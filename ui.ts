// Dashboard web local multi-sessao (http+SSE nativos; o app React/shadcn e' compilado em dist/web e
// servido estatico). Cada RUN (uma chamada de executar_orchestra) escreve seus eventos num JSONL
// proprio numa pasta compartilhada; QUEM pega a porta vira o "hub", le TODOS os arquivos e empurra
// pro browser. Varias sessoes do Claude aparecem juntas. Unica acao pela UI: cancelar uma run.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.HERMES_UI_PORT || "4123");
export const RUNS_DIR = path.join(os.tmpdir(), "hermes", "runs"); // barramento em disco, compartilhado entre processos
const SWARM_ID = randomUUID().slice(0, 8);                        // um id por processo/sessao
const PODA_MS = 7 * 24 * 3600 * 1000;                             // historico de 7 dias
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}

export type SlicePlano = { tarefa: string; arquivos_alvo: string[]; descricao: string };

export type Evento = { ts?: number } & (
  | { t: "run"; feature: string; cwd: string; total: number; plano?: SlicePlano[]; cmds?: string[]; gate?: string[] }
  | { t: "fase"; nome: string; info?: string }
  | { t: "slice"; idx: number; total: number; tarefa: string; status: "fila" | "rodando" | "ok" | "incompleta" | "pulada";
      escritos?: string[]; comandos?: string[]; motivo?: string; ms?: number; semMudancas?: boolean }
  | { t: "tool"; slice: number; nome: string; alvo?: string; ok: boolean; resumo?: string }
  | { t: "gerando"; slice: number; tokens: number }
  | { t: "comando"; slice: number; cmd: string; status: "rodando" }
  | { t: "gate"; cmd: string; status: "rodando" | "ok" | "falha"; tentativa?: number; saida?: string }
  | { t: "diff"; arquivo: string; patch: string }
  | { t: "painel"; status: string; branch: string; baseline?: string; linhas: string[] }
  | { t: "metrica"; slice: number; iteracoes: number; passouDePrimeira: boolean; tocouNoTeste: number; falhasAmbiente?: number; tokensIn: number; tokensOut: number; custoUSD: number; ms?: number }
  | { t: "log"; texto: string }
);

export type Emitir = (ev: Evento) => void;

// Run corrente deste processo: cada evento "run" abre um arquivo NOVO (nunca trunca o anterior).
let runId = "";
let runFile = "";
export function runAtual(): string { return runId; }
export function arquivoCancel(id: string): string { return path.join(RUNS_DIR, id + ".cancel"); }

// Unica porta de saida deste processo: grava o evento no JSONL da run corrente. Best-effort.
export function emitir(ev: Evento): void {
  try {
    if (ev.ts == null) ev.ts = Date.now();
    if (ev.t === "run" || !runFile) {
      runId = SWARM_ID + "-" + Date.now().toString(36);
      runFile = path.join(RUNS_DIR, runId + ".jsonl");
    }
    fs.appendFileSync(runFile, JSON.stringify(ev) + "\n");
  } catch {}
}

// Parse de um JSONL de run; linha corrompida e' ignorada. Pura (dado o texto).
function parse(txt: string): Evento[] {
  const evs: Evento[] = [];
  for (const l of txt.split("\n")) if (l) { try { evs.push(JSON.parse(l)); } catch {} }
  return evs;
}

// Le a pasta de runs e devolve os eventos agrupados por run (basename do arquivo). Testavel.
export function lerRuns(dir: string): Map<string, Evento[]> {
  const m = new Map<string, Evento[]>();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl")); } catch { return m; }
  for (const f of files) {
    try { m.set(f.slice(0, -6), parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {}
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
      if (ev.status === "ok") return `[T${ev.idx}] concluida: ${(ev.escritos ?? []).length} arq${ev.semMudancas ? " (sem mudancas)" : ""}${ev.comandos?.length ? ", " + ev.comandos.length + " cmd" : ""}`;
      if (ev.status === "pulada") return `[T${ev.idx}] PULADA: ${ev.motivo ?? ""}`;
      return `[T${ev.idx}] INCOMPLETA: ${ev.motivo ?? ""}`;
    case "tool": {
      const alvoTxt = ev.alvo ? " " + ev.alvo : "";
      return ev.ok ? `[T${ev.slice}] ${ev.nome}${alvoTxt} ok` : `[T${ev.slice}] REJEITADO ${ev.nome}${alvoTxt}: ${ev.resumo ?? ""}`;
    }
    case "gerando": return "";
    case "comando": return "";
    case "gate": {
      const marca = ev.status === "ok" ? "OK" : ev.status === "falha" ? "FALHA" : "rodando";
      return `GATE ${marca}: ${ev.cmd}${ev.tentativa ? " (reparo " + ev.tentativa + ")" : ""}`;
    }
    case "diff": return "";
    case "painel": return "";
    case "metrica": return `[T${ev.slice}] metrica: ${ev.iteracoes} iter, ${ev.passouDePrimeira ? "1a" : "reparo"}, teste:${ev.tocouNoTeste}, amb:${ev.falhasAmbiente ?? 0}, ${ev.tokensIn}+${ev.tokensOut} tok, $ ${ev.custoUSD.toFixed(4)}`;
    case "log": return ev.texto;
  }
}

// ---- hub: quem pega a porta serve o dashboard lendo TODOS os arquivos de run ----
type Cliente = { res: http.ServerResponse; offsets: Map<string, number> };
const clientes = new Set<Cliente>();
const estado = new Map<string, Evento[]>();
const vistos = new Map<string, string>(); // arquivo -> "size:mtime" (so rele o que mudou)
let servidor: http.Server | null = null;
let intervalo: NodeJS.Timeout | null = null;
let watcher: fs.FSWatcher | null = null;

function sse(c: Cliente, dado: unknown): void {
  try { c.res.write(`data: ${JSON.stringify(dado)}\n\n`); } catch {}
}

// Envia pro cliente so os eventos ainda nao enviados (deltas), por run.
function enviar(c: Cliente): void {
  for (const [run, evs] of estado) {
    const sent = c.offsets.get(run) || 0;
    for (let i = sent; i < evs.length; i++) sse(c, { swarm: run, ev: evs[i] });
    c.offsets.set(run, evs.length);
  }
}

// Rele so os arquivos que mudaram e empurra novidades/drops. Chamada por fs.watch e por um intervalo
// (o fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
function rescan(): void {
  let files: string[] = [];
  try { files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl")); } catch { return; }
  const drops: string[] = [];
  const presentes = new Set(files.map((f) => f.slice(0, -6)));
  for (const run of estado.keys()) if (!presentes.has(run)) drops.push(run);
  for (const f of files) {
    const run = f.slice(0, -6);
    try {
      const st = fs.statSync(path.join(RUNS_DIR, f));
      const marca = st.size + ":" + st.mtimeMs;
      if (vistos.get(f) === marca) continue;
      vistos.set(f, marca);
      const evs = parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
      if (evs.length < (estado.get(run)?.length ?? 0)) drops.push(run); // arquivo reescrito: reenvia do zero
      estado.set(run, evs);
    } catch {}
  }
  for (const run of drops) if (!presentes.has(run)) { estado.delete(run); vistos.delete(run + ".jsonl"); }
  for (const c of clientes) {
    for (const run of drops) { sse(c, { swarm: run, drop: true }); c.offsets.delete(run); }
    enviar(c);
  }
}

// Remove logs (e pedidos de cancelamento) mais velhos que PODA_MS.
function podar(): void {
  const limite = Date.now() - PODA_MS;
  try {
    for (const f of fs.readdirSync(RUNS_DIR)) {
      if (!f.endsWith(".jsonl") && !f.endsWith(".cancel")) continue;
      const p = path.join(RUNS_DIR, f);
      try { if (fs.statSync(p).mtimeMs < limite) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

// Versao da UI = mtime do index.html compilado: build mais novo vence no handoff da porta.
export function versaoUI(): number {
  try { return fs.statSync(path.join(WEB_DIR, "index.html")).mtimeMs; } catch { return 0; }
}

const TIPOS: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".map": "application/json",
};

function servirEstatico(url: string, res: http.ServerResponse): void {
  let rel = "index.html";
  try { rel = decodeURIComponent(url.split("?")[0]).replace(/^\/+/, "") || "index.html"; } catch {}
  let alvo = path.resolve(WEB_DIR, rel);
  if (alvo !== WEB_DIR && !alvo.startsWith(WEB_DIR + path.sep)) { res.writeHead(403); res.end(); return; }
  if (!fs.existsSync(alvo) || fs.statSync(alvo).isDirectory()) alvo = path.join(WEB_DIR, "index.html"); // SPA
  fs.readFile(alvo, (err, buf) => {
    if (err) { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }); res.end("UI nao compilada: rode npm run build no hermes-bridge"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(alvo)] || "application/octet-stream" });
    res.end(buf);
  });
}

// Acoes so via POST com header X-Hermes: header custom forca preflight CORS, que este servidor nao
// responde -> site externo aberto no browser nao consegue cancelar run nem derrubar o hub.
function acaoValida(req: http.IncomingMessage): boolean {
  return req.method === "POST" && req.headers["x-hermes"] === "1";
}

// Libera a porta (pedido de um processo com UI mais nova).
function ceder(): void {
  for (const c of clientes) { try { c.res.end(); } catch {} }
  clientes.clear();
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  servidor?.close();
  servidor = null;
}

function criarServidor(): http.Server {
  return http.createServer((req, res) => {
    const url = req.url || "/";
    if (url === "/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(": conectado\n\n");
      const c: Cliente = { res, offsets: new Map() };
      clientes.add(c);
      enviar(c); // replay do estado atual (todas as runs) pra quem acabou de conectar
      req.on("close", () => clientes.delete(c));
      return;
    }
    if (url === "/versao") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ versao: versaoUI() }));
      return;
    }
    if (url.startsWith("/cancel")) {
      const id = new URL(url, "http://x").searchParams.get("run") || "";
      if (!acaoValida(req) || !/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return; }
      try { fs.writeFileSync(arquivoCancel(id), String(Date.now())); res.writeHead(204); }
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
    servirEstatico(url, res);
  });
}

// Em EADDRINUSE: se o hub atual tem UI mais velha (e fala /versao), pede pra ele ceder e assume.
// Hub de versao antiga (sem /versao) nao entende o pedido -> esta sessao so escreve seu JSONL.
async function tentarAssumir(): Promise<void> {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/versao`, { signal: AbortSignal.timeout(1500) });
    const j: any = await r.json();
    if (!(typeof j?.versao === "number" && j.versao < versaoUI())) return;
    await fetch(`http://127.0.0.1:${PORT}/ceder`, { method: "POST", headers: { "X-Hermes": "1" }, signal: AbortSignal.timeout(1500) });
  } catch { return; }
  for (let i = 0; i < 3; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    if (await escutar()) return;
  }
}

function escutar(): Promise<boolean> {
  return new Promise((ok) => {
    const srv = criarServidor();
    srv.once("error", () => ok(false));
    srv.once("listening", () => {
      servidor = srv;
      process.stderr.write(`[hermes-bridge] dashboard: http://127.0.0.1:${PORT}\n`);
      podar();
      rescan();
      try { watcher = fs.watch(RUNS_DIR, () => rescan()); } catch {}
      intervalo = setInterval(rescan, 1000);
      intervalo.unref();
      ok(true);
    });
    srv.listen(PORT, "127.0.0.1");
  });
}

// Sobe o dashboard uma vez, no connect do MCP. Porta ocupada = outro processo ja hospeda (e le nosso
// arquivo), a nao ser que a nossa UI seja mais nova. Nunca derruba a run.
export async function iniciarUI(): Promise<void> {
  if (servidor) return;
  if (!(await escutar())) await tentarAssumir();
  // Se o hub sumir (sessao fechou ou cedeu pra outro que depois saiu), quem estiver vivo reassume a porta.
  setInterval(() => { if (!servidor) void escutar(); }, 10_000).unref();
}
