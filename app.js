/* Nunnez — app de divisão de gastos de viagem (telas, sincronização com a planilha, modo offline). */
'use strict';
const CFG = window.CONFIG || {};
const NOME = CFG.NOME_APP || 'Nunnez';
const SLOGAN = CFG.SLOGAN || 'Rolê com Nunnez';
const DEMO = !CFG.API_URL;
const C = window.Calc;

/* ---------- utilidades ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hoje = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const brl = C.brl;
// Aceita "12,50", "1.234,56", "12.5"
function lerNum(s) {
  s = String(s ?? '').trim().replace(/[R$\s]/g, '');
  if (!s) return '';
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, ''); // "2.400" = dois mil e quatrocentos
  const n = Number(s);
  return isNaN(n) ? '' : n;
}
const fmtNum = n => (n === '' || n == null || isNaN(Number(n))) ? '' : String(Number(n)).replace('.', ',');
const fmtData = s => { if (!s) return ''; const [a, m, d] = s.split('-'); return `${d}/${m}${a !== String(new Date().getFullYear()) ? '/' + a.slice(2) : ''}`; };
const somaDias = (d, n) => { if (!d) return ''; const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
/* Par de datas (início/fim): o fim só aceita do início para frente e, ao escolher o início,
   já vem preenchido (o calendário do fim abre no mês certo, não no mês de hoje).
   lim = { min, max } limita os dois ao período (ex.: datas da viagem); dias = quantos dias somar no fim automático. */
function ligarDatas(ini, fim, lim = {}, dias = 1) {
  if (!ini) return;
  const aplica = () => {
    if (lim.min) ini.min = lim.min;
    if (lim.max) ini.max = lim.max;
    if (!fim) return;
    fim.min = ini.value || lim.min || '';
    if (lim.max) fim.max = lim.max;
  };
  ini.addEventListener('change', () => {
    if (fim && ini.value && (dias > 0 ? (!fim.value || fim.value < ini.value) : (fim.value && fim.value < ini.value))) {
      let v = somaDias(ini.value, Math.max(dias, 0));
      if (lim.max && v > lim.max) v = lim.max < ini.value ? ini.value : lim.max;
      fim.value = v; fim.dispatchEvent(new Event('change', { bubbles: true }));
    }
    aplica();
  });
  // sem data inicial ainda: o calendário do fim abre no começo do período, não em hoje
  if (fim && !fim.value && !ini.value && lim.min) fim.min = lim.min;
  aplica();
}
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const fmtDia = s => { const d = new Date(s + 'T12:00'); return `${DIAS[d.getDay()]}, ${fmtData(s)}`; };

const ls = {
  get(k, pad) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : pad; } catch (e) { return pad; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

function toast(msg) {
  const t = $('#toast'); t.textContent = msg;
  // Com uma janela aberta, o aviso precisa ficar dentro dela (senão aparece atrás).
  const dl = document.getElementById('dlg');
  const casa = dl && dl.open ? dl : document.body;
  if (t.parentNode !== casa) casa.appendChild(t);
  t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- comunicação com a planilha (ou modo demonstração) ---------- */
async function chamar(p) {
  if (DEMO) return demo(JSON.parse(JSON.stringify(p)));
  const r = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(p) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.erro || 'Erro'); e.servidor = true; e.login = !!j.login; throw e; }
  return j;
}
// Chamada dentro da viagem aberta (leva código e o "crachá" de quem entrou).
function req(acao, extra) { return chamar({ acao, v: S.v, c: S.c, tok: S.tok || '', ...(extra || {}) }); }

function aplicar(d, o) {
  if (o.op === 'viagem') { Object.assign(d.viagem, o.dados); return d; }
  if (o.op === 'presenca') {
    const g = (d.gastos || []).find(x => x.id === o.id);
    if (g) { g.ausentes = (g.ausentes || []).filter(x => x !== o.pessoa); if (!o.vai) g.ausentes.push(o.pessoa); }
    return d;
  }
  if (o.op === 'votar') {
    const e = (d.enquetes || []).find(x => x.id === o.id);
    if (e) { e.votos = { ...(e.votos || {}) }; if (o.opcao) e.votos[o.pessoa] = o.opcao; else delete e.votos[o.pessoa]; }
    return d;
  }
  const k = o.tipo === 'passagem' ? 'passagens' : o.tipo + 's';
  d[k] = d[k] || [];
  if (o.op === 'salvar') {
    const i = d[k].findIndex(x => x.id === o.item.id);
    if (i >= 0) d[k][i] = { ...d[k][i], ...o.item }; else d[k].push({ ...o.item });
  } else if (o.op === 'excluir') d[k] = d[k].filter(x => x.id !== o.id);
  return d;
}

// "Servidor" de mentira no próprio navegador, para testar sem planilha.
function demo(p) {
  const db = ls.get('rv:demo', { viagens: {} });
  const rnd = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
  const falha = m => { const e = new Error(m); e.servidor = true; throw e; };
  if (p.acao === 'criar') {
    const v = 'V' + rnd(8), c = rnd(6), o = p.organizador || {};
    const org = { id: 'P' + rnd(9), nome: o.nome, email: o.email || '', origem: o.origem || '', papel: 'organizador', peso: 1, restricoes: [], pix: '' };
    db.viagens[v] = { c, dados: { viagem: { id: v, nome: p.nome, inicio: p.inicio || '', fim: p.fim || '', destino: p.destino || '', aeroporto: p.aeroporto || '', plano: {}, legado: true }, pessoas: [org, ...(p.pessoas || [])], carros: [], gastos: [], acertos: [], passagens: [] } };
    ls.set('rv:demo', db);
    return { ok: true, v, c, eu: org.id, tok: '', dados: db.viagens[v].dados };
  }
  const t = db.viagens[p.v];
  if (!t) falha('Viagem não encontrada');
  if (t.c !== String(p.c || '').toUpperCase()) falha('Código da viagem incorreto');
  if (p.acao === 'nomes') return { ok: true, viagem: t.dados.viagem.nome, legado: true, pessoas: t.dados.pessoas.map(x => ({ id: x.id, nome: x.nome })) };
  if (p.acao === 'ops') { (p.ops || []).forEach(o => aplicar(t.dados, o)); ls.set('rv:demo', db); }
  if (p.acao === 'foto') return { ok: true, url: 'data:' + (p.mime || 'image/jpeg') + ';base64,' + p.base64, arquivo: '' };
  if (p.acao === 'lerCupom') falha('A leitura do cupom só funciona com a planilha ligada.');
  return { ok: true, dados: t.dados };
}

/* ---------- estado ---------- */
let S = null; // { v, c, tok, dados, fila, eu, enviando, erro, login }
let ABA = ls.get('rv:aba', 'gastos');

function minhas() { return ls.get('rv:viagens', []); }
function lembrar(v, c, nome) {
  const l = minhas().filter(x => x.v !== v);
  l.unshift({ v, c, nome });
  ls.set('rv:viagens', l);
}
function guardar() {
  if (!S) return;
  ls.set('rv:dados:' + S.v, S.dados);
  ls.set('rv:fila:' + S.v, S.fila);
  lembrar(S.v, S.c, S.dados.viagem.nome);
}

function pessoa(id) { return (S.dados.pessoas || []).find(p => p.id === id); }
const legado = () => !!(S && S.dados && S.dados.viagem.legado);
// Organizador: cadastra pessoas, define senhas iniciais, muda a viagem e confirma passagens.
const souOrg = () => legado() || (pessoa(S.eu) || {}).papel === 'organizador';
function guardarSessao(tok, eu) {
  S.tok = tok || ''; S.eu = eu || S.eu;
  ls.set('rv:tok:' + S.v, S.tok); ls.set('rv:eu:' + S.v, S.eu);
}
function recebeu(j) {
  if (j.eu) { S.eu = j.eu; ls.set('rv:eu:' + S.v, j.eu); }
  if (j.avisos && j.avisos.length) toast([...new Set(j.avisos)].join(' '));
}
function nome(id) { const p = pessoa(id); return p ? p.nome : '(removido)'; }
function primeiroNome(id) { return nome(id).split(' ')[0]; }

function op(o) {
  // A senha inicial vai só para a planilha; não fica nos dados guardados no aparelho.
  if (o.item && o.item.senhaNova) { const { senhaNova, ...semSenha } = o.item; aplicar(S.dados, { ...o, item: { ...semSenha, temSenha: true, trocarSenha: true } }); }
  else aplicar(S.dados, o);
  S.fila.push(o);
  guardar();
  render();
  enviar();
}

async function enviar() {
  if (!S || S.enviando || !S.fila.length) return status();
  const alvo = S, lote = S.fila.slice();
  alvo.enviando = true; status();
  try {
    const j = await chamar({ acao: 'ops', v: alvo.v, c: alvo.c, tok: alvo.tok || '', ops: lote });
    alvo.fila = alvo.fila.slice(lote.length);
    alvo.dados = j.dados;
    alvo.fila.forEach(o => aplicar(alvo.dados, o));
    alvo.erro = '';
    if (S === alvo) recebeu(j);
  } catch (e) {
    if (e.login) { alvo.enviando = false; if (S === alvo) pedirLogin(e.message); return; } // a fila fica guardada até entrar de novo
    if (e.servidor) { toast('A planilha recusou: ' + e.message); alvo.fila = alvo.fila.slice(lote.length); setTimeout(() => atualizar(true), 500); }
    alvo.erro = e.servidor ? e.message : 'sem internet';
  } finally {
    alvo.enviando = false;
    if (S === alvo) { guardar(); render(); if (S.fila.length && !S.erro) setTimeout(enviar, 300); }
  }
}

async function atualizar(silencioso) {
  if (!S) return;
  if (S.fila.length) return enviar();
  const alvo = S;
  alvo.enviando = true; status();
  try {
    const j = await chamar({ acao: 'carregar', v: alvo.v, c: alvo.c, tok: alvo.tok || '' });
    alvo.dados = j.dados; alvo.erro = '';
    if (S === alvo) { recebeu(j); guardar(); render(); }
  } catch (e) {
    if (e.login) { alvo.enviando = false; if (S === alvo) pedirLogin(e.message); return; }
    alvo.erro = e.servidor ? e.message : 'sem internet';
    if (!silencioso) toast(e.servidor ? e.message : 'Sem internet: mostrando o que já estava salvo.');
  } finally { alvo.enviando = false; status(); }
}

function status() {
  const el = $('#status');
  if (!S || S.login) { el.classList.add('oculto'); return; }
  el.classList.remove('oculto');
  const n = S.fila.length;
  el.textContent = S.enviando ? 'sincronizando…' : n ? `${n} para enviar` : S.erro ? 'offline' : DEMO ? 'demonstração' : 'salvo ✓';
}

/* ---------- abrir / sair de viagem ---------- */
// Aba do momento: antes da viagem → Roteiro; durante → Gastos; depois → Acerto.
function abaDoMomento(viagem) {
  const h = hoje(), ini = viagem && viagem.inicio, fim = viagem && viagem.fim;
  if (fim && h > fim) return 'saldos';
  if (ini && h >= ini) return 'gastos';
  return 'roteiro';
}

function abrir(v, c) {
  const cache = ls.get('rv:dados:' + v, null);
  ABA = cache ? abaDoMomento(cache.viagem) : 'roteiro';
  S = { v, c: String(c).toUpperCase(), tok: ls.get('rv:tok:' + v, ''), dados: ls.get('rv:dados:' + v, null), fila: ls.get('rv:fila:' + v, []), eu: ls.get('rv:eu:' + v, ''), enviando: false, erro: '', login: null };
  history.replaceState(null, '', '#v=' + v + '&c=' + S.c);
  // Sem crachá numa viagem com senha: nem mostra o que estava guardado.
  if (!S.dados || (!S.tok && !S.dados.viagem.legado && !DEMO)) {
    S.dados = null;
    $('#tela').innerHTML = '<div class="vazio"><b>⏳</b>Abrindo a viagem…</div>';
    req('carregar').then(j => {
      S.dados = j.dados; recebeu(j); guardar(); ABA = abaDoMomento(S.dados.viagem); render();
      if (legado() && !S.eu) quemSouEu();
    }).catch(e => {
      if (e.login) return pedirLogin();
      toast(e.servidor ? e.message : 'Sem internet para abrir esta viagem pela primeira vez.');
      S = null; history.replaceState(null, '', location.pathname); render();
    });
    return;
  }
  render();
  if (S.fila.length) enviar(); else atualizar(true);
  if (legado() && !S.eu) quemSouEu();
}

/* ---------- login ---------- */
async function pedirLogin(msg) {
  if (!S) return;
  S.tok = ''; ls.del('rv:tok:' + S.v);
  S.login = { carregando: true, msg: msg || '' };
  render();
  try {
    const j = await chamar({ acao: 'nomes', v: S.v, c: S.c });
    if (j.legado) { S.login = null; return atualizar(false); }
    S.login = { viagem: j.viagem, pessoas: j.pessoas, msg: msg || '' };
  } catch (e) {
    toast(e.servidor ? e.message : 'Sem internet para entrar.');
    S.login = { viagem: '', pessoas: [], msg: 'Sem internet. Tente de novo quando tiver sinal.' };
  }
  render();
}

function telaLogin() {
  const L = S.login;
  $('#titulo').textContent = NOME; $('#subtitulo').textContent = SLOGAN;
  if (L.carregando) { $('#tela').innerHTML = '<div class="vazio"><b>⏳</b>Abrindo a viagem…</div>'; return; }
  const escolhido = L.escolhido || (L.pessoas.find(p => p.id === S.eu) || {}).id || '';
  const pe = L.pessoas.find(p => p.id === escolhido);
  const modo = escolhido === 'novo' ? 'novo' : pe ? (pe.temSenha ? 'senha' : 'primeiro') : '';
  const campoSenhas = `<label class="cp"><span>Crie uma senha</span><input type="password" name="senha" autocomplete="new-password" minlength="4" required></label>
      <label class="cp"><span>Repita a senha</span><input type="password" name="senha2" autocomplete="new-password" minlength="4" required></label>`;
  const campoEmail = `<label class="cp"><span>Seu e-mail (para avisos do roteiro e das passagens)</span><input type="email" name="email" autocomplete="email"></label>`;
  $('#tela').innerHTML = `
  <div class="heroi" style="padding-top:12px"><img src="logo.jpg" alt="${esc(NOME)}" style="width:min(150px,40vw)"></div>
  <div class="cartao">
    <h2>Entrar em ${esc(L.viagem || 'viagem')}</h2>
    ${L.msg ? `<div class="aviso">${esc(L.msg)}</div>` : ''}
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:6px">Quem é você?</span>
    <div class="chips" style="margin-bottom:14px">${L.pessoas.map(p => `<button class="chip" data-quem="${esc(p.id)}" aria-pressed="${p.id === escolhido}">${esc(p.nome)}</button>`).join('')}
      <button class="chip" data-quem="novo" aria-pressed="${escolhido === 'novo'}">➕ Não estou na lista</button></div>
    ${!modo ? '<p class="dica" style="margin:0">Toque no seu nome. Se ele não estiver aí, toque em "Não estou na lista".</p>' : `
    <form id="f-login">
      ${modo === 'senha' ? `<label class="cp"><span>Sua senha</span><input type="password" name="senha" autocomplete="current-password" required></label>` : ''}
      ${modo === 'primeiro' ? `<p class="mut" style="margin-top:0">Primeiro acesso, ${esc(pe.nome.split(' ')[0])}! Crie a sua senha.</p>${campoSenhas}${campoEmail}` : ''}
      ${modo === 'novo' ? `<label class="cp"><span>Seu nome</span><input type="text" name="nome" autocomplete="name" required></label>${campoEmail}${campoSenhas}` : ''}
      <button class="btn pri lg">${modo === 'senha' ? 'Entrar' : 'Criar acesso e entrar'}</button>
    </form>
    ${modo === 'senha' ? '<p class="dica" style="margin:12px 0 0">Esqueceu a senha? Peça ao organizador para criar uma nova.</p>' : ''}`}
  </div>`;
  $$('[data-quem]').forEach(b => b.onclick = () => { L.escolhido = b.dataset.quem; telaLogin(); const f = $('#f-login'); if (f) (f.nome || f.senha).focus(); });
  const fl = $('#f-login');
  if (!fl) return;
  fl.onsubmit = async e => {
    e.preventDefault();
    const f = e.target, btn = f.querySelector('button'), texto = btn.textContent;
    const senha = f.senha.value;
    if (f.senha2 && senha !== f.senha2.value) return toast('As duas senhas não são iguais.');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const base = { v: S.v, c: S.c, senha };
      const j = modo === 'senha' ? await chamar({ ...base, acao: 'entrar', pessoa: escolhido })
        : modo === 'primeiro' ? await chamar({ ...base, acao: 'primeiroAcesso', pessoa: escolhido, email: f.email.value.trim() })
        : await chamar({ ...base, acao: 'cadastrar', nome: f.nome.value.trim(), email: f.email.value.trim() });
      guardarSessao(j.tok, j.eu);
      S.login = null;
      const r = j.dados ? j : await req('carregar'); // planilha nova já devolve os dados junto
      S.dados = r.dados; recebeu(r); guardar(); ABA = abaDoMomento(S.dados.viagem); render();
      if (S.fila.length) enviar();
      if (j.trocarSenha) trocarSenha(senha, true);
      if (modo !== 'senha') toast(`Bem-vindo(a), ${nome(S.eu).split(' ')[0]}! Veja o roteiro na aba 🗺️.`);
    } catch (err) {
      btn.disabled = false; btn.textContent = texto;
      toast(err.servidor ? err.message : 'Sem internet para entrar.');
    }
  };
}

function trocarSenha(atual, obrigatorio) {
  const f = janela(obrigatorio ? 'Crie a sua senha' : 'Trocar minha senha', `
    ${obrigatorio ? '<p class="mut" style="margin-top:0">Você entrou com a senha que o organizador criou. Agora escolha uma só sua: ninguém mais vai saber qual é.</p>' : ''}
    ${obrigatorio ? '' : '<label class="cp"><span>Senha atual</span><input type="password" name="atual" autocomplete="current-password" required></label>'}
    <label class="cp"><span>Nova senha</span><input type="password" name="nova" autocomplete="new-password" minlength="4" required></label>
    <label class="cp"><span>Repita a nova senha</span><input type="password" name="nova2" autocomplete="new-password" minlength="4" required></label>`,
    `${obrigatorio ? '' : '<button class="btn" value="x" formnovalidate>Cancelar</button>'}<button class="btn pri" value="ok">Salvar senha</button>`);
  if (obrigatorio) dlg.oncancel = e => e.preventDefault(); // não fecha com Esc
  f.onsubmit = async e => {
    if (!e.submitter || e.submitter.value !== 'ok') return;
    e.preventDefault();
    const fd = new FormData(f);
    if (fd.get('nova') !== fd.get('nova2')) return toast('As duas senhas não são iguais.');
    if (String(fd.get('nova')).length < 4) return toast('Use pelo menos 4 caracteres.');
    try {
      const j = await req('senha', { atual: obrigatorio ? atual : fd.get('atual'), nova: fd.get('nova') });
      guardarSessao(j.tok, j.eu);
      dlg.oncancel = null; fecharJanela();
      toast('Senha salva ✓');
      atualizar(true);
    } catch (err) { toast(err.servidor ? err.message : 'Sem internet para trocar a senha.'); }
  };
}

function sairDaConta() {
  if (S.fila.length && !confirm(`Ainda há ${S.fila.length} alteração(ões) sem enviar. Sair mesmo assim?`)) return;
  ls.del('rv:dados:' + S.v); ls.del('rv:fila:' + S.v); S.fila = [];
  pedirLogin();
}

function sair() {
  S = null;
  history.replaceState(null, '', location.pathname + location.search);
  render();
}

function lerHash() {
  const h = new URLSearchParams(location.hash.slice(1));
  const v = h.get('v'), c = h.get('c');
  return v && c ? { v, c } : null;
}

/* ---------- desenho das telas ---------- */
function render() {
  if (S && S.login) {
    ['#abas', '#fab', '#btn-sync', '#btn-conta'].forEach(s => $(s).classList.add('oculto'));
    $('#btn-voltar').classList.remove('oculto');
    status();
    return telaLogin();
  }
  const emViagem = !!(S && S.dados);
  $('#abas').classList.toggle('oculto', !emViagem);
  $('#fab').classList.toggle('oculto', !emViagem || !['gastos', 'resumo'].includes(ABA));
  $('#btn-voltar').classList.toggle('oculto', !emViagem);
  $('#btn-sync').classList.toggle('oculto', !emViagem);
  $('#btn-conta').classList.toggle('oculto', !emViagem);
  $('.logo-top').classList.toggle('oculto', emViagem); // dentro da viagem, o espaço vai para o nome dela
  if (emViagem) { const eu = pessoa(S.eu); $('#btn-conta').textContent = eu ? eu.nome.trim().charAt(0).toUpperCase() : '👤'; }
  status();
  if (!emViagem) {
    $('#titulo').textContent = NOME;
    $('#subtitulo').textContent = SLOGAN;
    document.title = NOME;
    return telaInicio();
  }
  const v = S.dados.viagem;
  $('#titulo').textContent = v.nome;
  const eu = pessoa(S.eu);
  $('#subtitulo').textContent = [v.inicio && v.fim ? `${fmtData(v.inicio)} a ${fmtData(v.fim)}` : '', eu ? 'você: ' + eu.nome : ''].filter(Boolean).join(' · ') || `${S.dados.pessoas.length} pessoas`;
  document.title = v.nome + ' · ' + NOME;
  $$('#abas button').forEach(b => b.setAttribute('aria-current', b.dataset.aba === ABA ? 'page' : 'false'));
  ({ gastos: telaGastos, saldos: telaAcerto, voos: telaVoos, roteiro: telaRoteiro, plano: telaRoteiro, resumo: telaResumo, grupo: telaGrupo }[ABA] || telaGastos)();
}

function telaInicio() {
  const l = minhas();
  $('#tela').innerHTML = `
  <div class="heroi">
    <img src="logo.jpg" alt="${esc(NOME)} — ${esc(SLOGAN)}" onerror="this.outerHTML='<div class=&quot;logo&quot;>🧳</div><h1>${esc(NOME)}</h1>'">
    <p class="mut">Divida os gastos da viagem do jeito justo. O acerto sai por Pix.</p>
  </div>
  ${DEMO ? '<div class="aviso">Modo demonstração: os dados ficam só neste aparelho. Para dividir com os amigos, ligue a planilha (veja o LEIA-ME).</div>' : ''}
  <div class="btns" style="margin-bottom:14px">
    <button class="btn pri lg" id="nova">+ Nova viagem</button>
    <button class="btn lg" id="entrar">Entrar com link de convite</button>
  </div>
  ${l.length ? `<div class="titulo-sec">Minhas viagens</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${l.map(x => `
    <li class="clica" data-v="${esc(x.v)}" data-c="${esc(x.c)}"><span class="ico">🧳</span><span class="meio"><b>${esc(x.nome || x.v)}</b><small>Código ${esc(x.c)}</small></span><span class="mut">›</span></li>`).join('')}</ul></div>` : ''}
  <div class="vantagens">
    <div><b>🍺</b>Quem não bebe não paga a cerveja</div>
    <div><b>🛏️</b>Hospedagem por noite dormida</div>
    <div><b>🚗</b>Carro, gasolina e pedágio só para quem foi no carro</div>
    <div><b>⚡</b>Acerto com o mínimo de Pix</div>
  </div>`;
  $('#nova').onclick = novaViagem;
  $('#entrar').onclick = entrarComLink;
  $$('#tela li[data-v]').forEach(li => li.onclick = () => abrir(li.dataset.v, li.dataset.c));
}

const cadaUm = g => g.modo === 'porPessoa' || g.status === 'cada_um'; // cada um paga o seu na hora (só estimativa)
const pago = g => g.status !== 'previsto' && !cadaUm(g);
function totalGeral() { return (S.dados.gastos || []).filter(pago).reduce((s, g) => s + C.valorDoGasto(g), 0); }
function gastosOrdenados() {
  return (S.dados.gastos || []).filter(pago).sort((a, b) => (b.data || '').localeCompare(a.data || '') || String(b.id).localeCompare(String(a.id)));
}

let FILTRO = '';
function telaGastos() {
  const gs = gastosOrdenados().filter(g => !FILTRO || g.categoria === FILTRO);
  const sal = C.saldos(S.dados);
  const meu = S.eu in sal.saldo ? sal.saldo[S.eu] : null;
  const usadas = [...new Set((S.dados.gastos || []).filter(pago).map(g => g.categoria))];
  let html = `<div class="placar">
    <div class="cartao"><small>Total da viagem</small><strong class="num">${brl(totalGeral())}</strong></div>
    <div class="cartao"><small>${!meu ? 'Seu saldo' : meu > 0 ? 'Você tem a receber' : 'Você deve'}</small><strong class="num ${meu > 0 ? 'pos' : meu < 0 ? 'neg' : ''}">${meu === null ? '—' : brl(Math.abs(meu))}</strong></div>
  </div>`;
  const hist = (S.dados.historico || []).slice(0, 3);
  if (hist.length) html += `<div class="cartao" style="padding:10px 14px;margin-top:10px"><div style="display:flex;justify-content:space-between;align-items:center"><b class="peq">🕓 Últimas alterações</b><button class="btn mini" id="ver-hist">ver tudo</button></div>
    ${hist.map(h => `<div class="peq" style="margin-top:4px"><b>${esc(primeiroNome(h.pessoa))}</b> ${esc(h.texto)} <span class="mut">· ${quandoFoi(h.quando)}</span></div>`).join('')}</div>`;
  if (usadas.length > 1) html += `<div class="chips" style="margin:12px 0 2px"><button class="chip" data-f="" aria-pressed="${!FILTRO}">Todos</button>${usadas.map(c => `<button class="chip" data-f="${c}" aria-pressed="${FILTRO === c}">${(C.CAT[c] || C.CAT.outros).icone} ${(C.CAT[c] || C.CAT.outros).nome}</button>`).join('')}</div>`;
  if (!S.dados.pessoas.length) html += `<div class="cartao vazio"><b>👥</b>Comece cadastrando quem vai na viagem.<br><br><button class="btn pri" id="ir-grupo">Cadastrar pessoas</button></div>`;
  else if (!gs.length) html += `<div class="cartao vazio"><b>🧾</b>Nenhum gasto ainda.<br>Toque no <b style="display:inline;font-size:1rem">+</b> para lançar o primeiro.</div>`;
  let diaAtual = null, bloco = '';
  const fechar = () => { if (bloco) html += `<div class="cartao" style="padding:2px 16px"><ul class="lista">${bloco}</ul></div>`; bloco = ''; };
  gs.forEach(g => {
    if (g.data !== diaAtual) {
      fechar(); diaAtual = g.data;
      const soma = gs.filter(x => x.data === g.data).reduce((s, x) => s + C.valorDoGasto(x), 0);
      html += `<div class="dia"><span>${g.data ? fmtDia(g.data) : 'Sem data'}</span><span class="num">${brl(soma)}</span></div>`;
    }
    const cat = C.CAT[g.categoria] || C.CAT.outros;
    const partes = C.dividir(g, S.dados);
    const n = Object.keys(partes).length;
    const minha = partes[S.eu];
    const estr = g.moeda && g.moeda !== 'BRL' ? ` · ${g.moeda} ${fmtNum(g.valor)}` : '';
    bloco += `<li class="clica" data-g="${esc(g.id)}"><span class="ico">${cat.icone}</span><span class="meio">
      <b>${esc(g.descricao || cat.nome)}${g.status === 'pendente' ? '<span class="selo">pendente</span>' : ''}${g.foto ? ' 📎' : ''}</b>
      <small>${esc(primeiroNome(g.pagoPor))} pagou · ${g.categoria === 'caucao' ? `caução de ${brl(C.centavos(g.valor))}, ${C.valorDoGasto(g) ? 'parte retida' : 'a devolver'}` : `${n} ${n === 1 ? 'pessoa' : 'pessoas'}`}${estr}${minha ? ` · sua parte ${brl(minha)}` : ''}</small></span>
      <span class="num"><b>${brl(C.valorDoGasto(g))}</b></span></li>`;
  });
  fechar();
  $('#tela').innerHTML = html;
  $$('#tela [data-f]').forEach(b => b.onclick = () => { FILTRO = b.dataset.f; render(); });
  $$('#tela li[data-g]').forEach(li => li.onclick = () => {
    const g = S.dados.gastos.find(x => x.id === li.dataset.g);
    if (ehRoteiro(g)) return souOrg() ? formRoteiro(g) : irAba('roteiro');
    formGasto(g);
  });
  const ig = $('#ir-grupo'); if (ig) ig.onclick = () => irAba('grupo');
  const vh = $('#ver-hist'); if (vh) vh.onclick = janelaHistorico;
}

function telaSaldos() {
  const sal = C.saldos(S.dados);
  const tr = saldoAgrupado().transf;
  const pend = (S.dados.gastos || []).filter(g => g.status === 'pendente');
  const aPagar = (S.dados.gastos || []).filter(g => g.status === 'previsto');
  const falta = aPagar.reduce((s, g) => s + C.valorDoGasto(g) - C.jaPagoItem(g, S.dados), 0);
  const aguardando = (S.dados.acertos || []).filter(a => a.status === 'aguardando');
  let html = '';
  if (aPagar.length) html += `<div class="aviso" style="background:var(--suave);color:var(--tx)">🗺️ ${aPagar.length} ${aPagar.length === 1 ? 'item do roteiro ainda tem' : 'itens do roteiro ainda têm'} valor a pagar (${brl(falta)}). O que já foi pago (inteiro ou em partes) já está na conta abaixo. Sua parte prevista está na aba Roteiro.</div>`;
  if (aguardando.length) {
    html += `<div class="titulo-sec">⏳ Pix aguardando confirmação</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${aguardando.map(a => {
      const recebe = a.para === S.eu || souOrg();
      return `<li><span class="ico">⏳</span><span class="meio"><b>${esc(nome(a.de))} → ${esc(nome(a.para))}</b><small>${fmtData(a.data)} · ${recebe ? (a.para === S.eu ? 'você recebeu?' : 'aguardando ' + esc(primeiroNome(a.para)) + ' confirmar') : 'aguardando ' + esc(primeiroNome(a.para)) + ' confirmar'}</small></span><span class="num">${brl(C.centavos(a.valor))}</span></li>
        ${recebe ? `<li style="border-top:0;padding-top:0;justify-content:flex-end"><button class="btn mini pri" data-recebi="${esc(a.id)}">Recebi ✓</button><button class="btn mini" data-naorecebi="${esc(a.id)}">Não recebi</button></li>` : ''}`;
    }).join('')}</ul><p class="dica" style="margin:0 0 10px">O Pix só entra na conta depois que quem recebeu confirmar.</p></div>`;
  }
  if (pend.length) html += `<div class="aviso">⏳ ${pend.length} ${pend.length === 1 ? 'gasto ainda está' : 'gastos ainda estão'} como pendente (${pend.map(g => esc(g.descricao || C.CAT[g.categoria]?.nome)).join(', ')}). O acerto já considera o valor estimado; corrija quando a fatura chegar.</div>`;
  html += `<div class="titulo-sec">Para zerar tudo</div><div class="cartao">`;
  if (!tr.length) html += `<div class="vazio" style="padding:10px"><b>🎉</b>Tudo certo, ninguém deve nada.</div>`;
  else html += `<p class="mut peq" style="margin:0 0 6px">${tr.length} ${tr.length === 1 ? 'transferência resolve' : 'transferências resolvem'} a viagem inteira.</p>` + tr.map((t, i) => {
    const rec = pessoa(t.para);
    const avisado = aguardando.filter(a => a.de === t.de && a.para === t.para).reduce((s, a) => s + C.centavos(a.valor), 0);
    return `<div class="transf"><div class="quem"><b>${esc(nome(t.de))}</b><span class="seta">→</span><b>${esc(nome(t.para))}</b><div class="num" style="font-size:1.15rem;font-weight:700">${brl(t.valor)}</div>
        ${avisado ? `<div class="peq" style="color:var(--ali)">⏳ ${brl(avisado)} já avisado, aguardando confirmação</div>` : ''}</div>
      <div class="btns">${rec && rec.pix ? `<button class="btn mini pri" data-pix="${i}">Pagar com Pix</button>` : `<button class="btn mini sua" data-semchave="${esc(t.para)}">+ Chave Pix de ${esc(primeiroNome(t.para))}</button>`}<button class="btn mini" data-pago="${i}">${t.para === S.eu ? 'Já recebi' : 'Já paguei'}</button></div></div>`;
  }).join('');
  html += `</div><div class="titulo-sec">Situação de cada um</div><div class="cartao" style="padding:4px 16px"><ul class="lista">`;
  S.dados.pessoas.forEach(p => {
    const s = sal.saldo[p.id] || 0;
    html += `<li><span class="ico">${s > 0 ? '💰' : s < 0 ? '💸' : '✅'}</span><span class="meio"><b>${esc(p.nome)}${p.id === S.eu ? ' (você)' : ''}</b><small>pagou ${brl(sal.pago[p.id] || 0)} · consumiu ${brl(sal.consumo[p.id] || 0)}</small></span>
      <span class="num ${s > 0 ? 'pos' : s < 0 ? 'neg' : 'mut'}"><b>${s > 0 ? '+' : s < 0 ? '−' : ''}${brl(Math.abs(s))}</b></span></li>`;
  });
  html += `</ul></div>`;
  const ac = (S.dados.acertos || []).filter(a => a.status !== 'aguardando').sort((a, b) => String(b.id).localeCompare(String(a.id)));
  if (ac.length) {
    html += `<div class="titulo-sec">Pagamentos confirmados</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${ac.map(a => `
      <li><span class="ico">✔️</span><span class="meio"><b>${esc(nome(a.de))} → ${esc(nome(a.para))}</b><small>${fmtData(a.data)}${a.confirmadoPor ? ' · confirmado por ' + esc(primeiroNome(a.confirmadoPor)) : ''}${a.obs ? ' · ' + esc(a.obs) : ''}</small></span><span class="num">${brl(C.centavos(a.valor))}</span>
      ${souOrg() || legado() || a.de === S.eu || a.para === S.eu ? `<button class="ic-btn" data-desfaz="${esc(a.id)}" aria-label="Desfazer" title="Desfazer">✕</button>` : ''}</li>`).join('')}</ul></div>`;
  }
  html += `<button class="btn lg" id="acerto-manual">Registrar outro pagamento entre amigos</button>`;
  $('#tela').innerHTML = html;
  $$('[data-pix]').forEach(b => b.onclick = () => janelaPix(tr[b.dataset.pix]));
  $$('[data-semchave]').forEach(b => b.onclick = () => formPessoa(pessoa(b.dataset.semchave)));
  $$('[data-pago]').forEach(b => b.onclick = () => {
    const t = tr[b.dataset.pago];
    if (confirm(`Confirmar que ${nome(t.de)} já pagou ${brl(t.valor)} para ${nome(t.para)}?`)) registrarPix(t.de, t.para, t.valor / 100, '');
  });
  $$('[data-recebi]').forEach(b => b.onclick = () => { const a = S.dados.acertos.find(x => x.id === b.dataset.recebi); op({ op: 'salvar', tipo: 'acerto', item: { ...a, status: 'confirmado', confirmadoPor: S.eu } }); toast('Recebimento confirmado ✓'); });
  $$('[data-naorecebi]').forEach(b => b.onclick = () => { if (confirm('Marcar que você NÃO recebeu esse Pix? O aviso será apagado.')) op({ op: 'excluir', tipo: 'acerto', id: b.dataset.naorecebi }); });
  $$('[data-desfaz]').forEach(b => b.onclick = () => { if (confirm('Desfazer este pagamento?')) op({ op: 'excluir', tipo: 'acerto', id: b.dataset.desfaz }); });
  $('#acerto-manual').onclick = () => formAcerto();
}

/* Contas juntas (casal): a conta de uma pessoa é acertada por outra. Guardado no plano da viagem (sem mudar a planilha). */
const juntas = () => (S.dados.viagem.plano || {}).juntas || {};
const responsavel = id => { const j = juntas(); return j[id] && j[id] !== id && pessoa(j[id]) ? j[id] : id; };
function saldoAgrupado() {
  const sal = C.saldos(S.dados), s = { ...sal.saldo };
  Object.keys(s).forEach(id => { const r = responsavel(id); if (r !== id) { s[r] = (s[r] || 0) + s[id]; s[id] = 0; } });
  return { ...sal, agrupado: s, transf: C.transferencias(s) };
}
const cobre = id => S.dados.pessoas.filter(p => p.id !== id && responsavel(p.id) === id); // quem esta pessoa cobre

/* Aba Acerto: cada um vê só o que é seu. A situação de todo mundo fica no Resumo. */
function telaAcerto() {
  if (!S.eu) return telaSaldos(); // viagem antiga sem login: mostra tudo
  const eu = S.eu, resp = responsavel(eu), org = souOrg();
  const meusIds = [eu, ...cobre(eu).map(p => p.id)];
  const ag = saldoAgrupado(), meuSaldo = ag.agrupado[resp] || 0;
  const minhas = ag.transf.filter(t => t.de === resp || t.para === resp);
  const aguardando = (S.dados.acertos || []).filter(a => a.status === 'aguardando' && (org || meusIds.includes(a.de) || meusIds.includes(a.para)));
  let html = '';
  if (resp !== eu) html += `<div class="aviso" style="background:var(--suave);color:var(--tx)">💑 Sua conta é acertada por <b>${esc(nome(resp))}</b>. O que você deve ou tem a receber está somado na conta dele(a).</div>`;
  // 1) roteiro: a parte de cada um em cada item
  const itens = itensRoteiro().filter(g => C.dividir(g, S.dados)[eu]);
  if (itens.length) {
    let totalParte = 0, totalPend = 0;
    html += `<div class="titulo-sec">🗺️ Sua parte no roteiro${cobre(eu).length ? ' (só a sua)' : ''}</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${itens.map(g => {
      const parte = C.dividir(g, S.dados)[eu], total = C.valorDoGasto(g) || 1, cat = C.CAT[g.categoria] || C.CAT.outros;
      totalParte += parte;
      let sit;
      if (cadaUm(g)) sit = '<span class="mut">você paga na hora (não entra no acerto)</span>';
      else {
        const pagoParte = Math.round(parte * C.jaPagoItem(g, S.dados) / total), pend = parte - pagoParte;
        totalPend += pend;
        sit = !pagoParte ? `<span style="color:var(--ali)">⏳ pendente: ainda não foi pago</span>`
          : pend > 0 ? `<span class="pos">sinal ${brl(pagoParte)} já no acerto</span> · <span style="color:var(--ali)">restante ${brl(pend)} pendente</span>`
          : `<span class="pos">✓ quitado: entra no acerto</span>`;
      }
      return `<li><span class="ico">${cat.icone}</span><span class="meio"><b>${esc(g.descricao)}</b><small style="white-space:normal">${sit}</small></span><span class="num"><b>${brl(parte)}</b></span></li>`;
    }).join('')}</ul>
    <div class="peq" style="display:flex;justify-content:space-between;border-top:1px solid var(--lin);padding:10px 0;font-weight:700"><span>Sua parte no roteiro</span><span class="num">${brl(totalParte)}${totalPend ? ` <span style="color:var(--ali)">(${brl(totalPend)} pendente)</span>` : ''}</span></div></div>`;
  }
  // 2) Pix aguardando confirmação (os meus)
  if (aguardando.length) {
    html += `<div class="titulo-sec">⏳ Pix aguardando confirmação</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${aguardando.map(a => {
      const recebe = meusIds.includes(a.para) || org;
      return `<li><span class="ico">⏳</span><span class="meio"><b>${esc(nome(a.de))} → ${esc(nome(a.para))}</b><small>${fmtData(a.data)}</small></span><span class="num">${brl(C.centavos(a.valor))}</span></li>
        ${recebe ? `<li style="border-top:0;padding-top:0;justify-content:flex-end"><button class="btn mini pri" data-recebi="${esc(a.id)}">Recebi ✓</button><button class="btn mini" data-naorecebi="${esc(a.id)}">Não recebi</button></li>` : ''}`;
    }).join('')}</ul></div>`;
  }
  // 3) meu acerto
  html += `<div class="titulo-sec">💸 Seu acerto${resp !== eu ? ' (com ' + esc(primeiroNome(resp)) + ')' : cobre(eu).length ? ' (com ' + cobre(eu).map(p => esc(primeiroNome(p.id))).join(', ') + ')' : ''}</div>
  <div class="cartao"><div style="text-align:center;margin-bottom:6px"><div class="peq mut">${meuSaldo > 0 ? 'Você tem a receber' : meuSaldo < 0 ? 'Você tem a pagar' : 'Situação'}</div>
    <div class="num ${meuSaldo > 0 ? 'pos' : meuSaldo < 0 ? 'neg' : ''}" style="font-size:1.8rem;font-weight:800">${meuSaldo ? brl(Math.abs(meuSaldo)) : '🎉 Em dia'}</div>
    <div class="peq mut">Conta só o que já foi pago. Itens pendentes do roteiro entram quando forem pagos.</div></div>`;
  html += minhas.map((t, i) => {
    const rec = pessoa(t.para), eu_paga = t.de === resp;
    const avisado = aguardando.filter(a => a.de === t.de && a.para === t.para).reduce((s, a) => s + C.centavos(a.valor), 0);
    const outro = resp !== eu; // conta acertada por outra pessoa (casal): só mostra, quem paga/recebe é o responsável
    return `<div class="transf"><div class="quem">${outro ? (eu_paga ? `<b>${esc(nome(resp))}</b> paga para <b>${esc(nome(t.para))}</b> (inclui a sua parte)` : `<b>${esc(nome(t.de))}</b> paga para <b>${esc(nome(resp))}</b> (inclui a sua parte)`)
      : eu_paga ? `Você paga para <b>${esc(nome(t.para))}</b>` : `<b>${esc(nome(t.de))}</b> paga para você`}<div class="num" style="font-size:1.15rem;font-weight:700">${brl(t.valor)}</div>
      ${avisado ? `<div class="peq" style="color:var(--ali)">⏳ ${brl(avisado)} avisado, aguardando confirmação</div>` : ''}</div>
      ${outro ? '' : `<div class="btns">${eu_paga ? (rec && rec.pix ? `<button class="btn mini pri" data-pixm="${i}">Pagar com Pix</button>` : `<span class="peq mut">${esc(primeiroNome(t.para))} ainda não cadastrou Pix</span>`) : ''}<button class="btn mini" data-pagom="${i}">${eu_paga ? 'Já paguei' : 'Já recebi'}</button></div>`}</div>`;
  }).join('') + '</div>';
  const conf = (S.dados.acertos || []).filter(a => a.status !== 'aguardando' && (org || meusIds.includes(a.de) || meusIds.includes(a.para)));
  if (conf.length) html += `<div class="titulo-sec">Seus pagamentos confirmados</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${conf.map(a => `<li><span class="ico">✔️</span><span class="meio"><b>${esc(nome(a.de))} → ${esc(nome(a.para))}</b><small>${fmtData(a.data)}${a.obs ? ' · ' + esc(a.obs) : ''}</small></span><span class="num">${brl(C.centavos(a.valor))}</span>
    <button class="ic-btn" data-desfaz="${esc(a.id)}" aria-label="Desfazer" title="Desfazer">✕</button></li>`).join('')}</ul></div>`;
  html += `<button class="btn lg" id="acerto-manual">Registrar outro pagamento</button><p class="dica" style="text-align:center">A situação de todo o grupo está na aba 📊 Resumo.</p>`;
  $('#tela').innerHTML = html;
  $$('[data-pixm]').forEach(b => b.onclick = () => janelaPix(minhas[b.dataset.pixm]));
  $$('[data-pagom]').forEach(b => b.onclick = () => { const t = minhas[b.dataset.pagom]; if (confirm(`Confirmar: ${nome(t.de)} pagou ${brl(t.valor)} para ${nome(t.para)}?`)) registrarPix(t.de, t.para, t.valor / 100, ''); });
  $$('[data-recebi]').forEach(b => b.onclick = () => { const a = S.dados.acertos.find(x => x.id === b.dataset.recebi); op({ op: 'salvar', tipo: 'acerto', item: { ...a, status: 'confirmado', confirmadoPor: S.eu } }); toast('Recebimento confirmado ✓'); });
  $$('[data-naorecebi]').forEach(b => b.onclick = () => { if (confirm('Marcar que NÃO recebeu esse Pix? O aviso será apagado.')) op({ op: 'excluir', tipo: 'acerto', id: b.dataset.naorecebi }); });
  $$('[data-desfaz]').forEach(b => b.onclick = () => { if (confirm('Desfazer este pagamento?')) op({ op: 'excluir', tipo: 'acerto', id: b.dataset.desfaz }); });
  $('#acerto-manual').onclick = () => formAcerto();
}

// Quem recebe (ou o organizador) registra já confirmado; quem paga avisa e fica aguardando a confirmação.
function registrarPix(de, para, valor, obs) {
  const confirma = legado() || para === S.eu || souOrg();
  op({ op: 'salvar', tipo: 'acerto', item: { id: uid('A'), data: hoje(), de, para, valor, obs, status: confirma ? 'confirmado' : 'aguardando', confirmadoPor: confirma ? S.eu : '' } });
  toast(confirma ? 'Pagamento registrado ✓' : `Avisado ✓ Agora ${primeiroNome(para)} confirma que recebeu.`);
}

/* Plano: estimativa antes da viagem × o que já foi gasto */
const CAMPOS_PLANO = [
  ['distancia', 'Distância total (ida + volta, km)'], ['consumo', 'Consumo do carro (km/l)'], ['precoLitro', 'Preço do litro (R$)'],
  ['pedagio', 'Pedágios no total (R$)'], ['hospedagem', 'Hospedagem no total (R$)'], ['aluguel', 'Aluguel de carro (R$)'],
  ['comidaDia', 'Comida por pessoa por dia (R$)'], ['dias', 'Dias de viagem'], ['passeios', 'Passeios (R$)'], ['outros', 'Outros (R$)']
];
function telaPlano() {
  const pl = S.dados.viagem.plano || {};
  const n = S.dados.pessoas.length;
  const est = C.estimativa(pl, n);
  const real = {};
  (S.dados.gastos || []).filter(pago).forEach(g => { const k = ['eventos', 'trilhas'].includes(g.categoria) ? 'passeios' : ['mercado', 'bebidas'].includes(g.categoria) ? 'alimentacao' : ['estacionamento', 'desgaste', 'caucao'].includes(g.categoria) ? 'outros' : g.categoria; real[k] = (real[k] || 0) + C.valorDoGasto(g); });
  const totalReal = totalGeral();
  const rot = { combustivel: '⛽ Combustível', pedagio: '🛣️ Pedágio', hospedagem: '🏠 Hospedagem', aluguel: '🚗 Aluguel de carro', alimentacao: '🍽️ Comida e bebida', passeios: '🎟️ Passeios', outros: '📦 Outros' };
  const max = Math.max(1, ...Object.keys(rot).map(k => Math.max(est.linhas[k] || 0, real[k] || 0)));
  let html = `<div class="cartao"><h2>Quanto vai custar?</h2>
    <p class="mut peq" style="margin-top:-4px">Preencha antes de viajar para todo mundo saber quanto levar. Os campos são da viagem toda.</p>
    <div class="grade2">${CAMPOS_PLANO.map(([k, r]) => `<label class="cp"><span>${r}</span><input type="text" inputmode="decimal" data-pl="${k}" value="${esc(fmtNum(pl[k]))}"></label>`).join('')}</div>
    ${est.litros ? `<p class="dica">≈ ${Math.round(est.litros)} litros de combustível.</p>` : ''}
  </div>
  <div class="placar">
    <div class="cartao"><small>Previsto por pessoa</small><strong class="num">${n ? brl(est.porPessoa) : '—'}</strong></div>
    <div class="cartao"><small>Gasto até agora por pessoa</small><strong class="num ${n && est.porPessoa && totalReal / n > est.porPessoa ? 'neg' : ''}">${n ? brl(Math.round(totalReal / n)) : '—'}</strong></div>
  </div>
  <div class="cartao"><h2>Previsto × real</h2>
    <p class="mut peq" style="margin-top:-4px">Barra = gasto real · risco = previsto</p>
    ${Object.keys(rot).map(k => `<div class="linha-bar"><div class="t"><span>${rot[k]}</span><span class="num">${brl(real[k] || 0)} <span class="mut">/ ${brl(est.linhas[k] || 0)}</span></span></div>
      <div class="barra"><i style="width:${(real[k] || 0) / max * 100}%;${(real[k] || 0) > (est.linhas[k] || 0) && est.linhas[k] ? 'background:var(--neg)' : ''}"></i>${est.linhas[k] ? `<i class="plan" style="width:${est.linhas[k] / max * 100}%"></i>` : ''}</div></div>`).join('')}
    <div class="t" style="display:flex;justify-content:space-between;font-weight:700;border-top:1px solid var(--lin);padding-top:10px"><span>Total</span><span class="num">${brl(totalReal)} <span class="mut">/ ${brl(est.total)}</span></span></div>
  </div>`;
  ($('#plano-box') || $('#tela')).innerHTML = html; // dentro do Roteiro (calculadora) ou tela própria
  if (!souOrg()) $$('[data-pl]').forEach(inp => { inp.disabled = true; });
  $$('[data-pl]').forEach(inp => inp.onchange = () => {
    const novo = { ...(S.dados.viagem.plano || {}) };
    novo[inp.dataset.pl] = lerNum(inp.value);
    op({ op: 'viagem', dados: { plano: novo } });
  });
}

/* ---------- Voos: passagens de cada um ---------- */
const TRECHOS = { ida: 'Ida', volta: 'Volta' };
const SIT = {
  pendente: { t: 'Falta comprar', i: '⏳', cls: 'neg' },
  comprada: { t: 'Comprada, aguardando confirmação', i: '🎫', cls: '' },
  confirmada: { t: 'Confirmada', i: '✅', cls: 'pos' },
  nao_precisa: { t: 'Não vai de avião', i: '🚗', cls: 'mut' }
};
const idPassagem = (pid, tr) => 'T-' + pid + '-' + tr;
function passagemDe(pid, tr) { return (S.dados.passagens || []).find(x => x.pessoa === pid && x.trecho === tr) || null; }
function sitDe(pid, tr) { const p = passagemDe(pid, tr); return p ? p.status || 'pendente' : 'pendente'; }
const resolvida = s => ['comprada', 'confirmada', 'nao_precisa'].includes(s);
function fmtHora(s) { if (!s) return ''; const d = s.slice(0, 10), h = s.slice(11, 16); return fmtData(d) + (h ? ' ' + h : ''); }
function destinoViagem() { const v = S.dados.viagem; return v.aeroporto || v.destino || ''; }
function linkVoos(pid, tr) {
  const p = pessoa(pid) || {}, v = S.dados.viagem;
  const ida = p.chegada || v.inicio, volta = p.saida || v.fim;
  const casa = p.origem || (passagemDe(pid, 'ida') || {}).de || '';
  const de = tr === 'volta' ? destinoViagem() : casa, para = tr === 'volta' ? casa : destinoViagem();
  const q = 'Flights' + (para ? ` to ${para}` : '') + (de ? ` from ${de}` : '') + (tr === 'volta' ? (volta ? ` on ${volta}` : '') : (ida ? ` on ${ida}` : '') + (volta ? ` through ${volta}` : ''));
  return 'https://www.google.com/travel/flights?hl=pt-BR&curr=BRL&q=' + encodeURIComponent(q);
}

/* ---------- Checklist: o que levar (do grupo e de cada um) ---------- */
const SUGESTOES_BAGAGEM = ['Documento com foto', 'Cartão do plano de saúde', 'Carregador e power bank', 'Protetor solar', 'Repelente', 'Roupa de banho', 'Tênis para trilha', 'Casaco leve', 'Remédios de uso pessoal', 'Óculos de sol', 'Garrafa de água', 'Dinheiro trocado'];
const SUGESTOES_GRUPO = ['Caixa térmica', 'Kit de primeiros socorros', 'Caixa de som', 'Carvão e sal grosso', 'Baralho / jogos'];
function htmlChecklist() {
  const ts = S.dados.tarefas || [], grupo = ts.filter(t => t.tipo !== 'meu'), meus = ts.filter(t => t.tipo === 'meu' && t.pessoa === S.eu);
  const feito = t => t.feito === 'sim' || t.feito === true;
  const linha = (t, comQuem) => `<li><label class="check" style="flex:1;padding:4px 0"><input type="checkbox" data-feito="${esc(t.id)}" ${feito(t) ? 'checked' : ''}><span style="${feito(t) ? 'text-decoration:line-through;color:var(--mut)' : ''}">${esc(t.texto)}</span></label>
    ${comQuem ? `<select data-quemleva="${esc(t.id)}" style="max-width:120px;min-height:34px;padding:4px 8px;font-size:.85rem">${opcoesPessoas(t.pessoa, 'Quem leva?')}</select>` : ''}<button class="ic-btn" data-deltar="${esc(t.id)}" aria-label="Tirar" title="Tirar">✕</button></li>`;
  return `<div class="titulo-sec">🎒 O que levar</div>
  <div class="cartao"><h2>Do grupo <span class="mut peq" style="font-weight:400">(${grupo.filter(feito).length}/${grupo.length})</span></h2>
    <ul class="lista">${grupo.map(t => linha(t, true)).join('') || '<li class="mut peq">Coisas que servem para todos: caixa térmica, som, kit de primeiros socorros…</li>'}</ul>
    <div style="display:flex;gap:6px;margin-top:8px"><input type="text" id="nova-tar-grupo" placeholder="Adicionar item do grupo"><button class="btn mini pri" id="add-tar-grupo">+</button></div>
    ${grupo.length ? '' : '<button class="btn mini sua" id="sug-grupo" style="margin-top:8px">Usar sugestões</button>'}</div>
  ${S.eu ? `<div class="cartao"><h2>Minha lista <span class="mut peq" style="font-weight:400">(${meus.filter(feito).length}/${meus.length}) · só você vê</span></h2>
    <ul class="lista">${meus.map(t => linha(t, false)).join('') || '<li class="mut peq">Sua lista pessoal do que colocar na mala.</li>'}</ul>
    <div style="display:flex;gap:6px;margin-top:8px"><input type="text" id="nova-tar-meu" placeholder="Adicionar na minha lista"><button class="btn mini pri" id="add-tar-meu">+</button></div>
    ${meus.length ? '' : '<button class="btn mini sua" id="sug-meu" style="margin-top:8px">Usar sugestões</button>'}</div>` : ''}`;
}
function ligarChecklist() {
  const tar = id => S.dados.tarefas.find(t => t.id === id);
  const nova = (texto, tipo) => op({ op: 'salvar', tipo: 'tarefa', item: { id: uid('K'), texto, tipo, pessoa: tipo === 'meu' ? S.eu : '', feito: '', criadoPor: S.eu } });
  const add = (campo, tipo) => { const el = $('#' + campo); const x = el && el.value.trim(); if (x) { nova(x, tipo); } };
  if ($('#add-tar-grupo')) { $('#add-tar-grupo').onclick = () => add('nova-tar-grupo', 'grupo'); $('#nova-tar-grupo').onkeydown = e => { if (e.key === 'Enter') add('nova-tar-grupo', 'grupo'); }; }
  if ($('#add-tar-meu')) { $('#add-tar-meu').onclick = () => add('nova-tar-meu', 'meu'); $('#nova-tar-meu').onkeydown = e => { if (e.key === 'Enter') add('nova-tar-meu', 'meu'); }; }
  if ($('#sug-grupo')) $('#sug-grupo').onclick = () => SUGESTOES_GRUPO.forEach(x => nova(x, 'grupo'));
  if ($('#sug-meu')) $('#sug-meu').onclick = () => SUGESTOES_BAGAGEM.forEach(x => nova(x, 'meu'));
  $$('[data-feito]').forEach(c => c.onchange = () => op({ op: 'salvar', tipo: 'tarefa', item: { ...tar(c.dataset.feito), feito: c.checked ? 'sim' : '' } }));
  $$('[data-quemleva]').forEach(s => s.onchange = () => op({ op: 'salvar', tipo: 'tarefa', item: { ...tar(s.dataset.quemleva), pessoa: s.value } }));
  $$('[data-deltar]').forEach(b => b.onclick = () => op({ op: 'excluir', tipo: 'tarefa', id: b.dataset.deltar }));
}

function telaVoos() {
  const v = S.dados.viagem, ps = S.dados.pessoas, eu = pessoa(S.eu), org = souOrg();
  const conta = tr => ps.filter(p => resolvida(sitDe(p.id, tr))).length;
  let html = `<div class="cartao destaque">
    <div class="peq">Destino</div>
    <div style="font-size:1.3rem;font-weight:800">${esc(v.destino || 'Defina o destino')}${v.aeroporto ? ` <span style="opacity:.85">(${esc(v.aeroporto)})</span>` : ''}</div>
    <div class="peq">${v.inicio ? 'Ida ' + fmtData(v.inicio) : ''}${v.fim ? ' · Volta ' + fmtData(v.fim) : ''} · Ida ${conta('ida')}/${ps.length} · Volta ${conta('volta')}/${ps.length}</div>
  </div>`;
  if (!destinoViagem()) html += `<div class="aviso">${org ? 'Coloque o destino e o aeroporto na aba Grupo para o botão do Google Voos já abrir certinho.' : 'O organizador ainda não colocou o destino da viagem.'}</div>`;

  if (eu) {
    html += `<div class="titulo-sec">Minha passagem</div><div class="cartao">
      <label class="cp"><span>De onde você sai (cidade ou aeroporto)</span><input type="text" id="minha-origem" value="${esc(eu.origem || '')}" placeholder="Ex.: Goiânia ou GYN"></label>`;
    Object.keys(TRECHOS).forEach(tr => {
      const p = passagemDe(eu.id, tr), s = sitDe(eu.id, tr), si = SIT[s];
      html += `<div style="border-top:1px solid var(--lin);padding:12px 0">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center"><b>${TRECHOS[tr]}</b><span class="${si.cls} peq">${si.i} ${si.t}</span></div>
        ${p && ['comprada', 'confirmada'].includes(s) ? `<div class="peq" style="margin:4px 0 8px">${esc(p.cia)} ${esc(p.voo)} · ${esc(p.de)} → ${esc(p.para)}<br>Sai ${fmtHora(p.saida)} · chega <b>${fmtHora(p.chegada)}</b></div>` : ''}
        <div class="btns" style="margin-top:8px">
          ${s === 'pendente' ? `<a class="btn mini sua" href="${esc(linkVoos(eu.id, tr))}" target="_blank" rel="noopener">🔎 Ver preços no Google Voos</a>` : ''}
          ${s !== 'nao_precisa' ? `<button class="btn mini ${s === 'pendente' ? 'pri' : ''}" data-comprei="${tr}">${s === 'pendente' ? 'Já comprei' : 'Editar voo'}</button>` : ''}
          ${s === 'pendente' ? `<button class="btn mini" data-naoprecisa="${tr}">Não vou de avião</button>` : ''}
          ${s === 'nao_precisa' ? `<button class="btn mini" data-desfazer="${tr}">Vou de avião sim</button>` : ''}
        </div></div>`;
    });
    const faltaAlgo = Object.keys(TRECHOS).some(tr => sitDe(eu.id, tr) === 'pendente');
    if (faltaAlgo) html += `<p class="dica" style="margin:4px 0 0">💡 No Google Voos, ligue <b>Acompanhar preços</b> para receber e-mail quando o preço baixar.${eu.email ? ' O Nunnez também te lembra por e-mail enquanto faltar a passagem.' : ' Cadastre seu e-mail no Grupo para receber lembretes do Nunnez.'}</p>`;
    html += `</div>`;
  }

  html += `<div class="titulo-sec">Passagens do grupo</div><div class="cartao" style="padding:4px 16px"><ul class="lista">`;
  ps.forEach(p => {
    const linha = tr => { const s = sitDe(p.id, tr); return `${SIT[s].i} ${TRECHOS[tr]}`; };
    const pend = Object.keys(TRECHOS).filter(tr => sitDe(p.id, tr) === 'comprada');
    html += `<li class="${passagemDe(p.id, 'ida') || passagemDe(p.id, 'volta') ? 'clica' : ''}" data-ver="${esc(p.id)}"><span class="ico">${p.id === S.eu ? '🙋' : '👤'}</span>
      <span class="meio"><b>${esc(p.nome)}</b><small>${linha('ida')} · ${linha('volta')}${p.origem ? ' · sai de ' + esc(p.origem) : ''}</small></span>
      ${org && pend.length ? `<button class="btn mini pri" data-confirmar="${esc(p.id)}">Confirmar</button>` : ''}</li>`;
  });
  html += `</ul></div>`;

  const lista = (tr, campo, titulo) => {
    const xs = ps.map(p => ({ p, x: passagemDe(p.id, tr) })).filter(o => o.x && ['comprada', 'confirmada'].includes(o.x.status) && o.x[campo]).sort((a, b) => a.x[campo].localeCompare(b.x[campo]));
    if (!xs.length) return '';
    return `<div class="titulo-sec">${titulo}</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${xs.map(o => `
      <li><span class="ico">${tr === 'ida' ? '🛬' : '🛫'}</span><span class="meio"><b>${fmtHora(o.x[campo])} · ${esc(o.p.nome)}</b><small>${esc(o.x.cia)} ${esc(o.x.voo)} · ${esc(o.x.de)} → ${esc(o.x.para)}${o.x.status === 'confirmada' ? ' · ✅' : ''}</small></span></li>`).join('')}</ul></div>`;
  };
  html += lista('ida', 'chegada', 'Chegadas no destino') + lista('volta', 'saida', 'Saídas na volta');
  html += htmlChecklist();
  $('#tela').innerHTML = html;

  ligarChecklist();
  const orig = $('#minha-origem');
  if (orig) orig.onchange = () => op({ op: 'salvar', tipo: 'pessoa', item: { ...pessoa(S.eu), origem: orig.value.trim() } });
  $$('[data-comprei]').forEach(b => b.onclick = () => formPassagem(S.eu, b.dataset.comprei));
  $$('[data-naoprecisa]').forEach(b => b.onclick = () => op({ op: 'salvar', tipo: 'passagem', item: { id: idPassagem(S.eu, b.dataset.naoprecisa), pessoa: S.eu, trecho: b.dataset.naoprecisa, status: 'nao_precisa', cia: '', voo: '', de: '', para: '', saida: '', chegada: '', localizador: '', valor: '', obs: '', confirmadoPor: '' } }));
  $$('[data-desfazer]').forEach(b => b.onclick = () => op({ op: 'excluir', tipo: 'passagem', id: idPassagem(S.eu, b.dataset.desfazer) }));
  $$('[data-confirmar]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    Object.keys(TRECHOS).forEach(tr => { const x = passagemDe(b.dataset.confirmar, tr); if (x && x.status === 'comprada') op({ op: 'salvar', tipo: 'passagem', item: { ...x, status: 'confirmada', confirmadoPor: S.eu } }); });
    toast('Passagem confirmada ✓');
  });
  $$('li[data-ver].clica').forEach(li => li.onclick = () => verPassagens(li.dataset.ver));
}

function verPassagens(pid) {
  const p = pessoa(pid), org = souOrg(), dono = pid === S.eu;
  const bloco = tr => {
    const x = passagemDe(pid, tr), s = sitDe(pid, tr);
    if (!x || !['comprada', 'confirmada'].includes(s)) return `<p><b>${TRECHOS[tr]}:</b> ${SIT[s].i} ${SIT[s].t}</p>`;
    return `<div class="cartao" style="margin-bottom:10px"><h2>${TRECHOS[tr]} ${SIT[s].i}</h2>
      <div class="peq">${esc(x.cia)} <b>${esc(x.voo)}</b> · ${esc(x.de)} → ${esc(x.para)}<br>Sai ${fmtHora(x.saida)} · chega <b>${fmtHora(x.chegada)}</b>
      ${(org || dono) && x.localizador ? `<br>Localizador: <b>${esc(x.localizador)}</b>` : ''}${(org || dono) && x.valor ? `<br>Valor: ${brl(C.centavos(x.valor))}` : ''}${x.obs ? '<br>' + esc(x.obs) : ''}
      ${s === 'confirmada' && x.confirmadoPor ? `<br><span class="pos">Confirmada por ${esc(nome(x.confirmadoPor))}</span>` : ''}</div>
      ${org ? `<div class="btns" style="margin-top:8px">${s === 'comprada' ? `<button class="btn mini pri" value="conf-${tr}">Confirmar</button>` : `<button class="btn mini" value="desconf-${tr}">Desfazer confirmação</button>`}<button class="btn mini" value="edit-${tr}">Editar</button></div>` : ''}</div>`;
  };
  const f = janela('Passagens de ' + esc(p.nome), bloco('ida') + bloco('volta'));
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value || '';
    const [acao, tr] = b.split('-'); const x = passagemDe(pid, tr);
    if (acao === 'conf') op({ op: 'salvar', tipo: 'passagem', item: { ...x, status: 'confirmada', confirmadoPor: S.eu } });
    if (acao === 'desconf') op({ op: 'salvar', tipo: 'passagem', item: { ...x, status: 'comprada', confirmadoPor: '' } });
    if (acao === 'edit') { e.preventDefault(); formPassagem(pid, tr); }
  };
}

function formPassagem(pid, tr) {
  const p = pessoa(pid), v = S.dados.viagem;
  const x = passagemDe(pid, tr) || {};
  const CIAS = ['LATAM', 'GOL', 'Azul', 'Outra'];
  const ciaAtual = x.cia || '';
  const deP = x.de || (tr === 'ida' ? p.origem : destinoViagem()) || '', paraP = x.para || (tr === 'ida' ? destinoViagem() : p.origem) || '';
  const dataP = tr === 'ida' ? (p.chegada || v.inicio || '') : (p.saida || v.fim || '');
  const f = janela(`Passagem de ${TRECHOS[tr].toLowerCase()}${pid !== S.eu ? ' · ' + esc(p.nome) : ''}`, `
    <label class="cp"><span>Companhia</span><select name="cia">${CIAS.map(c => `<option ${c === ciaAtual || (c === 'Outra' && ciaAtual && !CIAS.includes(ciaAtual)) ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="cp oculto" id="bx-outra"><span>Qual companhia?</span><input type="text" name="ciaOutra" value="${esc(CIAS.includes(ciaAtual) ? '' : ciaAtual)}"></label>
    <div class="grade2"><label class="cp"><span>Número do voo</span><input type="text" name="voo" value="${esc(x.voo || '')}" placeholder="Ex.: LA3456" required autocapitalize="characters"></label>
      <label class="cp"><span>Data do voo</span><input type="date" name="dataVoo" value="${esc((x.saida || '').slice(0, 10) || dataP)}"></label></div>
    <button type="button" class="btn lg sua" id="buscar-voo" style="margin:-4px 0 6px">🔎 Buscar horários pelo número do voo</button>
    <p class="dica" id="res-voo">Digite o número e a data e toque em buscar: companhia, aeroportos e horários se preenchem sozinhos.</p>
    <div class="grade2"><label class="cp"><span>De</span><input type="text" name="de" value="${esc(deP)}" placeholder="GYN"></label><label class="cp"><span>Para</span><input type="text" name="para" value="${esc(paraP)}" placeholder="CGB"></label></div>
    <label class="cp"><span>Saída (data e hora)</span><input type="datetime-local" name="saida" value="${esc(x.saida || (dataP ? dataP + 'T08:00' : ''))}" required></label>
    <label class="cp"><span>Chegada (data e hora)</span><input type="datetime-local" name="chegada" value="${esc(x.chegada || (dataP ? dataP + 'T10:00' : ''))}" required></label>
    <p class="dica">A chegada aparece para todo mundo na lista de chegadas (ajuda a combinar quem busca quem).</p>
    <div class="grade2"><label class="cp"><span>Localizador (opcional)</span><input type="text" name="localizador" value="${esc(x.localizador || '')}"></label><label class="cp"><span>Valor pago (opcional)</span><input type="text" inputmode="decimal" name="valor" value="${esc(fmtNum(x.valor))}"></label></div>
    <p class="dica">Localizador e valor só você e o organizador veem. O valor não entra na divisão.</p>
    <label class="cp"><span>Observação</span><input type="text" name="obs" value="${esc(x.obs || '')}" placeholder="Ex.: conexão em Brasília"></label>`,
    `${x.id ? '<button class="btn perigo" value="del" formnovalidate>Apagar</button>' : ''}<button class="btn pri" value="ok">Salvar</button>`);
  const ajusta = () => $('#bx-outra', f).classList.toggle('oculto', f.cia.value !== 'Outra');
  f.cia.onchange = ajusta; ajusta();
  const preencher = vo => {
    const nomeCia = String(vo.cia || '').toUpperCase();
    const c = nomeCia.includes('LATAM') || /^(LA|JJ)\d/.test(vo.voo) ? 'LATAM' : nomeCia.includes('GOL') || /^G3\d/.test(vo.voo) ? 'GOL' : nomeCia.includes('AZUL') || /^AD\d/.test(vo.voo) ? 'Azul' : 'Outra';
    f.cia.value = c; if (c === 'Outra') f.ciaOutra.value = vo.cia || ''; ajusta();
    f.voo.value = vo.voo; f.de.value = vo.de; f.para.value = vo.para;
    if (vo.saida) f.saida.value = vo.saida; if (vo.chegada) f.chegada.value = vo.chegada;
    $('#res-voo', f).innerHTML = `✅ <b>${esc(vo.cia)} ${esc(vo.voo)}</b>: ${esc(vo.deNome || vo.de)} ${fmtHora(vo.saida).split(' ')[1] || ''} → ${esc(vo.paraNome || vo.para)} ${fmtHora(vo.chegada).split(' ')[1] || ''}. Confira e salve.`;
  };
  $('#buscar-voo', f).onclick = async () => {
    const numero = f.voo.value.trim().toUpperCase().replace(/\s/g, ''), data = f.dataVoo.value, b = $('#buscar-voo', f), res = $('#res-voo', f);
    if (!numero || !data) return toast('Digite o número do voo e a data.');
    b.disabled = true; b.textContent = 'Buscando…';
    try {
      const j = await req('voo', { numero, data });
      const voos = j.voos || [];
      if (voos.length === 1) preencher(voos[0]);
      else {
        // voo com escala: a viagem toda (1ª saída → última chegada) ou um trecho só
        const ult = voos[voos.length - 1];
        voos.unshift({ ...voos[0], para: ult.para, paraNome: ult.paraNome, chegada: ult.chegada, todo: true });
        res.innerHTML = 'Esse voo tem escala. O que você vai fazer?<div class="btns" style="margin-top:6px">' + voos.map((vo, i) => vo.todo ? `<button type="button" class="btn mini pri" data-trecho="${i}">Viagem toda: ${esc(vo.de)} → ${esc(vo.para)}</button>` : '').join('') + voos.map((vo, i) => vo.todo ? '' : `<button type="button" class="btn mini" data-trecho="${i}">Só ${esc(vo.de)} → ${esc(vo.para)} · ${fmtHora(vo.saida).split(' ')[1] || ''}</button>`).join('') + '</div>';
        $$('[data-trecho]', res).forEach(bt => bt.onclick = () => preencher(voos[bt.dataset.trecho]));
      }
    } catch (e) {
      res.innerHTML = '⚠️ ' + esc(e.servidor ? e.message : 'Sem internet para buscar o voo.');
    } finally { b.disabled = false; b.textContent = '🔎 Buscar horários pelo número do voo'; }
  };
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'del') { if (!confirm('Apagar os dados deste voo?')) return e.preventDefault(); return op({ op: 'excluir', tipo: 'passagem', id: idPassagem(pid, tr) }); }
    if (b !== 'ok') return;
    const fd = new FormData(f);
    const cia = fd.get('cia') === 'Outra' ? String(fd.get('ciaOutra')).trim() : fd.get('cia');
    if (fd.get('chegada') && fd.get('saida') && fd.get('chegada') < fd.get('saida')) { e.preventDefault(); return toast('A chegada está antes da saída.'); }
    const org = souOrg();
    const status = org && pid === S.eu ? 'confirmada' : (x.status === 'confirmada' && org ? 'confirmada' : 'comprada');
    op({ op: 'salvar', tipo: 'passagem', item: { id: idPassagem(pid, tr), pessoa: pid, trecho: tr, status, cia, voo: String(fd.get('voo')).trim().toUpperCase(), de: String(fd.get('de')).trim().toUpperCase(), para: String(fd.get('para')).trim().toUpperCase(), saida: fd.get('saida'), chegada: fd.get('chegada'), localizador: String(fd.get('localizador')).trim().toUpperCase(), valor: lerNum(fd.get('valor')), obs: String(fd.get('obs')).trim(), confirmadoPor: status === 'confirmada' ? S.eu : '' } });
    toast(status === 'confirmada' ? 'Passagem salva ✓' : 'Passagem registrada ✓ O organizador vai confirmar.');
  };
}

/* ---------- Roteiro: o organizador lança hospedagem, passeios etc.; cada um vê onde, quando e quanto ---------- */
const CATS_ROTEIRO = ['hospedagem', 'passeios', 'trilhas', 'eventos', 'alimentacao', 'aluguel', 'outros'];
const NOME_ROTEIRO = { hospedagem: 'Hospedagem', passeios: 'Passeio', trilhas: 'Trilha', eventos: 'Evento', alimentacao: 'Restaurante', aluguel: 'Aluguel de carro', outros: 'Outro' };
const DICA_LOCAL = { trilhas: 'Ponto de partida da trilha', eventos: 'Onde vai ser o evento' };
const ehRoteiro = g => g.roteiro === 'sim';
const linkMapa = local => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(local);
function quando(g) {
  if (!g.data) return 'Data a definir';
  return fmtDia(g.data) + (g.hora ? ' às ' + g.hora : '') + (g.ate ? ' até ' + fmtDia(g.ate) : '');
}
function itensRoteiro() {
  // mesma ordem do trajeto: sem hora, retirada do carro vem de manhã e check-in à tarde
  const h = g => g.hora || HORA_PADRAO[g.categoria] || '12:00';
  return (S.dados.gastos || []).filter(ehRoteiro).sort((a, b) => (a.data || '9999').localeCompare(b.data || '9999') || h(a).localeCompare(h(b)));
}

/* ---------- Trajeto: liga os pontos do roteiro pela data e calcula km e tempo de carro ---------- */
let ROTAS = ls.get('rv:rotas', {}); // "origem|destino" -> { km, min } ou { erro }
let buscandoRotas = false;
const chaveRota = (a, b) => a.trim().toLowerCase() + '|' + b.trim().toLowerCase();
const fmtDur = m => m < 60 ? m + ' min' : Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '');
const HORA_PADRAO = { aluguel: '06:00', hospedagem: '14:00', devolucao: '18:00' };
function trechosRoteiro() {
  const itens = itensRoteiro().filter(g => g.local && g.data);
  const pts = itens.map(g => ({ g, chave: g.id, data: g.data, hora: g.hora || HORA_PADRAO[g.categoria] || '12:00', local: g.local, tipo: g.categoria }));
  // devolução do carro alugado (no mesmo lugar da retirada)
  itens.filter(g => g.categoria === 'aluguel' && g.ate).forEach(g => pts.push({ g, chave: 'dev-' + g.id, data: g.ate, hora: HORA_PADRAO.devolucao, local: g.local, tipo: 'devolucao' }));
  pts.sort((a, b) => a.data.localeCompare(b.data) || a.hora.localeCompare(b.hora));
  // passeio num dia em que a turma está hospedada em algum lugar: sai e volta da hospedagem
  const hospEm = (d, exceto) => itens.find(h => h.categoria === 'hospedagem' && h !== exceto && h.data <= d && (h.ate ? d < h.ate : d === h.data));
  const out = []; let atual = null;
  pts.forEach(p => {
    const hosp = ['passeios', 'trilhas', 'eventos', 'alimentacao', 'outros'].includes(p.tipo) ? hospEm(p.data, p.g) : null;
    if (hosp && hosp.local.trim().toLowerCase() !== p.local.trim().toLowerCase()) { out.push({ antes: p.chave, de: hosp.local, para: p.local, idaVolta: true, ponto: p }); atual = hosp.local; return; }
    if (atual && atual.trim().toLowerCase() !== p.local.trim().toLowerCase()) out.push({ antes: p.chave, de: atual, para: p.local, ponto: p });
    atual = p.local;
  });
  return { trechos: out, pontos: pts };
}
async function buscarRotas(trechos) {
  if (DEMO || buscandoRotas) return;
  const faltam = [...new Map(trechos.filter(t => !ROTAS[chaveRota(t.de, t.para)]).map(t => [chaveRota(t.de, t.para), [t.de, t.para]])).values()];
  if (!faltam.length) return;
  buscandoRotas = true;
  try {
    const j = await req('rotas', { pares: faltam.slice(0, 25) });
    faltam.slice(0, 25).forEach((par, i) => { ROTAS[chaveRota(par[0], par[1])] = j.rotas[i]; });
    ls.set('rv:rotas', ROTAS);
    if (ABA === 'roteiro') render();
  } catch (e) {} finally { buscandoRotas = false; }
}
function htmlTrecho(t) {
  const r = ROTAS[chaveRota(t.de, t.para)];
  const mapa = 'https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=' + encodeURIComponent(t.de) + '&destination=' + encodeURIComponent(t.para);
  const txt = !r ? 'calculando distância…' : r.erro ? 'não achei o caminho (confira o endereço)'
    : t.idaVolta ? `ida e volta: <b>${fmtNum(r.km * 2)} km</b> · ${fmtDur(r.min)} cada perna` : `<b>${fmtNum(r.km)} km</b> · ${fmtDur(r.min)}`;
  return `<div class="trecho">🚗 ${txt}<br><span class="mut">${esc(t.de)} → ${esc(t.para)}</span> · <a href="${esc(mapa)}" target="_blank" rel="noopener">ver rota</a></div>`;
}

/* ---------- Enquetes ("Barco ou trilha no sábado?") ---------- */
function htmlEnquetes() {
  const org = souOrg(), es = (S.dados.enquetes || []).slice().sort((a, b) => (a.status === 'encerrada') - (b.status === 'encerrada') || String(b.id).localeCompare(String(a.id)));
  if (!es.length && !org) return '';
  let h = `<div class="titulo-sec" style="display:flex;justify-content:space-between;align-items:center"><span>🗳️ Enquetes</span>${org ? '<button class="btn mini" id="nova-enq">+ Enquete</button>' : ''}</div>`;
  if (!es.length) return h + '<p class="dica" style="margin:0 4px 10px">Em dúvida entre dois passeios ou datas? Crie uma enquete e o grupo vota.</p>';
  es.forEach(e => {
    const votos = e.votos || {}, total = Object.keys(votos).length, meu = votos[S.eu], fechada = e.status === 'encerrada';
    const maxV = Math.max(0, ...(e.opcoes || []).map(o => Object.values(votos).filter(x => x === o.id).length));
    h += `<div class="cartao" ${fechada ? 'style="opacity:.8"' : ''}><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(e.pergunta)}</b>${fechada ? '<span class="selo" style="background:var(--suave);color:var(--mut)">encerrada</span>' : ''}</div>
      <div style="display:grid;gap:6px;margin-top:8px">${(e.opcoes || []).map(o => {
        const quem = Object.keys(votos).filter(p => votos[p] === o.id), n = quem.length, venc = fechada && n && n === maxV;
        return `<button type="button" class="btn" data-voto="${esc(e.id)}" data-op="${esc(o.id)}" ${fechada || !S.eu ? 'disabled' : ''} style="justify-content:flex-start;text-align:left;position:relative;overflow:hidden;${meu === o.id ? 'border-color:var(--pri);outline:1px solid var(--pri)' : ''}">
          <i style="position:absolute;left:0;top:0;bottom:0;width:${total ? n / total * 100 : 0}%;background:var(--suave)"></i>
          <span style="position:relative;flex:1">${venc ? '🏆 ' : meu === o.id ? '✅ ' : ''}${esc(o.texto)}<br><small class="mut" style="font-weight:400">${quem.map(primeiroNome).join(', ')}</small></span><span style="position:relative" class="num">${n}</span></button>`;
      }).join('')}</div>
      <div class="peq mut" style="margin-top:6px">${total} de ${S.dados.pessoas.length} votaram${!fechada && meu ? ' · toque de novo para tirar seu voto' : ''}</div>
      ${org ? `<div class="btns" style="margin-top:8px">${fechada ? `<button class="btn mini" data-reabrir="${esc(e.id)}">Reabrir</button>` : `<button class="btn mini" data-encerrar="${esc(e.id)}">Encerrar</button>`}<button class="btn mini perigo" data-delenq="${esc(e.id)}">Apagar</button></div>` : ''}</div>`;
  });
  return h;
}
function ligarEnquetes() {
  const enq = id => S.dados.enquetes.find(e => e.id === id);
  if ($('#nova-enq')) $('#nova-enq').onclick = formEnquete;
  $$('[data-voto]').forEach(b => b.onclick = () => { const e = enq(b.dataset.voto); op({ op: 'votar', tipo: 'enquete', id: e.id, pessoa: S.eu, opcao: (e.votos || {})[S.eu] === b.dataset.op ? '' : b.dataset.op }); });
  $$('[data-encerrar]').forEach(b => b.onclick = () => op({ op: 'salvar', tipo: 'enquete', item: { ...enq(b.dataset.encerrar), status: 'encerrada' } }));
  $$('[data-reabrir]').forEach(b => b.onclick = () => op({ op: 'salvar', tipo: 'enquete', item: { ...enq(b.dataset.reabrir), status: 'aberta' } }));
  $$('[data-delenq]').forEach(b => b.onclick = () => { if (confirm('Apagar esta enquete e os votos?')) op({ op: 'excluir', tipo: 'enquete', id: b.dataset.delenq }); });
}
function formEnquete() {
  const f = janela('Nova enquete', `
    <label class="cp"><span>Pergunta</span><input type="text" name="pergunta" required placeholder="Ex.: Sábado: barco ou trilha?"></label>
    <label class="cp"><span>Opções (uma por linha)</span><textarea name="opcoes" rows="4" required placeholder="Passeio de barco&#10;Trilha da cachoeira&#10;Descansar na pousada"></textarea></label>
    <p class="dica">Cada um vota em uma opção e pode mudar o voto até você encerrar.</p>`,
    `<button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Criar enquete</button>`);
  f.onsubmit = e => {
    if (!e.submitter || e.submitter.value !== 'ok') return;
    const fd = new FormData(f), ops = [...new Set(String(fd.get('opcoes')).split('\n').map(s => s.trim()).filter(Boolean))];
    if (ops.length < 2) { e.preventDefault(); return toast('Coloque pelo menos duas opções.'); }
    op({ op: 'salvar', tipo: 'enquete', item: { id: uid('E'), pergunta: String(fd.get('pergunta')).trim(), opcoes: ops.slice(0, 8).map((t, i) => ({ id: 'o' + i, texto: t })), votos: {}, status: 'aberta', criadoPor: S.eu } });
    toast('Enquete criada ✓ Avise o grupo para votar.');
  };
}

/* ---------- Previsão do tempo por dia (Open-Meteo, gratuito) ---------- */
let CLIMA = ls.get('rv:clima', {});
const EMOJI_TEMPO = c => c === 0 ? '☀️' : c <= 2 ? '🌤️' : c === 3 ? '☁️' : c <= 48 ? '🌫️' : c <= 67 ? '🌧️' : c <= 77 ? '❄️' : c <= 82 ? '🌦️' : '⛈️';
function lugarDoDia(d) {
  const it = itensRoteiro();
  const hosp = it.find(h => h.categoria === 'hospedagem' && h.local && h.data <= d && (h.ate ? d < h.ate : d === h.data));
  return (hosp || it.find(x => x.data === d && x.local) || {}).local || S.dados.viagem.destino || '';
}
async function geocodificar(lugar) {
  const k = 'geo|' + lugar.toLowerCase();
  if (CLIMA[k]) return CLIMA[k];
  // tenta o texto inteiro e depois só a cidade (antes da vírgula)
  for (const nomeBusca of [lugar.split(/[,–-]/)[0].trim(), lugar]) {
    const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&countryCode=BR&name=' + encodeURIComponent(nomeBusca)).then(x => x.json()).catch(() => null);
    const g = r && r.results && r.results[0];
    if (g) { CLIMA[k] = { lat: g.latitude, lon: g.longitude }; return CLIMA[k]; }
  }
  CLIMA[k] = { erro: 1 }; return CLIMA[k];
}
async function climaDe(lugar, d) {
  const k = 'tempo|' + lugar.toLowerCase() + '|' + d, guardado = CLIMA[k];
  const dias = Math.round((new Date(d + 'T12:00') - new Date(hoje() + 'T12:00')) / 86400000);
  if (guardado && (guardado.tipico || Date.now() - guardado.em < 6 * 3600000)) return guardado;
  const geo = await geocodificar(lugar);
  if (geo.erro) return null;
  const q = `latitude=${geo.lat}&longitude=${geo.lon}&timezone=auto&daily=weathercode,temperature_2m_max,temperature_2m_min`;
  let url, tipico = false;
  if (dias >= 0 && dias <= 15) url = `https://api.open-meteo.com/v1/forecast?${q},precipitation_probability_max&start_date=${d}&end_date=${d}`;
  else { // longe demais para previsão: mostra como foi no mesmo dia do ano passado (clima típico)
    const ano = new Date(d + 'T12:00'); ano.setFullYear(ano.getFullYear() - (dias < 0 ? 0 : Math.max(1, Math.ceil(dias / 365))));
    const dd = ano.toISOString().slice(0, 10); if (dd > hoje()) return null;
    url = `https://archive-api.open-meteo.com/v1/archive?${q},precipitation_sum&start_date=${dd}&end_date=${dd}`; tipico = dias > 15;
  }
  const r = await fetch(url).then(x => x.json()).catch(() => null);
  const dl = r && r.daily; if (!dl || !dl.time || !dl.time.length) return null;
  CLIMA[k] = { em: Date.now(), tipico, cod: dl.weathercode[0], max: Math.round(dl.temperature_2m_max[0]), min: Math.round(dl.temperature_2m_min[0]),
    chuva: dl.precipitation_probability_max ? dl.precipitation_probability_max[0] : null, mm: dl.precipitation_sum ? dl.precipitation_sum[0] : null };
  ls.set('rv:clima', CLIMA);
  return CLIMA[k];
}
function preencherClima() {
  $$('[data-clima]').forEach(async el => {
    const d = el.dataset.clima, lugar = lugarDoDia(d);
    if (!lugar) return;
    try {
      const c = await climaDe(lugar, d);
      if (!c || !el.isConnected) return;
      el.innerHTML = `${EMOJI_TEMPO(c.cod)} ${c.max}° / ${c.min}°${c.chuva != null ? ` · 💧${c.chuva}%` : c.mm ? ` · 💧${Math.round(c.mm)}mm` : ''}${c.tipico ? ' <span title="Previsão só sai 16 dias antes. Isto é como estava no mesmo dia do ano passado.">(típico)</span>' : ''}`;
    } catch (e) {}
  });
}

// Informações úteis (Wi-Fi, horários, contato) num "abre e fecha"; telefone vira link do WhatsApp.
function htmlInfo(g) {
  const i = g.info || {};
  const linhas = [
    i.checkin || i.checkout ? `🕑 ${i.checkin ? 'Check-in a partir de ' + esc(i.checkin) : ''}${i.checkin && i.checkout ? ' · ' : ''}${i.checkout ? 'check-out até ' + esc(i.checkout) : ''}` : '',
    i.wifi ? `📶 Wi-Fi <b>${esc(i.wifi)}</b>${i.wifiSenha ? ' · senha <b>' + esc(i.wifiSenha) + '</b>' : ''}` : '',
    i.contato ? `📞 ${esc(i.contato)}${(() => { const d = i.contato.replace(/\D/g, ''); return d.length >= 10 ? ` · <a href="https://wa.me/${d.length <= 11 ? '55' + d : d}" target="_blank" rel="noopener">WhatsApp</a>` : ''; })()}` : '',
    i.instrucoes ? `📝 ${esc(i.instrucoes).replace(/\n/g, '<br>')}` : ''
  ].filter(Boolean);
  return linhas.length ? `<details style="margin-top:6px"><summary class="peq" style="cursor:pointer;font-weight:700">ℹ️ Informações úteis</summary><div class="peq" style="margin-top:4px;display:grid;gap:3px">${linhas.map(l => `<div>${l}</div>`).join('')}</div></details>` : '';
}

function selo(g) {
  if (cadaUm(g)) return '<span class="selo" style="background:var(--suave);color:var(--azul)">cada um paga o seu</span>';
  if ((g.pagamentos || []).length && g.status === 'previsto') {
    const pct = Math.round(C.jaPagoItem(g, S.dados) / Math.max(1, C.valorDoGasto(g)) * 100);
    return `<span class="selo">pago ${pct}% · falta ${brl(C.valorDoGasto(g) - C.jaPagoItem(g, S.dados))}</span>`;
  }
  return pago(g) ? `<span class="selo" style="background:var(--suave);color:var(--pos)">pago por ${esc(primeiroNome(g.pagoPor))}</span>` : '<span class="selo">a pagar</span>';
}

function telaRoteiro() {
  const org = souOrg(), itens = itensRoteiro();
  const minhas = C.partes(S.dados), meuTotal = minhas[S.eu] || 0;
  const aPagar = itens.filter(g => !pago(g) && !cadaUm(g));
  const totalRot = itens.reduce((s, g) => s + C.totalItem(g, S.dados), 0);
  let html = `<div class="cartao destaque">
    <div class="peq">${S.eu ? 'Sua parte na viagem (roteiro + gastos)' : 'Roteiro da viagem'}</div>
    <div style="font-size:1.9rem;font-weight:800" class="num">${S.eu ? brl(meuTotal) : brl(totalRot)}</div>
    <div class="peq">${itens.length} ${itens.length === 1 ? 'item' : 'itens'} no roteiro · ${brl(totalRot)} no total${aPagar.length ? ` · ${aPagar.length} a pagar` : ''}</div>
  </div>`;
  if (org) html += `<div class="btns" style="margin-bottom:6px"><button class="btn pri" id="add-rot">+ Adicionar ao roteiro</button>${itens.length ? '<button class="btn" id="rot-zap">Mandar no WhatsApp</button><button class="btn" id="rot-mail">Avisar por e-mail</button>' : ''}</div>`;
  html += htmlEnquetes();
  if (!itens.length) html += `<div class="cartao vazio"><b>🗺️</b>${org ? 'Lance aqui a hospedagem, os passeios e o que mais for da viagem, com local, data e valor. O valor é dividido entre quem vai.' : 'O organizador ainda não montou o roteiro.'}</div>`;
  const { trechos, pontos } = trechosRoteiro();
  if (trechos.length) {
    const comKm = trechos.map(t => ({ t, r: ROTAS[chaveRota(t.de, t.para)] })).filter(x => x.r && !x.r.erro);
    const km = comKm.reduce((s, x) => s + x.r.km * (x.t.idaVolta ? 2 : 1), 0), min = comKm.reduce((s, x) => s + x.r.min * (x.t.idaVolta ? 2 : 1), 0);
    const paradas = pontos.map(p => p.local).filter((l, i, a) => i === 0 || l.trim().toLowerCase() !== a[i - 1].trim().toLowerCase()).slice(0, 10);
    const mapa = 'https://www.google.com/maps/dir/' + paradas.map(encodeURIComponent).join('/');
    html += `<div class="cartao" style="padding:12px 16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <div style="flex:1;min-width:180px">🚗 <b>${comKm.length ? fmtNum(Math.round(km)) + ' km de estrada' : 'Calculando o trajeto…'}</b>${comKm.length ? ` <span class="mut peq">(≈ ${fmtDur(min)} dirigindo${comKm.length < trechos.length ? ', faltam trechos' : ''})</span>` : ''}</div>
      <a class="btn mini" href="${esc(mapa)}" target="_blank" rel="noopener">🗺️ Trajeto no Google Maps</a></div>`;
  }
  let diaAtual = null;
  itens.forEach(g => {
    if ((g.data || '') !== diaAtual) { diaAtual = g.data || ''; html += `<div class="dia"><span>${g.data ? fmtDia(g.data) : 'Sem data'}</span>${g.data ? `<span data-clima="${esc(g.data)}" style="font-weight:600"></span>` : ''}</div>`; }
    trechos.filter(t => t.antes === g.id).forEach(t => { html += htmlTrecho(t); });
    const cat = C.CAT[g.categoria] || C.CAT.outros;
    const partes = C.dividir(g, S.dados), n = Object.keys(partes).length;
    const vou = !(g.ausentes || []).includes(S.eu);
    const fora = S.dados.pessoas.filter(p => (g.ausentes || []).includes(p.id)).map(p => p.nome.split(' ')[0]);
    html += `<div class="cartao" data-rot="${esc(g.id)}">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <span class="ico" style="width:42px;height:42px;border-radius:12px;background:var(--suave);display:grid;place-items:center;font-size:1.3rem;flex:none">${cat.icone}</span>
        <div style="flex:1;min-width:0">
          <b style="font-size:1.05rem">${esc(g.descricao || cat.nome)}</b> ${selo(g)}
          <div class="peq" style="margin-top:4px">🕒 ${quando(g)}</div>
          ${g.local ? `<div class="peq">📍 <a href="${esc(linkMapa(g.local))}" target="_blank" rel="noopener">${esc(g.local)}</a></div>` : ''}
          ${g.link ? `<div class="peq">🔗 <a href="${esc(g.link)}" target="_blank" rel="noopener">Ver site / reserva</a></div>` : ''}
          ${g.obs ? `<div class="peq mut">${esc(g.obs)}</div>` : ''}
          ${(g.anexos || []).map(a => `<div class="peq">${a.tipo === 'pdf' ? '📄' : '🖼️'} <a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nome)}</a></div>`).join('')}
          ${htmlInfo(g)}
          <div class="peq" style="margin-top:6px">💰 ${cadaUm(g)
            ? (() => { const ent = Math.round(C.totalItem(g, S.dados) / C.centavos(g.valor)); return `<b class="num">${brl(C.centavos(g.valor))} por pessoa</b>, pago na hora · ${ent} ${ent === 1 ? 'entrada' : 'entradas'} (≈ ${brl(C.totalItem(g, S.dados))} no grupo)${partes[S.eu] ? ` · <b>você leva ${brl(partes[S.eu])}</b>` : ''}`; })()
            : `<b class="num">${brl(C.valorDoGasto(g))}</b> para ${n} ${n === 1 ? 'pessoa' : 'pessoas'}${partes[S.eu] ? ` · <b>sua parte ${brl(partes[S.eu])}</b>` : ''}`}</div>
          ${fora.length ? `<div class="peq mut">Não vão: ${esc(fora.join(', '))}</div>` : ''}
        </div>
      </div>
      <div class="btns" style="margin-top:10px">
        ${S.eu ? `<button class="btn mini ${vou ? 'pri' : ''}" data-vou="${esc(g.id)}" data-v="1">✅ Vou</button><button class="btn mini ${vou ? '' : 'pri'}" data-vou="${esc(g.id)}" data-v="0">Não vou</button>` : ''}
        ${org ? `<button class="btn mini" data-editrot="${esc(g.id)}">Editar</button>` : ''}
      </div></div>`;
  });
  // devolução do carro alugado
  pontos.filter(p => p.tipo === 'devolucao').forEach(p => {
    html += `<div class="dia"><span>${fmtDia(p.data)}</span></div>` + trechos.filter(t => t.antes === p.chave).map(htmlTrecho).join('') +
      `<div class="cartao" style="padding:12px 16px">🔑 <b>Devolução: ${esc(p.g.descricao)}</b><div class="peq">📍 <a href="${esc(linkMapa(p.local))}" target="_blank" rel="noopener">${esc(p.local)}</a></div></div>`;
  });
  html += `<details class="cartao" style="margin-top:18px"><summary style="cursor:pointer;font-weight:700">🧮 Calculadora: estimativa de combustível e custos</summary><div id="plano-box" style="margin-top:12px"></div></details>`;
  $('#tela').innerHTML = html;
  telaPlano();
  buscarRotas(trechos);
  ligarEnquetes();
  preencherClima();
  $$('[data-vou]').forEach(b => b.onclick = () => op({ op: 'presenca', id: b.dataset.vou, pessoa: S.eu, vai: b.dataset.v === '1' }));
  $$('[data-editrot]').forEach(b => b.onclick = () => formRoteiro(S.dados.gastos.find(g => g.id === b.dataset.editrot)));
  if ($('#add-rot')) $('#add-rot').onclick = () => formRoteiro();
  if ($('#rot-zap')) $('#rot-zap').onclick = () => compartilhar(textoRoteiro());
  if ($('#rot-mail')) $('#rot-mail').onclick = avisarPorEmail;
}

function textoRoteiro() {
  const v = S.dados.viagem;
  let t = `🗺️ *Roteiro: ${v.nome}*\n`;
  itensRoteiro().forEach(g => {
    const partes = C.dividir(g, S.dados), n = Object.keys(partes).length, total = C.valorDoGasto(g);
    t += `\n${(C.CAT[g.categoria] || C.CAT.outros).icone} *${g.descricao}*\n🕒 ${quando(g)}\n` + (g.local ? `📍 ${g.local}\n` : '') +
      (cadaUm(g) ? `💰 ${brl(C.centavos(g.valor))} por pessoa · cada um paga o seu na hora\n`
        : `💰 ${brl(total)}${n ? ` (≈ ${brl(Math.round(total / Object.keys(partes).reduce((s, k) => s + (Number((pessoa(k) || {}).peso) || 1), 0)))} por pessoa, ${n} ${n === 1 ? 'pessoa' : 'pessoas'})` : ''}${pago(g) ? '' : ' · a pagar'}\n`);
  });
  return t + `\nVeja a sua parte e marque se vai: ${linkConvite()}`;
}

async function avisarPorEmail() {
  const comEmail = S.dados.pessoas.filter(p => p.email);
  if (!comEmail.length) return toast('Ninguém tem e-mail cadastrado ainda (aba Grupo).');
  if (!confirm(`Mandar o roteiro por e-mail para ${comEmail.length} ${comEmail.length === 1 ? 'pessoa' : 'pessoas'} (${comEmail.map(p => p.nome.split(' ')[0]).join(', ')})?`)) return;
  const itens = itensRoteiro(), partes = C.partes(S.dados);
  const mensagens = comEmail.map(p => {
    const linhas = itens.map(g => { const pt = C.dividir(g, S.dados)[p.id]; return `<li><b>${esc(g.descricao)}</b><br>${esc(quando(g))}${g.local ? '<br>📍 ' + esc(g.local) : ''}<br>${cadaUm(g) ? `${brl(C.centavos(g.valor))} por pessoa, cada um paga o seu na hora · ${pt ? 'leve <b>' + brl(pt) + '</b>' : 'você não vai'}` : `Total ${brl(C.valorDoGasto(g))} · ${pt ? 'sua parte <b>' + brl(pt) + '</b>' : 'você não vai'}${pago(g) ? '' : ' (a pagar)'}`}</li>`; }).join('');
    return { pessoa: p.id, assunto: '🗺️ Roteiro: ' + S.dados.viagem.nome, titulo: 'Oi, ' + p.nome.split(' ')[0] + '! Este é o roteiro da viagem',
      html: `<ul>${linhas}</ul><p>Sua parte na viagem até agora: <b>${brl(partes[p.id] || 0)}</b>.</p><p>No app você marca se vai em cada passeio.</p>` };
  });
  try { const j = await req('avisar', { mensagens }); toast(`E-mail enviado para ${j.enviados} ${j.enviados === 1 ? 'pessoa' : 'pessoas'} ✓`); }
  catch (e) { toast(e.servidor ? e.message : 'Sem internet para mandar os e-mails.'); }
}

function formRoteiro(g) {
  const novo = !g;
  g = g ? { ...g } : { id: uid('G'), roteiro: 'sim', categoria: 'passeios', descricao: '', local: '', link: '', data: S.dados.viagem.inicio || '', hora: '', ate: '', valor: '', moeda: 'BRL', cambio: 1, status: 'previsto', pagoPor: '', modo: '', obs: '', ausentes: [], participantes: [], valores: {}, marca: '', carro: '', retido: '', foto: '', criadoPor: S.eu };
  let cat = g.categoria;
  const info = { ...(g.info || {}) };
  let pags = (g.pagamentos || []).map(p => ({ ...p }));
  let anexos = (g.anexos || []).map(a => ({ ...a }));
  const sitInicial = pags.length ? 'partes' : pago(g) ? 'pago' : 'previsto';
  const f = janela(novo ? 'Adicionar ao roteiro' : 'Editar item do roteiro', `
    <div class="chips" id="rot-cats" style="margin-bottom:12px">${CATS_ROTEIRO.map(c => `<button type="button" class="chip" data-c="${c}" aria-pressed="${c === cat}">${C.CAT[c].icone} ${NOME_ROTEIRO[c]}</button>`).join('')}</div>
    <label class="cp"><span>O que é</span><input type="text" name="descricao" required value="${esc(g.descricao)}" placeholder="Ex.: Passeio de barco na Chapada"></label>
    <label class="cp"><span id="rot-rot-local">Onde (endereço ou nome do lugar)</span><input type="text" name="local" value="${esc(g.local)}" placeholder="Ex.: Chapada dos Guimarães, MT"></label>
    <p class="dica" style="margin-top:-8px">Com cidade e estado, o app calcula os km e o tempo de carro entre os pontos do roteiro.</p>
    <div class="grade2"><label class="cp"><span id="rot-rot-data">Data</span><input type="date" name="data" value="${esc(g.data)}"></label><label class="cp"><span>Hora</span><input type="time" name="hora" value="${esc(g.hora)}"></label></div>
    <label class="cp" id="bx-ate"><span>Até (saída / check-out)</span><input type="date" name="ate" value="${esc(g.ate)}"></label>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:2px">Tipo de valor</span>
    <label class="check"><input type="radio" name="tipoValor" value="total" ${cadaUm(g) ? '' : 'checked'}>Valor total, dividido entre quem vai</label>
    <label class="check"><input type="radio" name="tipoValor" value="porPessoa" ${cadaUm(g) ? 'checked' : ''}>Valor por pessoa, cada um paga o seu na hora (entrada, ingresso)</label>
    <label class="cp" style="margin-top:6px"><span id="rot-rot-valor">Valor total (R$)</span><input type="text" inputmode="decimal" name="valor" required value="${esc(fmtNum(g.valor))}" placeholder="0,00" style="font-size:1.2rem;font-weight:700"></label>
    <p class="dica oculto" id="dica-pp">É só uma estimativa para cada um saber quanto levar. Não entra no Acerto, porque ninguém paga pelos outros.</p>
    <div id="bx-divisao">
    <label class="cp"><span>Como dividir</span><select name="modo">
      <option value="todos" ${g.modo !== 'noites' ? 'selected' : ''}>Igual entre quem vai</option>
      <option value="noites" ${g.modo === 'noites' ? 'selected' : ''}>Por noites dormidas (hospedagem)</option></select></label>
    </div>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:2px">Quem vai</span>
    ${S.dados.pessoas.map(p => `<label class="check"><input type="checkbox" name="vai" value="${esc(p.id)}" ${(g.ausentes || []).includes(p.id) ? '' : 'checked'}>${esc(p.nome)}</label>`).join('')}
    <p class="dica">Quem entrar na viagem depois já entra marcado. Cada um também pode tocar em "Não vou".</p>
    <div id="bx-pagamento">
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:2px">Pagamento</span>
    <label class="check"><input type="radio" name="sit" value="previsto" ${sitInicial === 'previsto' ? 'checked' : ''}>Ainda vai ser pago (cada um já vê quanto vai dever)</label>
    <label class="check"><input type="radio" name="sit" value="partes" ${sitInicial === 'partes' ? 'checked' : ''}>Pago em partes (sinal + restante)</label>
    <label class="check"><input type="radio" name="sit" value="pago" ${sitInicial === 'pago' ? 'checked' : ''}>Já foi pago inteiro por</label>
    <label class="cp" id="bx-pagador"><select name="pagoPor">${opcoesPessoas(g.pagoPor || S.eu)}</select></label>
    <div id="bx-partes" class="oculto" style="background:var(--suave);border-radius:12px;padding:10px 12px;margin-bottom:10px">
      <div id="lista-partes"></div>
      <div class="grade3" style="grid-template-columns:1fr 1.3fr 1.2fr;gap:6px;margin-top:6px">
        <input type="text" inputmode="decimal" id="np-valor" placeholder="R$">
        <select id="np-quem">${opcoesPessoas(S.eu)}</select>
        <input type="date" id="np-data" value="${hoje()}">
      </div>
      <button type="button" class="btn mini sua" id="np-add" style="margin-top:6px">+ Adicionar pagamento</button>
      <p class="dica" id="dica-partes" style="margin:6px 0 0"></p>
    </div>
    <p class="dica">O que já foi pago entra no Acerto na hora: cada um passa a sua parte por Pix para quem pagou.</p>
    </div>
    <div id="bx-info" class="oculto">
      <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:6px">ℹ️ Informações úteis (aparecem para o grupo)</span>
      <div class="grade2 so-hosp"><label class="cp"><span>Check-in a partir de</span><input type="time" name="i_checkin" value="${esc(info.checkin || '')}"></label><label class="cp"><span>Check-out até</span><input type="time" name="i_checkout" value="${esc(info.checkout || '')}"></label></div>
      <div class="grade2 so-hosp"><label class="cp"><span>Wi-Fi (rede)</span><input type="text" name="i_wifi" value="${esc(info.wifi || '')}" autocapitalize="off"></label><label class="cp"><span>Senha do Wi-Fi</span><input type="text" name="i_wifiSenha" value="${esc(info.wifiSenha || '')}" autocapitalize="off"></label></div>
      <label class="cp"><span>Contato (anfitrião, loja, guia)</span><input type="text" name="i_contato" value="${esc(info.contato || '')}" placeholder="Nome e telefone, ex.: Seu Zé (65) 99999-0000"></label>
      <label class="cp"><span>Instruções (chave, portão, ponto de encontro…)</span><textarea name="i_instrucoes" rows="2">${esc(info.instrucoes || '')}</textarea></label>
    </div>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:4px">📎 Reservas e vouchers (PDF ou foto)</span>
    <div id="lista-anexos" style="margin-bottom:6px"></div>
    <label class="cp"><input type="file" name="anexo" accept="image/*,application/pdf" multiple></label>
    <label class="cp"><span>Link (site, Airbnb, reserva) — opcional</span><input type="text" inputmode="url" name="link" value="${esc(g.link)}" placeholder="airbnb.com/…" autocapitalize="off"></label>
    <label class="cp"><span>Observação</span><input type="text" name="obs" value="${esc(g.obs)}" placeholder="Ex.: levar protetor e roupa de banho"></label>`,
    `${novo ? '' : '<button class="btn perigo" value="del" formnovalidate>Excluir</button>'}<button class="btn pri" value="ok">Salvar</button>`);
  const ajusta = () => {
    const pp = f.tipoValor.value === 'porPessoa';
    $('#bx-divisao', f).classList.toggle('oculto', pp);
    $('#bx-pagamento', f).classList.toggle('oculto', pp);
    $('#dica-pp', f).classList.toggle('oculto', !pp);
    $('#rot-rot-valor', f).textContent = pp ? 'Valor por pessoa (R$)' : 'Valor total (R$)';
    $('#bx-ate', f).classList.toggle('oculto', cat !== 'hospedagem' && cat !== 'aluguel');
    $('#bx-pagador', f).classList.toggle('oculto', f.sit.value !== 'pago');
    $('#bx-partes', f).classList.toggle('oculto', f.sit.value !== 'partes');
    $('#bx-info', f).classList.toggle('oculto', !['hospedagem', 'aluguel', 'passeios', 'trilhas', 'eventos'].includes(cat));
    $$('.so-hosp', f).forEach(el => el.classList.toggle('oculto', cat !== 'hospedagem'));
    desenhaPartes();
    $('#rot-rot-data', f).textContent = cat === 'hospedagem' ? 'Entrada (check-in)' : cat === 'aluguel' ? 'Retirada' : 'Data';
    $('#rot-rot-local', f).textContent = cat === 'aluguel' ? 'Local de retirada e devolução' : cat === 'hospedagem' ? 'Endereço da hospedagem' : DICA_LOCAL[cat] || 'Onde (endereço ou nome do lugar)';
    f.descricao.placeholder = { trilhas: 'Ex.: Trilha do Morro de São Jerônimo', eventos: 'Ex.: Show na praça, festival', hospedagem: 'Ex.: Pousada Chapada', aluguel: 'Ex.: Carro Localiza' }[cat] || 'Ex.: Passeio de barco na Chapada';
  };
  $$('#rot-cats [data-c]', f).forEach(b => b.onclick = () => {
    cat = b.dataset.c; $$('#rot-cats [data-c]', f).forEach(x => x.setAttribute('aria-pressed', x === b));
    f.modo.value = cat === 'hospedagem' ? 'noites' : 'todos'; ajusta();
  });
  // pagamentos em partes
  function desenhaPartes() {
    const total = C.centavos(lerNum(f.valor.value)), soma = pags.reduce((s, p) => s + C.centavos(p.valor), 0);
    $('#lista-partes', f).innerHTML = pags.length ? pags.map((p, i) => `<div style="display:flex;align-items:center;gap:8px;padding:4px 0"><span style="flex:1"><b class="num">${brl(C.centavos(p.valor))}</b> por ${esc(primeiroNome(p.pagoPor))} · ${fmtData(p.data)}</span><button type="button" class="ic-btn" data-delp="${i}" aria-label="Tirar">✕</button></div>`).join('') : '<p class="mut peq" style="margin:0">Nenhum pagamento ainda. Ex.: sinal de 50%.</p>';
    $('#dica-partes', f).innerHTML = total ? `Pago ${brl(soma)} de ${brl(total)} · ${soma >= total ? '<b class="pos">quitado ✓</b>' : 'falta ' + brl(total - soma)}` : '';
    $$('[data-delp]', f).forEach(b => b.onclick = () => { pags.splice(Number(b.dataset.delp), 1); desenhaPartes(); });
  }
  $('#np-add', f).onclick = () => {
    const v = lerNum($('#np-valor', f).value);
    if (!(v > 0)) return toast('Digite o valor desse pagamento.');
    pags.push({ id: uid('PG'), valor: v, pagoPor: $('#np-quem', f).value, data: $('#np-data', f).value || hoje() });
    $('#np-valor', f).value = ''; desenhaPartes();
  };
  f.valor.addEventListener('input', desenhaPartes);
  // anexos (voucher, reserva, ingresso)
  function desenhaAnexos() {
    $('#lista-anexos', f).innerHTML = anexos.map((a, i) => `<div style="display:flex;align-items:center;gap:8px"><a href="${esc(a.url)}" target="_blank" rel="noopener" style="flex:1">${a.tipo === 'pdf' ? '📄' : '🖼️'} ${esc(a.nome)}</a><button type="button" class="ic-btn" data-dela="${i}" aria-label="Tirar">✕</button></div>`).join('');
    $$('[data-dela]', f).forEach(b => b.onclick = () => { anexos.splice(Number(b.dataset.dela), 1); desenhaAnexos(); });
  }
  desenhaAnexos();
  f.anexo.onchange = async () => {
    for (const arq of [...f.anexo.files]) {
      const pdf = arq.type === 'application/pdf';
      if (arq.size > 7 * 1024 * 1024) { toast(`${arq.name}: arquivo grande demais (máximo 7 MB).`); continue; }
      $('#lista-anexos', f).insertAdjacentHTML('beforeend', `<div class="mut peq" id="enviando-anexo">Enviando ${esc(arq.name)}…</div>`);
      try {
        const base64 = pdf ? await new Promise((ok, erro) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = erro; r.readAsDataURL(arq); })
          : (await reduzirFoto(arq, 1600)).base64;
        const j = await req('foto', { nome: arq.name, mime: pdf ? 'application/pdf' : 'image/jpeg', base64 });
        anexos.push({ nome: arq.name, url: j.url, tipo: pdf ? 'pdf' : 'img' });
      } catch (e) { toast('Não consegui enviar ' + arq.name + (e.servidor ? ': ' + e.message : ' (sem internet).')); }
      desenhaAnexos();
    }
    f.anexo.value = '';
  };
  $$('input[name=sit], input[name=tipoValor]', f).forEach(r => r.onchange = ajusta); ajusta();
  ligarDatas(f.data, f.ate, { min: S.dados.viagem.inicio, max: S.dados.viagem.fim }, 1);
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'del') { if (!confirm('Excluir este item do roteiro?')) return e.preventDefault(); return op({ op: 'excluir', tipo: 'gasto', id: g.id }); }
    if (b !== 'ok') return;
    const fd = new FormData(f), valor = lerNum(fd.get('valor'));
    const pp = fd.get('tipoValor') === 'porPessoa';
    if (!(valor > 0)) { e.preventDefault(); return toast(pp ? 'Informe o valor por pessoa.' : 'Informe o valor total.'); }
    const vao = fd.getAll('vai');
    if (!vao.length) { e.preventDefault(); return toast('Marque pelo menos uma pessoa que vai.'); }
    const link = String(fd.get('link') || '').trim();
    const sit = fd.get('sit');
    if (!pp && sit === 'partes' && !pags.length) { e.preventDefault(); return toast('Adicione pelo menos um pagamento (ex.: o sinal).'); }
    const somaPags = pags.reduce((s, p) => s + C.centavos(p.valor), 0);
    if (!pp && sit === 'partes' && somaPags > C.centavos(valor)) { e.preventDefault(); return toast('Os pagamentos passam do valor total.'); }
    const usaPartes = !pp && sit === 'partes';
    const infoNova = {}; ['checkin', 'checkout', 'wifi', 'wifiSenha', 'contato', 'instrucoes'].forEach(k => { const x = String(fd.get('i_' + k) || '').trim(); if (x) infoNova[k] = x; });
    const item = { ...g, roteiro: 'sim', categoria: cat, descricao: String(fd.get('descricao')).trim(), local: String(fd.get('local')).trim(), link: /^https?:\/\//i.test(link) ? link : (link ? 'https://' + link : ''),
      data: fd.get('data'), hora: fd.get('hora'), ate: fd.get('ate') || '', valor, moeda: 'BRL', cambio: 1, valorBRL: valor, modo: pp ? 'porPessoa' : fd.get('modo'),
      status: pp ? 'cada_um' : usaPartes ? (somaPags >= C.centavos(valor) ? '' : 'previsto') : sit === 'pago' ? '' : 'previsto',
      pagoPor: pp ? '' : usaPartes ? pags[0].pagoPor : sit === 'pago' ? fd.get('pagoPor') : '',
      pagamentos: usaPartes ? pags : [], anexos, info: infoNova, obs: String(fd.get('obs')).trim() };
    if (item.ate && item.data && item.ate < item.data) { e.preventDefault(); return toast('A data final está antes da inicial.'); }
    const ausentesAntes = g.ausentes || [];
    delete item.ausentes; // presença vai por "presenca" (não apaga o "não vou" que alguém marcou ao mesmo tempo)
    if (novo) item.ausentes = S.dados.pessoas.filter(p => !vao.includes(p.id)).map(p => p.id);
    op({ op: 'salvar', tipo: 'gasto', item });
    if (!novo) S.dados.pessoas.forEach(p => {
      const vaiAgora = vao.includes(p.id), ia = !ausentesAntes.includes(p.id);
      if (vaiAgora !== ia) op({ op: 'presenca', id: g.id, pessoa: p.id, vai: vaiAgora });
    });
    toast(novo ? 'Adicionado ao roteiro ✓' : 'Roteiro atualizado ✓');
  };
}

function telaResumo() {
  const gs = (S.dados.gastos || []).filter(pago);
  // Tudo o que foi lançado: gastos pagos + roteiro a pagar + o que cada um paga na hora.
  const todos = (S.dados.gastos || []).filter(g => C.totalItem(g, S.dados) > 0);
  const val = g => C.totalItem(g, S.dados);
  const total = todos.reduce((s, g) => s + val(g), 0);
  if (!total) { $('#tela').innerHTML = `<div class="cartao vazio"><b>📊</b>O resumo aparece assim que houver algo com valor no roteiro ou nos gastos.</div>`; return; }
  const jaPago = todos.reduce((s, g) => s + C.jaPagoItem(g, S.dados), 0);
  const aPagar = todos.filter(g => g.status === 'previsto').reduce((s, g) => s + val(g) - C.jaPagoItem(g, S.dados), 0);
  const naHora = todos.filter(cadaUm).reduce((s, g) => s + val(g), 0);
  const sal = C.saldos(S.dados), partes = C.partes(S.dados);
  const porCat = {}, porDia = {};
  todos.forEach(g => { const v = val(g); porCat[g.categoria] = (porCat[g.categoria] || 0) + v; if (g.data) porDia[g.data] = (porDia[g.data] || 0) + v; });
  const cats = Object.entries(porCat).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
  const diaTop = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
  const maior = todos.slice().sort((a, b) => val(b) - val(a))[0];
  const pagou = S.dados.pessoas.slice().sort((a, b) => (sal.pago[b.id] || 0) - (sal.pago[a.id] || 0));
  const n = S.dados.pessoas.length || 1;
  const maxP = Math.max(1, ...pagou.map(p => sal.pago[p.id] || 0));
  const porPessoa = S.dados.pessoas.slice().sort((a, b) => (partes[b.id] || 0) - (partes[a.id] || 0));
  const maxPP = Math.max(1, ...porPessoa.map(p => partes[p.id] || 0));
  const html = `
  <div class="cartao destaque" style="text-align:center">
    <div class="peq" style="opacity:.9">${esc(S.dados.viagem.nome)} · custo total</div>
    <div style="font-size:2.1rem;font-weight:800" class="num">${brl(total)}</div>
    <div class="peq" style="opacity:.9">${todos.length} lançamentos · ${S.dados.pessoas.length} pessoas · ≈ ${brl(Math.round(total / n))} por pessoa</div>
  </div>
  <div class="cartao" style="padding:12px 16px">
    <div class="linha-bar" style="margin:0"><div class="barra" style="height:14px;display:flex">
      <i style="width:${jaPago / total * 100}%;border-radius:0;background:var(--pos)"></i><i style="width:${aPagar / total * 100}%;border-radius:0;background:var(--laranja)"></i><i style="width:${naHora / total * 100}%;border-radius:0;background:var(--azul)"></i></div></div>
    <div class="peq" style="display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:8px">
      <span><b style="color:var(--pos)">●</b> Já pago ${brl(jaPago)}</span><span><b style="color:var(--laranja)">●</b> A pagar ${brl(aPagar)}</span><span><b style="color:var(--azul)">●</b> Cada um paga na hora ${brl(naHora)}</span></div>
  </div>
  <div class="placar">
    <div class="cartao"><small>Dia mais caro</small><strong style="font-size:1rem">${diaTop ? fmtDia(diaTop[0]) : '—'}</strong><div class="num mut peq">${diaTop ? brl(diaTop[1]) : ''}</div></div>
    <div class="cartao"><small>Maior item</small><strong style="font-size:1rem">${esc(maior.descricao || C.CAT[maior.categoria]?.nome)}</strong><div class="num mut peq">${brl(val(maior))}</div></div>
  </div>
  <div class="cartao"><h2>Para onde vai o dinheiro</h2>${cats.map(([c, v]) => { const k = C.CAT[c] || C.CAT.outros; return `<div class="linha-bar"><div class="t"><span>${k.icone} ${k.nome}</span><span class="num">${brl(v)} <span class="mut">${Math.round(v / total * 100)}%</span></span></div><div class="barra"><i style="width:${v / cats[0][1] * 100}%"></i></div></div>`; }).join('')}</div>
  <div class="cartao"><h2>Quanto fica para cada um</h2>${porPessoa.map(p => `<div class="linha-bar"><div class="t"><span>${esc(p.nome)}${p.id === S.eu ? ' (você)' : ''}</span><span class="num">${brl(partes[p.id] || 0)}</span></div><div class="barra"><i style="width:${(partes[p.id] || 0) / maxPP * 100}%"></i></div></div>`).join('')}</div>
  ${(() => { const ag = saldoAgrupado(); return `<div class="cartao"><h2>Situação de cada um (só o que já foi pago)</h2><ul class="lista">${S.dados.pessoas.map(p => {
      const r = responsavel(p.id), s = ag.agrupado[p.id] || 0;
      return `<li><span class="meio"><b>${esc(p.nome)}</b><small>${r !== p.id ? '💑 conta acertada por ' + esc(primeiroNome(r)) : 'pagou ' + brl(ag.pago[p.id] || 0) + ' · consumiu ' + brl(ag.consumo[p.id] || 0)}</small></span>
        <span class="num ${s > 0 ? 'pos' : s < 0 ? 'neg' : 'mut'}"><b>${r !== p.id ? '—' : (s > 0 ? '+' : s < 0 ? '−' : '') + brl(Math.abs(s))}</b></span></li>`; }).join('')}</ul>
    <h2 style="margin-top:14px">Acerto do grupo</h2>${ag.transf.length ? ag.transf.map(t => `<div class="peq" style="display:flex;justify-content:space-between;padding:4px 0;border-top:1px solid var(--lin)"><span>${esc(nome(t.de))} → ${esc(nome(t.para))}</span><b class="num">${brl(t.valor)}</b></div>`).join('') : '<p class="mut peq">Ninguém deve nada. 🎉</p>'}</div>`; })()}
  ${jaPago ? `<div class="cartao"><h2>Quem passou o cartão</h2>${pagou.map((p, i) => `<div class="linha-bar"><div class="t"><span>${i === 0 ? '🏆 ' : ''}${esc(p.nome)}</span><span class="num">${brl(sal.pago[p.id] || 0)}</span></div><div class="barra"><i style="width:${(sal.pago[p.id] || 0) / maxP * 100}%"></i></div></div>`).join('')}</div>` : ''}
  <div style="display:grid;gap:8px"><button class="btn pri lg" id="compartilhar-resumo">Compartilhar resumo no grupo</button>
  <button class="btn lg" id="relatorio-pdf">📄 Relatório da viagem (PDF)</button></div>`;
  $('#tela').innerHTML = html;
  $('#relatorio-pdf').onclick = relatorioPDF;
  $('#compartilhar-resumo').onclick = () => {
    const tr = saldoAgrupado().transf;
    const txt = `🧳 ${S.dados.viagem.nome}\nCusto total: ${brl(total)} (≈ ${brl(Math.round(total / n))} por pessoa)\nJá pago ${brl(jaPago)} · a pagar ${brl(aPagar)} · na hora ${brl(naHora)}\n\n` +
      cats.map(([c, v]) => `${(C.CAT[c] || C.CAT.outros).icone} ${(C.CAT[c] || C.CAT.outros).nome}: ${brl(v)}`).join('\n') +
      (tr.length ? `\n\n💸 Acerto:\n` + tr.map(t => `${nome(t.de)} → ${nome(t.para)}: ${brl(t.valor)}`).join('\n') : '\n\n🎉 Tudo acertado!');
    compartilhar(txt);
  };
}

/* ---------- Relatório final: página pronta para imprimir ou "Salvar como PDF" ---------- */
function relatorioPDF() {
  const d = S.dados, v = d.viagem, sal = C.saldos(d), partes = C.partes(d), tr = saldoAgrupado().transf;
  const total = (d.gastos || []).reduce((s, g) => s + C.totalItem(g, d), 0);
  const tab = (cab, linhas) => `<table><thead><tr>${cab.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${linhas.join('')}</tbody></table>`;
  const gastos = (d.gastos || []).slice().sort((a, b) => (a.data || '').localeCompare(b.data || ''));
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(v.nome)} — relatório</title><style>
    body{font:12px/1.4 system-ui,Segoe UI,Arial,sans-serif;color:#101a3c;margin:24px} h1{font-size:20px;margin:0} h2{font-size:14px;margin:22px 0 6px;border-bottom:2px solid #2ad4b4;padding-bottom:3px}
    .sub{color:#5a6386} table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:4px 6px;border-bottom:1px solid #e0e3ef;vertical-align:top} th{background:#f4f5fa;font-size:11px}
    td.n,th.n{text-align:right;white-space:nowrap} .pos{color:#0f8f78} .neg{color:#d9531e} .topo{display:flex;justify-content:space-between;align-items:center;border-bottom:4px solid;border-image:linear-gradient(90deg,#f7931e,#2ad4b4,#3aa0f0) 1;padding-bottom:10px}
    .total{font-size:22px;font-weight:800} @media print{body{margin:10mm} button{display:none}}</style></head><body>
    <div class="topo"><div><h1>${esc(v.nome)}</h1><div class="sub">${v.inicio ? fmtData(v.inicio) + ' a ' + fmtData(v.fim) : ''}${v.destino ? ' · ' + esc(v.destino) : ''} · ${d.pessoas.length} pessoas</div></div>
      <div style="text-align:right"><div class="sub">Custo total</div><div class="total">${brl(total)}</div></div></div>
    <button onclick="print()" style="margin:12px 0;padding:8px 14px">Imprimir / Salvar como PDF</button>
    <h2>Quanto ficou para cada um</h2>${tab(['Pessoa', '<span class=n>Parte na viagem</span>', '<span class=n>Pagou</span>', '<span class=n>Saldo</span>'], d.pessoas.map(p => { const s = sal.saldo[p.id] || 0; return `<tr><td>${esc(p.nome)}</td><td class="n">${brl(partes[p.id] || 0)}</td><td class="n">${brl(sal.pago[p.id] || 0)}</td><td class="n ${s > 0 ? 'pos' : s < 0 ? 'neg' : ''}">${s > 0 ? '+' : s < 0 ? '−' : ''}${brl(Math.abs(s))}</td></tr>`; }))}
    <h2>Acerto final</h2>${tr.length ? tab(['De', 'Para', '<span class=n>Valor</span>', 'Pix de quem recebe'], tr.map(t => `<tr><td>${esc(nome(t.de))}</td><td>${esc(nome(t.para))}</td><td class="n"><b>${brl(t.valor)}</b></td><td>${esc((pessoa(t.para) || {}).pix || '—')}</td></tr>`)) : '<p>Tudo acertado: ninguém deve nada. 🎉</p>'}
    <h2>Roteiro</h2>${itensRoteiro().length ? tab(['Quando', 'O quê', 'Onde', '<span class=n>Valor</span>', 'Situação'], itensRoteiro().map(g => `<tr><td>${esc(quando(g))}</td><td>${esc(g.descricao)}</td><td>${esc(g.local || '')}</td><td class="n">${cadaUm(g) ? brl(C.centavos(g.valor)) + ' p/ pessoa' : brl(C.valorDoGasto(g))}</td><td>${cadaUm(g) ? 'cada um paga' : g.status === 'previsto' ? (C.jaPagoItem(g, d) ? 'pago em parte' : 'a pagar') : 'pago por ' + esc(nome(g.pagoPor))}</td></tr>`)) : '<p>Sem roteiro.</p>'}
    <h2>Todos os gastos</h2>${tab(['Data', 'Descrição', 'Pago por', 'Dividido entre', '<span class=n>Valor</span>'], gastos.filter(g => !ehRoteiro(g)).map(g => { const ps = Object.keys(C.dividir(g, d)); return `<tr><td>${fmtData(g.data)}</td><td>${esc(g.descricao)}${g.status === 'pendente' ? ' (pendente)' : ''}</td><td>${esc(nome(g.pagoPor))}</td><td>${ps.length === d.pessoas.length ? 'todos' : ps.map(primeiroNome).join(', ')}</td><td class="n">${brl(C.valorDoGasto(g))}</td></tr>`; }))}
    <h2>Pagamentos entre amigos</h2>${(d.acertos || []).length ? tab(['Data', 'De', 'Para', '<span class=n>Valor</span>', 'Situação'], d.acertos.map(a => `<tr><td>${fmtData(a.data)}</td><td>${esc(nome(a.de))}</td><td>${esc(nome(a.para))}</td><td class="n">${brl(C.centavos(a.valor))}</td><td>${a.status === 'aguardando' ? 'aguardando confirmação' : 'confirmado'}</td></tr>`)) : '<p>Nenhum ainda.</p>'}
    <p class="sub" style="margin-top:24px">Gerado pelo ${esc(NOME)} em ${new Date().toLocaleString('pt-BR')}.</p></body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('O navegador bloqueou a janela do relatório. Permita pop-ups para este site.');
  w.document.open(); w.document.write(html); w.document.close();
  setTimeout(() => { try { w.focus(); w.print(); } catch (e) {} }, 400);
}

function telaGrupo() {
  const v = S.dados.viagem;
  const link = linkConvite();
  const org = souOrg(), leg = legado();
  let html = `<div class="cartao"><h2>Convidar amigos</h2>
    <p class="mut peq" style="margin-top:-4px">${leg ? 'Quem abrir o link entra na viagem e já pode lançar gastos.' : 'Mande o link no grupo. Cada um toca no próprio nome (ou em "Não estou na lista") e cria a sua senha. Você não precisa cadastrar ninguém antes.'}${DEMO ? ' <b>No modo demonstração o link só funciona neste aparelho.</b>' : ''}</p>
    <div class="copia">${esc(link)}</div>
    <div class="btns"><button class="btn pri" id="conv-comp">Enviar convite</button><button class="btn" id="conv-copia">Copiar link</button></div></div>
  <div class="titulo-sec">Pessoas (${S.dados.pessoas.length})</div>
  <div class="cartao" style="padding:4px 16px"><ul class="lista">${S.dados.pessoas.map(p => {
    const acesso = leg ? '' : p.papel === 'organizador' ? '👑 organizador' : !p.temSenha ? '🔒 sem senha ainda' : p.trocarSenha ? 'ainda não criou a senha dele' : '';
    const extra = [org ? acesso : (p.papel === 'organizador' ? '👑 organizador' : ''), p.chegada || p.saida ? `${p.chegada ? 'chega ' + fmtData(p.chegada) : ''}${p.chegada && p.saida ? ', ' : ''}${p.saida ? 'sai ' + fmtData(p.saida) : ''}` : '', Number(p.peso) && Number(p.peso) !== 1 ? `conta como ${fmtNum(p.peso)}` : '', ...(p.restricoes || []).map(r => (C.RESTRICOES[r] || r).split(' ').slice(1).join(' ').toLowerCase()), p.pix ? 'Pix ✓' : 'sem Pix'].filter(Boolean).join(' · ');
    const pode = org || p.id === S.eu;
    return `<li class="${pode ? 'clica' : ''}" data-p="${esc(p.id)}"><span class="ico">${p.id === S.eu ? '🙋' : '👤'}</span><span class="meio"><b>${esc(p.nome)}${p.id === S.eu ? ' (você)' : ''}</b><small>${esc(extra)}</small></span>${pode ? '<span class="mut">›</span>' : ''}</li>`;
  }).join('')}</ul>${org ? '<button class="btn lg sua" id="add-p" style="margin:6px 0 12px">+ Adicionar pessoa</button>' : '<p class="dica" style="margin:6px 0 12px">Só o organizador cadastra pessoas. Toque no seu nome para editar seus dados.</p>'}</div>
  ${org || (S.dados.carros || []).length ? `<div class="titulo-sec">Carros (${(S.dados.carros || []).length})</div>
  <div class="cartao" style="padding:4px 16px">
    ${(S.dados.carros || []).length ? '' : '<p class="mut peq">Cadastre os carros para dividir aluguel, combustível e pedágio só entre quem foi em cada um.</p>'}
    <ul class="lista">${(S.dados.carros || []).map(c => `<li class="${org ? 'clica' : ''}" data-c="${esc(c.id)}"><span class="ico">${c.tipo === 'alugado' ? '🚙' : '🚗'}</span><span class="meio"><b>${esc(c.nome)}</b><small>${c.tipo === 'alugado' ? 'alugado' : 'de ' + esc(primeiroNome(c.dono))} · ${(c.ocupantes || []).map(primeiroNome).join(', ')}${c.consumo ? ' · ' + fmtNum(c.consumo) + ' km/l' : ''}</small></span>${org ? '<span class="mut">›</span>' : ''}</li>`).join('')}</ul>
    ${org ? '<button class="btn lg sua" id="add-c" style="margin:6px 0 12px">+ Adicionar carro</button>' : ''}</div>` : ''}
  <div class="titulo-sec">Viagem</div>
  <div class="cartao">
    <fieldset style="border:0;padding:0;margin:0" ${org ? '' : 'disabled'}>
    <label class="cp"><span>Nome</span><input type="text" id="v-nome" value="${esc(v.nome)}"></label>
    <div class="grade2"><label class="cp"><span>Início</span><input type="date" id="v-ini" value="${esc(v.inicio)}"></label><label class="cp"><span>Fim</span><input type="date" id="v-fim" value="${esc(v.fim)}"></label></div>
    <div class="grade2"><label class="cp"><span>Destino</span><input type="text" id="v-dest" value="${esc(v.destino || '')}" placeholder="Ex.: Cuiabá"></label><label class="cp"><span>Aeroporto (sigla)</span><input type="text" id="v-aero" value="${esc(v.aeroporto || '')}" placeholder="Ex.: CGB" maxlength="4"></label></div>
    </fieldset>
    <p class="dica" style="margin-bottom:0">${org ? 'As datas valem para quem não tem chegada/saída própria. Destino e aeroporto são usados na busca de passagens.' : 'Só o organizador muda os dados da viagem.'}</p>
  </div>
  <p class="dica" style="text-align:center">Seus dados, senha e sair da conta: botão 👤 no canto de cima.</p>`;
  $('#tela').innerHTML = html;
  $('#conv-comp').onclick = () => compartilhar(leg ? `Entra na viagem "${v.nome}" no ${NOME} para a gente dividir os gastos: ${link}` : `🧳 Entra na viagem "${v.nome}" no ${NOME}: ${link}\nToque no seu nome (ou em "Não estou na lista") e crie a sua senha. Lá tem o roteiro, quanto fica para cada um e onde lançar os gastos.`, link);
  $('#conv-copia').onclick = () => copiar(link);
  $$('li[data-p].clica').forEach(li => li.onclick = () => formPessoa(pessoa(li.dataset.p)));
  $$('li[data-c].clica').forEach(li => li.onclick = () => formCarro(S.dados.carros.find(c => c.id === li.dataset.c)));
  if ($('#add-p')) $('#add-p').onclick = () => formPessoa();
  if ($('#add-c')) $('#add-c').onclick = () => formCarro();
  $('#v-nome').onchange = e => { const x = e.target.value.trim(); if (x) op({ op: 'viagem', dados: { nome: x } }); };
  $('#v-ini').onchange = e => op({ op: 'viagem', dados: { inicio: e.target.value } });
  $('#v-fim').onchange = e => op({ op: 'viagem', dados: { fim: e.target.value } });
  ligarDatas($('#v-ini'), $('#v-fim'), {}, 1);
  $('#v-dest').onchange = e => op({ op: 'viagem', dados: { destino: e.target.value.trim() } });
  $('#v-aero').onchange = e => op({ op: 'viagem', dados: { aeroporto: e.target.value.trim().toUpperCase() } });
}

/* ---------- histórico ---------- */
function quandoFoi(iso) {
  const d = new Date(iso); if (isNaN(d)) return '';
  const min = Math.round((Date.now() - d) / 60000);
  if (min < 1) return 'agora'; if (min < 60) return `há ${min} min`; if (min < 24 * 60) return `há ${Math.round(min / 60)} h`;
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}
function janelaHistorico() {
  const h = S.dados.historico || [];
  janela('🕓 Histórico de alterações', h.length ? `<p class="mut peq" style="margin-top:0">Tudo o que foi lançado, mudado ou apagado na viagem (mais recente primeiro).</p>
    <ul class="lista">${h.map(x => `<li><span class="ico" style="width:34px;height:34px;font-size:.9rem;font-weight:800">${esc(nome(x.pessoa).charAt(0))}</span><span class="meio"><b style="white-space:normal">${esc(nome(x.pessoa))}</b><small style="white-space:normal">${esc(x.texto)}</small></span><span class="mut peq" style="white-space:nowrap">${quandoFoi(x.quando)}</span></li>`).join('')}</ul>`
    : '<div class="vazio"><b>🕓</b>Nada registrado ainda.</div>');
}

/* ---------- menu da conta (botão 👤 no topo) ---------- */
function esquecerViagem() {
  if (S.fila.length && !confirm(`Ainda há ${S.fila.length} alteração(ões) sem enviar. Sair mesmo assim e perdê-las?`)) return;
  if (!S.fila.length && !confirm('Tirar esta viagem da lista deste aparelho? Ela continua salva na planilha, e você pode voltar pelo link.')) return;
  ls.set('rv:viagens', minhas().filter(x => x.v !== S.v));
  ['rv:dados:', 'rv:fila:', 'rv:eu:', 'rv:tok:'].forEach(k => ls.del(k + S.v));
  sair();
}
function menuConta() {
  if (!S || !S.dados) return;
  const eu = pessoa(S.eu), leg = legado();
  const f = janela(eu ? esc(eu.nome) + (souOrg() && !leg ? ' 👑' : '') : 'Minha conta', `
    <p class="mut" style="margin-top:0">${esc(S.dados.viagem.nome)}${eu && eu.email ? ' · ' + esc(eu.email) : ''}</p>
    <div style="display:grid;gap:8px">
      ${eu ? '<button class="btn lg" value="dados">✏️ Meus dados (nome, Pix, datas)</button>' : ''}
      ${leg ? '<button class="btn lg" value="quem">🔄 Trocar quem sou eu</button>' : '<button class="btn lg" value="senha">🔑 Trocar minha senha</button><button class="btn lg" value="sair">🚪 Sair da minha conta</button>'}
      <button class="btn lg" value="hist">🕓 Histórico de alterações</button>
      <button class="btn lg" value="viagens">🧳 Minhas viagens</button>
      <button class="btn lg perigo" value="esquecer">🗑️ Tirar viagem deste aparelho</button>
    </div>`);
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'dados') { e.preventDefault(); formPessoa(eu); }
    if (b === 'senha') { e.preventDefault(); trocarSenha('', false); }
    if (b === 'quem') { e.preventDefault(); quemSouEu(); }
    if (b === 'hist') { e.preventDefault(); janelaHistorico(); }
    if (b === 'sair') sairDaConta();
    if (b === 'viagens') sair();
    if (b === 'esquecer') esquecerViagem();
  };
}

function linkConvite() { return location.origin + location.pathname + '#v=' + S.v + '&c=' + S.c; }
async function copiar(txt) {
  try { await navigator.clipboard.writeText(txt); toast('Copiado!'); }
  catch (e) { prompt('Copie:', txt); }
}
async function compartilhar(txt, url) {
  if (navigator.share) { try { await navigator.share(url ? { text: txt } : { text: txt }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copiar(txt);
}
function irAba(a) { ABA = a; ls.set('rv:aba', a); window.scrollTo(0, 0); render(); }

/* ---------- janelas ---------- */
const dlg = $('#dlg');
// Cada janela ganha um formulário novo (assim os eventos da janela anterior não ficam pendurados).
function janela(titulo, corpo, botoes) {
  const f = document.createElement('form');
  f.method = 'dialog';
  f.innerHTML = `<div class="dlg-top"><h2>${titulo}</h2><button class="ic-btn" value="x" aria-label="Fechar" formnovalidate>✕</button></div>
    <div class="dlg-corpo">${corpo}</div>${botoes ? `<div class="dlg-pe">${botoes}</div>` : ''}`;
  const t = $('#toast');
  dlg.replaceChildren(f);
  if (t) dlg.appendChild(t); // mantém o aviso (ele mora dentro da janela enquanto ela está aberta)
  if (!dlg.open) dlg.showModal();
  return f;
}
dlg.addEventListener('close', () => { const t = $('#toast'); if (t && t.parentNode === dlg) document.body.appendChild(t); });
function fecharJanela() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) fecharJanela(); });

function novaViagem() {
  const f = janela('Nova viagem', `
    <label class="cp"><span>Nome da viagem</span><input type="text" name="nome" required placeholder="Ex.: Mato Grosso 2027"></label>
    <div class="grade2"><label class="cp"><span>Início</span><input type="date" name="inicio"></label><label class="cp"><span>Fim</span><input type="date" name="fim"></label></div>
    <div class="grade2"><label class="cp"><span>Destino</span><input type="text" name="destino" placeholder="Ex.: Cuiabá"></label><label class="cp"><span>Aeroporto (sigla)</span><input type="text" name="aeroporto" placeholder="Ex.: CGB" maxlength="4"></label></div>
    <div class="titulo-sec" style="margin-top:4px">Você (organizador)</div>
    <label class="cp"><span>Seu nome</span><input type="text" name="meuNome" required autocomplete="name"></label>
    <label class="cp"><span>Seu e-mail</span><input type="email" name="email" autocomplete="email" placeholder="Para receber os avisos de passagem"></label>
    <label class="cp"><span>De onde você sai</span><input type="text" name="origem" placeholder="Ex.: Goiânia ou GYN"></label>
    <label class="cp"><span>Crie sua senha</span><input type="password" name="senha" minlength="4" required autocomplete="new-password"></label>
    <div class="titulo-sec" style="margin-top:4px">Quem mais vai</div>
    <label class="cp"><span>Um nome por linha (opcional)</span><textarea name="pessoas" rows="4" placeholder="Ana&#10;João"></textarea></label>
    <p class="dica">Não precisa pôr todo mundo agora: quem receber o link pode se cadastrar sozinho.</p>`,
    `<button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Criar viagem</button>`);
  ligarDatas(f.inicio, f.fim, { min: hoje() }, 1);
  f.onsubmit = async e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    e.preventDefault();
    const fd = new FormData(f);
    const meu = String(fd.get('meuNome')).trim();
    const nomes = String(fd.get('pessoas') || '').split(/\n|,/).map(s => s.trim()).filter(n => n && n.toLowerCase() !== meu.toLowerCase());
    const pessoas = [...new Set(nomes)].map(n => ({ id: uid('P'), nome: n, chegada: '', saida: '', peso: 1, restricoes: [], pix: '' }));
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Criando…';
    try {
      const j = await chamar({ acao: 'criar', nome: String(fd.get('nome')).trim(), inicio: fd.get('inicio'), fim: fd.get('fim'),
        destino: String(fd.get('destino')).trim(), aeroporto: String(fd.get('aeroporto')).trim().toUpperCase(), app: location.origin + location.pathname,
        organizador: { nome: meu, email: String(fd.get('email')).trim(), origem: String(fd.get('origem')).trim(), senha: fd.get('senha') }, pessoas });
      ls.set('rv:dados:' + j.v, j.dados);
      ls.set('rv:eu:' + j.v, j.eu); ls.set('rv:tok:' + j.v, j.tok || '');
      lembrar(j.v, j.c, j.dados.viagem.nome);
      fecharJanela();
      ABA = 'roteiro';
      abrir(j.v, j.c);
      toast('Viagem criada! Monte o roteiro e mande o convite no grupo.');
    } catch (err) { btn.disabled = false; btn.textContent = 'Criar viagem'; toast(err.servidor ? err.message : 'Precisa de internet para criar a viagem.'); }
  };
}

function entrarComLink() {
  const f = janela('Entrar na viagem', `
    <label class="cp"><span>Cole o link do convite</span><input type="text" name="link" required placeholder="https://…#v=…&c=…"></label>`,
    `<button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Entrar</button>`);
  f.onsubmit = e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    e.preventDefault();
    const s = String(new FormData(f).get('link'));
    const m = s.match(/v=([A-Z0-9]+).*?c=([A-Z0-9]+)/i);
    if (!m) return toast('Link inválido. Peça o convite de novo.');
    fecharJanela(); abrir(m[1], m[2]);
  };
}

function quemSouEu() {
  if (!S || !S.dados) return;
  const f = janela('Quem é você?', `<p class="mut" style="margin-top:0">Assim o app mostra a sua parte e o que você tem a pagar ou receber.</p>
    <div class="chips">${S.dados.pessoas.map(p => `<button class="chip" value="${esc(p.id)}" aria-pressed="${p.id === S.eu}">${esc(p.nome)}</button>`).join('')}</div>
    <p class="dica" style="margin-top:14px">Não está na lista? Feche e adicione seu nome na aba Grupo.</p>`);
  f.onsubmit = e => {
    const id = e.submitter && e.submitter.value;
    if (id && id !== 'x') { S.eu = id; ls.set('rv:eu:' + S.v, id); render(); }
  };
}

function opcoesPessoas(sel, vazio) {
  return (vazio ? `<option value="">${vazio}</option>` : '') + S.dados.pessoas.map(p => `<option value="${esc(p.id)}" ${p.id === sel ? 'selected' : ''}>${esc(p.nome)}</option>`).join('');
}

/* Chave Pix: a pessoa escolhe o tipo e digita do jeito que quiser; o app guarda no formato do Banco Central. */
const TIPOS_PIX = { celular: 'Celular', cpf: 'CPF / CNPJ', email: 'E-mail', aleatoria: 'Aleatória' };
// CPF tem 2 dígitos verificadores: é isso que separa um CPF de um celular (os dois têm 11 números).
function cpfValido(d) {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}
function tipoPix(ch) {
  const s = String(ch || '').trim(), dig = s.replace(/\D/g, '');
  if (!s) return 'celular';
  if (s.includes('@')) return 'email';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s)) return 'aleatoria';
  if (s.startsWith('+') || /[()]/.test(s)) return 'celular';
  if (dig.length === 14 || /\d{3}\.\d{3}\.\d{3}-\d{2}/.test(s)) return 'cpf';
  if (dig.length === 11) return cpfValido(dig) ? 'cpf' : 'celular';
  if (dig.length === 10) return 'celular';
  return 'cpf';
}
function mostrarPix(ch) { const s = String(ch || ''); return /^\+55\d{10,11}$/.test(s) ? s.slice(3) : s; }
// Devolve a chave no formato certo, '' se vazia, ou null se não fizer sentido para o tipo.
function guardarPix(tipo, ch) {
  const s = String(ch || '').trim(), dig = s.replace(/\D/g, '');
  if (!s) return '';
  if (tipo === 'email') return s.includes('@') ? s.toLowerCase() : null;
  if (tipo === 'aleatoria') return s.length >= 20 ? s.toLowerCase() : null;
  if (tipo === 'cpf') return (dig.length === 11 && cpfValido(dig)) || dig.length === 14 ? dig : null;
  const cel = dig.length >= 12 && dig.startsWith('55') ? dig.slice(2) : dig;
  return cel.length === 10 || cel.length === 11 ? '+55' + cel : null;
}

function formPessoa(p) {
  const novo = !p;
  p = p || { id: uid('P'), nome: '', email: '', origem: '', papel: 'membro', chegada: '', saida: '', peso: 1, restricoes: [], pix: '' };
  const org = souOrg(), leg = legado(), eu = p.id === S.eu;
  const sugestao = String(Math.floor(100000 + Math.random() * 900000));
  const blocoAcesso = leg || !org ? '' : `
    <div class="titulo-sec" style="margin-top:4px">Acesso</div>
    ${eu ? '' : `<label class="check"><input type="checkbox" name="org" ${p.papel === 'organizador' ? 'checked' : ''}>👑 Também é organizador (cadastra pessoas e confirma passagens)</label>`}
    ${eu ? '<p class="dica">Para trocar a sua senha, use "Trocar minha senha" na aba Grupo.</p>' : `
    <label class="cp"><span>${p.temSenha ? 'Nova senha temporária (só se a pessoa esqueceu a dela)' : 'Senha temporária (opcional)'}</span>
      <input type="text" name="senhaNova" value="" placeholder="${p.temSenha ? 'Deixe em branco para manter' : 'Em branco: a pessoa cria no 1º acesso'}" autocomplete="off"></label>
    <p class="dica">${p.temSenha ? 'Se a pessoa esqueceu a senha, crie uma temporária (ex.: ' + sugestao + ') e mande no privado. Ela troca no próximo acesso.' : 'Não precisa: pelo link a pessoa toca no nome e cria a senha dela.'}</p>`}`;
  const f = janela(novo ? 'Adicionar pessoa' : (eu ? 'Meus dados' : 'Editar pessoa'), `
    <label class="cp"><span>Nome</span><input type="text" name="nome" required value="${esc(p.nome)}"></label>
    ${leg ? '' : `<label class="cp"><span>E-mail</span><input type="email" name="email" value="${esc(p.email || '')}" placeholder="Para lembretes de passagem"></label>`}
    <label class="cp"><span>De onde sai (cidade ou aeroporto)</span><input type="text" name="origem" value="${esc(p.origem || '')}" placeholder="Ex.: Goiânia ou GYN"></label>
    <div class="grade2"><label class="cp"><span>Chegou em</span><input type="date" name="chegada" value="${esc(p.chegada)}"></label><label class="cp"><span>Saiu em</span><input type="date" name="saida" value="${esc(p.saida)}"></label></div>
    <p class="dica">Deixe em branco se ficou a viagem toda. Hospedagem é dividida pelas noites e comida pelos dias em que a pessoa estava.</p>
    <label class="cp"><span>Conta como quantas pessoas?</span><input type="text" inputmode="decimal" name="peso" value="${esc(fmtNum(p.peso === '' ? 1 : p.peso))}"></label>
    <p class="dica">1 = normal · 2 = casal que divide como um · 0,5 = criança.</p>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:2px">Não entra na divisão de</span>
    ${Object.entries(C.RESTRICOES).map(([k, r]) => `<label class="check"><input type="checkbox" name="r" value="${k}" ${(p.restricoes || []).includes(k) ? 'checked' : ''}>${r}</label>`).join('')}
    <div class="grade2" style="grid-template-columns:1fr 1.6fr">
      <label class="cp" style="margin-top:8px"><span>Tipo da chave Pix</span><select name="pixTipo">${Object.entries(TIPOS_PIX).map(([k, r]) => `<option value="${k}" ${k === tipoPix(p.pix) ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="cp" style="margin-top:8px"><span>Chave Pix (para receber)</span><input type="text" name="pix" value="${esc(mostrarPix(p.pix))}" placeholder="Ex.: 62999998888" autocapitalize="off"></label>
    </div>
    <p class="dica">Celular: só os números com DDD, sem +55. CPF: só os números.</p>
    ${novo ? '' : `<label class="cp"><span>💑 Quem acerta a conta desta pessoa</span><select name="juntaCom">${S.dados.pessoas.map(x => `<option value="${esc(x.id)}" ${responsavel(p.id) === x.id ? 'selected' : ''}>${x.id === p.id ? 'Ela mesma' : esc(x.nome)}</option>`).join('')}</select></label>
    <p class="dica">Para casal ou família: a parte desta pessoa entra na conta de quem você escolher, e o Pix sai de uma vez só.</p>`}${blocoAcesso}`,
    `${novo || !org || eu ? '' : '<button class="btn perigo" value="del" formnovalidate>Remover</button>'}<button class="btn pri" value="ok">Salvar</button>`);
  f.pixTipo.onchange = () => { f.pixTipo.dataset.manual = '1'; };
  // chegada/saída dentro do período da viagem; saída vazia = fica até o fim (por isso não preenche sozinho)
  ligarDatas(f.chegada, f.saida, { min: S.dados.viagem.inicio, max: S.dados.viagem.fim }, 0);
  if (!f.chegada.value && S.dados.viagem.inicio) f.chegada.min = S.dados.viagem.inicio;
  f.pix.oninput = () => { if (!f.pixTipo.dataset.manual && f.pix.value.replace(/\D/g, '').length >= 10 || f.pix.value.includes('@')) if (!f.pixTipo.dataset.manual) f.pixTipo.value = tipoPix(f.pix.value); };
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'del') {
      const usado = (S.dados.gastos || []).some(g => g.pagoPor === p.id || (g.participantes || []).includes(p.id) || (g.valores || {})[p.id]) || (S.dados.acertos || []).some(a => a.de === p.id || a.para === p.id);
      if (usado) { e.preventDefault(); return toast('Essa pessoa tem gastos ou pagamentos. Mude-os antes de remover.'); }
      if (!confirm(`Remover ${p.nome}?`)) return e.preventDefault();
      (S.dados.carros || []).filter(c => (c.ocupantes || []).includes(p.id)).forEach(c => op({ op: 'salvar', tipo: 'carro', item: { ...c, ocupantes: c.ocupantes.filter(x => x !== p.id) } }));
      return op({ op: 'excluir', tipo: 'pessoa', id: p.id });
    }
    if (b !== 'ok') return;
    const fd = new FormData(f);
    const item = { id: p.id, nome: String(fd.get('nome')).trim(), origem: String(fd.get('origem') || '').trim(), chegada: fd.get('chegada'), saida: fd.get('saida'), peso: lerNum(fd.get('peso')) === '' ? 1 : lerNum(fd.get('peso')), restricoes: fd.getAll('r'), pix: guardarPix(fd.get('pixTipo'), fd.get('pix')) };
    if (item.pix === null) { e.preventDefault(); return toast(fd.get('pixTipo') === 'cpf' ? 'Esse número não é um CPF válido. Se for celular, troque o tipo da chave para "Celular".' : 'Confira a chave Pix: ela não bate com o tipo escolhido.'); }
    if (!leg) item.email = String(fd.get('email') || '').trim();
    if (item.chegada && item.saida && item.saida < item.chegada) { e.preventDefault(); return toast(`A saída (${fmtData(item.saida)}) está antes da chegada (${fmtData(item.chegada)}). Corrija uma das datas.`); }
    if (!leg && org && !eu) {
      item.papel = fd.get('org') ? 'organizador' : 'membro';
      const sn = String(fd.get('senhaNova') || '').trim();
      if (sn && sn.length < 4) { e.preventDefault(); return toast('A senha inicial precisa ter pelo menos 4 caracteres.'); }
      if (sn) { item.senhaNova = sn; copiar(`Seu acesso ao ${NOME} (${S.dados.viagem.nome}): escolha "${item.nome}" e use a senha ${sn}\n${linkConvite()}`); }
    }
    op({ op: 'salvar', tipo: 'pessoa', item });
    const jc = fd.get('juntaCom');
    if (jc && jc !== responsavel(p.id)) {
      if (responsavel(jc) !== jc && jc !== p.id) { toast(`${nome(jc)} já tem a conta acertada por outra pessoa. Escolha quem paga de fato.`); }
      else {
        const pl = { ...(S.dados.viagem.plano || {}) }, j = { ...(pl.juntas || {}) };
        if (jc === p.id) delete j[p.id]; else j[p.id] = jc;
        // quem esta pessoa cobria passa para o novo responsável
        Object.keys(j).forEach(k => { if (j[k] === p.id && jc !== p.id) j[k] = jc; });
        op({ op: 'viagem', dados: { plano: { ...pl, juntas: j } } });
      }
    }
    if (item.senhaNova) toast('Salvo. Mensagem com a senha copiada: cole no WhatsApp da pessoa.');
    if (novo && !S.eu) { S.eu = item.id; ls.set('rv:eu:' + S.v, item.id); }
  };
}

function formCarro(c) {
  const novo = !c;
  c = c || { id: uid('C'), nome: '', tipo: 'alugado', dono: '', consumo: '', valorKm: '', ocupantes: S.dados.pessoas.map(p => p.id) };
  const f = janela(novo ? 'Adicionar carro' : 'Editar carro', `
    <label class="cp"><span>Nome do carro</span><input type="text" name="nome" required value="${esc(c.nome)}" placeholder="Ex.: Onix alugado, Carro do João"></label>
    <div class="chips" style="margin-bottom:12px">
      <label class="check" style="padding:0 12px 0 0"><input type="radio" name="tipo" value="alugado" ${c.tipo !== 'particular' ? 'checked' : ''}>Alugado</label>
      <label class="check" style="padding:0"><input type="radio" name="tipo" value="particular" ${c.tipo === 'particular' ? 'checked' : ''}>De alguém do grupo</label></div>
    <div id="part">
      <label class="cp"><span>Dono do carro</span><select name="dono">${opcoesPessoas(c.dono, 'Escolha…')}</select></label>
      <label class="cp"><span>Desgaste por km (R$)</span><input type="text" inputmode="decimal" name="valorKm" value="${esc(fmtNum(c.valorKm))}" placeholder="Ex.: 0,30"></label>
      <p class="dica">Opcional: pneu, revisão e depreciação de quem emprestou o carro. Lance em "Desgaste do carro" informando os km.</p>
    </div>
    <label class="cp"><span>Consumo (km/l)</span><input type="text" inputmode="decimal" name="consumo" value="${esc(fmtNum(c.consumo))}" placeholder="Ex.: 12"></label>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600">Quem vai neste carro</span>
    ${S.dados.pessoas.map(p => `<label class="check"><input type="checkbox" name="oc" value="${esc(p.id)}" ${(c.ocupantes || []).includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('')}
    <p class="dica">Aluguel, combustível, pedágio e estacionamento deste carro são divididos só entre essas pessoas.</p>`,
    `${novo ? '' : '<button class="btn perigo" value="del" formnovalidate>Remover</button>'}<button class="btn pri" value="ok">Salvar</button>`);
  const ajusta = () => $('#part', f).classList.toggle('oculto', f.tipo.value !== 'particular');
  $$('input[name=tipo]', f).forEach(r => r.onchange = ajusta); ajusta();
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'del') {
      if ((S.dados.gastos || []).some(g => g.carro === c.id)) { e.preventDefault(); return toast('Este carro tem gastos lançados. Mude-os antes de remover.'); }
      if (!confirm(`Remover ${c.nome}?`)) return e.preventDefault();
      return op({ op: 'excluir', tipo: 'carro', id: c.id });
    }
    if (b !== 'ok') return;
    const fd = new FormData(f);
    const item = { id: c.id, nome: String(fd.get('nome')).trim(), tipo: fd.get('tipo'), dono: fd.get('tipo') === 'particular' ? fd.get('dono') : '', consumo: lerNum(fd.get('consumo')), valorKm: fd.get('tipo') === 'particular' ? lerNum(fd.get('valorKm')) : '', ocupantes: fd.getAll('oc') };
    if (!item.ocupantes.length) { e.preventDefault(); return toast('Marque quem vai no carro.'); }
    op({ op: 'salvar', tipo: 'carro', item });
  };
}

function formAcerto() {
  const f = janela('Pagamento entre amigos', `
    <p class="mut" style="margin-top:0">Use para registrar um Pix ou dinheiro que alguém já passou para outra pessoa.</p>
    <div class="grade2"><label class="cp"><span>Quem pagou</span><select name="de" required>${opcoesPessoas(S.eu, 'Escolha…')}</select></label>
    <label class="cp"><span>Para quem</span><select name="para" required>${opcoesPessoas('', 'Escolha…')}</select></label></div>
    <div class="grade2"><label class="cp"><span>Valor (R$)</span><input type="text" inputmode="decimal" name="valor" required></label>
    <label class="cp"><span>Data</span><input type="date" name="data" value="${hoje()}"></label></div>
    <label class="cp"><span>Observação</span><input type="text" name="obs"></label>`,
    `<button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Registrar</button>`);
  f.onsubmit = e => {
    if (!e.submitter || e.submitter.value !== 'ok') return;
    const fd = new FormData(f), v = lerNum(fd.get('valor'));
    if (!fd.get('de') || !fd.get('para') || fd.get('de') === fd.get('para')) { e.preventDefault(); return toast('Escolha duas pessoas diferentes.'); }
    if (!(v > 0)) { e.preventDefault(); return toast('Informe o valor.'); }
    if (!souOrg() && !legado() && fd.get('de') !== S.eu && fd.get('para') !== S.eu) { e.preventDefault(); return toast('Você só registra pagamento que você fez ou recebeu.'); }
    registrarPix(fd.get('de'), fd.get('para'), v, String(fd.get('obs')).trim());
  };
}

function janelaPix(t) {
  const rec = pessoa(t.para);
  if (!rec || !rec.pix) {
    toast(`${nome(t.para)} ainda não cadastrou a chave Pix (aba Grupo).`);
    return;
  }
  const codigo = C.pix({ chave: rec.pix, nome: rec.nome, cidade: 'BRASIL', valor: t.valor, mensagem: S.dados.viagem.nome });
  let qr = '';
  try { if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(codigo); q.make(); qr = q.createSvgTag({ cellSize: 6, margin: 2, scalable: true }); } } catch (e) {}
  const f = janela('Pagar com Pix', `
    <p style="margin-top:0;text-align:center"><b>${esc(nome(t.de))}</b> paga <b class="num">${brl(t.valor)}</b> para <b>${esc(rec.nome)}</b></p>
    ${qr ? `<div class="qr">${qr}</div><p class="dica" style="text-align:center;margin:0 0 12px">Abra o app do banco e leia o QR Code, ou use o copia e cola.</p>` : ''}
    <div class="copia">${esc(codigo)}</div>
    <p class="dica">Chave: ${esc(rec.pix)}. Confira o nome de quem recebe no app do banco antes de confirmar.</p>`,
    `<button class="btn" value="copiar">Copiar código</button><button class="btn pri" value="pago">Já paguei</button>`);
  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'copiar') { e.preventDefault(); copiar(codigo); }
    if (b === 'pago') registrarPix(t.de, t.para, t.valor / 100, 'Pix');
  };
}

/* ---------- formulário de gasto ---------- */
function formGasto(g) {
  if (!S.dados.pessoas.length) { toast('Cadastre as pessoas primeiro.'); return irAba('grupo'); }
  const novo = !g;
  const carros = S.dados.carros || [];
  g = g ? JSON.parse(JSON.stringify(g)) : { id: uid('G'), data: hoje(), descricao: '', categoria: 'alimentacao', valor: '', moeda: 'BRL', cambio: 1, pagoPor: S.eu || S.dados.pessoas[0].id, modo: '', participantes: [], carro: carros[0] ? carros[0].id : '', marca: '', valores: {}, status: '', retido: '', foto: '', obs: '', criadoPor: S.eu };
  const st = { cat: g.categoria, modo: g.modo || (C.CAT[g.categoria] || {}).modo || 'presentes', modoManual: !!g.modo, foto: g.foto, fotoHash: g.fotoHash || '' };
  const moedas = ['BRL', 'USD', 'EUR', 'ARS', 'CLP', 'UYU', 'PYG', 'GBP'];
  // Organizador mexe em tudo; os outros só no que lançaram (ou pagaram).
  const podeMexer = novo || souOrg() || legado() || g.criadoPor === S.eu || g.pagoPor === S.eu;
  const f = janela(novo ? 'Novo gasto' : podeMexer ? 'Editar gasto' : 'Gasto', `
    ${podeMexer ? '' : `<div class="aviso">Lançado por ${esc(nome(g.criadoPor || g.pagoPor))}. Só quem lançou ou o organizador pode mudar ou apagar. Viu algo errado? Avise o organizador.</div>`}
    <div class="grade2" style="grid-template-columns:2fr 1fr">
      <label class="cp"><span id="rot-valor">Valor</span><input type="text" inputmode="decimal" name="valor" required value="${esc(fmtNum(g.valor))}" placeholder="0,00" style="font-size:1.3rem;font-weight:700"></label>
      <label class="cp"><span>Moeda</span><select name="moeda">${moedas.map(m => `<option ${m === (g.moeda || 'BRL') ? 'selected' : ''}>${m}</option>`).join('')}</select></label>
    </div>
    <label class="cp"><span>Descrição</span><input type="text" name="descricao" value="${esc(g.descricao)}" placeholder="Ex.: Jantar no restaurante" autocomplete="off"></label>
    <div class="cats" id="cats">${C.CATEGORIAS.map(c => `<button type="button" data-cat="${c.id}" aria-pressed="${c.id === st.cat}"><b>${c.icone}</b>${c.nome}</button>`).join('')}</div>
    <div id="bx-cambio" class="oculto">
      <div class="grade2"><label class="cp"><span>Cotação (R$ por 1)</span><input type="text" inputmode="decimal" name="cambio" value="${esc(fmtNum(g.cambio))}"></label>
      <div style="padding-top:22px"><button type="button" class="btn lg" id="buscar-cot">Cotação de hoje</button></div></div>
      <label class="check"><input type="checkbox" name="iof">Pago no cartão (soma IOF de 3,5%)</label>
    </div>
    <div id="bx-desgaste" class="oculto"><label class="cp"><span>Km rodados</span><input type="text" inputmode="decimal" name="km" placeholder="Ex.: 420"></label><p class="dica" id="dica-desg"></p></div>
    <div id="bx-caucao" class="oculto"><label class="cp"><span>Quanto ficou retido (não foi devolvido)</span><input type="text" inputmode="decimal" name="retido" value="${esc(fmtNum(g.retido))}" placeholder="0,00"></label>
      <p class="dica">A caução não entra na conta enquanto estiver para ser devolvida. Só o que ficar retido (multa, avaria) é dividido.</p></div>
    <div class="grade2">
      <label class="cp"><span>Data</span><input type="date" name="data" value="${esc(g.data)}"></label>
      <label class="cp"><span>Quem pagou</span><select name="pagoPor">${opcoesPessoas(g.pagoPor)}</select></label>
    </div>
    <label class="cp"><span>Como dividir</span><select name="modo">${Object.entries(C.MODOS).map(([k, r]) => `<option value="${k}" ${k === st.modo ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <div id="bx-carro" class="oculto"><label class="cp"><span>Qual carro</span><select name="carro">${carros.length ? carros.map(c => `<option value="${esc(c.id)}" ${c.id === g.carro ? 'selected' : ''}>${esc(c.nome)}</option>`).join('') : '<option value="">Nenhum carro cadastrado (divide entre todos)</option>'}</select></label></div>
    <div id="bx-escolher" class="oculto">${S.dados.pessoas.map(p => `<label class="check"><input type="checkbox" name="part" value="${esc(p.id)}" ${(g.participantes || []).includes(p.id) ? 'checked' : ''}>${esc(p.nome)}</label>`).join('')}</div>
    <div id="bx-valores" class="oculto">${S.dados.pessoas.map(p => `<label class="cp" style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="flex:1;margin:0">${esc(p.nome)}</span><input type="text" inputmode="decimal" name="val-${esc(p.id)}" value="${esc(fmtNum((g.valores || {})[p.id]))}" style="max-width:130px" placeholder="0,00"></label>`).join('')}<p class="dica" id="dica-val"></p></div>
    <label class="cp"><span>Tem algo que nem todos consomem?</span><select name="marca"><option value="">Não, todos consomem</option>${Object.entries(C.RESTRICOES).map(([k, r]) => `<option value="${k}" ${g.marca === k ? 'selected' : ''}>Sim: quem tem "${r.split(' ').slice(1).join(' ').toLowerCase()}" não paga</option>`).join('')}</select></label>
    <label class="check"><input type="checkbox" name="pendente" ${g.status === 'pendente' ? 'checked' : ''}>Valor ainda não confirmado (ex.: tag de pedágio, fatura não chegou)</label>
    <div class="previa" id="previa"></div>
    <label class="cp"><span>Foto do cupom (opcional)</span><input type="file" accept="image/*" capture="environment" name="arq"></label>
    <div id="foto-atual">${st.foto ? `<a href="${esc(st.foto)}" target="_blank" rel="noopener">📎 Ver foto anexada</a>` : ''}</div>
    <label class="cp" style="margin-top:10px"><span>Observação</span><input type="text" name="obs" value="${esc(g.obs)}"></label>`,
    podeMexer ? `${novo ? '' : '<button class="btn perigo" value="del" formnovalidate>Excluir</button>'}<button class="btn pri" value="ok">Salvar</button>` : '');
  if (!podeMexer) $$('.dlg-corpo input, .dlg-corpo select, .dlg-corpo button', f).forEach(el => { el.disabled = true; });

  const mostra = (id, sim) => $('#' + id, f).classList.toggle('oculto', !sim);
  function montar() {
    const fd = new FormData(f);
    const moeda = fd.get('moeda');
    let cambio = moeda === 'BRL' ? 1 : (lerNum(fd.get('cambio')) || 0);
    if (moeda !== 'BRL' && f.iof.checked) cambio = Math.round(cambio * 1.035 * 10000) / 10000;
    const valor = lerNum(fd.get('valor'));
    const valores = {};
    S.dados.pessoas.forEach(p => { const x = lerNum(fd.get('val-' + p.id)); if (x !== '' && x > 0) valores[p.id] = x; });
    return {
      ...g, categoria: st.cat, descricao: String(fd.get('descricao')).trim(), valor, moeda, cambio,
      valorBRL: valor === '' ? '' : Math.round(valor * cambio * 100) / 100,
      data: fd.get('data'), pagoPor: fd.get('pagoPor'), modo: st.modo, carro: st.modo === 'carro' ? fd.get('carro') : '',
      participantes: st.modo === 'escolher' ? fd.getAll('part') : [], valores: st.modo === 'valores' ? valores : {},
      marca: fd.get('marca'), status: fd.get('pendente') ? 'pendente' : '', retido: st.cat === 'caucao' ? lerNum(fd.get('retido')) : '',
      foto: st.foto || '', fotoHash: st.fotoHash || '', obs: String(fd.get('obs')).trim()
    };
  }
  function atualizarForm() {
    const moeda = f.moeda.value;
    mostra('bx-cambio', moeda !== 'BRL');
    mostra('bx-caucao', st.cat === 'caucao');
    const carro = carros.find(c => c.id === f.carro.value);
    mostra('bx-desgaste', st.cat === 'desgaste' && carro && Number(carro.valorKm) > 0);
    if (st.cat === 'desgaste' && carro && Number(carro.valorKm) > 0) $('#dica-desg', f).textContent = `${brl(C.centavos(carro.valorKm))} por km · quem recebe é ${nome(carro.dono)}.`;
    $('#rot-valor', f).textContent = st.cat === 'caucao' ? 'Valor da caução' : 'Valor';
    mostra('bx-carro', st.modo === 'carro');
    mostra('bx-escolher', st.modo === 'escolher');
    mostra('bx-valores', st.modo === 'valores');
    const x = montar();
    const partes = C.dividir(x, S.dados);
    const total = C.valorDoGasto(x);
    if (st.modo === 'valores') {
      const soma = Object.values(x.valores).reduce((s, v) => s + C.centavos(v), 0);
      $('#dica-val', f).textContent = soma === total ? 'Os valores fecham com o total. ✓' : `Os valores somam ${brl(soma)} e o total é ${brl(total)}: a diferença será repartida na proporção.`;
    }
    const ks = Object.keys(partes);
    $('#previa', f).innerHTML = st.cat === 'caucao' && !total ? 'Caução registrada. Não entra na divisão enquanto nada ficar retido.' :
      !total ? 'Digite o valor para ver como fica a divisão.' :
      `<b>Como fica (${brl(total)}):</b> ` + ks.map(k => `${esc(primeiroNome(k))} <b class="num">${brl(partes[k])}</b>`).join(' · ') +
      (S.dados.pessoas.length - ks.length > 0 ? `<br><span class="mut">Fora da divisão: ${S.dados.pessoas.filter(p => !ks.includes(p.id)).map(p => esc(p.nome.split(' ')[0])).join(', ')}</span>` : '');
  }
  $$('#cats button', f).forEach(b => b.onclick = () => {
    st.cat = b.dataset.cat;
    $$('#cats button', f).forEach(x => x.setAttribute('aria-pressed', x === b));
    const cat = C.CAT[st.cat];
    if (!st.modoManual) { st.modo = cat.modo; f.modo.value = st.modo; }
    if (cat.marca && !f.marca.value) f.marca.value = cat.marca;
    if (st.cat === 'desgaste') { const c = carros.find(c => c.id === f.carro.value && c.dono) || carros.find(c => c.dono); if (c) { f.carro.value = c.id; f.pagoPor.value = c.dono; } }
    atualizarForm();
  });
  f.modo.onchange = () => { st.modo = f.modo.value; st.modoManual = true; atualizarForm(); };
  f.km.oninput = () => { const c = carros.find(c => c.id === f.carro.value); const km = lerNum(f.km.value); if (c && km) { f.valor.value = fmtNum(Math.round(km * Number(c.valorKm) * 100) / 100); if (!f.descricao.value) f.descricao.value = `Desgaste ${c.nome} (${fmtNum(km)} km)`; f.pagoPor.value = c.dono; } atualizarForm(); };
  f.addEventListener('input', e => { if (e.target.name !== 'km') atualizarForm(); });
  f.addEventListener('change', atualizarForm);
  $('#buscar-cot', f).onclick = async () => {
    const m = f.moeda.value, b = $('#buscar-cot', f);
    b.textContent = 'Buscando…';
    try {
      const r = await fetch(`https://economia.awesomeapi.com.br/json/last/${m}-BRL`);
      const j = await r.json(); const q = j[m + 'BRL'];
      f.cambio.value = fmtNum(Math.round(Number(q.bid) * 10000) / 10000);
      atualizarForm(); b.textContent = 'Cotação de hoje ✓';
    } catch (e) { b.textContent = 'Cotação de hoje'; toast('Não consegui buscar a cotação. Digite manualmente.'); }
  };
  f.arq.onchange = async () => {
    const arq = f.arq.files[0]; if (!arq) return;
    $('#foto-atual', f).textContent = 'Enviando foto…';
    try {
      $('#foto-atual', f).textContent = 'Lendo o cupom…';
      const hash = await idCupom(arq);
      const igual = (S.dados.gastos || []).find(x => x.id !== g.id && x.fotoHash && x.fotoHash === hash);
      const quem = igual && `"${igual.descricao}" (${brl(C.valorDoGasto(igual))}, lançado por ${nome(igual.criadoPor || igual.pagoPor)} em ${fmtData(igual.data)})`;
      if (igual && !confirm(hash.startsWith('nfce:')
        ? `Esse cupom fiscal JÁ FOI LANÇADO em ${quem}.\n\nO QR Code é o mesmo, então é o mesmo cupom. Anexar assim mesmo?`
        : `Essa mesma foto já foi anexada em ${quem}.\n\nAnexar assim mesmo?`)) {
        f.arq.value = ''; $('#foto-atual', f).textContent = 'Foto não anexada (cupom repetido).'; return;
      }
      $('#foto-atual', f).textContent = hash.startsWith('nfce:') ? 'Cupom fiscal reconhecido ✓ Enviando foto…' : 'Enviando foto…';
      const { base64 } = await reduzirFoto(arq, DEMO ? 700 : 1400);
      const j = await req('foto', { nome: g.id, mime: 'image/jpeg', base64 });
      st.foto = j.url; st.fotoHash = hash;
      const linkFoto = `<a href="${esc(st.foto)}" target="_blank" rel="noopener">📎 Foto anexada ✓</a>`;
      $('#foto-atual', f).innerHTML = linkFoto + (j.arquivo ? '<br><span class="mut">📖 Lendo o valor do cupom…</span>' : '');
      if (j.arquivo) lerValorDoCupom(j.arquivo, f, linkFoto, atualizarForm);
    } catch (e) { $('#foto-atual', f).textContent = 'Não consegui enviar a foto (precisa de internet). O gasto pode ser salvo sem ela.'; }
  };
  atualizarForm();
  if (novo) setTimeout(() => f.valor.focus(), 50);

  f.onsubmit = e => {
    const b = e.submitter && e.submitter.value;
    if (b === 'del') { if (!confirm('Excluir este gasto?')) return e.preventDefault(); return op({ op: 'excluir', tipo: 'gasto', id: g.id }); }
    if (b !== 'ok') return;
    const x = montar();
    if (!(x.valor > 0)) { e.preventDefault(); return toast('Informe o valor.'); }
    if (x.moeda !== 'BRL' && !(x.cambio > 0)) { e.preventDefault(); return toast('Informe a cotação da moeda.'); }
    if (x.modo === 'escolher' && !x.participantes.length) { e.preventDefault(); return toast('Marque quem participa.'); }
    if (x.categoria === 'caucao' && x.retido > x.valor) { e.preventDefault(); return toast('O valor retido é maior que a caução.'); }
    if (!x.descricao) x.descricao = C.CAT[x.categoria].nome;
    // Possível duplicidade: mesmo valor, mesma data ou dia vizinho.
    const umDia = (a, b) => a && b && Math.abs(new Date(a + 'T12:00') - new Date(b + 'T12:00')) <= 86400000;
    const dup = (S.dados.gastos || []).find(o => o.id !== x.id && !ehRoteiro(o) && C.valorDoGasto(o) === C.valorDoGasto(x) && umDia(o.data, x.data));
    if (dup && !confirm(`Parece repetido: "${dup.descricao}" de ${brl(C.valorDoGasto(dup))}, lançado por ${nome(dup.criadoPor || dup.pagoPor)} em ${fmtData(dup.data)}.\n\nSalvar mesmo assim?`)) { e.preventDefault(); return; }
    op({ op: 'salvar', tipo: 'gasto', item: x });
    if (novo) toast('Gasto lançado ✓');
  };
}

/* Leitura do cupom (OCR do Google Drive, feito pela planilha): preenche o que estiver vazio e
   mostra o que foi lido; se o campo já tinha valor, oferece um botão para usar o valor lido. */
async function lerValorDoCupom(arquivo, f, linkFoto, depois) {
  const caixa = $('#foto-atual', f);
  try {
    const { cupom: c } = await req('lerCupom', { arquivo });
    if (!f.isConnected) return; // janela já fechada
    const partes = [c.loja && `<b>${esc(c.loja)}</b>`, c.total != null && `<b class="num">${brl(Math.round(c.total * 100))}</b>`, c.data && fmtData(c.data)].filter(Boolean);
    if (!partes.length) { caixa.innerHTML = linkFoto + '<br><span class="mut">Não consegui ler o valor desse cupom (foto escura, tremida ou amassada?). Digite o valor.</span>'; return; }
    const preenchido = [];
    if (c.total != null && !lerNum(f.valor.value)) { f.valor.value = fmtNum(c.total); preenchido.push('valor'); }
    if (c.loja && !f.descricao.value.trim()) { f.descricao.value = c.loja.replace(/\s+/g, ' ').toLowerCase().replace(/(^|\s)\S/g, s => s.toUpperCase()); preenchido.push('descrição'); }
    if (c.data && f.data.value === hoje() && c.data !== hoje() && c.data <= hoje()) { f.data.value = c.data; preenchido.push('data'); }
    caixa.innerHTML = linkFoto + `<div class="previa" style="margin:8px 0 0">📖 Li no cupom: ${partes.join(' · ')}<br>` +
      (preenchido.length ? `<span class="pos">Preenchi: ${preenchido.join(', ')}. Confira antes de salvar.</span>` : '') +
      (c.total != null && !preenchido.includes('valor') && lerNum(f.valor.value) !== c.total ? ` <button type="button" class="btn mini" id="usar-total">Usar ${brl(Math.round(c.total * 100))}</button>` : '') + '</div>';
    const b = $('#usar-total', f); if (b) b.onclick = () => { f.valor.value = fmtNum(c.total); depois(); b.remove(); };
    depois();
  } catch (e) {
    if (f.isConnected) caixa.innerHTML = linkFoto + '<br><span class="mut">' + esc(e.servidor ? e.message : 'Sem internet para ler o cupom.') + '</span>';
  }
}

// Reduz a foto no próprio celular antes de enviar (economiza internet e espaço no Drive).
function reduzirFoto(arq, max) {
  return new Promise((ok, erro) => {
    const img = new Image(), url = URL.createObjectURL(arq);
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(url);
      ok({ base64: cv.toDataURL('image/jpeg', 0.72).split(',')[1] });
    };
    img.onerror = erro; img.src = url;
  });
}

/* Identidade do cupom, para achar repetido:
   1) cupom fiscal eletrônico (NFC-e): o QR Code traz a chave de 44 números, única de cada cupom → "nfce:<chave>";
   2) sem QR legível: impressão do arquivo (SHA-256), que pega a mesma foto enviada duas vezes → "sha:<hex>". */
async function idCupom(arq) {
  try { const chave = await lerChaveNfce(arq); if (chave) return 'nfce:' + chave; } catch (e) {}
  const buf = await arq.arrayBuffer();
  const h = await crypto.subtle.digest('SHA-256', buf);
  return 'sha:' + [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}
function chaveDoTexto(t) { const m = String(t || '').replace(/\s/g, '').match(/(?:^|\D)(\d{44})(?:\D|$)/); return m ? m[1] : ''; }
let _jsQR = null;
function carregarJsQR() {
  if (window.jsQR) return Promise.resolve(window.jsQR);
  if (_jsQR) return _jsQR;
  _jsQR = new Promise((ok, erro) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.min.js';
    s.onload = () => ok(window.jsQR); s.onerror = erro; document.head.appendChild(s);
  });
  return _jsQR;
}
async function lerChaveNfce(arq) {
  const bmp = await createImageBitmap(arq);
  // Android/Chrome lê QR sozinho
  if ('BarcodeDetector' in window) {
    try { const cod = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bmp); for (const c of cod) { const k = chaveDoTexto(c.rawValue); if (k) return k; } } catch (e) {}
  }
  // Demais (iPhone): biblioteca jsQR, tentando em dois tamanhos
  const jsQR = await carregarJsQR();
  for (const lado of [1600, 1000]) {
    const k = Math.min(1, lado / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
    const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
    const r = jsQR(cx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'dontInvert' });
    const chave = r && chaveDoTexto(r.data);
    if (chave) return chave;
  }
  return '';
}

/* ---------- eventos gerais ---------- */
$$('#abas button').forEach(b => b.onclick = () => irAba(b.dataset.aba));
$('#fab').onclick = () => formGasto();
$('#btn-voltar').onclick = sair;
$('#btn-sync').onclick = () => atualizar(false);
$('#btn-conta').onclick = menuConta;
window.addEventListener('online', () => { if (S) { S.erro = ''; enviar(); } });
window.addEventListener('hashchange', () => { const h = lerHash(); if (h && (!S || h.v !== S.v)) abrir(h.v, h.c); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S && S.dados) atualizar(true); });
setInterval(() => { if (document.visibilityState === 'visible' && S && S.dados && !S.enviando) atualizar(true); }, 60000);

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

(function iniciar() {
  const h = lerHash();
  if (h) return abrir(h.v, h.c);
  render();
})();
