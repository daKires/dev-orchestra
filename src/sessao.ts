import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

export type PlanejadorSessao = "claude" | "opencode" | "antigravity";

export type Sessao = { planejador: PlanejadorSessao; id: string; host?: string };

export type RunDaSessao = {
  id: string;
  ts?: number;
  sessao?: { planejador?: string; id?: string; host?: string } | null;
  mcpRunId?: string;
};

export type ComoAbrir = { comando: string; args: string[]; copia: string };

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_HOST = /^local_[A-Za-z0-9-]{1,64}$/;
const RE_ID_OPENCODE = /^ses_[A-Za-z0-9]+$/;
// Aspas e metacaracteres de shell/CMD nunca entram na pasta: o comando vai pro terminal do usuario.
const RE_PASTA_RUIM = /["&|<>^%]/;

// node:sqlite e' experimental: onde ele nao existe, a descoberta do OpenCode simplesmente nao acontece
// (a ausencia nunca derruba o bridge, que sobe em qualquer Node >= 22).
type Db = import("node:sqlite").DatabaseSync;
let DatabaseSync: (new (caminho: string, opcoes?: { readOnly?: boolean }) => Db) | null = null;
try {
  DatabaseSync = (createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite")).DatabaseSync;
} catch {}

function normalizarCaminho(p: string): string {
  return String(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function caminhoDbOpenCode(env: NodeJS.ProcessEnv): string {
  return env.DEV_ORCHESTRA_OPENCODE_DB
    || process.env.DEV_ORCHESTRA_OPENCODE_DB
    || path.join(os.homedir(), ".local", "share", "opencode", "opencode.db");
}

function abrirDbOpenCode(env: NodeJS.ProcessEnv): Db | null {
  const Ctor = DatabaseSync;
  if (!Ctor) return null;
  return new Ctor(caminhoDbOpenCode(env), { readOnly: true });
}

// Antigravity guarda as conversas num SQLite em ~/.gemini/antigravity (injetavel pra testes).
function caminhoDbAntigravity(env: NodeJS.ProcessEnv = process.env): string {
  return env.DEV_ORCHESTRA_ANTIGRAVITY_DB
    || process.env.DEV_ORCHESTRA_ANTIGRAVITY_DB
    || path.join(os.homedir(), ".gemini", "antigravity", "conversation_summaries.db");
}

function abrirDbAntigravity(env: NodeJS.ProcessEnv = process.env): Db | null {
  const Ctor = DatabaseSync;
  if (!Ctor) return null;
  return new Ctor(caminhoDbAntigravity(env), { readOnly: true });
}

function pastaAnnotationsAntigravity(): string {
  return process.env.DEV_ORCHESTRA_ANTIGRAVITY_ANNOTATIONS
    || path.join(os.homedir(), ".gemini", "antigravity", "annotations");
}

// workspace_uris e' um JSON de file:// URIs; URI invalida nao derruba a linha (vira "" e nunca casa).
function workspacesDaConversa(workspaceUris: unknown): string[] {
  let uris: unknown;
  try { uris = JSON.parse(String(workspaceUris || "[]")); } catch { return []; }
  if (!Array.isArray(uris)) return [];
  const out: string[] = [];
  for (const u of uris) {
    try { out.push(normalizarCaminho(fileURLToPath(String(u)))); } catch {}
  }
  return out;
}

/**
 * Sessao do planejador desta run: Claude Code pelas envs (CLAUDE_CODE_SESSION_ID/HOST_SESSION_ID),
 * senao OpenCode (OPENCODE=1) pela sessao raiz (parent_id NULL) da MESMA pasta, a mais recente,
 * senao Antigravity (env direta ou o banco de conversas filtrado pelo workspace).
 * Nada disso presente (ou qualquer erro) -> undefined.
 */
export function sessaoAtual(env: NodeJS.ProcessEnv, cwd: string): Sessao | undefined {
  const idCli = env.CLAUDE_CODE_SESSION_ID;
  if (typeof idCli === "string" && idCli) {
    const host = env.CLAUDE_CODE_HOST_SESSION_ID;
    return typeof host === "string" && host
      ? { planejador: "claude", id: idCli, host }
      : { planejador: "claude", id: idCli };
  }
  const doOpenCode = env.OPENCODE === "1" ? sessaoOpenCode(env, cwd) : undefined;
  if (doOpenCode) return doOpenCode;
  return sessaoAntigravity(env, cwd);
}

// Sessao raiz do OpenCode na pasta: subsessoes (parent_id preenchido) sao de subagentes.
function sessaoOpenCode(env: NodeJS.ProcessEnv, cwd: string): Sessao | undefined {
  try {
    const db = abrirDbOpenCode(env);
    if (!db) return undefined;
    try {
      const alvo = normalizarCaminho(cwd);
      let melhor: string | undefined;
      let maior = -Infinity;
      for (const l of db.prepare("SELECT id, directory, time_updated FROM session WHERE parent_id IS NULL").all()) {
        if (normalizarCaminho(String(l.directory ?? "")) !== alvo) continue;
        const ts = Number(l.time_updated ?? 0);
        if (ts > maior) { maior = ts; melhor = String(l.id ?? ""); }
      }
      return melhor ? { planejador: "opencode", id: melhor } : undefined;
    } finally { try { db.close(); } catch {} }
  } catch { return undefined; }
}

/**
 * Antigravity: a env ANTIGRAVITY_CONVERSATION_ID ja' diz a conversa; sem ela (mas rodando dentro do
 * agente, ou com o banco injetado), acha a conversa RAIZ mais recente cujo workspace e' a pasta atual
 * ou um pai dela (o cwd costuma ser uma subpasta do workspace aberto no app).
 */
function sessaoAntigravity(env: NodeJS.ProcessEnv, cwd: string): Sessao | undefined {
  const idEnv = env.ANTIGRAVITY_CONVERSATION_ID;
  if (typeof idEnv === "string" && RE_UUID.test(idEnv)) return { planejador: "antigravity", id: idEnv };
  const dbDefinido = env.DEV_ORCHESTRA_ANTIGRAVITY_DB || process.env.DEV_ORCHESTRA_ANTIGRAVITY_DB;
  if (env.ANTIGRAVITY_AGENT !== "1" && !dbDefinido) return undefined;
  try {
    const db = abrirDbAntigravity(env);
    if (!db) return undefined;
    try {
      const alvo = normalizarCaminho(cwd);
      let melhor: string | undefined;
      let maiorTs = -Infinity;
      let melhorLm = "";
      // so' conversas raiz (parent_conversation_id vazio): as filhas sao de subagentes.
      for (const l of db.prepare("SELECT conversation_id, workspace_uris, last_modified_time FROM conversation_summaries WHERE parent_conversation_id = ''").all()) {
        const casa = workspacesDaConversa(l.workspace_uris).some((ws) => ws !== "" && (alvo === ws || alvo.startsWith(ws + "/")));
        if (!casa) continue;
        const lm = String(l.last_modified_time ?? "");
        const parsed = Date.parse(lm);
        const ts = Number.isFinite(parsed) ? parsed : 0;
        if (melhor === undefined || ts > maiorTs || (ts === maiorTs && lm > melhorLm)) {
          melhor = String(l.conversation_id ?? "");
          maiorTs = ts;
          melhorLm = lm;
        }
      }
      return melhor ? { planejador: "antigravity", id: melhor } : undefined;
    } finally { try { db.close(); } catch {} }
  } catch { return undefined; }
}

// Cache por caminho+mtimeMs+size: o transcript cresce a cada mensagem, mas o titulo raramente muda.
// O size entra na chave porque duas escritas no MESMO milissegundo teriam o mesmo mtimeMs (titulo velho).
const cacheTitulos = new Map<string, { mtime: number; size: number; titulo: string }>();

function raizProjetosClaude(): string {
  return process.env.DEV_ORCHESTRA_CLAUDE_PROJECTS || path.join(os.homedir(), ".claude", "projects");
}

// O transcript <uuid>.jsonl mora em alguma subpasta de ~/.claude/projects; o titulo e' o customTitle
// da ULTIMA linha type 'custom-title' (renomear o chat so' acrescenta linhas novas).
function tituloClaude(id: string): string {
  const raiz = raizProjetosClaude();
  let entradas: string[] = [];
  try { entradas = fs.readdirSync(raiz, { recursive: true, encoding: "utf8" }); } catch { return ""; }
  const nome = id + ".jsonl";
  const achado = entradas.find((e) => path.basename(e) === nome);
  if (!achado) return "";
  const arq = path.join(raiz, achado);
  let mtime = 0;
  let size = -1;
  try { const st = fs.statSync(arq); mtime = st.mtimeMs; size = st.size; } catch { return ""; }
  const cache = cacheTitulos.get(arq);
  if (cache && cache.mtime === mtime && cache.size === size) return cache.titulo;
  let titulo = "";
  try {
    for (const linha of fs.readFileSync(arq, "utf8").split("\n")) {
      if (!linha.includes("custom-title")) continue;
      try {
        const j = JSON.parse(linha);
        if (j?.type === "custom-title" && typeof j.customTitle === "string") titulo = j.customTitle;
      } catch {}
    }
  } catch { return ""; }
  cacheTitulos.set(arq, { mtime, size, titulo });
  return titulo;
}

function tituloOpenCode(id: string): string {
  const db = abrirDbOpenCode(process.env);
  if (!db) return "";
  try {
    const l = db.prepare("SELECT title FROM session WHERE id = ?").get(id);
    return l && typeof l.title === "string" ? l.title : "";
  } catch { return ""; } finally { try { db.close(); } catch {} }
}

// O titulo do Antigravity vive no SQLite (conversation_summaries.title); quando o banco nao tem a
// conversa (ou node:sqlite nao existe), cai no annotations/<id>.pbtxt, onde o titulo e' o campo title.
function tituloAntigravity(id: string): string {
  const db = abrirDbAntigravity();
  if (db) {
    try {
      const l = db.prepare("SELECT title FROM conversation_summaries WHERE conversation_id = ?").get(id);
      if (l && typeof l.title === "string" && l.title) return l.title;
    } catch {} finally { try { db.close(); } catch {} }
  }
  try {
    const txt = fs.readFileSync(path.join(pastaAnnotationsAntigravity(), id + ".pbtxt"), "utf8");
    const m = /title:\s*"((?:[^"\\]|\\.)*)"/.exec(txt);
    return m ? m[1] : "";
  } catch { return ""; }
}

export function tituloSessao(sessao: Sessao, _pasta?: string): string {
  try {
    if (sessao.planejador === "claude") return tituloClaude(sessao.id);
    if (sessao.planejador === "opencode") return tituloOpenCode(sessao.id);
    if (sessao.planejador === "antigravity") return tituloAntigravity(sessao.id);
  } catch { return ""; }
  return "";
}

let wtDisponivel: boolean | null = null;

// Windows Terminal instalado? (wt -d <pasta> ja' abre o terminal na pasta da sessao)
function temWT(): boolean {
  if (wtDisponivel !== null) return wtDisponivel;
  try {
    execSync("where wt", { stdio: "ignore", windowsHide: true, timeout: 3000 });
    wtDisponivel = true;
  } catch { wtDisponivel = false; }
  return wtDisponivel;
}

function comandoNavegador(url: string, plataforma: NodeJS.Platform): { comando: string; args: string[] } {
  if (plataforma === "win32") return { comando: "cmd", args: ["/c", "start", "", url] };
  if (plataforma === "darwin") return { comando: "open", args: [url] };
  return { comando: "xdg-open", args: [url] };
}

function abrirClaude(sessao: Sessao, plataforma: NodeJS.Platform): ComoAbrir | null {
  if (!RE_UUID.test(sessao.id)) return null;
  let host: string | undefined;
  if (sessao.host !== undefined) {
    if (!RE_HOST.test(sessao.host)) return null;
    host = sessao.host;
  }
  // com host-session o app retoma a sessao LOCAL (mesma maquina); sem ele, o resume pelo id do chat.
  const url = host ? `claude://code/continue?session=${host}` : `claude://resume?session=${sessao.id}`;
  return { ...comandoNavegador(url, plataforma), copia: `claude --resume ${sessao.id}` };
}

function abrirOpenCode(id: string, pasta: string, plataforma: NodeJS.Platform): ComoAbrir | null {
  if (!RE_ID_OPENCODE.test(id)) return null;
  if (typeof pasta !== "string" || !pasta || RE_PASTA_RUIM.test(pasta)) return null;
  try { if (!fs.statSync(pasta).isDirectory()) return null; } catch { return null; }
  const copia = `cd "${pasta}" && opencode -s ${id}`;
  if (plataforma === "win32") {
    return temWT()
      ? { comando: "wt", args: ["-d", pasta, "opencode", "-s", id], copia }
      : { comando: "cmd", args: ["/c", "start", "", "/D", pasta, "cmd", "/k", "opencode", "-s", id], copia };
  }
  if (plataforma === "darwin") return { comando: "open", args: ["-a", "Terminal", pasta], copia };
  return { comando: "xdg-open", args: [pasta], copia };
}

// Antigravity: deep link do app pra conversa (so' o id validado entra na URL).
function abrirAntigravity(id: string, plataforma: NodeJS.Platform): ComoAbrir | null {
  if (!RE_UUID.test(id)) return null;
  return { ...comandoNavegador(`antigravity://conversation/${id}`, plataforma), copia: id };
}

/**
 * Como reabrir a sessao: deep link do app Claude (id/host validados), terminal novo do OpenCode
 * (id validado, pasta existente e sem metacaractere) ou deep link do Antigravity (id UUID).
 * Planejador desconhecido/entrada invalida -> null.
 */
export function comoAbrirSessao(sessao: Sessao, pasta: string, plataforma: NodeJS.Platform): ComoAbrir | null {
  try {
    if (sessao.planejador === "claude") return abrirClaude(sessao, plataforma);
    if (sessao.planejador === "opencode") return abrirOpenCode(sessao.id, pasta, plataforma);
    if (sessao.planejador === "antigravity") return abrirAntigravity(sessao.id, plataforma);
  } catch { return null; }
  return null;
}

export function runMaisRecenteDaSessao(runs: RunDaSessao[], sessaoId: string): string | null {
  let melhor: string | null = null;
  let maior = -Infinity;
  for (const r of runs) {
    if (!r || !r.id || r.sessao?.id !== sessaoId) continue;
    const ts = typeof r.ts === "number" && Number.isFinite(r.ts) ? r.ts : -Infinity;
    if (melhor === null || ts > maior) { maior = ts; melhor = r.id; }
  }
  return melhor;
}
