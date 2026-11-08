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
  const n = Number(s);
  return isNaN(n) ? '' : n;
}
const fmtNum = n => (n === '' || n == null || isNaN(Number(n))) ? '' : String(Number(n)).replace('.', ',');
const fmtData = s => { if (!s) return ''; const [a, m, d] = s.split('-'); return `${d}/${m}${a !== String(new Date().getFullYear()) ? '/' + a.slice(2) : ''}`; };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const fmtDia = s => { const d = new Date(s + 'T12:00'); return `${DIAS[d.getDay()]}, ${fmtData(s)}`; };

const ls = {
  get(k, pad) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : pad; } catch (e) { return pad; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} }
};

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('on'), 2600);
}

/* ---------- comunicação com a planilha (ou modo demonstração) ---------- */
async function chamar(p) {
  if (DEMO) return demo(JSON.parse(JSON.stringify(p)));
  const r = await fetch(CFG.API_URL, { method: 'POST', body: JSON.stringify(p) });
  const j = await r.json();
  if (!j.ok) { const e = new Error(j.erro || 'Erro'); e.servidor = true; throw e; }
  return j;
}

function aplicar(d, o) {
  if (o.op === 'viagem') { Object.assign(d.viagem, o.dados); return d; }
  const k = o.tipo + 's';
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
    const v = 'V' + rnd(8), c = rnd(6);
    db.viagens[v] = { c, dados: { viagem: { id: v, nome: p.nome, inicio: p.inicio || '', fim: p.fim || '', plano: {} }, pessoas: p.pessoas || [], carros: [], gastos: [], acertos: [] } };
    ls.set('rv:demo', db);
    return { ok: true, v, c, dados: db.viagens[v].dados };
  }
  const t = db.viagens[p.v];
  if (!t) falha('Viagem não encontrada');
  if (t.c !== String(p.c || '').toUpperCase()) falha('Código da viagem incorreto');
  if (p.acao === 'ops') { (p.ops || []).forEach(o => aplicar(t.dados, o)); ls.set('rv:demo', db); }
  if (p.acao === 'foto') return { ok: true, url: 'data:' + (p.mime || 'image/jpeg') + ';base64,' + p.base64 };
  return { ok: true, dados: t.dados };
}

/* ---------- estado ---------- */
let S = null; // { v, c, dados, fila, eu, enviando, erro }
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
function nome(id) { const p = pessoa(id); return p ? p.nome : '(removido)'; }
function primeiroNome(id) { return nome(id).split(' ')[0]; }

function op(o) {
  aplicar(S.dados, o);
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
    const j = await chamar({ acao: 'ops', v: alvo.v, c: alvo.c, ops: lote });
    alvo.fila = alvo.fila.slice(lote.length);
    alvo.dados = j.dados;
    alvo.fila.forEach(o => aplicar(alvo.dados, o));
    alvo.erro = '';
  } catch (e) {
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
    const j = await chamar({ acao: 'carregar', v: alvo.v, c: alvo.c });
    alvo.dados = j.dados; alvo.erro = '';
    if (S === alvo) { guardar(); render(); }
  } catch (e) {
    alvo.erro = e.servidor ? e.message : 'sem internet';
    if (!silencioso) toast(e.servidor ? e.message : 'Sem internet: mostrando o que já estava salvo.');
  } finally { alvo.enviando = false; status(); }
}

function status() {
  const el = $('#status');
  if (!S) { el.classList.add('oculto'); return; }
  el.classList.remove('oculto');
  const n = S.fila.length;
  el.textContent = S.enviando ? 'sincronizando…' : n ? `${n} para enviar` : S.erro ? 'offline' : DEMO ? 'demonstração' : 'salvo ✓';
}

/* ---------- abrir / sair de viagem ---------- */
function abrir(v, c) {
  S = { v, c: String(c).toUpperCase(), dados: ls.get('rv:dados:' + v, null), fila: ls.get('rv:fila:' + v, []), eu: ls.get('rv:eu:' + v, ''), enviando: false, erro: '' };
  history.replaceState(null, '', '#v=' + v + '&c=' + S.c);
  if (!S.dados) {
    $('#tela').innerHTML = '<div class="vazio"><b>⏳</b>Abrindo a viagem…</div>';
    chamar({ acao: 'carregar', v, c: S.c }).then(j => {
      S.dados = j.dados; guardar(); render();
      if (!S.eu) quemSouEu();
    }).catch(e => {
      toast(e.servidor ? e.message : 'Sem internet para abrir esta viagem pela primeira vez.');
      S = null; history.replaceState(null, '', location.pathname); render();
    });
    return;
  }
  render();
  if (S.fila.length) enviar(); else atualizar(true);
  if (!S.eu) quemSouEu();
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
  const emViagem = !!(S && S.dados);
  $('#abas').classList.toggle('oculto', !emViagem);
  $('#fab').classList.toggle('oculto', !emViagem || !['gastos', 'resumo'].includes(ABA));
  $('#btn-voltar').classList.toggle('oculto', !emViagem);
  $('#btn-sync').classList.toggle('oculto', !emViagem);
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
  ({ gastos: telaGastos, saldos: telaSaldos, plano: telaPlano, resumo: telaResumo, grupo: telaGrupo })[ABA]();
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

function totalGeral() { return (S.dados.gastos || []).reduce((s, g) => s + C.valorDoGasto(g), 0); }
function gastosOrdenados() {
  return (S.dados.gastos || []).slice().sort((a, b) => (b.data || '').localeCompare(a.data || '') || String(b.id).localeCompare(String(a.id)));
}

let FILTRO = '';
function telaGastos() {
  const gs = gastosOrdenados().filter(g => !FILTRO || g.categoria === FILTRO);
  const sal = C.saldos(S.dados);
  const meu = S.eu in sal.saldo ? sal.saldo[S.eu] : null;
  const usadas = [...new Set((S.dados.gastos || []).map(g => g.categoria))];
  let html = `<div class="placar">
    <div class="cartao"><small>Total da viagem</small><strong class="num">${brl(totalGeral())}</strong></div>
    <div class="cartao"><small>${!meu ? 'Seu saldo' : meu > 0 ? 'Você tem a receber' : 'Você deve'}</small><strong class="num ${meu > 0 ? 'pos' : meu < 0 ? 'neg' : ''}">${meu === null ? '—' : brl(Math.abs(meu))}</strong></div>
  </div>`;
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
  $$('#tela li[data-g]').forEach(li => li.onclick = () => formGasto(S.dados.gastos.find(g => g.id === li.dataset.g)));
  const ig = $('#ir-grupo'); if (ig) ig.onclick = () => irAba('grupo');
}

function telaSaldos() {
  const sal = C.saldos(S.dados);
  const tr = C.transferencias(sal.saldo);
  const pend = (S.dados.gastos || []).filter(g => g.status === 'pendente');
  let html = '';
  if (pend.length) html += `<div class="aviso">⏳ ${pend.length} ${pend.length === 1 ? 'gasto ainda está' : 'gastos ainda estão'} como pendente (${pend.map(g => esc(g.descricao || C.CAT[g.categoria]?.nome)).join(', ')}). O acerto já considera o valor estimado; corrija quando a fatura chegar.</div>`;
  html += `<div class="titulo-sec">Para zerar tudo</div><div class="cartao">`;
  if (!tr.length) html += `<div class="vazio" style="padding:10px"><b>🎉</b>Tudo certo, ninguém deve nada.</div>`;
  else html += `<p class="mut peq" style="margin:0 0 6px">${tr.length} ${tr.length === 1 ? 'transferência resolve' : 'transferências resolvem'} a viagem inteira.</p>` + tr.map((t, i) => {
    const rec = pessoa(t.para);
    return `<div class="transf"><div class="quem"><b>${esc(nome(t.de))}</b><span class="seta">→</span><b>${esc(nome(t.para))}</b><div class="num" style="font-size:1.15rem;font-weight:700">${brl(t.valor)}</div></div>
      <div class="btns">${rec && rec.pix ? `<button class="btn mini pri" data-pix="${i}">Pagar com Pix</button>` : `<button class="btn mini sua" data-semchave="${esc(t.para)}">+ Chave Pix de ${esc(primeiroNome(t.para))}</button>`}<button class="btn mini" data-pago="${i}">Já paguei</button></div></div>`;
  }).join('');
  html += `</div><div class="titulo-sec">Situação de cada um</div><div class="cartao" style="padding:4px 16px"><ul class="lista">`;
  S.dados.pessoas.forEach(p => {
    const s = sal.saldo[p.id] || 0;
    html += `<li><span class="ico">${s > 0 ? '💰' : s < 0 ? '💸' : '✅'}</span><span class="meio"><b>${esc(p.nome)}${p.id === S.eu ? ' (você)' : ''}</b><small>pagou ${brl(sal.pago[p.id] || 0)} · consumiu ${brl(sal.consumo[p.id] || 0)}</small></span>
      <span class="num ${s > 0 ? 'pos' : s < 0 ? 'neg' : 'mut'}"><b>${s > 0 ? '+' : s < 0 ? '−' : ''}${brl(Math.abs(s))}</b></span></li>`;
  });
  html += `</ul></div>`;
  const ac = (S.dados.acertos || []).slice().sort((a, b) => String(b.id).localeCompare(String(a.id)));
  if (ac.length) {
    html += `<div class="titulo-sec">Pagamentos já feitos</div><div class="cartao" style="padding:4px 16px"><ul class="lista">${ac.map(a => `
      <li><span class="ico">✔️</span><span class="meio"><b>${esc(nome(a.de))} → ${esc(nome(a.para))}</b><small>${fmtData(a.data)}${a.obs ? ' · ' + esc(a.obs) : ''}</small></span><span class="num">${brl(C.centavos(a.valor))}</span>
      <button class="ic-btn" data-desfaz="${esc(a.id)}" aria-label="Desfazer" title="Desfazer">✕</button></li>`).join('')}</ul></div>`;
  }
  html += `<button class="btn lg" id="acerto-manual">Registrar outro pagamento entre amigos</button>`;
  $('#tela').innerHTML = html;
  $$('[data-pix]').forEach(b => b.onclick = () => janelaPix(tr[b.dataset.pix]));
  $$('[data-semchave]').forEach(b => b.onclick = () => formPessoa(pessoa(b.dataset.semchave)));
  $$('[data-pago]').forEach(b => b.onclick = () => {
    const t = tr[b.dataset.pago];
    if (confirm(`Confirmar que ${nome(t.de)} já pagou ${brl(t.valor)} para ${nome(t.para)}?`))
      op({ op: 'salvar', tipo: 'acerto', item: { id: uid('A'), data: hoje(), de: t.de, para: t.para, valor: t.valor / 100, obs: '' } });
  });
  $$('[data-desfaz]').forEach(b => b.onclick = () => { if (confirm('Desfazer este pagamento?')) op({ op: 'excluir', tipo: 'acerto', id: b.dataset.desfaz }); });
  $('#acerto-manual').onclick = () => formAcerto();
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
  (S.dados.gastos || []).forEach(g => { const k = ['mercado', 'bebidas'].includes(g.categoria) ? 'alimentacao' : ['estacionamento', 'desgaste', 'caucao'].includes(g.categoria) ? 'outros' : g.categoria; real[k] = (real[k] || 0) + C.valorDoGasto(g); });
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
  $('#tela').innerHTML = html;
  $$('[data-pl]').forEach(inp => inp.onchange = () => {
    const novo = { ...(S.dados.viagem.plano || {}) };
    novo[inp.dataset.pl] = lerNum(inp.value);
    op({ op: 'viagem', dados: { plano: novo } });
  });
}

function telaResumo() {
  const gs = S.dados.gastos || [];
  const total = totalGeral();
  if (!gs.length) { $('#tela').innerHTML = `<div class="cartao vazio"><b>📊</b>O resumo aparece quando houver gastos.</div>`; return; }
  const sal = C.saldos(S.dados);
  const porCat = {}, porDia = {};
  gs.forEach(g => { const v = C.valorDoGasto(g); porCat[g.categoria] = (porCat[g.categoria] || 0) + v; if (g.data) porDia[g.data] = (porDia[g.data] || 0) + v; });
  const cats = Object.entries(porCat).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
  if (!total) { $('#tela').innerHTML = `<div class="cartao vazio"><b>📊</b>O resumo aparece quando houver gastos com valor.</div>`; return; }
  const diaTop = Object.entries(porDia).sort((a, b) => b[1] - a[1])[0];
  const maior = gs.slice().sort((a, b) => C.valorDoGasto(b) - C.valorDoGasto(a))[0];
  const pagou = S.dados.pessoas.slice().sort((a, b) => (sal.pago[b.id] || 0) - (sal.pago[a.id] || 0));
  const n = S.dados.pessoas.length || 1;
  const maxP = Math.max(1, ...pagou.map(p => sal.pago[p.id] || 0));
  const html = `
  <div class="cartao destaque" style="text-align:center">
    <div class="peq" style="opacity:.9">${esc(S.dados.viagem.nome)}</div>
    <div style="font-size:2.1rem;font-weight:800" class="num">${brl(total)}</div>
    <div class="peq" style="opacity:.9">${gs.length} gastos · ${S.dados.pessoas.length} pessoas · ${brl(Math.round(total / n))} por pessoa</div>
  </div>
  <div class="placar">
    <div class="cartao"><small>Dia mais caro</small><strong style="font-size:1rem">${diaTop ? fmtDia(diaTop[0]) : '—'}</strong><div class="num mut peq">${diaTop ? brl(diaTop[1]) : ''}</div></div>
    <div class="cartao"><small>Maior gasto</small><strong style="font-size:1rem">${esc(maior.descricao || C.CAT[maior.categoria]?.nome)}</strong><div class="num mut peq">${brl(C.valorDoGasto(maior))}</div></div>
  </div>
  <div class="cartao"><h2>Para onde foi o dinheiro</h2>${cats.map(([c, v]) => { const k = C.CAT[c] || C.CAT.outros; return `<div class="linha-bar"><div class="t"><span>${k.icone} ${k.nome}</span><span class="num">${brl(v)} <span class="mut">${Math.round(v / total * 100)}%</span></span></div><div class="barra"><i style="width:${v / cats[0][1] * 100}%"></i></div></div>`; }).join('')}</div>
  <div class="cartao"><h2>Quem passou o cartão</h2>${pagou.map((p, i) => `<div class="linha-bar"><div class="t"><span>${i === 0 ? '🏆 ' : ''}${esc(p.nome)}</span><span class="num">${brl(sal.pago[p.id] || 0)}</span></div><div class="barra"><i style="width:${(sal.pago[p.id] || 0) / maxP * 100}%"></i></div></div>`).join('')}</div>
  <button class="btn pri lg" id="compartilhar-resumo">Compartilhar resumo no grupo</button>`;
  $('#tela').innerHTML = html;
  $('#compartilhar-resumo').onclick = () => {
    const tr = C.transferencias(sal.saldo);
    const txt = `🧳 ${S.dados.viagem.nome}\nTotal: ${brl(total)} (${brl(Math.round(total / n))} por pessoa)\n\n` +
      cats.map(([c, v]) => `${(C.CAT[c] || C.CAT.outros).icone} ${(C.CAT[c] || C.CAT.outros).nome}: ${brl(v)}`).join('\n') +
      (tr.length ? `\n\n💸 Acerto:\n` + tr.map(t => `${nome(t.de)} → ${nome(t.para)}: ${brl(t.valor)}`).join('\n') : '\n\n🎉 Tudo acertado!');
    compartilhar(txt);
  };
}

function telaGrupo() {
  const v = S.dados.viagem;
  const link = linkConvite();
  let html = `<div class="cartao"><h2>Convidar amigos</h2>
    <p class="mut peq" style="margin-top:-4px">Quem abrir o link entra na viagem e já pode lançar gastos.${DEMO ? ' <b>No modo demonstração o link só funciona neste aparelho.</b>' : ''}</p>
    <div class="copia">${esc(link)}</div>
    <div class="btns"><button class="btn pri" id="conv-comp">Enviar convite</button><button class="btn" id="conv-copia">Copiar link</button></div></div>
  <div class="titulo-sec">Pessoas (${S.dados.pessoas.length})</div>
  <div class="cartao" style="padding:4px 16px"><ul class="lista">${S.dados.pessoas.map(p => {
    const extra = [p.chegada || p.saida ? `${p.chegada ? 'chega ' + fmtData(p.chegada) : ''}${p.chegada && p.saida ? ', ' : ''}${p.saida ? 'sai ' + fmtData(p.saida) : ''}` : '', Number(p.peso) && Number(p.peso) !== 1 ? `conta como ${fmtNum(p.peso)}` : '', ...(p.restricoes || []).map(r => (C.RESTRICOES[r] || r).split(' ').slice(1).join(' ').toLowerCase()), p.pix ? 'Pix ✓' : 'sem Pix'].filter(Boolean).join(' · ');
    return `<li class="clica" data-p="${esc(p.id)}"><span class="ico">${p.id === S.eu ? '🙋' : '👤'}</span><span class="meio"><b>${esc(p.nome)}${p.id === S.eu ? ' (você)' : ''}</b><small>${esc(extra)}</small></span><span class="mut">›</span></li>`;
  }).join('')}</ul><button class="btn lg sua" id="add-p" style="margin:6px 0 12px">+ Adicionar pessoa</button></div>
  <div class="titulo-sec">Carros (${(S.dados.carros || []).length})</div>
  <div class="cartao" style="padding:4px 16px">
    ${(S.dados.carros || []).length ? '' : '<p class="mut peq">Cadastre os carros para dividir aluguel, combustível e pedágio só entre quem foi em cada um.</p>'}
    <ul class="lista">${(S.dados.carros || []).map(c => `<li class="clica" data-c="${esc(c.id)}"><span class="ico">${c.tipo === 'alugado' ? '🚙' : '🚗'}</span><span class="meio"><b>${esc(c.nome)}</b><small>${c.tipo === 'alugado' ? 'alugado' : 'de ' + esc(primeiroNome(c.dono))} · ${(c.ocupantes || []).length} no carro${c.consumo ? ' · ' + fmtNum(c.consumo) + ' km/l' : ''}</small></span><span class="mut">›</span></li>`).join('')}</ul>
    <button class="btn lg sua" id="add-c" style="margin:6px 0 12px">+ Adicionar carro</button></div>
  <div class="titulo-sec">Viagem</div>
  <div class="cartao">
    <label class="cp"><span>Nome</span><input type="text" id="v-nome" value="${esc(v.nome)}"></label>
    <div class="grade2"><label class="cp"><span>Início</span><input type="date" id="v-ini" value="${esc(v.inicio)}"></label><label class="cp"><span>Fim</span><input type="date" id="v-fim" value="${esc(v.fim)}"></label></div>
    <p class="dica">As datas da viagem valem para quem não tem chegada/saída própria.</p>
    <div class="btns"><button class="btn" id="eu">Trocar quem sou eu</button><button class="btn perigo" id="esquecer">Tirar viagem deste aparelho</button></div>
  </div>`;
  $('#tela').innerHTML = html;
  $('#conv-comp').onclick = () => compartilhar(`Entra na viagem "${v.nome}" no ${NOME} para a gente dividir os gastos: ${link}`, link);
  $('#conv-copia').onclick = () => copiar(link);
  $$('[data-p]').forEach(li => li.onclick = () => formPessoa(pessoa(li.dataset.p)));
  $$('[data-c]').forEach(li => li.onclick = () => formCarro(S.dados.carros.find(c => c.id === li.dataset.c)));
  $('#add-p').onclick = () => formPessoa();
  $('#add-c').onclick = () => formCarro();
  $('#v-nome').onchange = e => { const x = e.target.value.trim(); if (x) op({ op: 'viagem', dados: { nome: x } }); };
  $('#v-ini').onchange = e => op({ op: 'viagem', dados: { inicio: e.target.value } });
  $('#v-fim').onchange = e => op({ op: 'viagem', dados: { fim: e.target.value } });
  $('#eu').onclick = quemSouEu;
  $('#esquecer').onclick = () => {
    if (S.fila.length && !confirm(`Ainda há ${S.fila.length} alteração(ões) sem enviar. Sair mesmo assim e perdê-las?`)) return;
    if (!S.fila.length && !confirm('Tirar esta viagem da lista deste aparelho? Ela continua salva na planilha, e você pode voltar pelo link.')) return;
    ls.set('rv:viagens', minhas().filter(x => x.v !== S.v));
    ['rv:dados:', 'rv:fila:', 'rv:eu:'].forEach(k => ls.del(k + S.v));
    sair();
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
  dlg.replaceChildren(f);
  if (!dlg.open) dlg.showModal();
  return f;
}
function fecharJanela() { if (dlg.open) dlg.close(); }
dlg.addEventListener('click', e => { if (e.target === dlg) fecharJanela(); });

function novaViagem() {
  const f = janela('Nova viagem', `
    <label class="cp"><span>Nome da viagem</span><input type="text" name="nome" required placeholder="Ex.: Pirenópolis com a galera"></label>
    <div class="grade2"><label class="cp"><span>Início</span><input type="date" name="inicio"></label><label class="cp"><span>Fim</span><input type="date" name="fim"></label></div>
    <label class="cp"><span>Quem vai? (um nome por linha)</span><textarea name="pessoas" rows="5" placeholder="Você&#10;Ana&#10;João"></textarea></label>
    <p class="dica">O primeiro nome da lista é você. Dá para acrescentar ou mudar depois.</p>`,
    `<button class="btn" value="x" formnovalidate>Cancelar</button><button class="btn pri" value="ok">Criar viagem</button>`);
  f.onsubmit = async e => {
    if (e.submitter && e.submitter.value !== 'ok') return;
    e.preventDefault();
    const fd = new FormData(f);
    const nomes = String(fd.get('pessoas') || '').split(/\n|,/).map(s => s.trim()).filter(Boolean);
    const pessoas = [...new Set(nomes)].map(n => ({ id: uid('P'), nome: n, chegada: '', saida: '', peso: 1, restricoes: [], pix: '' }));
    const btn = e.submitter; btn.disabled = true; btn.textContent = 'Criando…';
    try {
      const j = await chamar({ acao: 'criar', nome: String(fd.get('nome')).trim(), inicio: fd.get('inicio'), fim: fd.get('fim'), pessoas });
      ls.set('rv:dados:' + j.v, j.dados);
      if (pessoas[0]) ls.set('rv:eu:' + j.v, pessoas[0].id);
      lembrar(j.v, j.c, j.dados.viagem.nome);
      fecharJanela();
      ABA = pessoas.length ? 'gastos' : 'grupo';
      abrir(j.v, j.c);
      toast('Viagem criada! Mande o convite na aba Grupo.');
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

function formPessoa(p) {
  const novo = !p;
  p = p || { id: uid('P'), nome: '', chegada: '', saida: '', peso: 1, restricoes: [], pix: '' };
  const f = janela(novo ? 'Adicionar pessoa' : 'Editar pessoa', `
    <label class="cp"><span>Nome</span><input type="text" name="nome" required value="${esc(p.nome)}"></label>
    <div class="grade2"><label class="cp"><span>Chegou em</span><input type="date" name="chegada" value="${esc(p.chegada)}"></label><label class="cp"><span>Saiu em</span><input type="date" name="saida" value="${esc(p.saida)}"></label></div>
    <p class="dica">Deixe em branco se ficou a viagem toda. Hospedagem é dividida pelas noites e comida pelos dias em que a pessoa estava.</p>
    <label class="cp"><span>Conta como quantas pessoas?</span><input type="text" inputmode="decimal" name="peso" value="${esc(fmtNum(p.peso === '' ? 1 : p.peso))}"></label>
    <p class="dica">1 = normal · 2 = casal que divide como um · 0,5 = criança.</p>
    <span style="display:block;font-size:.85rem;color:var(--mut);font-weight:600;margin-bottom:2px">Não entra na divisão de</span>
    ${Object.entries(C.RESTRICOES).map(([k, r]) => `<label class="check"><input type="checkbox" name="r" value="${k}" ${(p.restricoes || []).includes(k) ? 'checked' : ''}>${r}</label>`).join('')}
    <label class="cp" style="margin-top:8px"><span>Chave Pix (para receber)</span><input type="text" name="pix" value="${esc(p.pix)}" placeholder="CPF, e-mail, celular ou chave aleatória"></label>
    <p class="dica">Celular: escreva com o DDD entre parênteses, ex. (62) 99999-9999.</p>`,
    `${novo ? '' : '<button class="btn perigo" value="del" formnovalidate>Remover</button>'}<button class="btn pri" value="ok">Salvar</button>`);
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
    const item = { id: p.id, nome: String(fd.get('nome')).trim(), chegada: fd.get('chegada'), saida: fd.get('saida'), peso: lerNum(fd.get('peso')) === '' ? 1 : lerNum(fd.get('peso')), restricoes: fd.getAll('r'), pix: String(fd.get('pix')).trim() };
    if (item.chegada && item.saida && item.saida < item.chegada) { e.preventDefault(); return toast('A saída está antes da chegada.'); }
    op({ op: 'salvar', tipo: 'pessoa', item });
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
    op({ op: 'salvar', tipo: 'acerto', item: { id: uid('A'), data: fd.get('data'), de: fd.get('de'), para: fd.get('para'), valor: v, obs: String(fd.get('obs')).trim() } });
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
    if (b === 'pago') op({ op: 'salvar', tipo: 'acerto', item: { id: uid('A'), data: hoje(), de: t.de, para: t.para, valor: t.valor / 100, obs: 'Pix' } });
  };
}

/* ---------- formulário de gasto ---------- */
function formGasto(g) {
  if (!S.dados.pessoas.length) { toast('Cadastre as pessoas primeiro.'); return irAba('grupo'); }
  const novo = !g;
  const carros = S.dados.carros || [];
  g = g ? JSON.parse(JSON.stringify(g)) : { id: uid('G'), data: hoje(), descricao: '', categoria: 'alimentacao', valor: '', moeda: 'BRL', cambio: 1, pagoPor: S.eu || S.dados.pessoas[0].id, modo: '', participantes: [], carro: carros[0] ? carros[0].id : '', marca: '', valores: {}, status: '', retido: '', foto: '', obs: '', criadoPor: S.eu };
  const st = { cat: g.categoria, modo: g.modo || (C.CAT[g.categoria] || {}).modo || 'presentes', modoManual: !!g.modo, foto: g.foto };
  const moedas = ['BRL', 'USD', 'EUR', 'ARS', 'CLP', 'UYU', 'PYG', 'GBP'];
  const f = janela(novo ? 'Novo gasto' : 'Editar gasto', `
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
    `${novo ? '' : '<button class="btn perigo" value="del" formnovalidate>Excluir</button>'}<button class="btn pri" value="ok">Salvar</button>`);

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
      foto: st.foto || '', obs: String(fd.get('obs')).trim()
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
      const base64 = await reduzirFoto(arq, DEMO ? 700 : 1400);
      const j = await chamar({ acao: 'foto', v: S.v, c: S.c, nome: g.id, mime: 'image/jpeg', base64 });
      st.foto = j.url;
      $('#foto-atual', f).innerHTML = `<a href="${esc(st.foto)}" target="_blank" rel="noopener">📎 Foto anexada ✓</a>`;
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
    op({ op: 'salvar', tipo: 'gasto', item: x });
    if (novo) toast('Gasto lançado ✓');
  };
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
      ok(cv.toDataURL('image/jpeg', 0.72).split(',')[1]);
    };
    img.onerror = erro; img.src = url;
  });
}

/* ---------- eventos gerais ---------- */
$$('#abas button').forEach(b => b.onclick = () => irAba(b.dataset.aba));
$('#fab').onclick = () => formGasto();
$('#btn-voltar').onclick = sair;
$('#btn-sync').onclick = () => atualizar(false);
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
