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
const SWARM_ID = randomUUID().slice(0, 8); // um id por processo/sessao
const RUN_FILE = path.join(RUNS_DIR, SWARM_ID + ".jsonl");
const PODA_MS = 6 * 3600 * 1000; // arquivos de run mais velhos que isso sao removidos pelo hub
try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
}
catch { }
// Unica porta de saida deste processo: grava o evento no proprio arquivo JSONL. "run" trunca (nova run
// reseta o card); os demais anexam. Best-effort (falha de I/O nao derruba a run). O hub le esse arquivo.
export function emitir(ev) {
    try {
        const linha = JSON.stringify(ev) + "\n";
        if (ev.t === "run")
            fs.writeFileSync(RUN_FILE, linha); // ponytail: sem teto de tamanho; run e' finita
        else
            fs.appendFileSync(RUN_FILE, linha);
    }
    catch { }
}
// Le a pasta de runs e devolve os eventos agrupados por swarm (basename do arquivo). Pura -> testavel.
export function lerRuns(dir) {
    const m = new Map();
    let files = [];
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    }
    catch {
        return m;
    }
    for (const f of files) {
        const evs = [];
        try {
            for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n"))
                if (l) {
                    try {
                        evs.push(JSON.parse(l));
                    }
                    catch { }
                }
        }
        catch {
            continue;
        }
        m.set(f.slice(0, -6), evs);
    }
    return m;
}
// Deriva a linha de texto crua (stderr + HERMES_LOG) de um evento, preservando o log ao vivo de sempre.
export function linhaDe(ev) {
    switch (ev.t) {
        case "run": return `PLANO recebido: ${ev.total} slice(s)`;
        case "fase": return ev.nome.toUpperCase() + (ev.info ? " " + ev.info : "");
        case "slice":
            if (ev.status === "fila")
                return "";
            if (ev.status === "rodando")
                return `Tarefa ${ev.idx}/${ev.total}: ${ev.tarefa}`;
            if (ev.status === "ok")
                return `[T${ev.idx}] concluida: ${(ev.escritos ?? []).length} arq${ev.comandos?.length ? ", " + ev.comandos.length + " cmd" : ""}`;
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
  body { margin:0; background:#0d1117; color:#c9d1d9; font:14px/1.5 ui-monospace,Consolas,monospace; }
  header { padding:12px 16px; background:#161b22; border-bottom:1px solid #30363d; display:flex; gap:16px; align-items:center; flex-wrap:wrap; }
  header h1 { font-size:15px; margin:0; color:#e6edf3; font-weight:600; }
  .muted { color:#8b949e; }
  .badge { padding:2px 10px; border-radius:12px; font-weight:600; font-size:12px; background:#21262d; }
  .badge.rodando { background:#3b3410; color:#e3b341; }
  .badge.COMPLETE { background:#0f3d20; color:#3fb950; }
  .badge.NEEDS-REVIEW, .badge.GATE-FAILED, .badge.FAILED, .badge.COMMIT-SKIP { background:#3d1a1a; color:#f85149; }
  button.back { background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:4px 10px; cursor:pointer; font:inherit; }
  /* grid de swarms */
  #grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:12px; padding:12px; }
  .empty { color:#8b949e; padding:24px; }
  .scard { background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; cursor:pointer; transition:border-color .1s; }
  .scard:hover { border-color:#58a6ff; }
  .scard.rodando { border-left:3px solid #e3b341; }
  .scard.COMPLETE { border-left:3px solid #3fb950; }
  .scard.NEEDS-REVIEW, .scard.GATE-FAILED, .scard.FAILED, .scard.COMMIT-SKIP { border-left:3px solid #f85149; }
  .scard .feat { font-weight:600; color:#e6edf3; margin-bottom:8px; word-break:break-word; }
  .scard .cmeta { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .scard .prog { font-size:12px; color:#8b949e; }
  .scard .cwd { font-size:11px; color:#6e7681; margin-left:auto; word-break:break-all; }
  /* detalhe */
  main { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:12px; }
  section { background:#161b22; border:1px solid #30363d; border-radius:6px; padding:10px; min-height:120px; }
  section h2 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:#8b949e; margin:0 0 8px; }
  .card { border:1px solid #30363d; border-radius:6px; padding:8px; margin-bottom:8px; }
  .card.fila { opacity:.5; }
  .card.rodando { border-color:#e3b341; }
  .card.ok { border-color:#3fb950; }
  .card.incompleta { border-color:#f85149; }
  .card .t { font-weight:600; }
  .card .sub { color:#8b949e; font-size:12px; margin-top:2px; }
  #feed { max-height:420px; overflow:auto; display:flex; flex-direction:column; }
  #feed .row { padding:2px 0; border-bottom:1px dashed #21262d; font-size:12.5px; }
  #feed .row.err { color:#f85149; }
  #metricas .row { padding:2px 0; border-bottom:1px dashed #21262d; font-size:12.5px; }
  #metricas-agg { color:#8b949e; font-size:12px; margin-top:6px; border-top:1px solid #30363d; padding-top:4px; }
  #gate .row { display:flex; gap:8px; align-items:center; padding:4px 0; flex-wrap:wrap; }
  #gate .st { font-weight:600; }
  #gate .st.ok { color:#3fb950; } #gate .st.falha { color:#f85149; } #gate .st.rodando { color:#e3b341; }
  details { margin-top:4px; width:100%; } pre { white-space:pre-wrap; background:#0d1117; padding:8px; border-radius:4px; max-height:240px; overflow:auto; margin:4px 0 0; }
  #diffs { display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px; }
  #diffs button { background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:2px 8px; cursor:pointer; font:inherit; }
  #diffs button.on { background:#30363d; color:#e6edf3; }
  .add { color:#3fb950; } .rem { color:#f85149; }
  #painel { margin-top:8px; white-space:pre-wrap; font-size:12.5px; }
  button.copy { margin-top:6px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:4px; padding:4px 10px; cursor:pointer; font:inherit; }
  @media (max-width:900px) { main { grid-template-columns:1fr; } }
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
<div id="grid"></div>
<main id="detalhe" hidden>
  <section><h2 id="d-feature">Slices</h2><div id="slices"></div></section>
  <section><h2>Tool calls</h2><div id="feed"></div></section>
  <section><h2>Gate</h2><div id="gate"></div></section>
  <section><h2>Métricas</h2><div id="metricas"></div><div id="metricas-agg"></div></section>
  <section><h2>Diff / Painel</h2><div id="diffs"></div><pre id="diffbody"></pre><pre id="painel"></pre><button class="copy" id="btn-copy" hidden>Copiar REVERTER</button></section>
</main>
<script>
var es = new EventSource('/events');
var swarms = {};   // id -> { events:[], feature, cwd }
var atual = null;  // swarm aberto no detalhe, ou null = grid
var diffs = {};
var metricas = []; // acumulador de metricas do swarm aberto (zona detalhe)

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function esc(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

es.onmessage = function (msg) {
  var d = JSON.parse(msg.data);
  var id = d.swarm;
  if (d.drop) { delete swarms[id]; if (atual === id) voltar(); else renderGrid(); return; }
  var ev = d.ev;
  if (!swarms[id]) swarms[id] = { events: [], feature: id, cwd: '' };
  swarms[id].events.push(ev);
  if (ev.t === 'run') { swarms[id].feature = ev.feature; swarms[id].cwd = ev.cwd; }
  if (atual === id) aplicar(ev);
  else if (!atual) renderGrid();
};

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
function renderGrid() {
  if (atual) return;
  var g = document.getElementById('grid');
  g.innerHTML = '';
  var ids = Object.keys(swarms);
  document.getElementById('h-sub').textContent = ids.length ? (ids.length + ' swarm(s)') : 'nenhum swarm ativo';
  if (!ids.length) { g.appendChild(el('div', 'empty', 'Rode  orchestra "feature"  em alguma sessao — os swarms aparecem aqui.')); return; }
  for (var i = 0; i < ids.length; i++) {
    var s = swarms[ids[i]], st = statusDe(s), prog = progressoDe(s);
    var card = el('div', 'scard ' + st);
    card.appendChild(el('div', 'feat', s.feature));
    var meta = el('div', 'cmeta');
    meta.appendChild(el('span', 'badge ' + st, st));
    if (prog) meta.appendChild(el('span', 'prog', prog));
    if (s.cwd) meta.appendChild(el('span', 'cwd', s.cwd));
    card.appendChild(meta);
    (function (cid) { card.onclick = function () { abrir(cid); }; })(ids[i]);
    g.appendChild(card);
  }
}

// ---- roteamento grid <-> detalhe ----
function abrir(id) {
  atual = id;
  document.getElementById('grid').hidden = true;
  document.getElementById('detalhe').hidden = false;
  document.getElementById('btn-back').hidden = false;
  replay(id);
}
function voltar() {
  atual = null;
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
  document.getElementById('metricas-agg').textContent = '';
  document.getElementById('diffs').innerHTML = '';
  document.getElementById('diffbody').textContent = '';
  document.getElementById('painel').textContent = '';
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
function addFeed(text, err) {
  var feed = document.getElementById('feed');
  feed.appendChild(el('div', 'row' + (err ? ' err' : ''), text));
  while (feed.children.length > 500) feed.removeChild(feed.firstChild);
  feed.scrollTop = feed.scrollHeight;
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
function atualizarAgregadoMetricas() {
  var agg = document.getElementById('metricas-agg');
  var n = metricas.length;
  if (!n) { agg.textContent = ''; return; }
  var primeira = 0, somaIter = 0, tocou = 0, custo = 0;
  for (var i = 0; i < n; i++) {
    var m = metricas[i];
    if (m.passouDePrimeira) primeira++;
    somaIter += m.iteracoes;
    if (m.tocouNoTeste > 0) tocou++;
    custo += m.custoUSD;
  }
  agg.textContent = 'run (' + n + ' slice' + (n > 1 ? 's' : '') + '): '
    + Math.round((primeira / n) * 100) + '% 1a | media ' + (somaIter / n).toFixed(1) + ' iter | '
    + Math.round((tocou / n) * 100) + '% tocou teste | $ ' + custo.toFixed(4);
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
    addFeed(ev.nome + (ev.info ? ': ' + ev.info : ''));
    if (ev.nome === 'branch' && ev.info) document.getElementById('d-branch').textContent = ev.info.replace(' (existente)', '');
  }
  else if (ev.t === 'slice') { upsertSlice(ev); if (ev.status === 'rodando') addFeed('Tarefa ' + ev.idx + '/' + ev.total + ': ' + ev.tarefa); }
  else if (ev.t === 'tool') { addFeed('[T' + ev.slice + '] ' + ev.nome + (ev.alvo ? ' ' + ev.alvo : '') + (ev.ok ? '' : ' (' + (ev.resumo || 'erro') + ')'), !ev.ok); }
  else if (ev.t === 'gate') { addGate(ev); }
  else if (ev.t === 'diff') { addDiff(ev); }
  else if (ev.t === 'metrica') { addMetrica(ev); }
  else if (ev.t === 'painel') {
    setDStatus(ev.status);
    if (ev.branch) document.getElementById('d-branch').textContent = ev.branch;
    document.getElementById('painel').textContent = 'STATUS: ' + ev.status + '\\n' + ev.linhas.join('\\n');
    if (ev.baseline) {
      var btn = document.getElementById('btn-copy');
      btn.hidden = false;
      var cmd = 'git checkout ' + ev.baseline.slice(0, 8) + ' -- .';
      btn.onclick = function () {
        navigator.clipboard.writeText(cmd);
        btn.textContent = 'Copiado!';
        setTimeout(function () { btn.textContent = 'Copiar REVERTER'; }, 1500);
      };
    }
  }
  else if (ev.t === 'log') { if (ev.texto) addFeed(ev.texto); }
}

renderGrid();
</script>
</body>
</html>
`;
const clientes = new Set();
const estado = new Map();
let servidor = null;
// Envia pro cliente so os eventos ainda nao enviados (deltas), por swarm.
function enviar(c) {
    for (const [swarm, evs] of estado) {
        const sent = c.offsets.get(swarm) || 0;
        for (let i = sent; i < evs.length; i++) {
            try {
                c.res.write(`data: ${JSON.stringify({ swarm, ev: evs[i] })}\n\n`);
            }
            catch { }
        }
        c.offsets.set(swarm, evs.length);
    }
}
// Rele a pasta e empurra novidades/drops pros clientes. Chamada por fs.watch e por um intervalo (o
// fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
function rescan() {
    const novo = lerRuns(RUNS_DIR);
    const drops = [];
    for (const swarm of estado.keys())
        if (!novo.has(swarm))
            drops.push(swarm);
    estado.clear();
    for (const [k, v] of novo)
        estado.set(k, v);
    for (const c of clientes) {
        for (const swarm of drops) {
            try {
                c.res.write(`data: ${JSON.stringify({ swarm, drop: true })}\n\n`);
            }
            catch { }
            c.offsets.delete(swarm);
        }
        enviar(c);
    }
}
// Remove arquivos de run velhos (sessao que ja fechou ha muito / crashou), pra nao acumular cards mortos.
function podar() {
    const limite = Date.now() - PODA_MS;
    try {
        for (const f of fs.readdirSync(RUNS_DIR)) {
            if (!f.endsWith(".jsonl"))
                continue;
            const p = path.join(RUNS_DIR, f);
            try {
                if (fs.statSync(p).mtimeMs < limite)
                    fs.unlinkSync(p);
            }
            catch { }
        }
    }
    catch { }
}
// Sobe o dashboard uma vez, no connect do MCP. Porta ocupada = OUTRO processo ja hospeda (e vai ler
// nosso arquivo); esta sessao so escreve seu JSONL e nao serve nada. A run segue normalmente (CA-U1).
export function iniciarUI() {
    if (servidor)
        return;
    try {
        fs.mkdirSync(RUNS_DIR, { recursive: true });
    }
    catch { }
    const srv = http.createServer((req, res) => {
        if (req.url === "/events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            res.write(": conectado\n\n");
            const c = { res, offsets: new Map() };
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
        try {
            fs.watch(RUNS_DIR, () => rescan());
        }
        catch { }
        setInterval(rescan, 1000).unref();
    });
    srv.on("error", () => { servidor = null; }); // EADDRINUSE -> outro processo e' o hub, sem derrubar a run
    srv.listen(PORT, "127.0.0.1");
    servidor = srv;
}
