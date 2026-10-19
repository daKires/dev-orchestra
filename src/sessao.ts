import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

export type PlanejadorSessao = "claude" | "opencode";

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

/**
 * Sessao do planejador desta run: Claude Code pelas envs (CLAUDE_CODE_SESSION_ID/HOST_SESSION_ID),
 * senao OpenCode (OPENCODE=1) pela sessao raiz (parent_id NULL) da MESMA pasta, a mais recente.
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
  if (env.OPENCODE !== "1") return undefined;
  try {
    const db = abrirDbOpenCode(env);
    if (!db) return undefined;
    try {
      const alvo = normalizarCaminho(cwd);
      let melhor: string | undefined;
      let maior = -Infinity;
      // subsessoes (parent_id preenchido) sao de subagentes: so' a raiz identifica a sessao do usuario.
      for (const l of db.prepare("SELECT id, directory, time_updated FROM session WHERE parent_id IS NULL").all()) {
        if (normalizarCaminho(String(l.directory ?? "")) !== alvo) continue;
        const ts = Number(l.time_updated ?? 0);
        if (ts > maior) { maior = ts; melhor = String(l.id ?? ""); }
      }
      return melhor ? { planejador: "opencode", id: melhor } : undefined;
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

export function tituloSessao(sessao: Sessao, _pasta?: string): string {
  try {
    if (sessao.planejador === "claude") return tituloClaude(sessao.id);
    if (sessao.planejador === "opencode") return tituloOpenCode(sessao.id);
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

/**
 * Como reabrir a sessao: deep link do app Claude (id/host validados) ou terminal novo do OpenCode
 * (id validado, pasta existente e sem metacaractere). Planejador desconhecido/entrada invalida -> null.
 */
export function comoAbrirSessao(sessao: Sessao, pasta: string, plataforma: NodeJS.Platform): ComoAbrir | null {
  try {
    if (sessao.planejador === "claude") return abrirClaude(sessao, plataforma);
    if (sessao.planejador === "opencode") return abrirOpenCode(sessao.id, pasta, plataforma);
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
