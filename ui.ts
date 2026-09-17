// Dashboard web local multi-swarm (http+SSE nativos, sem dependencia nova). Cada processo bridge
// (uma sessao do Claude) escreve seus eventos num arquivo JSONL numa pasta compartilhada; QUEM pega a
// porta vira o "hub" e le TODOS os arquivos, servindo uma pagina com um card por swarm — clicar num
// card abre a visao detalhada ao vivo. Assim varias sessoes rodando ao mesmo tempo aparecem juntas,
// em vez de so a primeira (que ganhava a porta) mostrar algo. Read-only; aprovar/reverter no chat.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

const PORT = Number(process.env.HERMES_UI_PORT || "4123");
const RUNS_DIR = path.join(os.tmpdir(), "hermes", "runs"); // barramento em disco, compartilhado entre processos
const SWARM_ID = randomUUID().slice(0, 8);                 // um id por processo/sessao
const RUN_FILE = path.join(RUNS_DIR, SWARM_ID + ".jsonl");
const PODA_MS = 6 * 3600 * 1000; // arquivos de run mais velhos que isso sao removidos pelo hub

try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}

export type Evento = { ts?: number } & (
  | { t: "run"; feature: string; cwd: string; total: number }
  | { t: "fase"; nome: string; info?: string }
  | { t: "slice"; idx: number; total: number; tarefa: string; status: "fila" | "rodando" | "ok" | "incompleta";
      escritos?: string[]; comandos?: string[]; motivo?: string; ms?: number }
  | { t: "tool"; slice: number; nome: string; alvo?: string; ok: boolean; resumo?: string }
  | { t: "gate"; cmd: string; status: "rodando" | "ok" | "falha"; tentativa?: number; saida?: string }
  | { t: "diff"; arquivo: string; patch: string }
  | { t: "painel"; status: string; branch: string; baseline?: string; linhas: string[] }
  | { t: "metrica"; slice: number; iteracoes: number; passouDePrimeira: boolean; tocouNoTeste: number; tokensIn: number; tokensOut: number; custoUSD: number; ms?: number }
  | { t: "log"; texto: string }
);

export type Emitir = (ev: Evento) => void;

// Unica porta de saida deste processo: grava o evento no proprio arquivo JSONL. "run" trunca (nova run
// reseta o card); os demais anexam. Best-effort (falha de I/O nao derruba a run). O hub le esse arquivo.
export function emitir(ev: Evento): void {
  try {
    if (ev.ts == null) ev.ts = Date.now(); // timestamp no feed (persistido no JSONL; o replay mostra a hora real)
    const linha = JSON.stringify(ev) + "\n";
    if (ev.t === "run") fs.writeFileSync(RUN_FILE, linha); // ponytail: sem teto de tamanho; run e' finita
    else fs.appendFileSync(RUN_FILE, linha);
  } catch {}
}

// Le a pasta de runs e devolve os eventos agrupados por swarm (basename do arquivo). Pura -> testavel.
export function lerRuns(dir: string): Map<string, Evento[]> {
  const m = new Map<string, Evento[]>();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return m; }
  for (const f of files) {
    const evs: Evento[] = [];
    try {
      for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) if (l) { try { evs.push(JSON.parse(l)); } catch {} }
    } catch { continue; }
    m.set(f.slice(0, -6), evs);
  }
  return m;
}

// Deriva a linha de texto crua (stderr + HERMES_LOG) de um evento, preservando o log ao vivo de sempre.
export function linhaDe(ev: Evento): string {
  switch (ev.t) {
    case "run": return `PLANO recebido: ${ev.total} slice(s)`;
    case "fase": return ev.nome.toUpperCase() + (ev.info ? " " + ev.info : "");
    case "slice":
      if (ev.status === "fila") return "";
      if (ev.status === "rodando") return `Tarefa ${ev.idx}/${ev.total}: ${ev.tarefa}`;
      if (ev.status === "ok") return `[T${ev.idx}] concluida: ${(ev.escritos ?? []).length} arq${ev.comandos?.length ? ", " + ev.comandos.length + " cmd" : ""}`;
      return `[T${ev.idx}] INCOMPLETA: ${ev.motivo ?? ""}`;
    case "tool": {
      const alvoTxt = ev.alvo ? " " + ev.alvo : "";
      return ev.ok ? `[T${ev.slice}] ${ev.nome}${alvoTxt} ok` : `[T${ev.slice}] REJEITADO ${ev.nome}${alvoTxt}: ${ev.resumo ?? ""}`;
    }
    case "gate": {
      const marca = ev.status === "ok" ? "OK" : ev.status === "falha" ? "FALHA" : "rodando";
      return `GATE ${marca}: ${ev.cmd}${ev.tentativa ? " (reparo " + ev.tentativa + ")" : ""}`;
    }
    case "diff": return "";
    case "painel": return "";
    case "metrica": return `[T${ev.slice}] metrica: ${ev.iteracoes} iter, ${ev.passouDePrimeira ? "1a" : "reparo"}, teste:${ev.tocouNoTeste}, ${ev.tokensIn}+${ev.tokensOut} tok, $ ${ev.custoUSD.toFixed(4)}`;
    case "log": return ev.texto;
  }
}

const HTML = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Hermes Orchestra</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  [hidden] { display:none !important; }
  body { margin:0; background:#0d1117; color:#c9d1d9; font:14px/1.5 ui-monospace,Consolas,monospace; }
  header { padding:12px 16px; background:#161b22; border-bottom:1px solid #30363d; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:15px; margin:0; color:#e6edf3; font-weight:600; }
  .muted { color:#8b949e; }
  .badge { padding:2px 10px; border-radius:12px; font-weight:600; font-size:12px; background:#21262d; }
  .badge.rodando { background:#3b3410; color:#e3b341; }
  .badge.COMPLETE { background:#0f3d20; color:#3fb950; }
  .badge.NEEDS-REVIEW, .badge.GATE-FAILED, .badge.FAILED, .badge.COMMIT-SKIP { background:#3d1a1a; color:#f85149; }
  button.back { background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:4px 10px; cursor:pointer; font:inherit; }
  button.back:hover { border-color:#58a6ff; }
  /* barra de filtros/ordenacao do grid */
  #grid-tools { display:flex; gap:6px; flex-wrap:wrap; padding:14px 14px 0; }
  .chip { background:#21262d; border:1px solid #30363d; color:#c9d1d9; border-radius:6px; padding:4px 10px; cursor:pointer; font:inherit; }
  .chip.on { background:#30363d; color:#e6edf3; }
  /* grid de swarms */
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; padding:14px; }
  .empty { color:#8b949e; padding:24px; }
  .scard { background:#161b22; border:1px solid #30363d; border-radius:10px; padding:14px; cursor:pointer; transition:border-color .1s; display:flex; flex-direction:column; gap:10px; }
  .scard:hover { border-color:#58a6ff; }
  .scard:focus-visible { outline:2px solid #58a6ff; outline-offset:2px; }
  .scard.rodando { border-left:3px solid #e3b341; }
  .scard.COMPLETE { border-left:3px solid #3fb950; }
  .scard.NEEDS-REVIEW, .scard.GATE-FAILED, .scard.FAILED, .scard.COMMIT-SKIP { border-left:3px solid #f85149; }
  .scard .feat { font-weight:700; color:#e6edf3; word-break:break-word; font-size:14px; }
  .scard .cmeta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .scard .prog { font-size:12px; color:#8b949e; font-weight:600; }
  .scard .bar { height:6px; border-radius:3px; background:#21262d; overflow:hidden; }
  .scard .barfill { height:100%; border-radius:3px; background:#8b949e; transition:width .2s; }
  .scard .barfill.rodando { background:#e3b341; }
  .scard .barfill.COMPLETE { background:#3fb950; }
  .scard .barfill.NEEDS-REVIEW, .scard .barfill.GATE-FAILED, .scard .barfill.FAILED, .scard .barfill.COMMIT-SKIP { background:#f85149; }
  .scard .cwd { font-size:11px; color:#6e7681; word-break:break-all; }
  /* detalhe */
  main { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:14px; }
  section { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; min-height:120px; }
  section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#8b949e; margin:0 0 10px; }
  /* KPIs (agregado) full-width no topo do detalhe */
  #metricas-agg { grid-column:1/-1; display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
  .kpi { background:#161b22; border:1px solid #30363d; border-left:3px solid #58a6ff; border-radius:10px; padding:14px; display:flex; flex-direction:column; gap:8px; }
  .kpi .klabel { font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:#8b949e; }
  .kpi .kval { font-size:30px; font-weight:700; line-height:1; color:#e6edf3; }
  .kpi.verde { border-left-color:#3fb950; } .kpi.verde .kval { color:#3fb950; }
  .kpi.azul { border-left-color:#58a6ff; } .kpi.azul .kval { color:#58a6ff; }
  .kpi.vermelho { border-left-color:#f85149; } .kpi.vermelho .kval { color:#f85149; }
  .kpi.neutro { border-left-color:#8b949e; } .kpi.neutro .kval { color:#8b949e; }
  /* slices */
  #slices { display:flex; flex-direction:column; gap:8px; }
  .card { background:#0d1117; border:1px solid #30363d; border-left:3px solid #30363d; border-radius:8px; padding:10px 12px; }
  .card.fila { opacity:.5; }
  .card.rodando { border-left-color:#e3b341; }
  .card.ok { border-left-color:#3fb950; }
  .card.incompleta { border-left-color:#f85149; }
  .card .t { font-weight:600; color:#e6edf3; }
  .card .sub { color:#8b949e; font-size:12px; margin-top:4px; }
  /* tool calls */
  #feed { max-height:420px; overflow:auto; display:flex; flex-direction:column; gap:2px; }
  #feed .row { padding:3px 6px; border-bottom:1px dashed #21262d; font-size:12.5px; border-radius:4px; }
  #feed .row.err { color:#f85149; }
  /* metricas por slice */
  #metricas .row { padding:3px 0; border-bottom:1px dashed #21262d; font-size:12.5px; }
  /* gate */
  #gate .row { display:flex; gap:8px; align-items:center; padding:5px 0; flex-wrap:wrap; border-bottom:1px dashed #21262d; }
  #gate .st { font-weight:600; }
  #gate .st.ok { color:#3fb950; } #gate .st.falha { color:#f85149; } #gate .st.rodando { color:#e3b341; }
  details { margin-top:4px; width:100%; } pre { white-space:pre-wrap; background:#0d1117; padding:8px; border-radius:6px; max-height:240px; overflow:auto; margin:4px 0 0; border:1px solid #21262d; }
  #diffs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; }
  #diffs button { background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:3px 9px; cursor:pointer; font:inherit; font-size:12px; }
  #diffs button:hover { border-color:#58a6ff; }
  #diffs button.on { background:#30363d; color:#e6edf3; border-color:#58a6ff; }
  .add { color:#3fb950; } .rem { color:#f85149; }
  #painel { margin-top:8px; white-space:pre-wrap; font-size:12.5px; }
  #reverter { margin-top:10px; font-size:12.5px; color:#c9d1d9; }
  #reverter code { background:#0d1117; border:1px solid #21262d; border-radius:4px; padding:2px 6px; color:#e6edf3; }
  button.copy { margin-top:8px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; padding:5px 10px; cursor:pointer; font:inherit; }
  button.copy:hover { border-color:#58a6ff; }
  @media (max-width:900px) { main { grid-template-columns:1fr; } #metricas-agg { grid-template-columns:repeat(2,minmax(0,1fr)); } }
</style>
</head>
<body>
<header>
  <button class="back" id="btn-back" hidden>&larr; swarms</button>
  <h1 id="h-title">Hermes Orchestra</h1>
  <span class="muted" id="h-sub"></span>
  <span class="muted" id="d-cwd"></span>
  <span class="muted" id="d-branch"></span>
  <span class="badge" id="d-status" hidden></span>
</header>
<div id="grid-tools" hidden>
  <button class="chip on" data-filtro="todos">Todos</button>
  <button class="chip" data-filtro="rodando">Rodando</button>
  <button class="chip" data-filtro="problemas">Problemas</button>
  <button class="chip" data-filtro="concluidos">Concluídos</button>
</div>
<div id="grid"></div>
<main id="detalhe" hidden>
  <div id="metricas-agg"></div>
  <section><h2 id="d-feature">Slices</h2><div id="slices"></div></section>
  <section><h2>Tool calls</h2><div id="feed"></div></section>
  <section><h2>Gate</h2><div id="gate"></div></section>
  <section><h2>Métricas</h2><div id="metricas"></div></section>
  <section><h2>Diff</h2><div id="diffs"></div><pre id="diffbody"></pre></section>
  <section><h2>Painel</h2><pre id="painel"></pre><div id="reverter" hidden></div><button class="copy" id="btn-copy" hidden>Copiar comando de reverter</button></section>
</main>
<script>
var es = new EventSource('/events');
var swarms = {};   // id -> { events:[], feature, cwd }
var atual = null;  // swarm aberto no detalhe, ou null = grid
var diffs = {};
var metricas = []; // acumulador de metricas do swarm aberto (zona detalhe)
var filtroAtual = 'todos'; // filtro do grid (CA-8)
var autoAberto = false;    // ja reabriu o swarm salvo na sessao? (CA-7)

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function p2(n) { return (n < 10 ? '0' : '') + n; }

es.onmessage = function (msg) {
  var d = JSON.parse(msg.data);
  var id = d.swarm;
  if (d.drop) { delete swarms[id]; if (atual === id) voltar(); else renderGrid(); autoAbrir(); return; }
  var ev = d.ev;
  if (!swarms[id]) swarms[id] = { events: [], feature: id, cwd: '' };
  swarms[id].events.push(ev);
  if (ev.t === 'run') { swarms[id].feature = ev.feature; swarms[id].cwd = ev.cwd; }
  if (atual === id) aplicar(ev);
  else if (!atual) { upsertCard(id); atualizarContador(); aplicarGrid(); }
  autoAbrir();
};

// Reabre o swarm que estava aberto antes do reload (uma vez por sessao).
function autoAbrir() {
  if (autoAberto || atual) return;
  var salvo = null;
  try { salvo = sessionStorage.getItem('hermes_atual'); } catch (e) {}
  if (salvo && swarms[salvo]) { autoAberto = true; abrir(salvo); }
}

// ---- grid ----
function statusDe(s) {
  var st = 'aguardando';
  for (var i = 0; i < s.events.length; i++) { var ev = s.events[i]; if (ev.t === 'run') st = 'rodando'; else if (ev.t === 'painel') st = ev.status; }
  return st;
}
function progressoDe(s) {
  var total = 0, fim = {};
  for (var i = 0; i < s.events.length; i++) { var ev = s.events[i]; if (ev.t === 'slice') { total = ev.total; if (ev.status === 'ok' || ev.status === 'incompleta') fim[ev.idx] = 1; } }
  var f = 0; for (var k in fim) f++;
  return total ? (f + '/' + total) : '';
}
function pctDe(s) {
  var total = 0, fim = {};
  for (var i = 0; i < s.events.length; i++) { var ev = s.events[i]; if (ev.t === 'slice') { total = ev.total; if (ev.status === 'ok' || ev.status === 'incompleta') fim[ev.idx] = 1; } }
  var f = 0; for (var k in fim) f++;
  return total ? Math.round((f / total) * 100) : 0;
}
function atualizarContador() {
  var ids = Object.keys(swarms);
  document.getElementById('h-sub').textContent = ids.length ? (ids.length + ' swarm(s)') : 'nenhum swarm ativo';
}
function ehProblema(st) { return st === 'NEEDS-REVIEW' || st === 'GATE-FAILED' || st === 'FAILED' || st === 'COMMIT-SKIP'; }
function categoria(s) {
  var st = statusDe(s);
  if (st === 'rodando') return 0;
  if (ehProblema(st)) return 1;
  return 2;
}
function passaFiltro(s) {
  if (filtroAtual === 'todos') return true;
  var st = statusDe(s);
  if (filtroAtual === 'rodando') return st === 'rodando';
  if (filtroAtual === 'problemas') return ehProblema(st);
  if (filtroAtual === 'concluidos') return st === 'COMPLETE';
  return true;
}
// Atualiza (ou cria) o card de um swarm IN-PLACE, sem reconstruir o grid todo (CA-3).
function upsertCard(id) {
  if (!swarms[id]) return;
  var g = document.getElementById('grid');
  var card = document.getElementById('gcard-' + id);
  if (!card) {
    card = el('div', 'scard');
    card.id = 'gcard-' + id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.appendChild(el('div', 'feat'));
    var meta = el('div', 'cmeta');
    meta.appendChild(el('span', 'badge'));
    meta.appendChild(el('span', 'prog'));
    card.appendChild(meta);
    var bar = el('div', 'bar');
    bar.appendChild(el('div', 'barfill'));
    card.appendChild(bar);
    card.appendChild(el('div', 'cwd'));
    (function (cid) {
      card.onclick = function () { abrir(cid); };
      card.onkeydown = function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(cid); }
      };
    })(id);
    g.appendChild(card);
  }
  var s = swarms[id], st = statusDe(s), prog = progressoDe(s), pct = pctDe(s);
  card.className = 'scard ' + st;
  card.setAttribute('aria-label', 'Abrir run: ' + s.feature + ' (' + st + ')');
  card.querySelector('.feat').textContent = s.feature;
  var badge = card.querySelector('.badge');
  badge.className = 'badge ' + st;
  badge.textContent = st;
  var progEl = card.querySelector('.prog');
  progEl.textContent = prog;
  progEl.hidden = !prog;
  var barEl = card.querySelector('.bar');
  barEl.hidden = !prog;
  var fill = card.querySelector('.barfill');
  fill.className = 'barfill ' + st;
  fill.style.width = pct + '%';
  var cwdEl = card.querySelector('.cwd');
  cwdEl.textContent = s.cwd;
  cwdEl.hidden = !s.cwd;
}
// Aplica empty-state, ordem (rodando > problemas > resto) e filtro; remove cards orfaos.
function aplicarGrid() {
  var g = document.getElementById('grid');
  var cards = g.querySelectorAll('.scard');
  for (var i = 0; i < cards.length; i++) {
    var cid = cards[i].id.slice(6);
    var s = swarms[cid];
    if (!s) { cards[i].parentNode.removeChild(cards[i]); continue; }
    cards[i].style.order = categoria(s);
    cards[i].style.display = passaFiltro(s) ? '' : 'none';
  }
  var tem = Object.keys(swarms).length > 0;
  var empty = document.getElementById('grid-empty');
  if (tem) {
    if (empty) empty.parentNode.removeChild(empty);
    document.getElementById('grid-tools').hidden = false;
  } else {
    if (!empty) { empty = el('div', 'empty', 'Rode  orchestra "feature"  em alguma sessao — os swarms aparecem aqui.'); empty.id = 'grid-empty'; g.appendChild(empty); }
    document.getElementById('grid-tools').hidden = true;
  }
}
function renderGrid() {
  if (atual) return;
  var ids = Object.keys(swarms);
  atualizarContador();
  for (var i = 0; i < ids.length; i++) upsertCard(ids[i]);
  aplicarGrid();
}
// chips de filtro (CA-8)
(function () {
  var chips = document.querySelectorAll('#grid-tools .chip');
  function marcar() {
    for (var i = 0; i < chips.length; i++) chips[i].className = chips[i].getAttribute('data-filtro') === filtroAtual ? 'chip on' : 'chip';
  }
  for (var i = 0; i < chips.length; i++) {
    (function (chip) {
      chip.onclick = function () { filtroAtual = chip.getAttribute('data-filtro'); marcar(); aplicarGrid(); };
    })(chips[i]);
  }
  marcar();
})();

// ---- roteamento grid <-> detalhe ----
function abrir(id) {
  atual = id;
  try { sessionStorage.setItem('hermes_atual', id); } catch (e) {}
  document.getElementById('grid').hidden = true;
  document.getElementById('detalhe').hidden = false;
  document.getElementById('btn-back').hidden = false;
  replay(id);
}
function voltar() {
  atual = null;
  try { sessionStorage.removeItem('hermes_atual'); } catch (e) {}
  document.getElementById('detalhe').hidden = true;
  document.getElementById('btn-back').hidden = true;
  document.getElementById('d-cwd').textContent = '';
  document.getElementById('d-branch').textContent = '';
  document.getElementById('d-status').hidden = true;
  document.getElementById('h-title').textContent = 'Hermes Orchestra';
  document.getElementById('grid').hidden = false;
  renderGrid();
}
document.getElementById('btn-back').onclick = voltar;

function limparDetalhe() {
  diffs = {};
  metricas = [];
  document.getElementById('slices').innerHTML = '';
  document.getElementById('feed').innerHTML = '';
  document.getElementById('gate').innerHTML = '';
  document.getElementById('metricas').innerHTML = '';
  atualizarAgregadoMetricas();
  document.getElementById('diffs').innerHTML = '';
  document.getElementById('diffbody').textContent = '';
  document.getElementById('painel').textContent = '';
  var rev = document.getElementById('reverter');
  if (rev) { rev.hidden = true; rev.textContent = ''; }
  document.getElementById('btn-copy').hidden = true;
  document.getElementById('d-branch').textContent = '';
}
function replay(id) {
  limparDetalhe();
  var s = swarms[id];
  document.getElementById('h-title').textContent = s.feature;
  document.getElementById('d-cwd').textContent = s.cwd;
  setDStatus(statusDe(s));
  for (var i = 0; i < s.events.length; i++) aplicar(s.events[i]);
}
function setDStatus(st) {
  var b = document.getElementById('d-status');
  b.hidden = false;
  b.textContent = st;
  b.className = 'badge ' + st;
}

// ---- paineis do detalhe (alimentados por aplicar()) ----
function addFeed(text, err, ts) {
  var feed = document.getElementById('feed');
  var prefix = '';
  if (ts != null) {
    var dt = new Date(ts);
    prefix = p2(dt.getHours()) + ':' + p2(dt.getMinutes()) + ':' + p2(dt.getSeconds()) + ' ';
  }
  var atFundo = feed.scrollTop + feed.clientHeight >= feed.scrollHeight - 4; // (CA-2) so' auto-scroll se ja estiver no fundo
  feed.appendChild(el('div', 'row' + (err ? ' err' : ''), prefix + text));
  while (feed.children.length > 500) feed.removeChild(feed.firstChild);
  if (atFundo) feed.scrollTop = feed.scrollHeight;
}
function upsertSlice(ev) {
  var root = document.getElementById('slices');
  var id = 'slice-' + ev.idx;
  var card = document.getElementById(id);
  if (!card) { card = el('div', ''); card.id = id; root.appendChild(card); }
  card.className = 'card ' + ev.status;
  card.innerHTML = '';
  card.appendChild(el('div', 't', '[' + ev.idx + '/' + ev.total + '] ' + ev.tarefa));
  var sub = [];
  if (ev.escritos && ev.escritos.length) sub.push('arq: ' + ev.escritos.join(', '));
  if (ev.comandos && ev.comandos.length) sub.push('cmd: ' + ev.comandos.join(', '));
  if (ev.motivo) sub.push('motivo: ' + ev.motivo);
  if (ev.ms) sub.push(ev.ms + 'ms');
  if (sub.length) card.appendChild(el('div', 'sub', sub.join(' | ')));
}
function addMetrica(ev) {
  metricas.push(ev);
  var root = document.getElementById('metricas');
  var linha = '[T' + ev.slice + '] ' + ev.iteracoes + ' iter, ' + (ev.passouDePrimeira ? '1a' : 'reparo')
    + ', teste:' + ev.tocouNoTeste + ', ' + ev.tokensIn + '+' + ev.tokensOut + ' tok, $ ' + ev.custoUSD.toFixed(4)
    + (ev.ms != null ? ', ' + ev.ms + 'ms' : '');
  root.appendChild(el('div', 'row', linha));
  atualizarAgregadoMetricas();
}
function kpiTile(label, valor, cor) {
  return '<div class="kpi ' + cor + '"><div class="klabel">' + label + '</div><div class="kval">' + valor + '</div></div>';
}
function atualizarAgregadoMetricas() {
  var agg = document.getElementById('metricas-agg');
  var n = metricas.length;
  var primeira = 0, somaIter = 0, tocou = 0, custo = 0;
  for (var i = 0; i < n; i++) {
    var m = metricas[i];
    if (m.passouDePrimeira) primeira++;
    somaIter += m.iteracoes;
    if (m.tocouNoTeste > 0) tocou++;
    custo += m.custoUSD;
  }
  var vPrimeira, vIter, vTeste, vCusto, corTeste;
  if (!n) {
    vPrimeira = '—'; vIter = '—'; vTeste = '—'; vCusto = '—'; corTeste = 'neutro';
  } else {
    vPrimeira = Math.round((primeira / n) * 100) + '%';
    vIter = (somaIter / n).toFixed(1);
    vTeste = Math.round((tocou / n) * 100) + '%';
    vCusto = '$' + custo.toFixed(4);
    corTeste = tocou > 0 ? 'vermelho' : 'verde';
  }
  agg.innerHTML = kpiTile('Passou de 1ª', vPrimeira, 'verde')
    + kpiTile('Média iterações', vIter, 'azul')
    + kpiTile('Tocou no teste', vTeste, corTeste)
    + kpiTile('Custo total', vCusto, 'azul');
}
function addGate(ev) {
  var root = document.getElementById('gate');
  var row = el('div', 'row');
  row.appendChild(el('span', 'st ' + ev.status, ev.status.toUpperCase()));
  row.appendChild(el('span', '', ev.cmd + (ev.tentativa ? ' (reparo ' + ev.tentativa + ')' : '')));
  if (ev.status === 'falha' && ev.saida) {
    var det = document.createElement('details');
    det.appendChild(el('summary', '', 'saida'));
    det.appendChild(el('pre', '', ev.saida));
    row.appendChild(det);
  }
  root.appendChild(row);
}
function diffColor(patch) {
  return patch.split('\\n').map(function (l) {
    if (l.charAt(0) === '+' && l.charAt(1) !== '+') return '<span class="add">' + esc(l) + '</span>';
    if (l.charAt(0) === '-' && l.charAt(1) !== '-') return '<span class="rem">' + esc(l) + '</span>';
    return esc(l);
  }).join('\\n');
}
function showDiff(f) {
  var btns = document.querySelectorAll('#diffs button');
  for (var i = 0; i < btns.length; i++) btns[i].className = btns[i].getAttribute('data-f') === f ? 'on' : '';
  document.getElementById('diffbody').innerHTML = diffColor(diffs[f] || '');
}
function addDiff(ev) {
  diffs[ev.arquivo] = ev.patch;
  var tabs = document.getElementById('diffs');
  if (!tabs.querySelector('[data-f="' + ev.arquivo + '"]')) {
    var b = el('button', '', ev.arquivo);
    b.setAttribute('data-f', ev.arquivo);
    b.onclick = function () { showDiff(ev.arquivo); };
    tabs.appendChild(b);
  }
  showDiff(ev.arquivo);
}
function aplicar(ev) {
  if (ev.t === 'run') { setDStatus('rodando'); }
  else if (ev.t === 'fase') {
    addFeed(ev.nome + (ev.info ? ': ' + ev.info : ''), false, ev.ts);
    if (ev.nome === 'branch' && ev.info) document.getElementById('d-branch').textContent = ev.info.replace(' (existente)', '');
  }
  else if (ev.t === 'slice') { upsertSlice(ev); if (ev.status === 'rodando') addFeed('Tarefa ' + ev.idx + '/' + ev.total + ': ' + ev.tarefa, false, ev.ts); }
  else if (ev.t === 'tool') { addFeed('[T' + ev.slice + '] ' + ev.nome + (ev.alvo ? ' ' + ev.alvo : '') + (ev.ok ? '' : ' (' + (ev.resumo || 'erro') + ')'), !ev.ok, ev.ts); }
  else if (ev.t === 'gate') { addGate(ev); }
  else if (ev.t === 'diff') { addDiff(ev); }
  else if (ev.t === 'metrica') { addMetrica(ev); }
  else if (ev.t === 'painel') {
    setDStatus(ev.status);
    if (ev.branch) document.getElementById('d-branch').textContent = ev.branch;
    document.getElementById('painel').textContent = 'STATUS: ' + ev.status + '\\n' + ev.linhas.join('\\n');
    var rev = document.getElementById('reverter');
    var btn = document.getElementById('btn-copy');
    if (ev.baseline) {
      var cmd = 'git checkout ' + ev.baseline.slice(0, 8) + ' -- .';
      rev.hidden = false;
      rev.innerHTML = 'Reverter tudo pro estado antes do swarm: <code>' + esc(cmd) + '</code>';
      btn.hidden = false;
      btn.onclick = function () {
        navigator.clipboard.writeText(cmd);
        btn.textContent = 'Copiado!';
        setTimeout(function () { btn.textContent = 'Copiar comando de reverter'; }, 1500);
      };
    } else {
      rev.hidden = true;
      rev.textContent = '';
      btn.hidden = true;
    }
  }
  else if (ev.t === 'log') { if (ev.texto) addFeed(ev.texto, false, ev.ts); }
}

renderGrid();
</script>
</body>
</html>
`;

// ---- hub: quem pega a porta serve o dashboard lendo TODOS os arquivos de run ----
type Cliente = { res: http.ServerResponse; offsets: Map<string, number> };
const clientes = new Set<Cliente>();
const estado = new Map<string, Evento[]>();
let servidor: http.Server | null = null;

// Envia pro cliente so os eventos ainda nao enviados (deltas), por swarm.
function enviar(c: Cliente): void {
  for (const [swarm, evs] of estado) {
    const sent = c.offsets.get(swarm) || 0;
    for (let i = sent; i < evs.length; i++) {
      try { c.res.write(`data: ${JSON.stringify({ swarm, ev: evs[i] })}\n\n`); } catch {}
    }
    c.offsets.set(swarm, evs.length);
  }
}

// Rele a pasta e empurra novidades/drops pros clientes. Chamada por fs.watch e por um intervalo (o
// fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
function rescan(): void {
  const novo = lerRuns(RUNS_DIR);
  const drops: string[] = [];
  for (const swarm of estado.keys()) if (!novo.has(swarm)) drops.push(swarm);
  estado.clear();
  for (const [k, v] of novo) estado.set(k, v);
  for (const c of clientes) {
    for (const swarm of drops) {
      try { c.res.write(`data: ${JSON.stringify({ swarm, drop: true })}\n\n`); } catch {}
      c.offsets.delete(swarm);
    }
    enviar(c);
  }
}

// Remove arquivos de run velhos (sessao que ja fechou ha muito / crashou), pra nao acumular cards mortos.
function podar(): void {
  const limite = Date.now() - PODA_MS;
  try {
    for (const f of fs.readdirSync(RUNS_DIR)) {
      if (!f.endsWith(".jsonl")) continue;
      const p = path.join(RUNS_DIR, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

// Sobe o dashboard uma vez, no connect do MCP. Porta ocupada = OUTRO processo ja hospeda (e vai ler
// nosso arquivo); esta sessao so escreve seu JSONL e nao serve nada. A run segue normalmente (CA-U1).
export function iniciarUI(): void {
  if (servidor) return;
  try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}
  const srv = http.createServer((req, res) => {
    if (req.url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": conectado\n\n");
      const c: Cliente = { res, offsets: new Map() };
      clientes.add(c);
      enviar(c); // replay do estado atual (todas as runs) pra quem acabou de conectar (CA-U7)
      req.on("close", () => clientes.delete(c));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(HTML);
  });
  srv.on("listening", () => {
    process.stderr.write(`[hermes-bridge] dashboard: http://127.0.0.1:${PORT}\n`);
    podar();
    rescan();
    try { fs.watch(RUNS_DIR, () => rescan()); } catch {}
    setInterval(rescan, 1000).unref();
  });
  srv.on("error", () => { servidor = null; }); // EADDRINUSE -> outro processo e' o hub, sem derrubar a run
  srv.listen(PORT, "127.0.0.1");
  servidor = srv;
}