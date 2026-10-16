// Dashboard web local multi-sessao (http+SSE nativos; o app React/shadcn e' compilado em dist/web e
// servido estatico). Cada RUN (uma chamada de executar_orchestra) escreve seus eventos num JSONL
// proprio numa pasta compartilhada; QUEM pega a porta vira o "hub", le TODOS os arquivos e empurra
// pro browser. Varias sessoes do Claude aparecem juntas. Unica acao pela UI: cancelar uma run.
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { aplicarOps, idProjeto, mesclarProjetos, validarAsset, validarOps, type Aresta, type No, type Op, type Projeto, type Snapshot } from "./canvas.js";
import { urlPermitida, formatarLeitura, resolverElemento, nomeShot } from "./navegador.js";
import type { Elemento, Leitura } from "./navegador.js";
import { randomBytes } from "node:crypto";
import {
  conectados, resolverAlvo, slugNome, Conversas, FilaEntregas,
  fmtPergunta, fmtResposta, fmtMensagem, fmtSemResposta, linhaIdentidade,
  opsFlowAdd, opsFlowLink, opsFile, opsNote, validarCaminho,
  type AgenteRef,
} from "./colaboracao.js";
import {
  PAPEIS, validarAgente, agenteDePlanejador, normalizarEvento, historicoParaLinhas,
  aplicarLinhas, separarModelo, itensDeContexto, planoArquivos, diffContexto, FilaAvisos,
  type Agente, type AssinaturaArquivo, type Linha, type OrigemAgente, type Papel, type ParteRegistrada,
} from "./agentes.js";
// Agentes Claude Code via PTY (F4/S3): logica pura importada AQUI (os modulos puros nao importam em runtime).
import { argsClaude, settingsHooks, textoParaPty } from "./claude-pty.js";
// Acoes da run no card (G1/S2): merge local, abrir PR e descartar (modulo puro rodado no mesmo processo).
import { mergeLocal, descartarRun, abrirPr, type ResultadoAcao } from "./acoes-run.js";
// G3: caixa de instrucoes e pausa por slice (arquivos no RUNS_DIR, mesmo padrao do <runId>.cancel).
import { validarAcaoSlice, validarTexto, gravarInstrucao, pausarSlice, retomarSlice } from "./instrucoes.js";

const PORT = Number(process.env.HERMES_UI_PORT || "4123");
// Dados do hub fora do TEMP (o Windows limpa %TEMP%): tudo vive em ~/.dev-orchestra/dados.
const DADOS_DIR = path.join(os.homedir(), ".dev-orchestra", "dados");
export const RUNS_DIR = process.env.HERMES_RUNS_DIR || path.join(DADOS_DIR, "runs"); // barramento em disco, compartilhado entre processos
// Registros dos planejadores: um JSON por worktree com o chat do planejador.
export const PLANEJADORES_DIR = process.env.HERMES_PLANEJADORES_DIR || path.join(DADOS_DIR, "planejadores");
// Canvas (S2): um subdiretorio por projeto (idProjeto) com canvas.json + assets/. Injetavel por env.
export const CANVAS_DIR = process.env.HERMES_CANVAS_DIR || path.join(DADOS_DIR, "canvas");
// Agentes (F2/S3): um JSON por agente do canvas (validado por validarAgente). Injetavel por env.
export const AGENTES_DIR = process.env.HERMES_AGENTES_DIR || path.join(DADOS_DIR, "agentes");
const SWARM_ID = randomUUID().slice(0, 8);                        // um id por processo/sessao
const PODA_MS = 7 * 24 * 3600 * 1000;                             // historico de 7 dias
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

// Copia o antigo pro novo uma vez so': nunca toca num destino que ja existe.
export function migrarDadosAntigos(antigo: string, novo: string): boolean {
  try {
    if (!fs.existsSync(antigo) || fs.existsSync(novo)) return false;
    fs.cpSync(antigo, novo, { recursive: true });
    return true;
  } catch { return false; }
}

// Antes do primeiro mkdirSync, e so' sem env de pasta: puxa o local antigo (<tmp>/hermes).
const PASTAS_PADRAO = !process.env.HERMES_RUNS_DIR && !process.env.HERMES_PLANEJADORES_DIR
  && !process.env.HERMES_CANVAS_DIR && !process.env.HERMES_AGENTES_DIR;
if (PASTAS_PADRAO) {
  try { migrarDadosAntigos(path.join(os.tmpdir(), "hermes"), DADOS_DIR); } catch {}
}

try { fs.mkdirSync(RUNS_DIR, { recursive: true }); } catch {}

export type SlicePlano = { tarefa: string; arquivos_alvo: string[]; descricao: string };

// Registro de um planejador: o worktree onde o OpenCode roda e a URL do chat.
export type Planejador = {
  slug: string; projeto: string; raiz: string; cwd: string;
  feature: string; url: string; base: string; pid: number; ts: number;
};

export type Evento = { ts?: number } & (
  | { t: "run"; feature: string; cwd: string; total: number; plano?: SlicePlano[]; cmds?: string[]; gate?: string[] }
  | { t: "fase"; nome: string; info?: string }
  | { t: "slice"; idx: number; total: number; tarefa: string; status: "fila" | "rodando" | "ok" | "incompleta" | "pulada";
      escritos?: string[]; comandos?: string[]; motivo?: string; ms?: number; semMudancas?: boolean }
  | { t: "tool"; slice: number; nome: string; alvo?: string; ok: boolean; resumo?: string; saida?: string }
  | { t: "gerando"; slice: number; tokens: number }
  | { t: "comando"; slice: number; cmd: string; status: "rodando" }
  | { t: "gate"; cmd: string; status: "rodando" | "ok" | "falha"; tentativa?: number; saida?: string }
  | { t: "diff"; arquivo: string; patch: string }
  | { t: "painel"; status: string; branch: string; baseline?: string; base?: string; linhas: string[] }
  | { t: "metrica"; slice: number; iteracoes: number; passouDePrimeira: boolean; tocouNoTeste: number; falhasAmbiente?: number; tokensIn: number; tokensOut: number; custoUSD: number; ms?: number }
  | { t: "instrucao"; slice: number; texto: string; descartada?: boolean }
  | { t: "pausa"; slice: number; estado: "pausada" | "retomada"; motivo?: string }
  | { t: "log"; texto: string }
);

export type Emitir = (ev: Evento) => void;

// S3: como abrir o dashboard — o app Hermes instalado vence; senao o navegador do sistema. Pura.
export function comoAbrirDashboard(exe: string | null, url: string, plataforma: NodeJS.Platform): { comando: string; args: string[] } {
  if (exe) return { comando: exe, args: [] };
  if (plataforma === "win32") return { comando: "cmd", args: ["/c", "start", "", url] };
  if (plataforma === "darwin") return { comando: "open", args: [url] };
  return { comando: "xdg-open", args: [url] };
}

// Run corrente deste processo: cada evento "run" abre um arquivo NOVO (nunca trunca o anterior).
// O sufixo sequencial garante ids distintos mesmo se duas runs abrirem no MESMO milissegundo.
let runId = "";
let runFile = "";
let seq = 0;
export function runAtual(): string { return runId; }
export function arquivoCancel(id: string): string { return path.join(RUNS_DIR, id + ".cancel"); }

// Unica porta de saida deste processo: grava o evento no JSONL da run corrente. Best-effort.
export function emitir(ev: Evento): void {
  try {
    if (ev.ts == null) ev.ts = Date.now();
    if (ev.t === "run" || !runFile) {
      runId = SWARM_ID + "-" + Date.now().toString(36) + "-" + (seq++).toString(36);
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

// Arquivos que viram RUN: JSONL do RUNS_DIR, MENOS os <runId>.instrucao.jsonl (caixa de instrucoes
// da slice, mesmo padrao do <runId>.cancel): sem isso cada pedido de instrucao viraria run fantasma.
// A poda (podar()) continua vendo os .jsonl em geral, entao tambem limpa os de instrucao.
function ehJsonlDeRun(f: string): boolean {
  return f.endsWith(".jsonl") && !f.endsWith(".instrucao.jsonl");
}

// Le a pasta de runs e devolve os eventos agrupados por run (basename do arquivo). Testavel.
export function lerRuns(dir: string): Map<string, Evento[]> {
  const m = new Map<string, Evento[]>();
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter(ehJsonlDeRun); } catch { return m; }
  for (const f of files) {
    try { m.set(f.slice(0, -6), parse(fs.readFileSync(path.join(dir, f), "utf8"))); } catch {}
  }
  return m;
}

// ---- registros de planejadores ----
// Valida/estrutura um registro cru; null se faltar campo obrigatorio (JSON incompleto e' descartado).
function planejadorDe(j: any): Planejador | null {
  if (!j || typeof j !== "object") return null;
  for (const k of ["slug", "projeto", "raiz", "cwd", "feature", "url", "base"]) if (typeof j[k] !== "string" || !j[k]) return null;
  if (typeof j.pid !== "number" || !j.pid) return null;
  if (typeof j.ts !== "number") return null;
  return {
    slug: j.slug, projeto: j.projeto, raiz: j.raiz, cwd: j.cwd,
    feature: j.feature, url: j.url, base: j.base, pid: j.pid, ts: j.ts,
  };
}

// Le a pasta de registros. Tolerante: JSON corrompido/sem campos obrigatorios e' ignorado; pasta
// inexistente vira []. Sincrona (usada no replay do SSE e no rescan do intervalo).
export function lerPlanejadores(dir: string): Planejador[] {
  const out: Planejador[] = [];
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return out; }
  for (const f of files) {
    try {
      const p = planejadorDe(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
      if (p) out.push(p);
    } catch {}
  }
  return out;
}

export type DepsLimpeza = {
  existeCwd: (cwd: string) => boolean;
  vivo: (pid: number) => boolean;
  ehOpencode: (pid: number) => Promise<boolean>;
  matar: (pid: number) => void;
  remover: (arquivo: string) => void;
};

// Worktree que o registro descreve (<raiz>/.claude/worktrees/<slug>).
function worktreeDe(p: Planejador): string {
  return path.join(p.raiz, ".claude", "worktrees", p.slug);
}

// process.kill(pid, 0): sem erro = vivo; EPERM (processo de outro usuario) tambem conta como vivo.
function vivoReal(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (e: any) { return e?.code === "EPERM"; }
}

// tasklist com filtro de PID: imagem do processo contem 'opencode'? Falha do tasklist -> false (conservador).
function ehOpencodeReal(pid: number): Promise<boolean> {
  return new Promise((ok) => {
    try {
      const saida = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", timeout: 4000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
      ok(/opencode/i.test(saida));
    } catch { ok(false); }
  });
}

const depsReais: DepsLimpeza = {
  existeCwd: (cwd) => { try { return fs.existsSync(cwd); } catch { return true; } },
  vivo: vivoReal,
  ehOpencode: ehOpencodeReal,
  matar: (pid) => { try { process.kill(pid); } catch {} },
  remover: (arq) => { try { fs.unlinkSync(arq); } catch {} },
};

// Limpa registros de planejadores que nao servem mais:
//   pid morto -> so' remove o JSON (nao ha o que matar);
//   worktree sumiu + pid vivo + opencode -> mata o orfao e remove;
//   worktree sumiu + pid vivo + NAO opencode -> pid reutilizado: so' remove (nunca mata alheio);
//   worktree existe + pid vivo -> mantem.
export async function limparPlanejadores(dir: string, deps: DepsLimpeza = depsReais): Promise<void> {
  let arquivos: string[] = [];
  try { arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of arquivos) {
    const arq = path.join(dir, f);
    let p: Planejador | null = null;
    try { p = planejadorDe(JSON.parse(fs.readFileSync(arq, "utf8"))); } catch {}
    if (!p) continue;
    if (!deps.vivo(p.pid)) { deps.remover(arq); continue; }
    if (deps.existeCwd(worktreeDe(p))) continue;
    if (await deps.ehOpencode(p.pid)) deps.matar(p.pid);
    deps.remover(arq);
  }
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
    case "instrucao": return `[T${ev.slice}] instrucao: ${ev.texto}${ev.descartada ? " (descartada)" : ""}`;
    case "pausa": return `[T${ev.slice}] pausa ${ev.estado}${ev.motivo ? ": " + ev.motivo : ""}`;
    case "log": return ev.texto;
  }
}

// ---- hub: quem pega a porta serve o dashboard lendo TODOS os arquivos de run ----
type Cliente = { res: http.ServerResponse; offsets: Map<string, number> };
const clientes = new Set<Cliente>();
const estado = new Map<string, Evento[]>();
const vistos = new Map<string, string>(); // arquivo -> "size:mtime" (so rele o que mudou)
let servidor: http.Server | null = null;
// Promessa do fechamento do ultimo servidor: o proximo escutar() espera o socket ser liberado de fato
// (sem isso, um iniciarUI imediatamente apos pararUI liga numa porta ainda presa pelo socket antigo).
let servidorFechando: Promise<void> | null = null;
let intervalo: NodeJS.Timeout | null = null;
let watcher: fs.FSWatcher | null = null;
let limpeza: NodeJS.Timeout | null = null;   // poda os registros de planejadores orfaos
let reassumir: NodeJS.Timeout | null = null; // quem ficou sem porta tenta de novo
let planejadores: Planejador[] = [];         // ultima lista empurrada via SSE
let planejadoresAssinatura = "";             // muda -> avisa os clientes
let onCeder: (() => void) | null = null;     // chamado no fim do ceder() (modo --ui encerra o processo)
let sempreAssumir = false;                   // modo --ui: assume a porta de QUALQUER hub Hermes (sem comparar versao)

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

// Rele os registros de planejadores; se a lista mudou, empurra pra quem esta conectado. Chamada no
// rescan (intervalo + fs.watch); o replay do novo cliente usa `planejadores` direto.
function atualizarPlanejadores(): void {
  const lista = lerPlanejadores(PLANEJADORES_DIR);
  const assinatura = JSON.stringify(lista);
  if (assinatura === planejadoresAssinatura) return;
  planejadoresAssinatura = assinatura;
  planejadores = lista;
  for (const c of clientes) sse(c, { planejadores: lista });
  for (const p of lista) void garantirTokenPlanejador(p); // F3/S2: identidade do planejador (uma vez)
  void reconectarPontes(); // a lista mudou: reabre as pontes das bases dos planejadores (F2.2)
}

// Rele so os arquivos que mudaram e empurra novidades/drops. Chamada por fs.watch e por um intervalo
// (o fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
function rescan(): void {
  atualizarPlanejadores();
  let files: string[] = [];
  try { files = fs.readdirSync(RUNS_DIR).filter(ehJsonlDeRun); } catch { return; }
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
      if (!f.endsWith(".jsonl") && !f.endsWith(".cancel") && !f.endsWith(".pausa")) continue;
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
    if (err) { res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" }); res.end("UI nao compilada: rode npm run build no dev-orchestra"); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(alvo)] || "application/octet-stream" });
    res.end(buf);
  });
}

// Acoes so via POST com header X-Hermes: header custom forca preflight CORS, que este servidor nao
// responde -> site externo aberto no browser nao consegue cancelar run nem derrubar o hub.
function acaoValida(req: http.IncomingMessage): boolean {
  return req.method === "POST" && req.headers["x-hermes"] === "1";
}

function broadcast(dado: unknown): void { for (const c of clientes) sse(c, dado); }

// Barra DNS rebinding: dominio alheio que resolve pra 127.0.0.1 chega com o Host dele (e o X-Hermes).
export function hostLocal(cabecalho: string | string[] | undefined, porta: number): boolean {
  const h = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (typeof h !== "string") return false;
  const alvo = h.toLowerCase();
  return alvo === "127.0.0.1:" + porta || alvo === "localhost:" + porta;
}

// ---- canvas (S2): grafo por projeto, persistido em <CANVAS_DIR>/<idProjeto>/canvas.json ----
const LIMITE_BODY_CANVAS = 2 * 1024 * 1024;        // 2MB: lotes de ops
const LIMITE_BODY_CANVAS_ASSET = 40 * 1024 * 1024; // 40MB: imagem em base64 (infla ~33%)
const CANVAS_DEBOUNCE_MS = 300;                    // gravacao em disco com debounce

const canvasCache = new Map<string, Snapshot>();       // idProjeto -> snapshot em memoria
const canvasTimers = new Map<string, NodeJS.Timeout>(); // idProjeto -> gravacao pendente

// Content-type das imagens servidas em GET /canvas/asset (so' imagem entra no canvas).
const TIPOS_IMG: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon",
};

function arquivoCanvas(id: string): string { return path.join(CANVAS_DIR, id, "canvas.json"); }

// Cache por projeto: no primeiro acesso (ou apos restart) le do disco; projeto novo = vazio.
function lerCanvas(id: string): Snapshot {
  const emCache = canvasCache.get(id);
  if (emCache) return emCache;
  let s: Snapshot = { nos: [], arestas: [] };
  try {
    const j = JSON.parse(fs.readFileSync(arquivoCanvas(id), "utf8"));
    if (j && Array.isArray(j.nos) && Array.isArray(j.arestas)) s = { nos: j.nos, arestas: j.arestas };
  } catch {}
  canvasCache.set(id, s);
  return s;
}

function gravarCanvasAgora(id: string): void {
  const s = canvasCache.get(id);
  if (!s) return;
  try {
    fs.mkdirSync(path.join(CANVAS_DIR, id), { recursive: true });
    fs.writeFileSync(arquivoCanvas(id), JSON.stringify(s));
  } catch {}
}

// Debounce ~300ms: rajadas de ops (arrastar varios nos) viram UMA gravacao.
function gravarCanvasDebounced(id: string): void {
  const t = canvasTimers.get(id);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => { canvasTimers.delete(id); gravarCanvasAgora(id); }, CANVAS_DEBOUNCE_MS);
  timer.unref?.();
  canvasTimers.set(id, timer);
}

// Grava o que estiver pendente (chamado no pararUI pra nao perder ops na janela do debounce).
function descarregarCanvas(): void {
  for (const [id, t] of canvasTimers) { clearTimeout(t); gravarCanvasAgora(id); }
  canvasTimers.clear();
}

// Raizes descobertas: cwd das runs EM MEMORIA + raiz dos planejadores.
function raizesDescobertas(): string[] {
  const out: string[] = [];
  for (const evs of estado.values()) for (const ev of evs) if (ev.t === "run" && ev.cwd) out.push(ev.cwd);
  for (const p of planejadores) out.push(p.raiz);
  return out;
}

function lerProjetosSalvos(): Projeto[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(CANVAS_DIR, "projetos.json"), "utf8"));
    if (!Array.isArray(j)) return [];
    return j
      .filter((p: any) => p && typeof p.raiz === "string" && typeof p.nome === "string")
      .map((p: any) => (typeof p.cor === "string" ? { raiz: p.raiz, nome: p.nome, cor: p.cor } : { raiz: p.raiz, nome: p.nome }));
  } catch { return []; }
}

function gravarProjetosSalvos(salvos: Projeto[]): void {
  try {
    fs.mkdirSync(CANVAS_DIR, { recursive: true });
    fs.writeFileSync(path.join(CANVAS_DIR, "projetos.json"), JSON.stringify(salvos));
  } catch {}
}

function nomeBase(raiz: string): string {
  const base = raiz.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  return base || raiz;
}

// Upsert por idProjeto: mesma raiz (grafias diferentes) nao duplica; campo ausente preserva o salvo.
function salvarProjeto(raiz: string, nome?: unknown, cor?: unknown): void {
  const id = idProjeto(raiz);
  const salvos = lerProjetosSalvos();
  const i = salvos.findIndex((p) => idProjeto(p.raiz) === id);
  const atual = i >= 0 ? salvos[i] : undefined;
  const nomeLimpo = typeof nome === "string" ? nome.trim() : "";
  const novo: Projeto = { raiz: atual?.raiz ?? raiz, nome: nomeLimpo || atual?.nome || nomeBase(raiz) };
  const corLimpa = typeof cor === "string" ? cor.trim() : "";
  if (corLimpa) novo.cor = corLimpa;
  else if (atual?.cor !== undefined) novo.cor = atual.cor;
  if (i >= 0) salvos[i] = novo; else salvos.push(novo);
  gravarProjetosSalvos(salvos);
}

// Le o corpo de um POST com teto de bytes; null = estourou o limite (o chamador responde 400).
// Acumula os Buffers crus e so' decodifica UTF-8 no fim: um acento partido entre dois chunks chega
// integro (decodificar chunk a chunk trocaria o par de bytes por U+FFFD). O limite e' contado em BYTES,
// pela soma dos tamanhos dos chunks.
function lerCorpo(req: http.IncomingMessage, limite: number): Promise<string | null> {
  return new Promise((ok) => {
    const partes: Buffer[] = [];
    let total = 0;
    let cortou = false;
    req.on("data", (d: Buffer) => {
      if (cortou) return;
      partes.push(d);
      total += d.length;
      if (total > limite) { cortou = true; ok(null); }
    });
    req.on("end", () => { if (!cortou) ok(Buffer.concat(partes).toString("utf8")); });
    req.on("error", () => { if (!cortou) { cortou = true; ok(null); } });
  });
}

// GET /canvas/asset/<idProjeto>/<arquivo>: so' imagem, id hex, recusa traversal e inexistente -> 404.
function servirCanvasAsset(caminho: string, res: http.ServerResponse): void {
  const resto = caminho.slice("/canvas/asset/".length);
  const barra = resto.indexOf("/");
  if (barra < 0) { res.writeHead(404); res.end(); return; }
  let id = resto.slice(0, barra);
  let arquivo = resto.slice(barra + 1);
  try { id = decodeURIComponent(id); arquivo = decodeURIComponent(arquivo); } catch { res.writeHead(400); res.end(); return; }
  if (!/^[0-9a-f]+$/i.test(id)) { res.writeHead(400); res.end(); return; }
  if (!arquivo || /[\\/]/.test(arquivo) || arquivo.includes("..")) { res.writeHead(400); res.end(); return; }
  const alvo = path.join(CANVAS_DIR, id, "assets", arquivo);
  fs.readFile(alvo, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    // sandbox: SVG aberto direto nao roda script na origem do hub.
    res.writeHead(200, {
      "Content-Type": TIPOS_IMG[path.extname(arquivo).toLowerCase()] || "application/octet-stream",
      "Content-Security-Policy": "sandbox",
    });
    res.end(buf);
  });
}

// Agentes (F2/S3, CA-4a/4c/5/9): registros em disco, ponte do /event do OpenCode,
// rotas /agentes e sincronizacao do contexto do canvas.

// Registro em disco de um agente: o Agente do modelo + campos de runtime (erro do ultimo start,
// pid do serve e status explicito marcado pelo reiniciar, que destaca o serve como saudavel).
type RegistroAgente = Agente & { erro?: string; pid?: number; status?: string; token?: string };

const agentes = new Map<string, RegistroAgente>();             // id -> registro
const serves = new Map<string, { base: string; pid: number }>(); // cwd -> serve do OpenCode (reaproveitado)
const agenteLinhas = new Map<string, Linha[]>();               // id -> transcricao (linhas do chat)
const pontes = new Map<string, AbortController>();             // base -> ponte do /event
const basesMortas = new Set<string>();                         // base -> serve inacessivel (status 'encerrado')
let reconectando = false;                                     // serializa o reconectar das pontes (sem sobrepor)
const ctxAssinaturas = new Map<string, AssinaturaArquivo[]>(); // id -> assinaturas do contexto em disco
const fila = new FilaAvisos();
let agentesCarregados = false;

// ---- agentes Claude Code via PTY (F4/S3) ----
// Driver de PTY injetado pelo app desktop (electron). Sem ele, POST /agentes tipo 'claude' responde
// 'falhou' com "abra o app Hermes para usar agentes Claude". O hub nunca abre PTY por conta propria.
type PtyProc = {
  pid: number;
  write(d: string): void;
  kill(): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (c: number) => void): void;
  resize?(cols: number, rows: number): void;
};
export type PtyDriver = {
  spawn(opts: { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }): PtyProc;
};
let ptyAtual: PtyDriver | undefined;
const ptyProcs = new Map<string, PtyProc>();   // id -> processo do `claude`
const ptyBuffers = new Map<string, string>();  // id -> ultimas ~200KB de saida do PTY (GET /agentes/:id/pty)
const aguardandoSet = new Set<string>();       // ids aguardando permissao (aguardando = ocupado na fila)
const tamanhoPty = new Map<string, { cols: number; rows: number }>(); // id -> ultimo tamanho do xterm do card (reusado no retomar)
const LIMITE_BUFFER_PTY = 200 * 1024;          // ~200KB de buffer por agente

let subirServeAtual: (cwd: string, env?: Record<string, string | undefined>) => Promise<{ base: string; pid: number }> = subirServeReal;
let matarProcessoAtual: (pid: number) => void = (pid) => { try { process.kill(pid); } catch {} };

// ---- colaboracao entre agentes (F3/S2): identidade por token, conversas e fila de entregas ----
const conversas = new Conversas();
const filaEntregas = new FilaEntregas<string>();
const tokensPlanejadores = new Map<string, string>();  // "plan-<slug>" -> token
let expiracao: NodeJS.Timeout | null = null;           // varre as conversas pendentes a cada 60s

// Referencia de um agente para as rotas /cli (id + nome + contexto de entrega + token).
type Colab = { id: string; nome: string; projeto: string; cwd: string; base: string; sessao: string; token: string };

function novoToken(): string { return randomBytes(24).toString("hex"); } // 48 chars (>=16)

// Porta livre escolhida pelo SO (mesma ideia de um TcpListener na porta 0).
function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

// Caminho do exe do OpenCode (exe direto, nao o shim .cmd/.ps1).
function caminhoOpencode(): string {
  try {
    const cmd = process.platform === "win32" ? "where opencode" : "which opencode";
    const linhas = execSync(cmd, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const l of linhas) if (/\.exe$/i.test(l)) return l;
    for (const l of linhas) {
      const exe = path.join(path.dirname(l), "node_modules", "opencode-ai", "bin", "opencode.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return "opencode";
}

// PATH do serve: bin/ (CLI `canvas`) e a pasta do node na frente. No Windows a chave pode vir como 'Path'.
function envServe(): NodeJS.ProcessEnv {
  const bin = path.join(RAIZ_BRIDGE, "bin");
  const env: NodeJS.ProcessEnv = { ...process.env };
  const atual = env.PATH ?? env.Path ?? "";
  delete env.Path;
  env.PATH = bin + path.delimiter + path.dirname(process.execPath) + path.delimiter + atual;
  return env;
}

// Env do `claude` no PTY: o do serve (bin/ no PATH, onde fica o `canvas`) sem as variaveis de uma sessao
// Claude Code/desktop que abriu o app (ANTHROPIC_BASE_URL, CLAUDE_CODE_*...): com elas o claude cobra
// pela API em vez de usar o login da conta. CLAUDE_CONFIG_DIR fica (escolha do usuario).
export function envClaude(base: NodeJS.ProcessEnv = envServe()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$)/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

// Sobe `opencode serve --port <livre>` na cwd e espera o /doc responder.
async function subirServeReal(cwd: string, env?: Record<string, string | undefined>): Promise<{ base: string; pid: number }> {
  const porta = await portaLivre();
  // detached + unref: o serve vira processo independente (novo grupo no Windows) e SOBREVIVE ao hub
  // de um Start-Process). Sem isso ele e' filho do processo do hub e
  // morre junto quando o hub reinicia ou cede a porta, deixando o agente 'encerrado' para sempre.
  const p = spawn(caminhoOpencode(), ["serve", "--port", String(porta)], { cwd, windowsHide: true, stdio: "ignore", env: env ?? process.env, detached: true });
  p.unref();
  let falha: Error | null = null;
  p.once("error", (e) => { falha = e; }); // cwd inexistente/opencode ausente: sem isso o hub inteiro cai
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    if (falha) throw new Error("não foi possível iniciar o OpenCode: " + (falha as Error).message);
    try { const r = await fetch(base + "/doc", { signal: AbortSignal.timeout(2000) }); if (r.ok) return { base, pid: p.pid ?? 0 }; } catch {}
  }
  try { if (p.pid) process.kill(p.pid); } catch {}
  throw new Error("o servidor do OpenCode nao subiu na porta " + porta);
}

function arquivoAgente(id: string): string { return path.join(AGENTES_DIR, id + ".json"); }

// Le (uma vez) os registros do disco. JSON corrompido/invalido e' ignorado; pasta inexistente vira vazio.
function carregarAgentes(): void {
  if (agentesCarregados) return;
  agentesCarregados = true;
  let files: string[] = [];
  try { files = fs.readdirSync(AGENTES_DIR).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    try {
      const a = validarAgente(JSON.parse(fs.readFileSync(path.join(AGENTES_DIR, f), "utf8"))) as RegistroAgente | null;
      if (!a) continue; // nao e' um agente do canvas (ex.: registro {id,token} de planejador): ignora
      if (!a.token) { a.token = novoToken(); gravarAgente(a); } // agente antigo sem token ganha um ao carregar
      else agentes.set(a.id, a);
      // Agente Claude nao sobrevive ao restart do hub (PTY morre junto): entra como 'encerrado'.
      if (a.tipo === "claude") a.status = "encerrado";
    } catch {}
  }
}

function gravarAgente(a: RegistroAgente): void {
  agentes.set(a.id, a);
  try { fs.mkdirSync(AGENTES_DIR, { recursive: true }); fs.writeFileSync(arquivoAgente(a.id), JSON.stringify(a)); } catch {}
}

function removerAgenteDoDisco(id: string): void {
  agentes.delete(id);
  agenteLinhas.delete(id);
  fila.estados.delete(id);
  try { fs.unlinkSync(arquivoAgente(id)); } catch {}
}

// status de um agente: 'falhou' quando o serve/sessao nao subiu; 'encerrado' quando a base nao
// responde mais (serve morto); senao ocupado/ocioso pela fila de avisos.
function statusDe(id: string, base = ""): string {
  const a = agentes.get(id);
  const b = base || a?.base || "";
  if (b && basesMortas.has(b)) return "encerrado";
  if (!a) return "ocioso";
  if (a.erro) return "falhou";
  if (fila.estados.get(id)?.ocupado) return "ocupado";
  // Agente reiniciado com sucesso grava status 'ok' (serve/sessao novos); os demais ficam 'ocioso'.
  return a.status ?? "ocioso";
}

type ResumoAgente = { id: string; nome: string; papel: string; modelo: string; cwd: string; origem: string; tipo: string; status: string; ocupado: boolean; aguardando: boolean };

function resumoAgente(a: Agente): ResumoAgente {
  return {
    id: a.id, nome: a.nome, papel: a.papel, modelo: a.modelo, cwd: a.cwd, origem: a.origem, tipo: a.tipo,
    status: statusDe(a.id, a.base), ocupado: fila.estados.get(a.id)?.ocupado === true, aguardando: aguardandoSet.has(a.id),
  };
}

// Agentes do canvas daquele projeto + os derivados dos planejadores (agenteDePlanejador).
function listarAgentes(projeto: string): ResumoAgente[] {
  const out: ResumoAgente[] = [];
  // Inclui tambem agentes cujo cwd casa com o projeto consultado (G2: o planejador Claude roda no
  // worktree, entao aparece em /agentes?projeto=<worktree> mesmo tendo projeto = raiz do pedido).
  for (const a of agentes.values()) if (a.projeto === projeto || a.cwd === projeto) out.push(resumoAgente(a));
  for (const p of planejadores) {
    if (p.projeto !== projeto && idProjeto(p.raiz) !== idProjeto(projeto)) continue;
    out.push(resumoAgente(agenteDePlanejador(p)));
  }
  return out;
}

function serveDoCwd(cwd: string): { base: string; pid: number } | undefined {
  const s = serves.get(cwd);
  if (s) return s;
  for (const a of agentes.values()) if (a.cwd === cwd && a.base) return { base: a.base, pid: 0 };
  return undefined;
}

// Base do OpenCode usada pra listar os modelos (GET /agentes/modelos): a do cwd pedido; sem serve
// naquela pasta, cai no primeiro serve conhecido (serves.values()) ou na base de um planejador do
// orchestra-go — a lista de providers do OpenCode e' da CONTA, nao da pasta. Sem nenhum -> "" (-> []).
function baseParaModelos(cwd: string): string {
  const s = cwd ? serveDoCwd(cwd) : undefined;
  if (s) return s.base;
  for (const x of serves.values()) if (x.base) return x.base;
  for (const p of planejadores) if (p.base) return p.base;
  return "";
}

// ['provider/modelo', ...] a partir de GET {base}/config/providers.
async function listarModelos(base: string): Promise<string[]> {
  try {
    const r = await fetch(base + "/config/providers");
    if (!r.ok) return [];
    const j: any = await r.json();
    const out: string[] = [];
    if (Array.isArray(j?.providers)) {
      for (const p of j.providers) {
        if (!p || typeof p.id !== "string" || !p.models || typeof p.models !== "object") continue;
        for (const m of Object.keys(p.models)) out.push(p.id + "/" + m);
      }
    }
    return out;
  } catch { return []; }
}

// ---- ponte do /event (uma por base): le o stream SSE e empurra linhas/status pros clientes ----
function abrirPonte(base: string): void {
  if (!base || pontes.has(base)) return;
  const ctrl = new AbortController();
  pontes.set(base, ctrl);
  void loopPonte(base, ctrl);
}

async function loopPonte(base: string, ctrl: AbortController): Promise<void> {
  const papeis = new Map<string, string>();
  const partes = new Map<string, ParteRegistrada>(); // por ponte (por base): acumula os deltas de texto
  while (!ctrl.signal.aborted) {
    try {
      const r = await fetch(base + "/event", { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
      if (!r.ok || !r.body) throw new Error("evento indisponivel");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const bloco = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const l of bloco.split("\n")) {
            if (!l.startsWith("data:")) continue;
            const dados = l.slice(5).trim();
            if (!dados) continue;
            let ev: unknown = null;
            try { ev = JSON.parse(dados); } catch { continue; }
            tratarEvento(base, ev, papeis, partes);
          }
        }
      }
    } catch {}
    if (ctrl.signal.aborted) break;
    await new Promise((ok) => setTimeout(ok, 1000)); // reconecta sem loop agressivo
  }
}

function fecharPonte(base: string): void {
  const ctrl = pontes.get(base);
  if (!ctrl) return;
  try { ctrl.abort(); } catch {}
  pontes.delete(base);
}

// O serve do OpenCode responde? GET {base}/doc com timeout curto (~1.5s), usado ANTES de abrir a
// ponte de um agente recarregado do disco (nao adianta assinar /event de um serve que morreu).
async function serveVivo(base: string): Promise<boolean> {
  try {
    const r = await fetch(base + "/doc", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// Empurra a lista de agentes de cada projeto conhecido (canvas + raiz dos planejadores).
function broadcastAgentes(): void {
  const projetos = new Set<string>();
  for (const a of agentes.values()) projetos.add(a.projeto);
  for (const p of planejadores) projetos.add(p.raiz);
  for (const projeto of projetos) broadcast({ agentes: listarAgentes(projeto) });
}

// Reabre as pontes de /event dos agentes conhecidos (canvas recarregado do disco + derivados dos
// planejadores do orchestra-go): para cada base distinta testa o serve com GET /doc e so' entao abre
// a ponte (abrirPonte ja ignora base repetida). Base inacessivel NAO abre ponte e fica marcada como
// morta (status 'encerrado' no GET /agentes e no broadcast {agentes}); e' retentada de forma espacada
// (no intervalo de limpeza), nunca em loop agressivo.
async function reconectarPontes(): Promise<void> {
  if (reconectando) return;
  reconectando = true;
  try {
    const bases = new Set<string>();
    for (const a of agentes.values()) if (a.base) bases.add(a.base);
    for (const p of planejadores) { const b = agenteDePlanejador(p).base; if (b) bases.add(b); }
    let mudou = false;
    for (const base of bases) {
      if (!servidor) return; // hub parou durante a checagem: nao abre ponte orfa
      if (pontes.has(base)) continue; // ja conectado
      if (await serveVivo(base)) {
        if (basesMortas.delete(base)) mudou = true;
        abrirPonte(base);
      } else if (!basesMortas.has(base)) {
        basesMortas.add(base);
        mudou = true;
      }
    }
    for (const base of [...basesMortas]) if (!bases.has(base)) { basesMortas.delete(base); mudou = true; }
    if (mudou) broadcastAgentes();
  } finally { reconectando = false; }
}

function agenteDaSessao(base: string, sessao: string): RegistroAgente | undefined {
  for (const a of agentes.values()) if (a.base === base && a.sessao === sessao) return a;
  return undefined;
}

function tratarEvento(base: string, ev: unknown, papeis: Map<string, string>, partes: Map<string, ParteRegistrada>): void {
  const r = normalizarEvento(ev, papeis, partes);
  if (!r) return;
  const ag = agenteDaSessao(base, r.sessao);
  if (!ag) return;
  if (r.linha) {
    const novas = aplicarLinhas(agenteLinhas.get(ag.id) ?? [], [r.linha]);
    agenteLinhas.set(ag.id, novas);
    broadcast({ agenteLinhas: { id: ag.id, linhas: novas } });
  }
  if (r.status) {
    if (r.status === "ocupado") { fila.marcarOcupado(ag.id); filaEntregas.marcarOcupado(ag.id); }
    else {
      fila.marcarOcioso(ag.id); filaEntregas.marcarOcioso(ag.id);
      tentarLiberarAviso(ag.id);
      tentarLiberarEntregas(ag.id);
    }
    broadcast({ agentes: listarAgentes(ag.projeto) });
  }
}

// system do prompt: instrucao do papel (com o <id> substituido) + linha do README de contexto +
// a identidade do agente (nome (id) + comando `canvas --eu id:token`, F3/S2).
function instrucaoDe(a: RegistroAgente): string {
  const comId = (a.instrucao ?? "").replace(/<id>/g, a.id).trim();
  const partes: string[] = [];
  if (comId) partes.push(comId);
  if (!/README\.md/.test(comId)) partes.push("Antes de responder, leia .orchestra/contexto/" + a.id + "/README.md se existir.");
  if (a.token) partes.push(linhaIdentidade(a.nome, a.id, a.token));
  return partes.join(" ");
}

// POST /session/<sessao>/prompt_async (best-effort); model/system opcionais.
async function enviarTexto(base: string, sessao: string, texto: string, sistema?: string, modelo?: unknown): Promise<void> {
  if (!base || !sessao) return;
  const corpo: Record<string, unknown> = { parts: [{ type: "text", text: texto }] };
  if (modelo) corpo.model = modelo;
  if (sistema) corpo.system = sistema;
  try {
    await fetch(`${base}/session/${sessao}/prompt_async`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
  } catch {}
}

async function enviarPrompt(a: RegistroAgente, texto: string): Promise<void> {
  // Agentes Claude Code (F4/S3): a entrega e' digitada no PTY (nao ha' OpenCode/sessao).
  if (a.tipo === "claude") { escreverPty(a.id, textoParaPty(texto)); return; }
  await enviarTexto(a.base, a.sessao, texto, instrucaoDe(a), separarModelo(a.modelo));
}

function tentarLiberarAviso(id: string): void {
  const a = agentes.get(id);
  if (!a) return;
  const msg = fila.liberar(id, Date.now());
  if (msg) void enviarPrompt(a, msg);
}

// Escreve no PTY do agente (teclas do xterm ou texto de uma entrega); sem processo, ignora.
function escreverPty(id: string, dados: string): void {
  const p = ptyProcs.get(id);
  if (!p) return;
  try { p.write(dados); } catch {}
}

// Mata o PTY do agente e descarta o buffer (usado no encerrar/reiniciar).
function matarPty(id: string): void {
  const p = ptyProcs.get(id);
  if (p) { try { p.kill(); } catch {} }
  ptyProcs.delete(id);
  ptyBuffers.delete(id);
}

// Prompt de sistema do Claude: instrucao do papel (id substituido) + identidade + leitura do contexto.
function promptClaude(instrucao: string, id: string, nome: string, token: string): string {
  const comId = instrucao.replace(/<id>/g, id).trim();
  return [
    comId,
    linhaIdentidade(nome, id, token),
    `Antes de responder, leia .orchestra/contexto/${id}/README.md se existir.`,
  ].filter(Boolean).join(" ");
}

// Sobe o PTY do Claude: grava os hooks de status, monta os args e liga a saida ao SSE + buffer.
// Lanca se o driver de PTY nao estiver disponivel (sem app desktop) ou se o spawn falhar.
// `inicial` (G2): prompt inicial posicional do Claude (ex.: `/orchestra "<feature>"`), so' no primeiro start.
function subirPtyClaude(a: RegistroAgente, continuar: boolean, inicial?: string): void {
  const settingsPath = path.join(AGENTES_DIR, a.id + ".settings.json");
  try {
    fs.mkdirSync(AGENTES_DIR, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settingsHooks(a.id, a.token ?? "", process.execPath, path.join(RAIZ_BRIDGE, "bin", "canvas.mjs"))));
  } catch {}
  if (!ptyAtual) throw new Error("abra o app Hermes para usar agentes Claude");
  const prompt = promptClaude(a.instrucao ?? "", a.id, a.nome, a.token ?? "");
  const proc = ptyAtual.spawn({
    comando: "claude",
    args: argsClaude({ prompt, settingsPath, modelo: a.modelo, continuar, inicial }),
    cwd: a.cwd,
    env: {
      ...envClaude(),
      HERMES_EU: `${a.id}:${a.token}`, // um processo por agente: `canvas` ja' sai identificado
      // app Electron: o `node` do hook e' o exe do app; sem isso ele abriria uma nova janela do Hermes.
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    cols: tamanhoPty.get(a.id)?.cols ?? 120,
    rows: tamanhoPty.get(a.id)?.rows ?? 32,
  });
  ptyProcs.set(a.id, proc);
  ptyBuffers.set(a.id, "");
  proc.onData((d) => {
    const atual = ptyBuffers.get(a.id) ?? "";
    const novo = atual + d;
    ptyBuffers.set(a.id, novo.length > LIMITE_BUFFER_PTY ? novo.slice(novo.length - LIMITE_BUFFER_PTY) : novo);
    broadcast({ pty: { id: a.id, dados: Buffer.from(d, "utf8").toString("base64") } });
  });
  proc.onExit(() => {
    ptyProcs.delete(a.id);
    const reg = agentes.get(a.id);
    if (!reg) return; // ja' encerrado/removido: nao ressuscita o registro
    reg.status = "encerrado";
    gravarAgente(reg);
    broadcast({ agentes: listarAgentes(reg.projeto) });
  });
}

// Cria um agente Claude: registro em disco, PTY e broadcast. Falha vira status 'falhou' (com a mensagem).
// `origem`/`inicial`: um agente pode nascer com origem propria e um prompt inicial (ex.: auto-contido).
function criarAgenteClaude(projeto: string, cwd: string, papel: Papel, nome: string, modelo: string, instrucao: string, origem: OrigemAgente = "canvas", inicial?: string): { id: string; ok: boolean; erro: string } {
  const id = "ag-" + randomUUID().slice(0, 8);
  const reg: RegistroAgente = {
    id, projeto, cwd, base: "", sessao: "", nome, papel, modelo, instrucao,
    tipo: "claude", origem, token: novoToken(),
  };
  let erro = "";
  try { subirPtyClaude(reg, false, inicial); }
  catch (e: any) { erro = String(e?.message ?? e); reg.erro = erro; }
  gravarAgente(reg);
  broadcast({ agentes: listarAgentes(projeto) });
  return { id, ok: !erro, erro };
}

// Colaboracao entre agentes (F3/S2): identidade, conversas, fila de entregas

// Contexto de colaboracao de um id: agente do canvas (registro em disco) ou planejador derivado.
function colabDe(id: string): Colab | undefined {
  const a = agentes.get(id);
  if (a) return { id: a.id, nome: a.nome, projeto: a.projeto, cwd: a.cwd, base: a.base, sessao: a.sessao, token: a.token ?? "" };
  const tok = tokensPlanejadores.get(id);
  const p = planejadores.find((x) => "plan-" + x.slug === id);
  if (p && tok) { const ag = agenteDePlanejador(p); return { id, nome: ag.nome, projeto: ag.projeto, cwd: ag.cwd, base: ag.base, sessao: ag.sessao, token: tok }; }
  return undefined;
}

// X-Eu: "id:token" -> Colab so' se o token bater (senao undefined = identidade invalida).
function colabDoToken(eu: string): Colab | undefined {
  const i = eu.indexOf(":");
  if (i <= 0 || i === eu.length - 1) return undefined;
  const id = eu.slice(0, i);
  const token = eu.slice(i + 1);
  const c = colabDe(id);
  return c && c.token === token ? c : undefined;
}

// Agentes do projeto do agente (id + nome), na ordem dos registros; alimenta conectados/resolverAlvo.
function agentesRefProjeto(projeto: string): AgenteRef[] {
  const out: AgenteRef[] = [];
  for (const a of agentes.values()) if (a.projeto === projeto) out.push({ id: a.id, nome: a.nome });
  for (const p of planejadores) {
    if (p.raiz !== projeto && idProjeto(p.raiz) !== idProjeto(projeto)) continue;
    const ag = agenteDePlanejador(p);
    out.push({ id: ag.id, nome: ag.nome });
  }
  return out;
}

// Status de colaboracao: ocupado -> "trabalhando"; encerrado -> "encerrado"; resto -> "ocioso".
function statusColab(id: string): string {
  const s = statusDe(id);
  if (s === "encerrado") return "encerrado";
  if (s === "ocupado") return "trabalhando";
  return "ocioso";
}

function estaOcupado(id: string): boolean { return fila.estados.get(id)?.ocupado === true; }

// /cli/status (F4/S3): os hooks do Claude marcam ocupado/ocioso/aguardando. 'aguardando' conta como
// ocupado na fila de entregas; 'ocioso' libera os avisos e as entregas pendentes.
function marcarStatusAgente(id: string, estado: "ocupado" | "ocioso" | "aguardando"): void {
  if (estado === "ocioso") {
    fila.marcarOcioso(id);
    filaEntregas.marcarOcioso(id);
    aguardandoSet.delete(id);
    tentarLiberarAviso(id);
    tentarLiberarEntregas(id);
  } else {
    fila.marcarOcupado(id);
    filaEntregas.marcarOcupado(id);
    if (estado === "aguardando") aguardandoSet.add(id);
    else aguardandoSet.delete(id);
  }
  const a = agentes.get(id);
  if (a) broadcast({ agentes: listarAgentes(a.projeto) });
  else broadcastAgentes();
}

// Envia agora (ocioso) ou enfileira (ocupado). Devolve true se entregou na hora.
async function entregarColab(id: string, texto: string): Promise<boolean> {
  if (estaOcupado(id)) { filaEntregas.enfileirar(id, texto); return false; }
  const a = agentes.get(id);
  if (a) { await enviarPrompt(a, texto); return true; }
  const c = colabDe(id);
  if (c) await enviarTexto(c.base, c.sessao, texto);
  return true;
}

// Alvo ficou ocioso: esvazia a fila de entregas dele.
function tentarLiberarEntregas(id: string): void {
  const pend = filaEntregas.liberar(id);
  for (const texto of pend) void entregarColab(id, texto);
}

// {conversas:[{q,de,para,texto}]} em toda mudanca (ids de agentes).
function broadcastConversas(): void {
  broadcast({ conversas: conversas.pendentes().map((p) => ({ q: p.q, de: p.de, para: p.para, texto: p.texto })) });
}

// Expiracao das perguntas pendentes: avisa a origem que o alvo nao respondeu.
function expirarConversas(): void {
  const expiradas = conversas.expirar();
  if (!expiradas.length) return;
  for (const p of expiradas) {
    const nomeAlvo = colabDe(p.para)?.nome ?? p.para;
    void entregarColab(p.de, fmtSemResposta(nomeAlvo, p.q));
  }
  broadcastConversas();
}

function iniciarExpiracao(): void {
  if (expiracao) return;
  expiracao = setInterval(expirarConversas, 60_000);
  expiracao.unref?.();
}

function pararExpiracao(): void { if (expiracao) { clearInterval(expiracao); expiracao = null; } }

// Planejadores: na primeira vez que sao vistos, ganham um token (AGENTES_DIR/<id>.json = {id,token})
// e recebem UMA vez a linha de identidade como mensagem.
function arquivoTokenPlanejador(id: string): string { return path.join(AGENTES_DIR, id + ".json"); }

async function garantirTokenPlanejador(p: Planejador): Promise<void> {
  const id = "plan-" + p.slug;
  if (tokensPlanejadores.has(id)) return;
  try {
    const j = JSON.parse(fs.readFileSync(arquivoTokenPlanejador(id), "utf8"));
    if (j && j.id === id && typeof j.token === "string" && j.token.length >= 16) { tokensPlanejadores.set(id, j.token); return; }
  } catch {}
  const token = novoToken();
  tokensPlanejadores.set(id, token);
  try { fs.mkdirSync(AGENTES_DIR, { recursive: true }); fs.writeFileSync(arquivoTokenPlanejador(id), JSON.stringify({ id, token })); } catch {}
  const ag = agenteDePlanejador(p);
  await entregarColab(id, linhaIdentidade(ag.nome, id, token));
}

// Aplica um lote de ops no canvas do projeto pelo MESMO caminho do POST /canvas/op.
function aplicarOpsProjeto(projeto: string, ops: Op[]): void {
  const id = idProjeto(projeto);
  const snapNovo = aplicarOps(lerCanvas(id), ops);
  canvasCache.set(id, snapNovo);
  gravarCanvasDebounced(id);
  broadcast({ canvasOp: { projeto, ops } });
  try { sincronizarContexto(snapNovo); } catch {}
}

// ---- navegador controlado por agentes (F4/S2): rotas /cli/browser-* ----
// Driver injetado pelo app desktop. Sem ele, toda rota browser-* responde 400 (abra o app Hermes).
type Navegador = {
  ler(noId: string): Promise<Leitura>;
  clicar(noId: string, n: number): Promise<void>;
  digitar(noId: string, n: number, valor: string, enter: boolean): Promise<void>;
  navegar(noId: string, acao: string): Promise<void>;
  capturar(noId: string): Promise<Buffer>;
};

let navegadorAtual: Navegador | undefined;
const browserCache = new Map<string, Elemento[]>(); // "<idProjeto>\\n<noId>" -> elementos lidos

function chaveElementos(projeto: string, noId: string): string { return idProjeto(projeto) + "\\n" + noId; }

// Navegadores do projeto acessiveis ao agente: criados por ele ou ligados por aresta (qualquer direcao).
function navegadoresAcessiveis(snap: Snapshot, agenteId: string): No[] {
  const noAg = "ag:" + agenteId;
  return snap.nos.filter((n) => n.tipo === "navegador" && (
    n.dados.criador === agenteId ||
    snap.arestas.some((a) => (a.de === noAg && a.para === n.id) || (a.para === noAg && a.de === n.id))
  ));
}

// Resolve por noId exato ou pelo slug do nome (case-insensitive); o primeiro que casar.
function acharNavegador(navs: No[], alvo: string): No | undefined {
  const exato = navs.find((n) => n.id === alvo);
  if (exato) return exato;
  const slug = slugNome(alvo);
  return navs.find((n) => slugNome(String(n.dados.nome ?? "")) === slug);
}

// Sem `nav`, usa o unico acessivel; com `nav`, so' entre os acessiveis. Inacessivel -> erro do contrato.
function resolverNavegador(snap: Snapshot, agenteId: string, bruto: unknown): { ok: No } | { erro: string } {
  const navs = navegadoresAcessiveis(snap, agenteId);
  if (bruto === undefined || bruto === null || bruto === "") {
    if (navs.length === 1) return { ok: navs[0] };
    return { erro: navs.length === 0 ? "nenhum navegador conectado a você" : "navegador não especificado (há mais de um conectado a você)" };
  }
  const s = String(bruto);
  const achado = acharNavegador(navs, s);
  if (!achado) return { erro: `navegador ${s} não está conectado a você` };
  return { ok: achado };
}

// Elementos na cache do noId; sem cache, faz uma leitura antes (mesmo contrato do read).
async function elementosDoNavegador(projeto: string, noId: string): Promise<Elemento[]> {
  const k = chaveElementos(projeto, noId);
  const emCache = browserCache.get(k);
  if (emCache) return emCache;
  const l = await navegadorAtual!.ler(noId);
  browserCache.set(k, l.elementos);
  return l.elementos;
}

// Arvore do worktree do agente: `git ls-files` + nao rastreados (exclui ignorados), barras '/', ate 5000.
function listarArvore(cwd: string): string[] {
  const opcoes = { cwd, encoding: "utf8" as const, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[] };
  const out = new Set<string>();
  try {
    for (const linha of execSync("git ls-files", opcoes).split(/\r?\n/)) if (linha.trim()) out.add(linha.trim().replace(/\\/g, "/"));
    for (const linha of execSync("git ls-files --others --exclude-standard", opcoes).split(/\r?\n/)) if (linha.trim()) out.add(linha.trim().replace(/\\/g, "/"));
  } catch {}
  return [...out].slice(0, 5000);
}

// Raiz absoluta de um projeto a partir de ?projeto=<raiz>: so' vale se idProjeto(<projeto>) bater com
// idProjeto(p.raiz) de algum item de mesclarProjetos(raizesDescobertas(), lerProjetosSalvos()); caso
// contrario undefined (o chamador responde 404). Grafias diferentes da mesma pasta casam pelo id.
function raizDeProjeto(projeto: string): string | undefined {
  const id = idProjeto(projeto);
  return mesclarProjetos(raizesDescobertas(), lerProjetosSalvos()).find((p) => idProjeto(p.raiz) === id)?.raiz;
}

function responderTexto(res: http.ServerResponse, status: number, texto: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(texto);
}

async function criarSessao(base: string, nome: string): Promise<string | null> {
  try {
    const r = await fetch(base + "/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nome }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return typeof j?.id === "string" && j.id ? j.id : null;
  } catch { return null; }
}

async function buscarHistorico(a: RegistroAgente): Promise<Linha[]> {
  if (!a.base || !a.sessao) return [];
  try {
    const r = await fetch(`${a.base}/session/${a.sessao}/message?limit=50`);
    if (!r.ok) return [];
    return historicoParaLinhas(await r.json());
  } catch { return []; }
}

async function abortarSessao(a: RegistroAgente): Promise<void> {
  if (!a.base || !a.sessao) return;
  try { await fetch(`${a.base}/session/${a.sessao}/abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}
}

// Encerra: apaga a sessao, remove o registro e mata o serve se nao sobrou nenhum agente no mesmo base.
async function encerrarAgente(a: RegistroAgente): Promise<void> {
  const base = a.base;
  if (base && a.sessao) {
    try { await fetch(`${base}/session/${a.sessao}`, { method: "DELETE" }); } catch {}
  }
  matarPty(a.id); // agente Claude: encerra o PTY antes de sumir com o registro
  removerAgenteDoDisco(a.id);
  if (base && ![...agentes.values()].some((x) => x.base === base)) {
    for (const [cwd, s] of serves) if (s.base === base) { if (s.pid > 0) matarProcessoAtual(s.pid); serves.delete(cwd); }
    fecharPonte(base);
  }
}

// ---- contexto em disco: <cwd>/.orchestra/contexto/<agenteId>/ (CA-9) ----
function hashDe(s: string): string { return createHash("sha1").update(s, "utf8").digest("hex"); }

function dirContexto(a: Agente): string { return path.join(a.cwd, ".orchestra", "contexto", a.id); }

function lerManifest(a: Agente): AssinaturaArquivo[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dirContexto(a), ".manifest.json"), "utf8"));
    if (Array.isArray(j)) return j.filter((x: any) => x && typeof x.nome === "string" && typeof x.assinatura === "string");
  } catch {}
  return [];
}

function gravarManifest(a: Agente, as: AssinaturaArquivo[]): void {
  try { fs.writeFileSync(path.join(dirContexto(a), ".manifest.json"), JSON.stringify(as)); } catch {}
}

// Garante `.orchestra/` no <git common dir>/info/exclude (mesmo esquema do .claude/worktrees/).
function garantirExclude(cwd: string): void {
  try {
    const comum = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!comum) return;
    const info = path.join(comum, "info");
    const arq = path.join(info, "exclude");
    let atual = "";
    try { atual = fs.readFileSync(arq, "utf8"); } catch {}
    if (atual.split(/\r?\n/).includes(".orchestra/")) return;
    fs.mkdirSync(info, { recursive: true });
    fs.appendFileSync(arq, (atual && !atual.endsWith("\n") ? "\n" : "") + ".orchestra/\n");
  } catch {}
}

// Caminho local da imagem referenciada por /canvas/asset/<idProjeto>/<arquivo>.
function assetLocal(url: string): string | null {
  const marca = "/canvas/asset/";
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const partes = url.slice(i + marca.length).split(/[?#]/)[0].split("/").filter(Boolean);
  if (partes.length < 2) return null;
  const arquivo = partes.pop() as string;
  const id = partes.join("/");
  if (!/^[0-9a-f]+$/i.test(id) || arquivo.includes("..")) return null;
  return path.join(CANVAS_DIR, id, "assets", arquivo);
}

// Apos cada /canvas/op: sincroniza o contexto dos nos 'agente' e enfileira os avisos.
function sincronizarContexto(snap: Snapshot): void {
  for (const no of snap.nos) {
    if (no.tipo !== "agente") continue;
    const aid = typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
    const a = aid ? agentes.get(aid) : undefined;
    if (!a || !a.cwd) continue;
    const plano = planoArquivos(itensDeContexto(snap, no.id));
    const atual: AssinaturaArquivo[] = [{ nome: "README.md", assinatura: hashDe(plano.readme) }];
    for (const f of plano.arquivos) {
      atual.push({ nome: f.nome, assinatura: f.conteudo !== undefined ? hashDe(f.conteudo) : "url:" + (f.url ?? "") });
    }
    const anterior = ctxAssinaturas.get(aid) ?? lerManifest(a);
    const d = diffContexto(atual, anterior);
    const dir = dirContexto(a);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    garantirExclude(a.cwd);
    for (const nome of d.remover) { try { fs.unlinkSync(path.join(dir, nome)); } catch {} }
    for (const nome of d.gravar) {
      const alvo = path.join(dir, nome);
      if (nome === "README.md") { try { fs.writeFileSync(alvo, plano.readme); } catch {} continue; }
      const f = plano.arquivos.find((x) => x.nome === nome);
      if (!f) continue;
      if (f.conteudo !== undefined) { try { fs.writeFileSync(alvo, f.conteudo); } catch {} }
      else if (f.url) {
        const local = assetLocal(f.url);
        if (local) { try { fs.copyFileSync(local, alvo); } catch {} }
      }
    }
    gravarManifest(a, atual);
    ctxAssinaturas.set(aid, atual);
    // README.md NAO entra nos nomes do aviso: mudanca so do README (ou sem itens) nao avisa.
    const nomes = [...d.gravar, ...d.remover].filter((n) => n !== "README.md");
    if (nomes.length) { fila.adicionar(aid, nomes); tentarLiberarAviso(aid); }
  }
}

// Raiz do dev-orchestra (um nivel acima de dist/web ou de web no dev): onde vive a pasta bin/.
const RAIZ_BRIDGE = path.resolve(WEB_DIR, "..", "..");
const LIMITE_BODY = 64 * 1024; // 64KB: teto padrao dos demais POSTs; acima disso e' abuso -> 400

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

// ---- acoes da run no canvas (G1/S2): POST /runs/acao?run=<id> {acao} -> merge | pr | descartar ----
const ACOES_RUN = new Set(["merge", "pr", "descartar"]);

// Eventos da run: da memoria (rescan) ou, se ainda nao lidos, do JSONL em disco. null = run desconhecida.
function eventosDaRun(id: string): Evento[] | null {
  const emMemoria = estado.get(id);
  if (emMemoria) return emMemoria;
  try { return parse(fs.readFileSync(path.join(RUNS_DIR, id + ".jsonl"), "utf8")); } catch { return null; }
}

// Corpo do PR: resumo por slice (ultima linha de cada uma) + gate ok + custo total (soma das metricas).
function corpoDoPr(evs: Evento[]): string {
  const slices = new Map<number, { tarefa: string; status: string }>();
  let gateOk = false;
  let custo = 0;
  for (const ev of evs) {
    if (ev.t === "slice") slices.set(ev.idx, { tarefa: ev.tarefa, status: ev.status });
    else if (ev.t === "gate" && ev.status === "ok") gateOk = true;
    else if (ev.t === "metrica") custo += ev.custoUSD;
  }
  const linhas = [...slices.entries()].sort((a, b) => a[0] - b[0]).map(([n, s]) => `- S${n} ${s.tarefa}: ${s.status}`);
  let corpo = "## Resumo\n" + linhas.join("\n");
  if (gateOk) corpo += "\n\nGate: ok";
  corpo += `\n\nCusto total: $${custo.toFixed(3).replace(".", ",")}`;
  return corpo;
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
    // Acoes da run no card (G1/S2): merge local, abrir PR e descartar. So' por POST com X-Hermes.
    if (caminho === "/runs/acao") {
      // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      const acao = j && typeof j.acao === "string" ? j.acao : "";
      if (!ACOES_RUN.has(acao)) { res.writeHead(400); res.end(); return; }
      const id = new URL(url, "http://x").searchParams.get("run") || "";
      // id ANTES de procurar a run: id fora do formato (<runId> e' [a-z0-9-]) nunca toca o disco.
      if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return; }
      const evs = eventosDaRun(id);
      const runEv = evs && evs.find((e) => e.t === "run");
      if (!runEv || runEv.t !== "run") { res.writeHead(404); res.end(); return; }
      const painel = [...evs!].reverse().find((e) => e.t === "painel");
      if (!painel || painel.t !== "painel") { responderTexto(res, 409, "run ainda rodando"); return; }
      if ((acao === "merge" || acao === "pr") && painel.status !== "COMPLETE") { responderTexto(res, 409, "só para runs COMPLETE"); return; }
      let r: ResultadoAcao;
      if (acao === "merge") r = mergeLocal({ cwd: runEv.cwd, branch: painel.branch, base: painel.base });
      else if (acao === "descartar") r = descartarRun({ cwd: runEv.cwd, branch: painel.branch, base: painel.base });
      else r = abrirPr({ cwd: runEv.cwd, branch: painel.branch, feature: runEv.feature, corpo: corpoDoPr(evs!), base: painel.base });
      res.writeHead(r.ok ? 200 : 409, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r));
      return;
    }
    // G3: instruir e pausar a slice RODANDO pelo card do canvas (POST /runs/instrucao e /runs/pausa).
    // Ordem: drena o corpo -> X-Hermes -> JSON -> slice inteiro >= 1 -> validarAcaoSlice -> acao/texto.
    if (caminho === "/runs/instrucao" || caminho === "/runs/pausa") {
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      if (!j || typeof j !== "object") { res.writeHead(400); res.end(); return; }
      const slice = Number(j.slice);
      if (!Number.isInteger(slice) || slice < 1) { res.writeHead(400); res.end(); return; }
      const id = new URL(url, "http://x").searchParams.get("run") || "";
      if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return; }
      const cancelado = fs.existsSync(arquivoCancel(id));
      const erro = validarAcaoSlice(eventosDaRun(id), slice, cancelado);
      if (erro) { responderTexto(res, erro.status, erro.erro); return; }
      if (caminho === "/runs/instrucao") {
        const e = validarTexto(j.texto, true);
        if (e) { responderTexto(res, 400, e); return; }
        gravarInstrucao(RUNS_DIR, id, slice, j.texto.trim());
        res.writeHead(204); res.end(); return;
      }
      const acao = typeof j.acao === "string" ? j.acao : "";
      if (acao === "pausar") { pausarSlice(RUNS_DIR, id, slice); res.writeHead(204); res.end(); return; }
      if (acao === "retomar") {
        const e = validarTexto(j.texto, false);
        if (e) { responderTexto(res, 400, e); return; }
        retomarSlice(RUNS_DIR, id, slice, typeof j.texto === "string" ? j.texto.trim() : undefined);
        res.writeHead(204); res.end(); return;
      }
      res.writeHead(400); res.end(); return;
    }
    // ---- canvas (S2) ----
    if (caminho === "/canvas/op") {
      // Drena o corpo ANTES de responder 400: corpo sem ler deixa a conexao suja (reset no cliente).
      const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
      const ops = j ? validarOps(j.ops) : null;
      if (!projeto || !ops) { res.writeHead(400); res.end(); return; }
      const id = idProjeto(projeto);
      const snapNovo = aplicarOps(lerCanvas(id), ops);
      canvasCache.set(id, snapNovo);
      gravarCanvasDebounced(id);
      broadcast({ canvasOp: { projeto, ops } });
      try { sincronizarContexto(snapNovo); } catch {}
      res.writeHead(204); res.end();
      return;
    }
    if (caminho === "/canvas/asset") {
      // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
      const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS_ASSET);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
      const v = j ? validarAsset(j.nome, j.dadosB64) : null;
      if (!projeto || !v) { res.writeHead(400); res.end(); return; }
      const id = idProjeto(projeto);
      const arquivo = randomUUID() + "." + v.ext;
      try {
        fs.mkdirSync(path.join(CANVAS_DIR, id, "assets"), { recursive: true });
        fs.writeFileSync(path.join(CANVAS_DIR, id, "assets", arquivo), v.bytes);
      } catch { res.writeHead(500); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ url: `/canvas/asset/${id}/${arquivo}` }));
      return;
    }
    if (caminho.startsWith("/canvas/asset/")) { servirCanvasAsset(caminho, res); return; }
    if (caminho === "/canvas/projetos") {
      if (req.method === "POST") {
        // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
        const corpo = await lerCorpo(req, LIMITE_BODY);
        if (corpo === null) { res.writeHead(400); res.end(); return; }
        if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
        let j: any = null;
        try { j = JSON.parse(corpo); } catch {}
        const raiz = j && typeof j.raiz === "string" ? j.raiz.trim() : "";
        if (!raiz) { res.writeHead(400); res.end(); return; }
        salvarProjeto(raiz, j.nome, j.cor);
        res.writeHead(204); res.end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(mesclarProjetos(raizesDescobertas(), lerProjetosSalvos())));
      return;
    }
    if (caminho === "/canvas") {
      const projeto = new URL(url, "http://x").searchParams.get("projeto") || "";
      if (!projeto) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(lerCanvas(idProjeto(projeto))));
      return;
    }
    // ---- agentes (F2/S3) ----
    if (caminho === "/agentes/modelos") {
      const cwd = new URL(url, "http://x").searchParams.get("cwd") || "";
      // Sem serve na pasta pedida o dialog ficaria sem modelos; usa um serve/planejador conhecido
      // (a lista de providers do OpenCode e' da conta, nao da pasta).
      const base = baseParaModelos(cwd);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(base ? await listarModelos(base) : []));
      return;
    }
    if (caminho === "/agentes" && req.method === "GET") {
      const projeto = new URL(url, "http://x").searchParams.get("projeto") || "";
      if (!projeto) { res.writeHead(400); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(listarAgentes(projeto)));
      return;
    }
    if (caminho === "/agentes") {
      // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
      const cwd = j && typeof j.cwd === "string" ? j.cwd.trim() : "";
      const papel = j && typeof j.papel === "string" ? j.papel : "";
      if (!projeto || !cwd || !Object.prototype.hasOwnProperty.call(PAPEIS, papel)) { res.writeHead(400); res.end(); return; }
      const def = PAPEIS[papel as Papel];
      const nome = j && typeof j.nome === "string" && j.nome.trim() ? j.nome.trim() : def.nome;
      const instrucao = j && typeof j.instrucao === "string" ? j.instrucao : def.instrucao;
      // Agentes Claude Code (F4/S3): PTY gerenciado pelo app desktop, sem OpenCode/ponte.
      if (j && j.tipo === "claude") {
        const modelo = j && typeof j.modelo === "string" ? j.modelo.trim() : "";
        const r = criarAgenteClaude(projeto, cwd, papel as Papel, nome, modelo, instrucao);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(r.ok ? { id: r.id, status: "ok" } : { id: r.id, status: "falhou", erro: r.erro }));
        return;
      }
      const id = "ag-" + randomUUID().slice(0, 8);
      const modelo = (j && typeof j.modelo === "string" ? j.modelo.trim() : "") || "opencode-go/glm-5.2";
      let serve = serves.get(cwd);
      let erro = "";
      if (!serve) {
        // Reaproveita o serve de um agente vivo do MESMO cwd (ex.: registros lidos do disco apos restart).
        for (const a of agentes.values()) if (a.cwd === cwd && a.base && !a.erro) { serve = { base: a.base, pid: 0 }; break; }
        if (serve) serves.set(cwd, serve);
      }
      if (!serve) {
        try { serve = await subirServeAtual(cwd, envServe()); serves.set(cwd, serve); }
        catch (e: any) { erro = String(e?.message ?? e); }
      }
      if (serve) abrirPonte(serve.base);
      let sessao = "";
      if (serve) {
        const s = await criarSessao(serve.base, nome);
        if (s) sessao = s;
        else if (!erro) erro = "nao foi possivel criar a sessao no OpenCode";
      }
      const ok = !!(serve && sessao);
      const reg: RegistroAgente = {
        id, projeto, cwd, base: serve ? serve.base : "", sessao, nome,
        papel: papel as Papel, modelo, instrucao, tipo: "opencode", origem: "canvas",
        token: novoToken(),
      };
      if (!ok) reg.erro = erro || "falha ao subir o OpenCode";
      gravarAgente(reg);
      broadcast({ agentes: listarAgentes(projeto) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(ok ? { id, status: "ok" } : { id, status: "falhou", erro: reg.erro }));
      return;
    }
    if (caminho.startsWith("/agentes/")) {
      const partes = caminho.slice("/agentes/".length).split("/");
      let id = partes[0] || "";
      try { id = decodeURIComponent(id); } catch {}
      const acao = partes[1] || "";
      if (acao === "historico" && req.method === "GET") {
        const a = agentes.get(id);
        if (!a) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(await buscarHistorico(a)));
        return;
      }
      if (acao === "pty" && req.method === "GET") {
        // Ultimas ~200KB de saida do PTY do agente Claude (base64), para reidratar o terminal na UI.
        const a = agentes.get(id);
        if (!a) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id, dados: Buffer.from(ptyBuffers.get(id) ?? "", "utf8").toString("base64") }));
        return;
      }
      if (req.method === "POST") {
        // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
        const corpo = await lerCorpo(req, LIMITE_BODY);
        if (corpo === null) { res.writeHead(400); res.end(); return; }
        if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
        const a = agentes.get(id);
        if (!a) { res.writeHead(404); res.end(); return; }
        let j: any = null;
        try { j = JSON.parse(corpo); } catch {}
        if (acao === "teclas") {
          // Teclas do xterm (F4/S3): digitadas cruas no PTY do agente Claude.
          const dados = j && typeof j.dados === "string" ? j.dados : "";
          if (!dados) { res.writeHead(400); res.end(); return; }
          escreverPty(a.id, dados);
          res.writeHead(204); res.end(); return;
        }
        if (acao === "tamanho") {
          // Tamanho do xterm do card (fit): o PTY precisa saber, senao o claude quebra linhas na largura errada.
          const cols = Math.trunc(Number(j?.cols)), rows = Math.trunc(Number(j?.rows));
          if (!(cols >= 10 && cols <= 500 && rows >= 4 && rows <= 300)) { res.writeHead(400); res.end(); return; }
          tamanhoPty.set(a.id, { cols, rows });
          ptyProcs.get(a.id)?.resize?.(cols, rows);
          res.writeHead(204); res.end(); return;
        }
        if (acao === "mensagem") {
          const texto = j && typeof j.texto === "string" ? j.texto : "";
          if (!texto) { res.writeHead(400); res.end(); return; }
          await enviarPrompt(a, texto);
          res.writeHead(204); res.end(); return;
        }
        if (acao === "modelo") {
          const modelo = j && typeof j.modelo === "string" ? j.modelo.trim() : "";
          if (!modelo) { res.writeHead(400); res.end(); return; }
          a.modelo = modelo;
          gravarAgente(a);
          res.writeHead(204); res.end(); return;
        }
        if (acao === "abortar") { await abortarSessao(a); res.writeHead(204); res.end(); return; }
        if (acao === "encerrar") {
          // Encerra as conversas do agente: quem perguntou a ele recebe o aviso de "sem resposta".
          const pendentes = conversas.encerrarAgente(id);
          for (const p of pendentes) void entregarColab(p.de, fmtSemResposta(a.nome, p.q));
          await encerrarAgente(a);
          if (pendentes.length) broadcastConversas();
          res.writeHead(204); res.end(); return;
        }
        if (acao === "reiniciar") {
          // Agente Claude (F4/S3): retoma a conversa no PTY (--continue), sem OpenCode/ponte.
          if (a.tipo === "claude") {
            try {
              matarPty(a.id);
              delete a.erro;
              subirPtyClaude(a, true);
              a.status = "ok";
              gravarAgente(a);
              broadcast({ agentes: listarAgentes(a.projeto) });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id: a.id, status: "ok" }));
            } catch (e: any) {
              const motivo = String(e?.message ?? e);
              a.erro = motivo;
              gravarAgente(a);
              broadcast({ agentes: listarAgentes(a.projeto) });
              res.writeHead(200, { "Content-Type": "application/json" });
              res.end(JSON.stringify({ id: a.id, status: "falhou", erro: motivo }));
            }
            return;
          }
          // Reabre a sessao do agente: reaproveita um serve VIVO da mesma cwd (o serve destacado
          // sobrevive ao hub) ou sobe um novo com subirServe(cwd), cria uma sessao limpa e reabre a
          // ponte do /event. Sucesso -> 200 {id,status:'ok'}; falha ao subir -> 200 {id,status:'falhou',erro}.
          let serve = serves.get(a.cwd);
          if (serve && !(await serveVivo(serve.base))) { serves.delete(a.cwd); serve = undefined; }
          if (!serve) {
            for (const x of agentes.values()) {
              if (x.id === a.id || x.cwd !== a.cwd || !x.base || x.erro) continue;
              if (await serveVivo(x.base)) { serve = { base: x.base, pid: x.pid ?? 0 }; break; }
            }
            if (serve) serves.set(a.cwd, serve);
          }
          let erro = "";
          if (!serve) {
            try { serve = await subirServeAtual(a.cwd, envServe()); serves.set(a.cwd, serve); }
            catch (e: any) { erro = String(e?.message ?? e); }
          }
          let sessao = "";
          if (serve) {
            const s = await criarSessao(serve.base, a.nome);
            if (s) sessao = s;
            else if (!erro) erro = "nao foi possivel criar a sessao no OpenCode";
          }
          if (serve && sessao) {
            a.base = serve.base; a.sessao = sessao; a.pid = serve.pid;
            delete a.erro; a.status = "ok";
            gravarAgente(a);              // registro atualizado em disco (base, pid, sessao, status)
            agenteLinhas.set(a.id, []);   // sessao nova: zera o chat em memoria
            basesMortas.delete(serve.base);
            abrirPonte(serve.base);       // reabre a ponte do /event da base
            broadcast({ agenteLinhas: { id: a.id, linhas: [] } });
            broadcast({ agentes: listarAgentes(a.projeto) });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: a.id, status: "ok" }));
            return;
          }
          const motivo = erro || "falha ao reiniciar o OpenCode";
          a.erro = motivo;
          gravarAgente(a);
          broadcast({ agentes: listarAgentes(a.projeto) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: a.id, status: "falhou", erro: motivo }));
          return;
        }
        res.writeHead(404); res.end(); return;
      }
      res.writeHead(404); res.end(); return;
    }
    // ---- CLI dos agentes (F3/S2): POST /cli/<cmd> com X-Hermes e X-Eu: id:token ----
    if (caminho.startsWith("/cli/")) {
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return; }
      const c = colabDoToken(String(req.headers["x-eu"] ?? ""));
      if (!c) { responderTexto(res, 403, "identidade inválida"); return; }
      let j: any = null;
      try { j = corpo ? JSON.parse(corpo) : null; } catch {}
      const cmd = caminho.slice("/cli/".length);
      const snap = lerCanvas(idProjeto(c.projeto));
      const noAg = snap.nos.find((n) => n.id === "ag:" + c.id);
      // No' do agente no canvas do projeto; se nao existir, uma posicao padrao.
      const agNo: No = noAg ?? { id: "ag:" + c.id, tipo: "agente", x: 0, y: 0, w: 620, h: 420, dados: { agenteId: c.id }, rev: 0 };
      const refs = () => conectados(snap, c.id, agentesRefProjeto(c.projeto));
      const alvoDe = (bruto: unknown): { ok: AgenteRef } | { erro: string } => {
        const alvo = typeof bruto === "string" ? bruto : "";
        if (!alvo) return { erro: "alvo obrigatório" };
        return resolverAlvo(refs(), alvo);
      };
      if (cmd === "status") {
        // Hooks do Claude Code (F4/S3) marcam o estado do agente; estado invalido -> 400.
        const estado = typeof j?.estado === "string" ? j.estado : "";
        if (estado !== "ocupado" && estado !== "ocioso" && estado !== "aguardando") { responderTexto(res, 400, "estado inválido"); return; }
        marcarStatusAgente(c.id, estado);
        responderTexto(res, 200, "status atualizado");
        return;
      }
      if (cmd === "list") {
        const lista = refs();
        responderTexto(res, 200, lista.length ? lista.map((a) => `${slugNome(a.nome)} (${a.id}) — ${a.nome}, ${statusColab(a.id)}`).join("\n") : "nenhum agente conectado a você");
        return;
      }
      if (cmd === "ask") {
        const alvo = alvoDe(j?.alvo);
        if ("erro" in alvo) { responderTexto(res, 400, alvo.erro); return; }
        const texto = typeof j?.texto === "string" ? j.texto : "";
        const r = conversas.perguntar(c.id, alvo.ok.id, texto);
        if ("erro" in r) { responderTexto(res, 400, r.erro); return; }
        const entregue = await entregarColab(alvo.ok.id, fmtPergunta(c.nome, r.ok.q, texto));
        broadcastConversas();
        responderTexto(res, 200, entregue ? `pergunta ${r.ok.q} enviada a ${alvo.ok.nome}` : `pergunta ${r.ok.q} enfileirada (${alvo.ok.nome} ocupado)`);
        return;
      }
      if (cmd === "tell") {
        const alvo = alvoDe(j?.alvo);
        if ("erro" in alvo) { responderTexto(res, 400, alvo.erro); return; }
        const texto = typeof j?.texto === "string" ? j.texto : "";
        const entregue = await entregarColab(alvo.ok.id, fmtMensagem(c.nome, texto));
        responderTexto(res, 200, entregue ? `mensagem enviada a ${alvo.ok.nome}` : `mensagem enfileirada (${alvo.ok.nome} ocupado)`);
        return;
      }
      if (cmd === "reply") {
        const q = typeof j?.q === "string" ? j.q : "";
        const texto = typeof j?.texto === "string" ? j.texto : "";
        const r = conversas.responder(c.id, q);
        if ("erro" in r) { responderTexto(res, 400, r.erro); return; }
        await entregarColab(r.ok.de, fmtResposta(c.nome, r.ok.q, texto));
        broadcastConversas();
        responderTexto(res, 200, `resposta enviada a ${colabDe(r.ok.de)?.nome ?? r.ok.de}`);
        return;
      }
      if (cmd === "flow-add") {
        const r = opsFlowAdd(snap, agNo, c.nome, String(j?.chave ?? ""), String(j?.forma ?? ""), String(j?.texto ?? ""), typeof j?.cor === "string" ? j.cor : undefined, Date.now());
        if ("erro" in r) { responderTexto(res, 400, r.erro); return; }
        aplicarOpsProjeto(c.projeto, r.ops);
        responderTexto(res, 200, "fluxo atualizado");
        return;
      }
      if (cmd === "flow-link") {
        const r = opsFlowLink(snap, c.id, String(j?.a ?? ""), String(j?.b ?? ""), typeof j?.rotulo === "string" ? j.rotulo : undefined, Date.now());
        if ("erro" in r) { responderTexto(res, 400, r.erro); return; }
        aplicarOpsProjeto(c.projeto, r.ops);
        responderTexto(res, 200, "fluxo atualizado");
        return;
      }
      if (cmd === "file") {
        const limpo = validarCaminho(c.cwd, typeof j?.caminho === "string" ? j.caminho : "");
        if (!limpo) { responderTexto(res, 400, "caminho inválido"); return; }
        aplicarOpsProjeto(c.projeto, opsFile(snap, agNo, limpo, typeof j?.status === "string" ? j.status : "", Date.now()));
        responderTexto(res, 200, "arquivo atualizado");
        return;
      }
      if (cmd === "note") {
        aplicarOpsProjeto(c.projeto, opsNote(snap, agNo, typeof j?.titulo === "string" ? j.titulo : "", typeof j?.corpo === "string" ? j.corpo : "", Date.now()));
        responderTexto(res, 200, "nota atualizada");
        return;
      }
      // ---- navegador (F4/S2): create/read/click/type/nav/shot ----
      if (cmd.startsWith("browser-")) {
        if (!navegadorAtual) { responderTexto(res, 400, "navegador indisponível: abra o app Hermes"); return; }
        try { // erro do driver (webview fechada, pagina carregando...) vira 400, nunca request pendurada
        if (cmd === "browser-create") {
          const nome = typeof j?.nome === "string" ? j.nome.trim() : "";
          const url = typeof j?.url === "string" ? j.url : "";
          if (!nome) { responderTexto(res, 400, "nome obrigatório"); return; }
          if (!urlPermitida(url)) { responderTexto(res, 400, "url inválida"); return; }
          // no' `nav:<slugNome(nome)>`, com sufixo -2, -3... se o id ja existir no projeto.
          const base = "nav:" + slugNome(nome);
          let noId = base;
          let k = 1;
          while (snap.nos.some((n) => n.id === noId)) { k++; noId = base + "-" + k; }
          const agora = Date.now();
          const navNo: No = { id: noId, tipo: "navegador", x: agNo.x + agNo.w + 40, y: agNo.y, w: 900, h: 620, dados: { nome, url, criador: c.id }, rev: agora };
          const aresta: Aresta = { id: `${agNo.id}->${noId}`, de: agNo.id, para: noId, rev: agora };
          aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: navNo }, { op: "upsert", tipo: "aresta", item: aresta }]);
          responderTexto(res, 200, `navegador ${nome} aberto (${noId})`);
          return;
        }
        if (cmd === "browser-read") {
          const nav = resolverNavegador(snap, c.id, j?.nav);
          if ("erro" in nav) { responderTexto(res, 400, nav.erro); return; }
          const l = await navegadorAtual.ler(nav.ok.id);
          browserCache.set(chaveElementos(c.projeto, nav.ok.id), l.elementos);
          responderTexto(res, 200, formatarLeitura(l));
          return;
        }
        if (cmd === "browser-click" || cmd === "browser-type") {
          const nav = resolverNavegador(snap, c.id, j?.nav);
          if ("erro" in nav) { responderTexto(res, 400, nav.erro); return; }
          const alvo = typeof j?.alvo === "string" ? j.alvo : "";
          if (!alvo) { responderTexto(res, 400, "alvo obrigatório"); return; }
          const els = await elementosDoNavegador(c.projeto, nav.ok.id);
          const el = resolverElemento(els, alvo);
          if ("erro" in el) { responderTexto(res, 400, el.erro); return; }
          if (cmd === "browser-click") {
            await navegadorAtual.clicar(nav.ok.id, el.ok.n);
            responderTexto(res, 200, `clique em [${el.ok.n}] ${el.ok.papel} "${el.ok.rotulo}"`);
          } else {
            const valor = typeof j?.valor === "string" ? j.valor : "";
            const enter = j?.enter === true;
            await navegadorAtual.digitar(nav.ok.id, el.ok.n, valor, enter);
            responderTexto(res, 200, `digitação em [${el.ok.n}] ${el.ok.papel} "${el.ok.rotulo}"`);
          }
          return;
        }
        if (cmd === "browser-nav") {
          const nav = resolverNavegador(snap, c.id, j?.nav);
          if ("erro" in nav) { responderTexto(res, 400, nav.erro); return; }
          const acao = typeof j?.acao === "string" ? j.acao : "";
          const ehControle = acao === "back" || acao === "forward" || acao === "reload";
          if (!ehControle && !urlPermitida(acao)) { responderTexto(res, 400, "ação inválida"); return; }
          await navegadorAtual.navegar(nav.ok.id, acao);
          if (!ehControle) {
            // url nova: atualiza dados.url do no (back/forward/reload nao revelam a url resultante).
            const no = snap.nos.find((n) => n.id === nav.ok.id);
            if (no) aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: { ...no, dados: { ...no.dados, url: acao }, rev: Date.now() } }]);
          }
          responderTexto(res, 200, "navegador navegou");
          return;
        }
        if (cmd === "browser-shot") {
          const nav = resolverNavegador(snap, c.id, j?.nav);
          if ("erro" in nav) { responderTexto(res, 400, nav.erro); return; }
          const png = await navegadorAtual.capturar(nav.ok.id);
          const nome = String(nav.ok.dados.nome ?? "");
          garantirExclude(c.cwd); // .orchestra/ no info/exclude do repo do agente
          const dir = path.join(c.cwd, ".orchestra", "shots");
          try { fs.mkdirSync(dir, { recursive: true }); } catch {}
          const destino = path.join(dir, nomeShot(nome, new Date()));
          try { fs.writeFileSync(destino, png); } catch {}
          // asset do canvas + no' imagem ligado ao navegador
          const id = idProjeto(c.projeto);
          const arq = randomUUID() + ".png";
          let url = "";
          try {
            fs.mkdirSync(path.join(CANVAS_DIR, id, "assets"), { recursive: true });
            fs.writeFileSync(path.join(CANVAS_DIR, id, "assets", arq), png);
            url = `/canvas/asset/${id}/${arq}`;
          } catch {}
          if (url) {
            const agora = Date.now();
            const imgId = `img:${nav.ok.id}:${agora}`;
            const imgNo: No = { id: imgId, tipo: "imagem", x: nav.ok.x + nav.ok.w + 40, y: nav.ok.y, w: 480, h: 360, dados: { url, nome }, rev: agora };
            const aresta: Aresta = { id: `${nav.ok.id}->${imgId}`, de: nav.ok.id, para: imgId, rev: agora };
            aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: imgNo }, { op: "upsert", tipo: "aresta", item: aresta }]);
          }
          responderTexto(res, 200, `captura de ${nome} salva\n${destino}`);
          return;
        }
        } catch (e) { responderTexto(res, 400, (e as Error)?.message ?? String(e)); return; }
        responderTexto(res, 400, "comando desconhecido: " + cmd);
        return;
      }
      responderTexto(res, 400, "comando desconhecido: " + cmd);
      return;
    }
    // ---- arvore e preview de arquivo do agente (F3/S2) ----
    if (caminho === "/arvore") {
      const params = new URL(url, "http://x").searchParams;
      const c = colabDe(params.get("agente") || "");
      // ./agente (comportamento de sempre) ou, na falta dele, ?projeto=<raiz> conhecido.
      const cwd = c?.cwd ?? (params.get("projeto") ? raizDeProjeto(params.get("projeto") as string) : undefined);
      if (!cwd) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(listarArvore(cwd)));
      return;
    }
    if (caminho === "/arquivo") {
      const params = new URL(url, "http://x").searchParams;
      const c = colabDe(params.get("agente") || "");
      // ./agente (comportamento de sempre) ou, na falta dele, ?projeto=<raiz> conhecido.
      const cwd = c?.cwd ?? (params.get("projeto") ? raizDeProjeto(params.get("projeto") as string) : undefined);
      if (!cwd) { res.writeHead(404); res.end(); return; }
      const limpo = validarCaminho(cwd, params.get("caminho") || "");
      if (!limpo) { res.writeHead(400); res.end(); return; }
      const raiz = path.resolve(cwd);
      const alvo = path.resolve(raiz, limpo);
      if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) { res.writeHead(400); res.end(); return; }
      let st: fs.Stats;
      try { st = fs.statSync(alvo); } catch { res.writeHead(404); res.end(); return; }
      if (!st.isFile()) { res.writeHead(404); res.end(); return; }
      if (st.size > 200 * 1024) { res.writeHead(413); res.end(); return; }
      let buf: Buffer;
      try { buf = fs.readFileSync(alvo); } catch { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(buf);
      return;
    }
    servirEstatico(url, res);
  });
}

// Em EADDRINUSE: se a porta fala /versao (e' um hub Hermes), pede pra ele ceder e assume a porta.
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
    if (!ehHub) return; // nao e' o Hermes: nunca interferir
    if (!sempreAssumir && !(j.versao < versaoUI())) return; // stdio: so' cede pra uma UI mais nova
    await fetch(`http://127.0.0.1:${PORT}/ceder`, { method: "POST", headers: { "X-Hermes": "1" }, signal: AbortSignal.timeout(1500) });
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
  sempreAssumir?: boolean; // modo --ui: assume a porta de qualquer hub Hermes, sem comparar versao
  subirServe?: (cwd: string, env?: Record<string, string | undefined>) => Promise<{ base: string; pid: number }>; // sobe `opencode serve` na cwd (injetavel)
  matarProcesso?: (pid: number) => void; // encerra o serve (injetavel)
  navegador?: Navegador; // driver do navegador embutido (F4/S2): liga as rotas /cli/browser-*
  pty?: PtyDriver; // driver de PTY (F4/S3): liga os agentes Claude Code; sem ele, POST /agentes tipo 'claude' falha
};

export async function iniciarUI(opts: OpcoesUI = {}): Promise<void> {
  if (servidor) return;
  onCeder = opts.onCeder ?? null;
  sempreAssumir = opts.sempreAssumir ?? false;
  subirServeAtual = opts.subirServe ?? subirServeReal;
  matarProcessoAtual = opts.matarProcesso ?? ((pid: number) => { try { process.kill(pid); } catch {} });
  navegadorAtual = opts.navegador; // F4/S2: sem driver, toda rota browser-* responde 400
  ptyAtual = opts.pty; // F4/S3: sem driver, POST /agentes tipo 'claude' responde 'falhou'
  carregarAgentes();
  if (!(await escutar())) await tentarAssumir();
  if (servidor) void reconectarPontes(); // agentes recarregados do disco ganham ponte de /event (F2.2)
  iniciarExpiracao(); // F3/S2: varre as conversas pendentes (expira -> avisa a origem)
  // Se o hub sumir (sessao fechou ou cedeu pra outro que depois saiu), quem estiver vivo reassume a porta.
  // Com sempreAssumir (app), perder a corrida pra um hub stdio nao e' definitivo: pede pra ele ceder de novo.
  if (!reassumir) reassumir = setInterval(() => { if (!servidor) void escutar().then((ok) => { if (!ok && sempreAssumir) void tentarAssumir(); }); }, 10_000);
  reassumir.unref();
}

// App reaberto (`hermes` com o app ja' aberto): retoma a porta na hora se um hub stdio ficou com ela.
export async function assumirPorta(): Promise<void> {
  if (servidor) return;
  if (!(await escutar())) await tentarAssumir();
}

// Encerra o servidor/watcher e limpa TODOS os intervalos (rescan, reassumir, limpeza). Usado nos testes.
export function pararUI(): void {
  if (intervalo) { clearInterval(intervalo); intervalo = null; }
  if (reassumir) { clearInterval(reassumir); reassumir = null; }
  if (limpeza) { clearInterval(limpeza); limpeza = null; }
  pararExpiracao();
  if (watcher) { try { watcher.close(); } catch {} watcher = null; }
  descarregarCanvas(); // grava ops pendentes do debounce antes de desligar
  for (const ctrl of pontes.values()) { try { ctrl.abort(); } catch {} }
  pontes.clear();
  serves.clear();
  for (const c of clientes) { try { c.res.end(); } catch {} }
  clientes.clear();
  fecharServidor(); // fecha conexoes abertas e guarda a promessa: o proximo escutar espera o socket liberar
  onCeder = null;
  sempreAssumir = false;
  navegadorAtual = undefined; // F4/S2: solta o driver do navegador entre sessoes de teste
  browserCache.clear();
  for (const p of ptyProcs.values()) { try { p.kill(); } catch {} } // F4/S3: encerra os PTYs dos agentes Claude
  ptyProcs.clear();
  ptyBuffers.clear();
  ptyAtual = undefined;
  aguardandoSet.clear();
}
