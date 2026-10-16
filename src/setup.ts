// setup.ts — instalador do `npx dev-orchestra`: detecta as ferramentas presentes, le a config atual,
// grava o MCP + env em cada uma (Claude Code, OpenCode, Codex, Cursor, Antigravity), instala as skills
// e limpa o legado. Tudo recebe `home` (pasta do usuario) pra poder rodar em pasta temporaria nos testes.
// Sem dependencia nova: so' node:fs/path (o TOML do Codex e' tratado por bloco de texto).
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, cpSync, readdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Provedores
// ---------------------------------------------------------------------------

export type ProvedorId = "go" | "deepseek" | "openrouter";

export interface Provedor {
  nome: string;
  env: string;
  modelos: string[];
}

export const PROVEDORES: Record<ProvedorId, Provedor> = {
  go: {
    nome: "OpenCode Go",
    env: "OPENCODE_GO_API_KEY",
    modelos: ["deepseek-v4.1-flash", "glm-5.2", "kimi-k3", "qwen3.8-max"],
  },
  deepseek: {
    nome: "DeepSeek",
    env: "DEEPSEEK_API_KEY",
    modelos: ["deepseek-flash"],
  },
  openrouter: {
    nome: "OpenRouter",
    env: "OPENROUTER_API_KEY",
    modelos: ["deepseek/deepseek-v4.1-flash"],
  },
};

// Ordem de prioridade do bridge (Go > DeepSeek > OpenRouter).
const ORDEM_PROVEDORES: ProvedorId[] = ["go", "deepseek", "openrouter"];

// Envs de chave que o bridge escolhe sozinho: saem do env extra pra nao "roubar" a prioridade.
const ENVS_CHAVE: string[] = [PROVEDORES.go.env, PROVEDORES.deepseek.env, PROVEDORES.openrouter.env];

// Ferramentas suportadas pelo instalador.
const FERRAMENTAS = ["claude", "opencode", "codex", "cursor", "antigravity"] as const;
export type Ferramenta = (typeof FERRAMENTAS)[number];

type Env = Record<string, string>;

// ---------------------------------------------------------------------------
// Utilitarios
// ---------------------------------------------------------------------------

function garantirPasta(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

function backupSeExistir(arquivo: string): void {
  if (existsSync(arquivo)) {
    try {
      copyFileSync(arquivo, arquivo + ".bak-dev-orchestra");
    } catch {
      /* backup e' best-effort */
    }
  }
}

function escreverTexto(arquivo: string, conteudo: string): void {
  garantirPasta(path.dirname(arquivo));
  backupSeExistir(arquivo);
  writeFileSync(arquivo, conteudo);
}

function escreverJson(arquivo: string, obj: unknown): void {
  escreverTexto(arquivo, JSON.stringify(obj, null, 2) + "\n");
}

function mensagem(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return `Falha ao gravar a configuracao: ${m}`;
}

function objetoOuVazio(v: unknown): any {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as any) : {};
}

function copiarEnv(origem: unknown): Env {
  const out: Env = {};
  const o = objetoOuVazio(origem);
  for (const [k, v] of Object.entries(o)) if (typeof v === "string") out[k] = v;
  return out;
}

// ---------------------------------------------------------------------------
// Mascarar
// ---------------------------------------------------------------------------

export function mascarar(chave: string): string {
  if (!chave || chave.length <= 7) return "•••";
  return chave.slice(0, 3) + "…" + chave.slice(-4);
}

// ---------------------------------------------------------------------------
// Deteccao
// ---------------------------------------------------------------------------

export interface Deteccao {
  claude: boolean;
  opencode: boolean;
  codex: boolean;
  cursor: boolean;
  antigravity: boolean;
}

export function detectar(home: string): Deteccao {
  return {
    claude: existsSync(path.join(home, ".claude")),
    opencode: existsSync(path.join(home, ".config", "opencode")),
    codex: existsSync(path.join(home, ".codex")),
    cursor: existsSync(path.join(home, ".cursor")),
    antigravity: existsSync(path.join(home, ".gemini")),
  };
}

// ---------------------------------------------------------------------------
// Leitura da config atual
// ---------------------------------------------------------------------------

// Le o `env` da entrada 'dev-orchestra' (ou 'hermes-bridge') de um JSON, usando `pega` pra
// localizar a entrada dentro do arquivo. Arquivo ausente/invalido -> {}.
function lerEntrada(arquivo: string, pega: (j: any) => any, campo: "env" | "environment"): Env {
  if (!existsSync(arquivo)) return {};
  try {
    const j = JSON.parse(readFileSync(arquivo, "utf8"));
    const entrada = objetoOuVazio(pega(j));
    return copiarEnv(entrada[campo]);
  } catch {
    return {};
  }
}

// Localiza a entrada do dev-orchestra (ou do antigo hermes-bridge) dentro de `mcpServers`.
function mcpServersEntrada(j: any): any {
  const s = objetoOuVazio(j?.mcpServers);
  return s["dev-orchestra"] ?? s["hermes-bridge"];
}

function lerClaudeEnv(home: string): Env {
  return lerEntrada(path.join(home, ".claude.json"), mcpServersEntrada, "env");
}

function lerOpencodeEnv(home: string): Env {
  return lerEntrada(
    path.join(home, ".config", "opencode", "opencode.json"),
    (j) => {
      const m = objetoOuVazio(j?.mcp);
      return m["dev-orchestra"] ?? m["hermes-bridge"];
    },
    "environment",
  );
}

function lerCursorEnv(home: string): Env {
  return lerEntrada(path.join(home, ".cursor", "mcp.json"), mcpServersEntrada, "env");
}

// Env "extra" da propria ferramenta: pega o env da entrada antiga dela, tirando as 3 envs de
// chave e HERMES_MODEL — o que sobra e' configuracao do usuario (ex.: HERMES_MAX_TURNS) e e'
// preservado. Cada ferramenta usa o seu, nao o das outras.
function envExtraFerramenta(home: string, ferramenta: string): Env {
  let cru: Env = {};
  if (ferramenta === "claude") cru = lerClaudeEnv(home);
  else if (ferramenta === "cursor") cru = lerCursorEnv(home);
  else if (ferramenta === "antigravity") {
    cru = {
      ...lerEntrada(path.join(home, ".gemini", "config", "mcp_config.json"), mcpServersEntrada, "env"),
      ...lerEntrada(path.join(home, ".gemini", "antigravity", "mcp_config.json"), mcpServersEntrada, "env"),
    };
  } else if (ferramenta === "opencode") cru = lerOpencodeEnv(home);

  const extra: Env = {};
  for (const [k, v] of Object.entries(cru)) {
    if (ENVS_CHAVE.includes(k) || k === "HERMES_MODEL") continue;
    extra[k] = v;
  }
  return extra;
}

export interface ConfigAtual {
  provedor: ProvedorId | null;
  modelo: string | null;
  chaveMascarada: string | null;
}

export function lerAtual(home: string): ConfigAtual {
  const env: Env = { ...lerClaudeEnv(home), ...lerOpencodeEnv(home), ...lerCursorEnv(home) };
  let provedor: ProvedorId | null = null;
  let chave: string | null = null;
  for (const id of ORDEM_PROVEDORES) {
    const v = env[PROVEDORES[id].env];
    if (typeof v === "string" && v.trim()) {
      provedor = id;
      chave = v;
      break;
    }
  }
  if (!provedor || !chave) return { provedor: null, modelo: null, chaveMascarada: null };
  const modelo = typeof env.HERMES_MODEL === "string" && env.HERMES_MODEL ? env.HERMES_MODEL : null;
  return { provedor, modelo, chaveMascarada: mascarar(chave) };
}

// ---------------------------------------------------------------------------
// Gravacao do MCP por ferramenta
// ---------------------------------------------------------------------------

function gravarClaude(home: string, app: string, env: Env): void {
  const arquivo = path.join(home, ".claude.json");
  let j: any = {};
  if (existsSync(arquivo)) j = JSON.parse(readFileSync(arquivo, "utf8")); // invalido -> throw (nao sobrescreve)
  j = objetoOuVazio(j);
  j.mcpServers = objetoOuVazio(j.mcpServers);
  delete j.mcpServers["hermes-bridge"];
  j.mcpServers["dev-orchestra"] = { type: "stdio", command: "node", args: [app], env };
  escreverJson(arquivo, j);
}

function gravarOpencode(home: string, app: string, env: Env): void {
  const arquivo = path.join(home, ".config", "opencode", "opencode.json");
  let j: any = {};
  if (existsSync(arquivo)) j = JSON.parse(readFileSync(arquivo, "utf8"));
  j = objetoOuVazio(j);
  if (!j.$schema) j.$schema = "https://opencode.ai/config.json";
  j.mcp = objetoOuVazio(j.mcp);
  delete j.mcp["hermes-bridge"];
  j.mcp["dev-orchestra"] = { type: "local", command: ["node", app], environment: env, enabled: true };
  escreverJson(arquivo, j);
}

function gravarFormatoCursor(arquivo: string, app: string, env: Env): void {
  let j: any = {};
  if (existsSync(arquivo)) j = JSON.parse(readFileSync(arquivo, "utf8"));
  j = objetoOuVazio(j);
  j.mcpServers = objetoOuVazio(j.mcpServers);
  delete j.mcpServers["hermes-bridge"];
  j.mcpServers["dev-orchestra"] = { command: "node", args: [app], env };
  escreverJson(arquivo, j);
}

const BLOCOS_TOML_REMOVER = [
  "[mcp_servers.dev-orchestra]",
  "[mcp_servers.dev-orchestra.env]",
  "[mcp_servers.hermes-bridge]",
  "[mcp_servers.hermes-bridge.env]",
];

// Remove um bloco TOML inteiro: do cabecalho ate' a proxima linha que comece com '['.
function removerBlocosToml(txt: string): string {
  const linhas = txt.split("\n");
  const out: string[] = [];
  let pulando = false;
  for (const linha of linhas) {
    if (linha.trimStart().startsWith("[")) {
      pulando = BLOCOS_TOML_REMOVER.includes(linha.trim());
    }
    if (!pulando) out.push(linha);
  }
  return out.join("\n");
}

function tomlEscape(v: string): string {
  return v.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function gravarCodex(home: string, app: string, env: Env): void {
  const arquivo = path.join(home, ".codex", "config.toml");
  let txt = existsSync(arquivo) ? readFileSync(arquivo, "utf8") : "";
  txt = removerBlocosToml(txt);
  if (txt.length > 0 && !txt.endsWith("\n")) txt += "\n";

  let bloco = `\n[mcp_servers.dev-orchestra]\ncommand = "node"\nargs = ["${tomlEscape(app)}"]\n`;
  bloco += `\n[mcp_servers.dev-orchestra.env]\n`;
  for (const [k, v] of Object.entries(env)) bloco += `${k} = "${tomlEscape(v)}"\n`;

  escreverTexto(arquivo, txt + bloco);
}

function gravarMcp(home: string, ferramenta: string, app: string, env: Env): void {
  switch (ferramenta) {
    case "claude":
      gravarClaude(home, app, env);
      break;
    case "opencode":
      gravarOpencode(home, app, env);
      break;
    case "cursor":
      gravarFormatoCursor(path.join(home, ".cursor", "mcp.json"), app, env);
      break;
    case "antigravity":
      gravarFormatoCursor(path.join(home, ".gemini", "config", "mcp_config.json"), app, env);
      gravarFormatoCursor(path.join(home, ".gemini", "antigravity", "mcp_config.json"), app, env);
      break;
    case "codex":
      gravarCodex(home, app, env);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

function destinosSkills(home: string, ferramenta: string): string[] {
  switch (ferramenta) {
    case "claude":
      return [path.join(home, ".claude", "skills")];
    case "opencode":
      return [path.join(home, ".config", "opencode", "skills")];
    case "codex":
      return [path.join(home, ".codex", "skills")];
    case "cursor":
      return [path.join(home, ".cursor", "skills")];
    case "antigravity":
      return [path.join(home, ".gemini", "skills"), path.join(home, ".gemini", "antigravity", "skills")];
    default:
      return [];
  }
}

function instalarSkills(home: string, skillsDir: string, ferramenta: string): void {
  const srcOrchestra = path.join(skillsDir, "orchestra", "SKILL.md");
  const srcPlan = path.join(skillsDir, "plan-sdd", "SKILL.md");
  for (const dest of destinosSkills(home, ferramenta)) {
    // orchestra: sempre sobrescreve (fica atualizada).
    if (existsSync(srcOrchestra)) {
      const alvo = path.join(dest, "orchestra", "SKILL.md");
      garantirPasta(path.dirname(alvo));
      writeFileSync(alvo, readFileSync(srcOrchestra));
    }
    // plan-sdd: so' instala se o usuario ainda nao tiver uma pasta propria.
    const pastaPlan = path.join(dest, "plan-sdd");
    if (!existsSync(pastaPlan) && existsSync(srcPlan)) {
      const alvo = path.join(pastaPlan, "SKILL.md");
      garantirPasta(pastaPlan);
      writeFileSync(alvo, readFileSync(srcPlan));
    }
  }
}

// ---------------------------------------------------------------------------
// Legado
// ---------------------------------------------------------------------------

function limparLegado(home: string, perfis: string[]): void {
  // Comandos antigos (skill orquestra do Claude/OpenCode).
  for (const p of [
    path.join(home, ".claude", "commands", "orchestra.md"),
    path.join(home, ".config", "opencode", "commands", "orchestra.md"),
  ]) {
    try {
      if (existsSync(p)) rmSync(p);
    } catch {
      /* best-effort */
    }
  }

  // Linhas que apontavam pra setup/profile.ps1 do bridge antigo.
  for (const perfil of perfis) {
    try {
      if (!existsSync(perfil)) continue; // nao cria perfil que nao existia
      const conteudo = readFileSync(perfil, "utf8");
      const novo = conteudo
        .split("\n")
        .filter((l) => !l.includes("setup\\profile.ps1") && !l.includes("setup/profile.ps1"))
        .join("\n");
      if (novo !== conteudo) {
        copyFileSync(perfil, perfil + ".bak-dev-orchestra");
        writeFileSync(perfil, novo);
      }
    } catch {
      /* best-effort */
    }
  }
}

// ---------------------------------------------------------------------------
// salvar
// ---------------------------------------------------------------------------

export interface ConfigSalvar {
  provedor: ProvedorId;
  modelo: string;
  chave: string;
  ferramentas: string[];
  app: string;
  skillsDir: string;
  perfis?: string[];
}

export interface ResultadoSalvar {
  ok: string[];
  erros: Record<string, string>;
}

export function salvar(home: string, cfg: ConfigSalvar): ResultadoSalvar {
  const { provedor, modelo, ferramentas, app, skillsDir } = cfg;
  const perfis = cfg.perfis ?? [];

  // Chave: vazia = mantem a atual (do mesmo provedor); sem atual -> erro.
  let chave = (cfg.chave ?? "").trim();
  if (!chave) {
    const cru: Env = { ...lerClaudeEnv(home), ...lerOpencodeEnv(home), ...lerCursorEnv(home) };
    const encontrada = cru[PROVEDORES[provedor].env];
    if (!encontrada || !encontrada.trim()) {
      throw new Error("Informe a chave do provedor (nao encontrei nenhuma chave atual pra reutilizar).");
    }
    chave = encontrada.trim();
  }

  // Env gravado no MCP: env extra da propria ferramenta + a chave do provedor escolhido + HERMES_MODEL.
  const ok: string[] = [];
  const erros: Record<string, string> = {};

  for (const ferramenta of ferramentas) {
    if (!FERRAMENTAS.includes(ferramenta as Ferramenta)) continue;
    try {
      const env: Env = {
        ...envExtraFerramenta(home, ferramenta),
        [PROVEDORES[provedor].env]: chave,
        HERMES_MODEL: modelo,
      };
      gravarMcp(home, ferramenta, app, env);
      instalarSkills(home, skillsDir, ferramenta);
      ok.push(ferramenta);
    } catch (e) {
      erros[ferramenta] = mensagem(e);
    }
  }

  limparLegado(home, perfis);

  return { ok, erros };
}

// ---------------------------------------------------------------------------
// Local do app (clone git vs pacote do npx)
// ---------------------------------------------------------------------------

export interface LocalApp {
  app: string;
  copiar: boolean;
}

export function localDoApp(pacote: string, home: string): LocalApp {
  if (existsSync(path.join(pacote, ".git"))) {
    return { app: path.join(pacote, "dist", "index.js"), copiar: false };
  }
  return { app: path.join(home, ".dev-orchestra", "app", "dist", "index.js"), copiar: true };
}

export function copiarApp(pacote: string, destino: string): void {
  if (existsSync(destino)) rmSync(destino, { recursive: true, force: true });
  garantirPasta(destino);
  for (const item of readdirSync(pacote)) {
    if (item === "node_modules" || item === ".git") continue;
    cpSync(path.join(pacote, item), path.join(destino, item), { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// Teste de chave
// ---------------------------------------------------------------------------

export interface TesteChave {
  ok: boolean;
  erro?: string;
}

type FetchLike = (
  url: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export async function testarChave(
  provedor: ProvedorId,
  modelo: string,
  chave: string,
  fetchFn: FetchLike = fetch as unknown as FetchLike,
): Promise<TesteChave> {
  let url: string;
  let headers: Record<string, string>;
  const corpoBase = { max_tokens: 1, messages: [{ role: "user", content: "ok" }] };

  if (provedor === "go") {
    url = "https://opencode.ai/zen/go/v1/chat/completions";
    // OpenCode Go exige o x-opencode-session (400 MissingSessionID sem ele); id unico por teste.
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chave}`,
      "x-opencode-session": randomUUID(),
    };
  } else if (provedor === "deepseek") {
    url = "https://api.deepseek.com/anthropic/v1/messages";
    headers = { "Content-Type": "application/json", "x-api-key": chave, "anthropic-version": "2023-06-01" };
  } else {
    url = "https://openrouter.ai/api/v1/messages";
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${chave}`,
      "anthropic-version": "2023-06-01",
    };
  }

  const body = JSON.stringify({ model: modelo, ...corpoBase });

  try {
    const resp = await fetchFn(url, { method: "POST", headers, body });
    if (resp.ok) return { ok: true };
    let texto = "";
    try {
      texto = await resp.text();
    } catch {
      texto = "";
    }
    const trecho = (texto || "").replace(/\s+/g, " ").trim().slice(0, 200);
    return {
      ok: false,
      erro: `O provedor recusou (${resp.status}): ${trecho || "sem corpo"}. Verifique se a chave e o modelo '${modelo}' estao corretos e validos.`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, erro: `Sem conexao com o provedor: ${msg}` };
  }
}
