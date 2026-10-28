// Dashboard web local multi-sessao (http+SSE nativos; o app React/shadcn e' compilado em dist/web e
// servido estatico). Cada RUN (uma chamada de executar_orchestra) escreve seus eventos num JSONL
// proprio numa pasta compartilhada; QUEM pega a porta vira o "hub", le TODOS os arquivos e empurra
// pro browser. Varias sessoes do Claude aparecem juntas. Unica acao pela UI: cancelar uma run.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

import { tituloSessao, comoAbrirSessao } from "./sessao.js";

// Aqui ficam so' o roteador e o handoff da porta; o resto mora em hub/canvas-hub/navegador-hub/agentes-hub
// (nenhum deles importa este modulo). A API publica continua aqui, reexportada.
import {
  PORT, DADOS_DIR, RUNS_DIR, PLANEJADORES_DIR, CANVAS_DIR,
  clientes, planejadores, sse, enviar, rescan, podar, servirEstatico,
  acaoValida, limparPlanejadores, arquivoCancel, versaoUI, hostLocal,
  responderTexto, rotasRuns, migrarDadosAntigos, definirGanchosHub,
  lerRuns, resolverIdRun, eventosDaRun, lerCorpo, type Cliente,
} from "./hub.js";

import {
  rotasCanvas, descarregarCanvas, definirGanchosCanvas,
} from "./canvas-hub.js";

import {
  definirNavegador, pararNavegador,
  type Navegador,
} from "./navegador-hub.js";

import {
  envClaude, pontes, ptyProcs, ptyBuffers,
  reconectarPontes, definirGanchosAgentes, iniciarAgentes, pararAgentes,
  aguardandoSet, filaEntregas,
  tentarLiberarAviso, tentarLiberarEntregas,
  iniciarExpiracao, pararExpiracao, garantirTokenPlanejador,
  sincronizarContexto, rotasAgentes,
  rotasCli,
  type PtyDriver,
} from "./agentes-hub.js";

export { envClaude };

export {
  RUNS_DIR, PLANEJADORES_DIR, CANVAS_DIR, AGENTES_DIR, migrarDadosAntigos, comoAbrirDashboard,
  runAtual, arquivoCancel, emitir, lerRuns, lerPlanejadores, limparPlanejadores, linhaDe,
  versaoUI, hostLocal,
} from "./hub.js";
export type { SlicePlano, Planejador, Evento, Emitir, DepsLimpeza } from "./hub.js";

// O agentes-hub nao conhece o servidor deste modulo: liga por gancho o que a ponte do /event usa ao
// mudar o status do agente (fila de entregas, avisos presos, 'aguardando' dos hooks) e o hubAtivo.
definirGanchosAgentes({
  marcarOcupadoColab: (id) => filaEntregas.marcarOcupado(id),
  marcarOciosoColab: (id) => filaEntregas.marcarOcioso(id),
  liberarAviso: (id) => tentarLiberarAviso(id),
  liberarEntregas: (id) => tentarLiberarEntregas(id),
  estaAguardando: (id) => aguardandoSet.has(id),
  hubAtivo: () => servidor !== null,
});

// O hub nao importa o ui (dependencia de mao unica): liga aqui os efeitos que dependem deste modulo —
// um planejador novo ganha token/identidade (F3/S2) e a lista nova reabre as pontes do /event (F2.2).
definirGanchosHub({
  aoMudarPlanejadores: (lista) => {
    for (const p of lista) void garantirTokenPlanejador(p); // F3/S2: identidade do planejador (uma vez)
    void reconectarPontes(); // a lista mudou: reabre as pontes das bases dos planejadores (F2.2)
  },
});

// O canvas-hub nao conhece agentes: o contexto em disco dos nos 'agente' entra por gancho.
definirGanchosCanvas({ aoAplicarOps: (snap) => sincronizarContexto(snap) });

// Antes do primeiro mkdirSync, e so' sem env de pasta: puxa o local antigo (nome anterior do produto).
const PASTAS_PADRAO = !process.env.DEV_ORCHESTRA_RUNS_DIR && !process.env.DEV_ORCHESTRA_PLANEJADORES_DIR
  && !process.env.DEV_ORCHESTRA_CANVAS_DIR && !process.env.DEV_ORCHESTRA_AGENTES_DIR;
if (PASTAS_PADRAO) {
  try { migrarDadosAntigos(path.join(os.tmpdir(), "hermes"), DADOS_DIR); } catch {}
}

try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}

let servidor: http.Server | null = null;
// Promessa do fechamento do ultimo servidor: o proximo escutar() espera o socket ser liberado de fato
// (sem isso, um iniciarUI imediatamente apos pararUI liga numa porta ainda presa pelo socket antigo).
let servidorFechando: Promise<void> | null = null;
let intervalo: NodeJS.Timeout | null = null;
let watcher: fs.FSWatcher | null = null;
let limpeza: NodeJS.Timeout | null = null;   // poda os registros de planejadores orfaos
let reassumir: NodeJS.Timeout | null = null; // quem ficou sem porta tenta de novo
let onCeder: (() => void) | null = null;     // chamado no fim do ceder() (modo --ui encerra o processo)
let sempreAssumir = false;                   // modo --ui: assume a porta de QUALQUER hub Dev Orchestra (sem comparar versao)

// Libera a porta (pedido de um processo com UI mais nova). No modo --ui, onCeder encerra o processo.
function ceder(): void {
  for (const c of clientes) { try { c.res.end(); } catch {} }
  clientes.clear();
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  if (limpeza) { clearInterval(limpeza); limpeza = null; }
  pararExpiracao();
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  descarregarCanvas(); // grava ops pendentes antes de ceder a porta
  for (const ctrl of pontes.values()) { try { ctrl.abort(); } catch {} }
  pontes.clear();
  for (const p of ptyProcs.values()) { try { p.kill(); } catch {} } // F4/S3: PTYs dos agentes Claude morrem com o hub
  ptyProcs.clear();
  ptyBuffers.clear();
  fecharServidor(); // derruba as conexoes keep-alive e guarda a promessa do socket do servidor antigo
  onCeder?.();
}

// GET /sessoes: { idDaRun: titulo } para cada run cujo evento 'run' tem sessao (runs sem sessao ficam
// de fora). Le a pasta fresca a cada chamada e o titulo usa cache por mtime: renomear o chat aparece ja'
// na proxima chamada. POST /runs/sessao?run=<id>: reabre a sessao SALVA no log (o cliente nunca manda
// URL/comando); com DEV_ORCHESTRA_ABRIR_LOG ligado so' grava {comando,args} (sem spawnar), senao spawna.
const LIMITE_BODY_SESSAO = 64 * 1024;
async function rotasSessoes(req: http.IncomingMessage, res: http.ServerResponse, caminho: string, url: string): Promise<boolean> {
  if (caminho === "/sessoes") {
    const out: Record<string, string> = {};
    for (const [id, evs] of lerRuns(RUNS_DIR)) {
      const runEv = evs.find((e) => e.t === "run");
      if (!runEv || runEv.t !== "run" || !runEv.sessao) continue;
      out[id] = tituloSessao(runEv.sessao, runEv.cwd);
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(out));
    return true;
  }
  if (caminho !== "/runs/sessao") return false;
  const corpo = await lerCorpo(req, LIMITE_BODY_SESSAO); // drena antes de responder (mesmo motivo de /runs/acao)
  if (corpo === null) { res.writeHead(400); res.end(); return true; }
  if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
  const id = new URL(url, "http://x").searchParams.get("run") || "";
  if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return true; }
  const evs = eventosDaRun(id);
  const runEv = evs && evs.find((e) => e.t === "run");
  if (!runEv || runEv.t !== "run" || !runEv.sessao) { res.writeHead(404); res.end(); return true; }
  const como = comoAbrirSessao(runEv.sessao, runEv.cwd, process.platform);
  if (!como) { res.writeHead(400); res.end(); return true; }
  const log = process.env.DEV_ORCHESTRA_ABRIR_LOG;
  if (log) {
    try { fs.appendFileSync(log, JSON.stringify({ comando: como.comando, args: como.args }) + "\n"); } catch {}
  } else {
    try { spawn(como.comando, como.args, { detached: true, stdio: "ignore", windowsHide: true }).unref(); } catch {}
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ comandoCopia: como.copia }));
  return true;
}

function criarServidor(): http.Server {
  return http.createServer(async (req, res) => {
    const url = req.url || "/";
    const caminho = url.split("?")[0];
    if (!hostLocal(req.headers.host, req.socket.localPort ?? PORT)) {
      res.shouldKeepAlive = false;
      responderTexto(res, 403, "Host nao permitido");
      return;
    }
    if (url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": conectado\n\n");
      const c: Cliente = { res, offsets: new Map() };
      clientes.add(c);
      enviar(c); // replay do estado atual (todas as runs) pra quem acabou de conectar
      sse(c, { planejadores }); // registros de planejadores (chat embutido) antes do {pronto}
      sse(c, { pronto: true }); // fim do replay: a UI so aplica depois disso (sem estado pela metade)
      req.on("close", () => clientes.delete(c));
      return;
    }
    // Toda resposta que NAO e' SSE sai SEM keep-alive: o socket morre junto com a resposta e o cliente
    // (undici) nunca reaproveita uma conexao do servidor antigo depois de um restart/ceder de porta
    // (evita ECONNRESET no primeiro pedido pos-restart).
    res.shouldKeepAlive = false;
    if (url === "/versao") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ versao: versaoUI() }));
      return;
    }
    if (url.startsWith("/cancel")) {
      const id = new URL(url, "http://x").searchParams.get("run") || "";
      if (!acaoValida(req) || !/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return; }
      try { fs.writeFileSync(arquivoCancel(resolverIdRun(id) ?? id), String(Date.now())); res.writeHead(204); }
      catch { res.writeHead(500); }
      res.end();
      return;
    }
    if (url === "/ceder") {
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      res.writeHead(204); res.end();
      setTimeout(ceder, 50);
      return;
    }
    if (await rotasSessoes(req, res, caminho, url)) return;
    // ---- acoes da run no card (G1/S2 merge|pr|descartar e G3 instrucao|pausa): rotasRuns no hub ----
    if (await rotasRuns(req, res, caminho, url)) return;
    if (await rotasCanvas(req, res, caminho, url)) return;
    if (await rotasAgentes(req, res, caminho, url)) return;
    // ---- CLI dos agentes (F3/S2 + S5): as rotas POST <cli>/<cmd> moram no agentes-hub (rotasCli) ----
    if (await rotasCli(req, res, caminho, url)) return;
    servirEstatico(url, res);
  });
}

// Em EADDRINUSE: se a porta fala /versao (e' um hub Dev Orchestra), pede pra ele ceder e assume a porta.
// Com sempreAssumir (modo --ui, o app de verdade) o pedido e' INCONDICIONAL: abrir o app derruba o node
// do dashboard anterior e o novo passa a servir o dist mais atualizado, mesmo com versoes empatadas
// (mesmo dist) ou o hub "mais novo". Sem sempreAssumir (modo stdio) mantem a regra antiga: so' assume se
// a nossa UI for MAIS NOVA. Processo ALHEIO na porta (nao responde /versao / hub quebrado) nunca e' tocado.
async function tentarAssumir(): Promise<void> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/versao`, { signal: AbortSignal.timeout(1500) });
    let j: any = null;
    try { j = await r.json(); } catch {} // corpo nao-JSON (processo alheio) -> j fica null
    const ehHub = r.ok && typeof j?.versao === "number";
    if (!ehHub) return; // nao e' o Dev Orchestra: nunca interferir
    if (!sempreAssumir && !(j.versao < versaoUI())) return; // stdio: so' cede pra uma UI mais nova
    await fetch(`http://127.0.0.1:${PORT}/ceder`, { method: "POST", headers: { "X-Dev-Orchestra": "1" }, signal: AbortSignal.timeout(1500) });
  } catch { return; }
  for (let i = 0; i < 6; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    if (await escutar()) return;
  }
}

// Fecha o servidor atual e guarda a promessa do fechamento (callback do close): quem for reabrir a
// porta (escutar) espera essa promessa, garantindo que o socket antigo ja' foi liberado.
function fecharServidor(): void {
  const s = servidor;
  servidor = null;
  if (!s) return;
  try { s.closeAllConnections(); } catch {}
  servidorFechando = new Promise<void>((ok) => { try { s.close(() => ok()); } catch { ok(); } });
}

async function escutar(): Promise<boolean> {
  if (servidorFechando) { await servidorFechando; servidorFechando = null; }
  return new Promise((ok) => {
    const srv = criarServidor();
    srv.once("error", () => ok(false));
    srv.once("listening", () => {
      servidor = srv;
      process.stderr.write(`[dev-orchestra] dashboard: http://127.0.0.1:${PORT}\n`);
      podar();
      rescan();
      void limparPlanejadores(PLANEJADORES_DIR); // uma vez no start
      // Limpeza dos registros orfaos + retentativa espacada das pontes (bases que ainda nao respondem).
      limpeza = setInterval(() => { void limparPlanejadores(PLANEJADORES_DIR); void reconectarPontes(); }, 5000);
      limpeza.unref();
      try { watcher = fs.watch(RUNS_DIR, () => rescan()); } catch {}
      intervalo = setInterval(rescan, 1000);
      intervalo.unref();
      // Cede um tick ao event loop: o cliente (mesmo processo) processa o FIN/RST dos sockets do
      // servidor anterior antes de reusar a pool — sem isso, o 1o POST apos um restart reusa um
      // socket morto e leva ECONNRESET.
      setTimeout(() => ok(true), 0);
    });
    srv.listen(PORT, "127.0.0.1");
  });
}

// Sobe o dashboard uma vez, no connect do MCP. Porta ocupada = outro processo ja hospeda (e le nosso
// arquivo), a nao ser que a nossa UI seja mais nova (ou que sempreAssumir esteja ligado). Nunca derruba a run.
// No modo --ui (dashboard-only), onCeder encerra o processo ao ceder a porta; com sempreAssumir, esse
// processo SEMPRE passa a banda pro app recem-aberto (garante o dist mais atualizado no ar).
export type OpcoesUI = {
  onCeder?: () => void;
  sempreAssumir?: boolean; // modo --ui: assume a porta de qualquer hub Dev Orchestra, sem comparar versao
  subirServe?: (cwd: string, env?: Record<string, string | undefined>) => Promise<{ base: string; pid: number }>; // sobe `opencode serve` na cwd (injetavel)
  matarProcesso?: (pid: number) => void; // encerra o serve (injetavel)
  navegador?: Navegador; // driver do navegador embutido (F4/S2): liga as rotas browser-* do CLI
  pty?: PtyDriver; // driver de PTY (F4/S3): liga os agentes Claude Code; sem ele, POST /agentes tipo 'claude' falha
};

export async function iniciarUI(opts: OpcoesUI = {}): Promise<void> {
  if (servidor) return;
  onCeder = opts.onCeder ?? null;
  sempreAssumir = opts.sempreAssumir ?? false;
  iniciarAgentes({ subirServe: opts.subirServe, matarProcesso: opts.matarProcesso, pty: opts.pty });
  definirNavegador(opts.navegador); // F4/S2: sem driver, toda rota browser-* responde 400
  if (!(await escutar())) await tentarAssumir();
  if (servidor) void reconectarPontes(); // agentes recarregados do disco ganham ponte de /event (F2.2)
  iniciarExpiracao(); // F3/S2: varre as conversas pendentes (expira -> avisa a origem)
  // Se o hub sumir (sessao fechou ou cedeu pra outro que depois saiu), quem estiver vivo reassume a porta.
  // Com sempreAssumir (app), perder a corrida pra um hub stdio nao e' definitivo: pede pra ele ceder de novo.
  if (!reassumir) reassumir = setInterval(() => { if (!servidor) void escutar().then((ok) => { if (!ok && sempreAssumir) void tentarAssumir(); }); }, 10_000);
  reassumir.unref();
}

// App reaberto (`dev-orchestra` com o app ja' aberto): retoma a porta na hora se um hub stdio ficou com ela.
export async function assumirPorta(): Promise<void> {
  if (servidor) return;
  if (!(await escutar())) await tentarAssumir();
}

// Encerra o servidor/watcher e limpa TODOS os intervalos (rescan, reassumir, limpeza). Usado nos testes.
export function pararUI(): void {
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  if (reassumir) { clearInterval(reassumir); reassumir = null; }
  if (limpeza) { clearInterval(limpeza); limpeza = null; }
  pararAgentes();
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  descarregarCanvas(); // grava ops pendentes do debounce antes de desligar
  for (const c of clientes) { try { c.res.end(); } catch {} }
  clientes.clear();
  fecharServidor(); // fecha conexoes abertas e guarda a promessa: o proximo escutar espera o socket liberar
  onCeder = null;
  sempreAssumir = false;
  pararNavegador(); // F4/S2: solta o driver do navegador e descarta a cache entre sessoes de teste
}
