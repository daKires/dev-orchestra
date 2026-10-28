// Núcleo do hub do dashboard: pastas de dados compartilhadas, JSONL das runs, registros de
// planejadores e o barramento SSE (quem pega a porta empurra TODOS os arquivos pro browser).
// Nunca importa ./ui.js (o ui.ts importa daqui).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
// S6: as rotas das acoes da run (G1/S2 merge|pr|descartar e G3 instrucao|pausa) moram aqui; o ui.ts
// fica so' com o roteador, que chama rotasRuns.
import { mergeLocal, descartarRun, abrirPr, type ResultadoAcao } from "./acoes-run.js";
import { validarAcaoSlice, validarTexto, gravarInstrucao, pausarSlice, retomarSlice } from "./instrucoes.js";

export const PORT = Number(process.env.DEV_ORCHESTRA_UI_PORT || "4123");
// Dados do hub fora do TEMP (o Windows limpa %TEMP%): tudo vive em ~/.dev-orchestra/dados.
// (a migracao do local antigo mora no ui.ts, o unico que conhece o nome anterior do produto)
export const DADOS_DIR = path.join(os.homedir(), ".dev-orchestra", "dados");
export const RUNS_DIR = process.env.DEV_ORCHESTRA_RUNS_DIR || path.join(DADOS_DIR, "runs"); // barramento em disco, compartilhado entre processos
// Registros dos planejadores: um JSON por worktree com o chat do planejador.
export const PLANEJADORES_DIR = process.env.DEV_ORCHESTRA_PLANEJADORES_DIR || path.join(DADOS_DIR, "planejadores");
// Canvas: um subdiretorio por projeto (idProjeto) com canvas.json + assets/. Injetavel por env.
export const CANVAS_DIR = process.env.DEV_ORCHESTRA_CANVAS_DIR || path.join(DADOS_DIR, "canvas");
// Agentes (F2/S3): um JSON por agente do canvas (validado por validarAgente). Injetavel por env.
export const AGENTES_DIR = process.env.DEV_ORCHESTRA_AGENTES_DIR || path.join(DADOS_DIR, "agentes");
const SWARM_ID = randomUUID().slice(0, 8);                        // um id por processo/sessao
const PODA_MS = 7 * 24 * 3600 * 1000;                             // historico de 7 dias
export const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");

// Copia o antigo pro novo uma vez so': nunca toca num destino que ja existe.
export function migrarDadosAntigos(antigo: string, novo: string): boolean {
  try {
    if (!fs.existsSync(antigo) || fs.existsSync(novo)) return false;
    fs.cpSync(antigo, novo, { recursive: true });
    return true;
  } catch { return false; }
}

// (o mkdir de RUNS_DIR e a migracao das pastas antigas ficam no ui.ts: precisam rodar depois da
// migracao e ANTES do primeiro uso da pasta de runs — o ui.ts e' o ponto de entrada do hub.)

export type SlicePlano = { tarefa: string; arquivos_alvo: string[]; descricao: string };

// Registro de um planejador: o worktree onde o OpenCode roda e a URL do chat.
export type Planejador = {
  slug: string; projeto: string; raiz: string; cwd: string;
  feature: string; url: string; base: string; pid: number; ts: number;
};

export type Evento = { ts?: number } & (
  | { t: "run"; feature: string; cwd: string; total: number; plano?: SlicePlano[]; cmds?: string[]; gate?: string[]; pid?: number;
      sessao?: { planejador: "claude" | "opencode" | "antigravity"; id: string; host?: string }; mcpRunId?: string }
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

// S3: como abrir o dashboard — o app Dev Orchestra instalado vence; senao o navegador do sistema. Pura.
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
export function parse(txt: string): Evento[] {
  const evs: Evento[] = [];
  for (const l of txt.split("\n")) if (l) { try { evs.push(JSON.parse(l)); } catch {} }
  return evs;
}

// <runId>.instrucao.jsonl e' a caixa de instrucoes da slice, nao uma run.
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

// Id da run no hub a partir do id completo, do mcpRunId (o que executar_orchestra devolve) ou de um
// prefixo unico (>= 8 chars) de qualquer um dos dois; null se nao achar ou se o prefixo for ambiguo.
export function resolverIdRun(q: string, dir = RUNS_DIR): string | null {
  const achados = new Set<string>();
  for (const [id, evs] of lerRuns(dir)) {
    const ev = evs.find((e) => e.t === "run");
    const m = ev && ev.t === "run" ? ev.mcpRunId ?? "" : "";
    if (id === q || m === q) return id;
    if (q.length >= 8 && (id.startsWith(q) || (m && m.startsWith(q)))) achados.add(id);
  }
  return achados.size === 1 ? [...achados][0] : null;
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

// Deriva a linha de texto crua (stderr + DEV_ORCHESTRA_LOG) de um evento, preservando o log ao vivo de sempre.
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
export type Cliente = { res: ServerResponse; offsets: Map<string, number> };
export const clientes = new Set<Cliente>();
export const estado = new Map<string, Evento[]>();
const vistos = new Map<string, string>(); // arquivo -> "size:mtime" (so rele o que mudou)
export let planejadores: Planejador[] = [];         // ultima lista empurrada via SSE
let planejadoresAssinatura = "";                    // muda -> avisa os clientes

// Ganchos do ui.ts (o hub nao importa o ui): um planejador novo ganha token/identidade (F3/S2) e a
// lista nova reabre as pontes do /event das bases conhecidas (F2.2). Sem gancho ligado, nada acontece.
export type GanchosHub = {
  aoMudarPlanejadores: (lista: Planejador[]) => void;
};
let ganchosHub: GanchosHub = { aoMudarPlanejadores: () => {} };
export function definirGanchosHub(g: GanchosHub): void { ganchosHub = g; }

export function sse(c: Cliente, dado: unknown): void {
  try { c.res.write(`data: ${JSON.stringify(dado)}\n\n`); } catch {}
}

// Envia pro cliente so os eventos ainda nao enviados (deltas), por run.
export function enviar(c: Cliente): void {
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
  ganchosHub.aoMudarPlanejadores(lista); // F3/S2: identidade do planejador (uma vez) + F2.2: reabre as pontes
}

// Rele so os arquivos que mudaram e empurra novidades/drops. Chamada por fs.watch e por um intervalo
// (o fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
export function rescan(): void {
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
export function podar(): void {
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

export function servirEstatico(url: string, res: ServerResponse): void {
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

// Acoes so via POST com header X-Dev-Orchestra: header custom forca preflight CORS, que este servidor nao
// responde -> site externo aberto no browser nao consegue cancelar run nem derrubar o hub.
export function acaoValida(req: IncomingMessage): boolean {
  return req.method === "POST" && req.headers["x-dev-orchestra"] === "1";
}

export function broadcast(dado: unknown): void { for (const c of clientes) sse(c, dado); }

// Barra DNS rebinding: dominio alheio que resolve pra 127.0.0.1 chega com o Host dele (e o X-Dev-Orchestra).
export function hostLocal(cabecalho: string | string[] | undefined, porta: number): boolean {
  const h = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  if (typeof h !== "string") return false;
  const alvo = h.toLowerCase();
  return alvo === "127.0.0.1:" + porta || alvo === "localhost:" + porta;
}

export function responderTexto(res: ServerResponse, status: number, texto: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(texto);
}

// Le o corpo de um POST com teto de bytes; null = estourou o limite (o chamador responde 400).
// Decodifica so' no fim: acento partido entre chunks chega integro.
export function lerCorpo(req: IncomingMessage, limite: number): Promise<string | null> {
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

// ---- acoes da run no card: POST /runs/acao?run=<id> {acao} -> merge | pr | descartar (G1/S2) ----
const LIMITE_BODY = 64 * 1024; // 64KB: teto padrao dos demais POSTs; acima disso e' abuso -> 400
const ACOES_RUN = new Set(["merge", "pr", "descartar"]);

// Eventos da run: da memoria (rescan) ou, se ainda nao lidos, do JSONL em disco. null = run desconhecida.
export function eventosDaRun(id: string): Evento[] | null {
  const emMemoria = estado.get(id);
  if (emMemoria) return emMemoria;
  try { return parse(fs.readFileSync(path.join(RUNS_DIR, id + ".jsonl"), "utf8")); } catch { return null; }
}

// Corpo do PR: resumo por slice (ultima linha de cada uma) + gate ok + custo total (soma das metricas).
export function corpoDoPr(evs: Evento[]): string {
  const slices = new Map<number, { tarefa: string; status: string }>();
  let gateOk = false;
  let custo = 0;
  for (const ev of evs) {
    if (ev.t === "slice") slices.set(ev.idx, { tarefa: ev.tarefa, status: ev.status });
    else if (ev.t === "gate" && ev.status === "ok") gateOk = true;
    else if (ev.t === "metrica") custo += ev.custoUSD;
  }
  const limpar = (n: number, t: string) => { const m = t.match(new RegExp(`^s${n}(?:\\s*[·:-]\\s*|\\s+)`, "i")); return (m && t.slice(m[0].length).trim()) || t; };
  const linhas = [...slices.entries()].sort((a, b) => a[0] - b[0]).map(([n, s]) => `- S${n} ${limpar(n, s.tarefa)}: ${s.status}`);
  let corpo = "## Resumo\n" + linhas.join("\n");
  if (gateOk) corpo += "\n\nGate: ok";
  corpo += `\n\nCusto total: $${custo.toFixed(3).replace(".", ",")}`;
  return corpo;
}

// Rotas das acoes da run: /runs/acao (merge|pr|descartar) e /runs/instrucao|pausa (G3). true = respondeu.
// Mesmo contrato do rotasCanvas/rotasAgentes: o roteador do ui.ts so' despacha.
export async function rotasRuns(req: IncomingMessage, res: ServerResponse, caminho: string, url: string): Promise<boolean> {
  if (caminho === "/runs/acao") {
    // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
    const corpo = await lerCorpo(req, LIMITE_BODY);
    if (corpo === null) { res.writeHead(400); res.end(); return true; }
    if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
    let j: any = null;
    try { j = JSON.parse(corpo); } catch {}
    const acao = j && typeof j.acao === "string" ? j.acao : "";
    if (!ACOES_RUN.has(acao)) { res.writeHead(400); res.end(); return true; }
    const id = new URL(url, "http://x").searchParams.get("run") || "";
    if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return true; }
    const evs = eventosDaRun(id);
    const runEv = evs && evs.find((e) => e.t === "run");
    if (!runEv || runEv.t !== "run") { res.writeHead(404); res.end(); return true; }
    const painel = [...evs!].reverse().find((e) => e.t === "painel");
    if (!painel || painel.t !== "painel") { responderTexto(res, 409, "run ainda rodando"); return true; }
    if ((acao === "merge" || acao === "pr") && painel.status !== "COMPLETE") { responderTexto(res, 409, "só para runs COMPLETE"); return true; }
    let r: ResultadoAcao;
    if (acao === "merge") r = mergeLocal({ cwd: runEv.cwd, branch: painel.branch, base: painel.base });
    else if (acao === "descartar") r = descartarRun({ cwd: runEv.cwd, branch: painel.branch, base: painel.base });
    else r = abrirPr({ cwd: runEv.cwd, branch: painel.branch, feature: runEv.feature, corpo: corpoDoPr(evs!), base: painel.base });
    res.writeHead(r.ok ? 200 : 409, { "Content-Type": "application/json" });
    res.end(JSON.stringify(r));
    return true;
  }
  // G3: instruir e pausar a slice RODANDO pelo card do canvas (POST /runs/instrucao e /runs/pausa).
  // Ordem: drena o corpo -> X-Dev-Orchestra -> JSON -> slice inteiro >= 1 -> validarAcaoSlice -> acao/texto.
  if (caminho !== "/runs/instrucao" && caminho !== "/runs/pausa") return false;
  const corpo = await lerCorpo(req, LIMITE_BODY);
  if (corpo === null) { res.writeHead(400); res.end(); return true; }
  if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
  let j: any = null;
  try { j = JSON.parse(corpo); } catch {}
  if (!j || typeof j !== "object") { res.writeHead(400); res.end(); return true; }
  const slice = Number(j.slice);
  if (!Number.isInteger(slice) || slice < 1) { res.writeHead(400); res.end(); return true; }
  const id = new URL(url, "http://x").searchParams.get("run") || "";
  if (!/^[a-z0-9-]+$/.test(id)) { res.writeHead(400); res.end(); return true; }
  const cancelado = fs.existsSync(arquivoCancel(id));
  const erro = validarAcaoSlice(eventosDaRun(id), slice, cancelado);
  if (erro) { responderTexto(res, erro.status, erro.erro); return true; }
  if (caminho === "/runs/instrucao") {
    const e = validarTexto(j.texto, true);
    if (e) { responderTexto(res, 400, e); return true; }
    gravarInstrucao(RUNS_DIR, id, slice, j.texto.trim());
    res.writeHead(204); res.end(); return true;
  }
  const acao = typeof j.acao === "string" ? j.acao : "";
  if (acao === "pausar") { pausarSlice(RUNS_DIR, id, slice); res.writeHead(204); res.end(); return true; }
  if (acao === "retomar") {
    const e = validarTexto(j.texto, false);
    if (e) { responderTexto(res, 400, e); return true; }
    retomarSlice(RUNS_DIR, id, slice, typeof j.texto === "string" ? j.texto.trim() : undefined);
    res.writeHead(204); res.end(); return true;
  }
  res.writeHead(400); res.end();
  return true;
}
