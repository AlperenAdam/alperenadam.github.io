/* Racha Viagem — regras de divisão, saldos, acerto mínimo e código Pix.
   Tudo em centavos (inteiros) para não perder 1 centavo no caminho. */
(function (raiz) {
  'use strict';

  const CATEGORIAS = [
    { id: 'hospedagem', nome: 'Hospedagem', icone: '🏠', modo: 'noites' },
    { id: 'aluguel', nome: 'Aluguel de carro', icone: '🚗', modo: 'carro' },
    { id: 'combustivel', nome: 'Combustível', icone: '⛽', modo: 'carro' },
    { id: 'pedagio', nome: 'Pedágio', icone: '🛣️', modo: 'carro' },
    { id: 'estacionamento', nome: 'Estacionamento', icone: '🅿️', modo: 'carro' },
    { id: 'desgaste', nome: 'Desgaste do carro', icone: '🔧', modo: 'carro' },
    { id: 'alimentacao', nome: 'Alimentação', icone: '🍽️', modo: 'presentes' },
    { id: 'mercado', nome: 'Mercado', icone: '🛒', modo: 'presentes' },
    { id: 'bebidas', nome: 'Bebidas', icone: '🍺', modo: 'presentes', marca: 'alcool' },
    { id: 'passeios', nome: 'Passeios', icone: '🎟️', modo: 'presentes' },
    { id: 'caucao', nome: 'Caução', icone: '🔒', modo: 'todos' },
    { id: 'outros', nome: 'Outros', icone: '📦', modo: 'presentes' }
  ];
  const CAT = Object.fromEntries(CATEGORIAS.map(c => [c.id, c]));

  const MODOS = {
    presentes: 'Quem estava na viagem no dia',
    todos: 'Todo mundo',
    noites: 'Por noites dormidas',
    carro: 'Quem estava no carro',
    escolher: 'Só quem eu escolher',
    valores: 'Valores exatos por pessoa'
  };

  const RESTRICOES = {
    alcool: '🍺 Não bebe álcool',
    carne: '🥩 Não come carne'
  };

  const centavos = v => Math.round((Number(v) || 0) * 100);
  const dia = s => (s ? Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000 : null);
  const peso = p => { const n = Number(p.peso); return p.peso === '' || p.peso == null || isNaN(n) ? 1 : Math.max(0, n); };

  // Valor que conta na divisão (em centavos de R$). Caução só conta o que ficou retido.
  function valorDoGasto(g) {
    if (g.categoria === 'caucao') return centavos(g.retido);
    if (g.valorBRL !== '' && g.valorBRL != null && !isNaN(Number(g.valorBRL))) return centavos(g.valorBRL);
    return centavos(Number(g.valor) * (Number(g.cambio) || 1));
  }

  function chegadaSaida(p, viagem) {
    return { ini: dia(p.chegada || viagem.inicio), fim: dia(p.saida || viagem.fim) };
  }

  // Reparte "total" centavos conforme os pesos; os centavos que sobram vão para os maiores restos.
  function repartir(total, pesos) {
    const ids = Object.keys(pesos).filter(k => pesos[k] > 0);
    const soma = ids.reduce((s, k) => s + pesos[k], 0);
    const out = {};
    if (!ids.length || !soma) return out;
    let usado = 0;
    const restos = ids.map(k => {
      const exato = total * pesos[k] / soma;
      out[k] = Math.floor(exato);
      usado += out[k];
      return { k, r: exato - out[k] };
    });
    restos.sort((a, b) => b.r - a.r || (a.k < b.k ? -1 : 1));
    for (let i = 0; usado < total; i = (i + 1) % restos.length) { out[restos[i].k]++; usado++; }
    return out;
  }

  /* Quem paga quanto de um gasto: { pessoaId: centavos }.
     d = { viagem, pessoas, carros } */
  function dividir(g, d) {
    const total = valorDoGasto(g);
    const pessoas = d.pessoas || [];
    if (!total || !pessoas.length) return {};
    const modo = g.modo || (CAT[g.categoria] || {}).modo || 'presentes';

    if (modo === 'valores') {
      const v = g.valores || {};
      const pesos = {};
      pessoas.forEach(p => { pesos[p.id] = centavos(v[p.id]); });
      const soma = Object.values(pesos).reduce((s, x) => s + x, 0);
      if (soma === total) { Object.keys(pesos).forEach(k => { if (!pesos[k]) delete pesos[k]; }); return pesos; }
      return repartir(total, pesos); // valores não fecham com o total: reparte proporcionalmente
    }

    let grupo = pessoas;
    if (modo === 'presentes' && g.data) {
      const x = dia(g.data);
      const presentes = pessoas.filter(p => { const c = chegadaSaida(p, d.viagem || {}); return (c.ini == null || x >= c.ini) && (c.fim == null || x <= c.fim); });
      if (presentes.length) grupo = presentes;
    } else if (modo === 'carro') {
      const carro = (d.carros || []).find(c => c.id === g.carro);
      const occ = carro ? pessoas.filter(p => (carro.ocupantes || []).indexOf(p.id) >= 0) : [];
      if (occ.length) grupo = occ;
    } else if (modo === 'escolher') {
      const esc = pessoas.filter(p => (g.participantes || []).indexOf(p.id) >= 0);
      if (esc.length) grupo = esc;
    }

    // Quem marcou "não vou" neste item sai da divisão.
    if ((g.ausentes || []).length) {
      const vai = grupo.filter(p => g.ausentes.indexOf(p.id) < 0);
      if (vai.length) grupo = vai;
    }

    // Marca (ex.: bebida alcoólica) tira quem tem a restrição.
    if (g.marca) {
      const sem = grupo.filter(p => (p.restricoes || []).indexOf(g.marca) < 0);
      if (sem.length) grupo = sem;
    }

    const pesos = {};
    if (modo === 'noites') {
      grupo.forEach(p => {
        const c = chegadaSaida(p, d.viagem || {});
        const noites = c.ini != null && c.fim != null ? Math.max(0, c.fim - c.ini) : 1;
        pesos[p.id] = noites * peso(p);
      });
      if (!Object.values(pesos).some(x => x > 0)) grupo.forEach(p => { pesos[p.id] = peso(p) || 1; });
    } else {
      grupo.forEach(p => { pesos[p.id] = peso(p); });
      if (!Object.values(pesos).some(x => x > 0)) grupo.forEach(p => { pesos[p.id] = 1; });
    }
    return repartir(total, pesos);
  }

  /* Saldo de cada pessoa (centavos): positivo = tem a receber; negativo = deve. */
  function saldos(d) {
    const s = {}, pago = {}, consumo = {};
    (d.pessoas || []).forEach(p => { s[p.id] = 0; pago[p.id] = 0; consumo[p.id] = 0; });
    (d.gastos || []).forEach(g => {
      if (g.status === 'previsto') return; // item do roteiro ainda não pago: não entra no acerto
      const total = valorDoGasto(g);
      if (!total) return;
      const partes = dividir(g, d);
      if (!Object.keys(partes).length) return;
      if (g.pagoPor in s) { s[g.pagoPor] += total; pago[g.pagoPor] += total; }
      Object.keys(partes).forEach(k => { if (k in s) { s[k] -= partes[k]; consumo[k] += partes[k]; } });
    });
    (d.acertos || []).forEach(a => {
      const v = centavos(a.valor);
      if (a.de in s) s[a.de] += v;
      if (a.para in s) s[a.para] -= v;
    });
    return { saldo: s, pago, consumo };
  }

  /* Parte de cada pessoa em todos os gastos, pagos ou ainda a pagar (o "quanto vai custar para mim"). */
  function partes(d, filtro) {
    const out = {};
    (d.pessoas || []).forEach(p => { out[p.id] = 0; });
    (d.gastos || []).filter(filtro || (() => true)).forEach(g => {
      const ps = dividir(g, d);
      Object.keys(ps).forEach(k => { if (k in out) out[k] += ps[k]; });
    });
    return out;
  }

  /* Menor número de transferências para zerar os saldos. */
  function transferencias(saldo) {
    const dev = [], cred = [];
    Object.keys(saldo).forEach(k => {
      if (saldo[k] < 0) dev.push({ k, v: -saldo[k] });
      else if (saldo[k] > 0) cred.push({ k, v: saldo[k] });
    });
    const out = [];
    // Primeiro casa valores iguais (1 transferência resolve duas pessoas).
    for (let i = dev.length - 1; i >= 0; i--) {
      const j = cred.findIndex(c => c.v === dev[i].v);
      if (j >= 0) { out.push({ de: dev[i].k, para: cred[j].k, valor: dev[i].v }); dev.splice(i, 1); cred.splice(j, 1); }
    }
    dev.sort((a, b) => b.v - a.v); cred.sort((a, b) => b.v - a.v);
    while (dev.length && cred.length) {
      const a = dev[0], b = cred[0], v = Math.min(a.v, b.v);
      out.push({ de: a.k, para: b.k, valor: v });
      a.v -= v; b.v -= v;
      if (!a.v) dev.shift();
      if (!b.v) cred.shift();
      dev.sort((x, y) => y.v - x.v); cred.sort((x, y) => y.v - x.v);
    }
    return out;
  }

  /* ---------- Pix "copia e cola" (BR Code estático, padrão do Banco Central) ---------- */
  function semAcento(s, max) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9 .\-]/g, '').trim().slice(0, max).toUpperCase();
  }
  function campo(id, valor) { return id + String(valor.length).padStart(2, '0') + valor; }
  function crc16(s) {
    let crc = 0xFFFF;
    for (let i = 0; i < s.length; i++) {
      crc ^= s.charCodeAt(i) << 8;
      for (let j = 0; j < 8; j++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
    return crc.toString(16).toUpperCase().padStart(4, '0');
  }
  // Ajusta a chave: telefone ganha +55, CPF/CNPJ só números, e-mail e aleatória ficam como estão.
  function normalizarChave(ch) {
    let c = String(ch || '').trim();
    if (/@/.test(c) || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(c)) return c;
    const dig = c.replace(/\D/g, '');
    if (/^\+/.test(c)) return '+' + dig;
    if (dig.length === 11 && /[()\s-]/.test(c) && !/\./.test(c)) return '+55' + dig; // (62) 99999-9999
    if (dig.length === 11 || dig.length === 14) return dig; // CPF / CNPJ
    if (dig.length === 10 || dig.length === 13) return '+' + (dig.length === 10 ? '55' : '') + dig;
    return c;
  }
  function pix({ chave, nome, cidade, valor, mensagem }) {
    const k = normalizarChave(chave);
    if (!k) return '';
    let conta = campo('00', 'br.gov.bcb.pix') + campo('01', k);
    const msg = semAcento(mensagem, 40);
    if (msg && conta.length + msg.length + 4 <= 99) conta += campo('02', msg);
    let s = campo('00', '01') + campo('26', conta) + campo('52', '0000') + campo('53', '986');
    if (valor > 0) s += campo('54', (valor / 100).toFixed(2));
    s += campo('58', 'BR') + campo('59', semAcento(nome, 25) || 'RECEBEDOR') + campo('60', semAcento(cidade, 15) || 'BRASIL');
    s += campo('62', campo('05', '***')) + '6304';
    return s + crc16(s);
  }

  /* ---------- Planejamento: estimativa antes da viagem ---------- */
  function estimativa(pl, nPessoas) {
    const n = x => Number(String(x == null ? '' : x).replace(',', '.')) || 0;
    const litros = n(pl.consumo) ? n(pl.distancia) / n(pl.consumo) : 0;
    const linhas = {
      combustivel: centavos(litros * n(pl.precoLitro)),
      pedagio: centavos(pl.pedagio),
      hospedagem: centavos(pl.hospedagem),
      aluguel: centavos(pl.aluguel),
      alimentacao: centavos(n(pl.comidaDia) * n(pl.dias) * (nPessoas || 0)),
      passeios: centavos(pl.passeios),
      outros: centavos(pl.outros)
    };
    const total = Object.values(linhas).reduce((s, x) => s + x, 0);
    return { linhas, litros, total, porPessoa: nPessoas ? Math.round(total / nPessoas) : 0 };
  }

  const brl = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const API = { CATEGORIAS, CAT, MODOS, RESTRICOES, centavos, valorDoGasto, dividir, saldos, partes, transferencias, pix, crc16, normalizarChave, estimativa, brl, repartir };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.Calc = API;
})(this);
