// O swarm Hermes: BASELINE -> AGENTES DeepSeek (serial, com ferramentas) -> GATE -> commit local.
// Quem planeja e o Claude; aqui chega o plano pronto (slices). Quem revisa/barra e o Claude (ver /orchestra).
import { mensagem as mensagemReal, texto, CanceladoError, type MensagemFn, type Ferramenta, type Msg } from "./deepseek.js";
import { type Evento, type Emitir } from "./ui.js";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const pexec = promisify(execFile); // git
const pshell = promisify(exec);    // comandos allowlisted / gate (build/teste/typecheck)
const MAX_TURNS = Number(process.env.HERMES_MAX_TURNS || "25");
const CMD_TIMEOUT = Number(process.env.HERMES_CMD_TIMEOUT_MS || "120000");

export const REPAIR_TRIES = Number(process.env.HERMES_REPAIR_TRIES ?? "1");
export function podeReparar(tentativa: number, tries: number = REPAIR_TRIES): boolean {
  return tentativa < tries;
}

export type Tarefa = { tarefa: string; arquivos_alvo: string[]; descricao: string };

// Override opcional vindo do planner (tool): allowlist e/ou gate explicitos.
export type Override = { cmds?: string[]; gate?: string[] };

// Resolve COMANDOS/gate a partir do package.json do alvo (auto-detect), com override do planner e
// fallback pro env legado (HERMES_CMDS/HERMES_GATE). PURA -> testavel no selftest.
export function resolverDeScripts(
  scripts: Record<string, string> | null,
  override: Override | undefined,
  envCmds: string[],
  envGate: string[],
): { cmds: string[]; gate: string[]; origem: string } {
  let cmds: string[];
  let gate: string[];
  let origem: string;
  if (scripts) {
    cmds = Object.keys(scripts).map((k) => "npm run " + k);
    if (scripts.test) cmds.push("npm test");
    gate = [];
    if (scripts.typecheck) gate.push("npm run typecheck");
    if (scripts.test) gate.push("npm test");
    if (gate.length === 0 && scripts.build) gate.push("npm run build");
    origem = "package.json";
  } else {
    cmds = envCmds || [];
    gate = envGate || [];
    origem = envGate && envGate.length ? "env" : "nenhum";
  }
  // Precedencia final: override vence (cada um independente).
  const cmdsFinal = override?.cmds ?? cmds;
  const gateFinal = override?.gate ?? gate;
  return { cmds: cmdsFinal, gate: gateFinal, origem };
}

// Le <cwd>/package.json e o env legado; delega pra resolverDeScripts. Nunca lanca.
export async function resolverComandos(
  cwd: string, override?: Override,
): Promise<{ cmds: string[]; gate: string[]; origem: string; scripts: Record<string, string> }> {
  let scripts: Record<string, string> | null = null;
  try {
    const raw = await fs.readFile(path.join(cwd, "package.json"), "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j === "object" && j.scripts && typeof j.scripts === "object") scripts = j.scripts;
  } catch { scripts = null; }
  const envCmds = (process.env.HERMES_CMDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const envGate = (process.env.HERMES_GATE || "").split(",").map((s) => s.trim()).filter(Boolean);
  return { ...resolverDeScripts(scripts, override, envCmds, envGate), scripts: scripts ?? {} };
}

// Saida de comando que falhou por AMBIENTE (executavel, node/binding, pacote, servico), nao por codigo. Pura.
// Import relativo ausente ('./x') NAO e' ambiente: e' o esperado de um teste da spec antes da implementacao.
export function ehFalhaAmbiente(saida: string): boolean {
  return /reconhecido|not recognized|command not found|ENOENT|Cannot find native binding|Unsupported engine|requires Node|Command "[^"]+" not found|Cannot find (module|package) ['"][^.'"]|ECONNREFUSED|Can't reach database server/i.test(saida);
}

// Comando que a allowlist/gate NAO aceita (motivo) ou null. `exec` do pnpm/npm imprime 'Command "x" not
// found' ate com teste falhando (falso positivo de ambiente); migrate/seed/... muda estado fora do git, que
// o REVERTER nao desfaz. Olha o texto e o corpo do script chamado; args depois de ' -- ' (arquivos) ficam de fora.
// ponytail: so os scripts do package.json da raiz; `--filter pkg` nao le o package.json do pacote.
export function recusaComando(cmd: string, scripts: Record<string, string> = {}): string | null {
  const cabeca = cmd.split(" -- ")[0];
  if (/\b(pnpm|npm|yarn)(\.cmd)?\b.*\sexec\b/i.test(cabeca)) return "usa `exec` (imprime 'Command not found' ate com teste falhando); use o script ou o bin direto";
  const efeito = /\b(migrate|db[:\s]push|seed|db[:\s]reset|migrate[:\s]reset|drop)\b/i;
  for (const alvo of [cabeca, ...cabeca.split(/\s+/).map((t) => scripts[t]).filter(Boolean)]) {
    const m = alvo.split(" -- ")[0].match(efeito);
    if (m) return `efeito fora do git (${m[1]}): o planejador aplica depois da revisao, nao o swarm`;
  }
  return null;
}

// Roda um comando no shell do bridge (o mesmo dos agentes e do gate). Nunca lanca, exceto cancelamento.
export async function rodarShell(cmd: string, cwd: string, signal?: AbortSignal, timeout = CMD_TIMEOUT): Promise<{ code: number | string; saida: string; timeout: boolean }> {
  try {
    const { stdout, stderr } = await pshell(cmd, { cwd, windowsHide: true, timeout, maxBuffer: 10 * 1024 * 1024, signal });
    return { code: 0, saida: String(stdout + stderr).slice(-4000), timeout: false };
  } catch (e: any) {
    if (signal?.aborted) throw new CanceladoError();
    const saida = String((e?.stdout ?? "") + (e?.stderr ?? "") || e?.message || "").slice(-4000);
    return { code: e?.code ?? "?", saida, timeout: !!e?.killed };
  }
}

export type ItemPreflight = { cmd: string; classe: "ok" | "esperada" | "ambiente" | "recusado"; motivo?: string; saida: string; ms: number };

// Roda allowlist + gate NA BASELINE pelo shell do bridge, antes de gastar 1 token. Falha de teste/typecheck
// e' esperada (spec sem implementacao); ambiente (padrao/timeout) ou comando recusado = nao ok.
export async function preflight(
  cwd: string, cmds: string[], gateCmds: string[], scripts: Record<string, string>, signal?: AbortSignal, timeout = CMD_TIMEOUT,
): Promise<{ ok: boolean; itens: ItemPreflight[] }> {
  const unicos = [...new Set([...cmds, ...gateCmds])];
  const itens: ItemPreflight[] = [];
  for (const cmd of unicos) {
    const motivo = recusaComando(cmd, scripts);
    if (motivo) itens.push({ cmd, classe: "recusado", motivo, saida: "", ms: 0 });
  }
  if (itens.length) return { ok: false, itens }; // recusa nao executa nada (migrate nao pode rodar nem aqui)
  for (const cmd of unicos) {
    const t0 = Date.now();
    const r = await rodarShell(cmd, cwd, signal, timeout);
    const ms = Date.now() - t0;
    const classe = r.code === 0 ? "ok" : r.timeout || ehFalhaAmbiente(r.saida) ? "ambiente" : "esperada";
    itens.push({ cmd, classe, motivo: r.timeout ? `timeout (${timeout}ms)` : r.code === 0 ? undefined : "exit " + r.code, saida: r.saida, ms });
  }
  return { ok: itens.every((i) => i.classe === "ok" || i.classe === "esperada"), itens };
}

// Texto da tabela do doctor/painel. Saida so pra quem nao passou (cauda curta).
export function textoPreflight(itens: ItemPreflight[]): string {
  const rot = { ok: "[ok]       ", esperada: "[esperada] ", ambiente: "[AMBIENTE] ", recusado: "[RECUSADO] " };
  return itens.map((i) => {
    let l = `${rot[i.classe]} ${i.cmd}  ${(i.ms / 1000).toFixed(1)}s${i.motivo ? "  " + i.motivo : ""}`;
    if (i.classe !== "ok" && i.saida) l += "\n" + i.saida.trim().slice(-1500).split("\n").map((s) => "      | " + s).join("\n");
    return l;
  }).join("\n");
}

// Falha de ambiente no meio da run: sobe ate o construir/rodar, que param tudo (ENV-FAILED).
export class AmbienteError extends Error {
  tokensIn = 0; tokensOut = 0;
  constructor(public cmd: string, public saida: string) { super("falha de ambiente: " + cmd); }
}

// Guarda de escrita (motivo ou null): o agente nao "conserta" ambiente criando shim, mexendo em
// node_modules, gerado/ignorado ou migration. Caminho listado em arquivos_alvo passa (exceto node_modules). Pura.
export function escritaProibida(rel: string, alvos: string[], ignorado: boolean, exes: Set<string>): string | null {
  const p = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  if (/(^|\/)node_modules\//i.test(p)) return "node_modules nao se edita";
  if (alvos.some((a) => a.replace(/\\/g, "/").replace(/^\.\//, "") === p)) return null;
  const nome = p.split("/").pop() || p;
  if (/\.(cmd|bat|ps1|exe)$/i.test(nome) || (!nome.includes(".") && exes.has(nome.toLowerCase())))
    return "parece shim de executavel; falha de ambiente nao se conserta pelo codigo";
  if (/(^|\/)migrations\//i.test(p)) return "migration e' do planejador, nao do swarm";
  if (ignorado) return "arquivo ignorado pelo git (gerado/build)";
  return null;
}

// Nome do executavel (1o token, sem pasta e sem extensao) de cada comando: alimenta a guarda de shim.
export function exesDe(cmds: string[]): Set<string> {
  return new Set(cmds.map((c) => {
    const m = c.trim().match(/^"([^"]+)"|^(\S+)/);
    return (m?.[1] ?? m?.[2] ?? "").split(/[\\/]/).pop()!.replace(/\.[^.]+$/, "").toLowerCase();
  }).filter(Boolean));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await pexec("git", args, { cwd, windowsHide: true });
  return stdout;
}
async function gitOk(cwd: string, args: string[]): Promise<boolean> {
  try { await git(cwd, args); return true; } catch { return false; }
}
async function ensureIdentity(cwd: string): Promise<void> {
  if (!(await gitOk(cwd, ["config", "user.email"]))) await git(cwd, ["config", "user.email", "hermes@orchestra.local"]);
  if (!(await gitOk(cwd, ["config", "user.name"]))) await git(cwd, ["config", "user.name", "Hermes Swarm"]);
}

export function slug(feature: string): string {
  const s = feature.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return s || "feature";
}

// SNAPSHOT do estado original ANTES de qualquer agente. Devolve baselineRef (pra reverter) + branch de trabalho.
export async function baseline(cwd: string, feature: string, emit: Emitir): Promise<{ baselineRef: string; branch: string }> {
  const repo = await gitOk(cwd, ["rev-parse", "--is-inside-work-tree"]);
  let baselineRef: string;
  if (!repo) {
    emit({ t: "fase", nome: "baseline", info: "git init (novo repo)" });
    await git(cwd, ["init"]);
    await ensureIdentity(cwd);
    await git(cwd, ["add", "-A"]);
    if (await gitOk(cwd, ["commit", "-m", "baseline: estado antes do orchestra"])) {
      baselineRef = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    } else {
      // pasta vazia: cria um commit raiz vazio so pra ter baselineRef
      await git(cwd, ["commit", "--allow-empty", "-m", "baseline: estado antes do orchestra"]);
      baselineRef = (await git(cwd, ["rev-parse", "HEAD"])).trim();
    }
  } else {
    await ensureIdentity(cwd);
    // captura mudancas nao commitadas SEM mexer no working tree; se limpo, usa HEAD
    const stash = (await git(cwd, ["stash", "create"]).catch(() => "")).trim();
    baselineRef = stash || (await git(cwd, ["rev-parse", "HEAD"]).catch(() => "")).trim();
  }
  emit({ t: "fase", nome: "baseline", info: baselineRef ? baselineRef.slice(0, 8) : "(vazio)" });
  const branch = "orchestra/" + slug(feature);
  if (await gitOk(cwd, ["checkout", "-b", branch])) emit({ t: "fase", nome: "branch", info: branch });
  else { await gitOk(cwd, ["checkout", branch]); emit({ t: "fase", nome: "branch", info: branch + " (existente)" }); }
  return { baselineRef, branch };
}

// Guarda anti-destruicao: escrita que zera, encolhe demais, trunca, ou perde marcador estrutural e' recusada.
export function destrutivo(arquivo: string, antes: string, depois: string): string | null {
  const d = depois.trim();
  if (!d) return "saida vazia";
  if (antes.length > 200 && d.length < antes.length * 0.5) return `encolheu demais (${antes.length}->${d.length})`;
  const ext = arquivo.toLowerCase();
  if (ext.endsWith(".html") || ext.endsWith(".htm")) {
    // perda de tag de abertura OU de fechamento (truncamento) => destrutivo
    for (const [re, nome] of [[/<html[\s>]/i, "<html>"], [/<body[\s>]/i, "<body>"], [/<\/html>/i, "</html>"], [/<\/body>/i, "</body>"]] as const) {
      if (re.test(antes) && !re.test(depois)) return `perdeu ${nome} (provavel truncamento)`;
    }
  }
  return null;
}

// Converte um glob simples (suporta * e **) em regex ancorada, sem lib externa.
function globRe(g: string): RegExp {
  let esc = g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // escapa os meta-regex (inclusive * e ?)
  esc = esc.replace(/\\\*\\\*/g, ".*").replace(/\\\*/g, "[^/]*").replace(/\\\?/g, ".");
  return new RegExp("^" + esc + "$");
}

// Trava anti-alterar-teste: pura, decide se um caminho relativo aponta pra um arquivo de TESTE.
// Configuravel por HERMES_TEST_GLOB (csv de globs); sem ela, o default cobre os padroes comuns.
export function ehTeste(rel: string): boolean {
  const p = rel.replace(/\\/g, "/"); // normaliza separador pro dashboard/FS
  const nome = p.split("/").pop() || p;
  const globs = (process.env.HERMES_TEST_GLOB || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (globs.length) return globs.some((g) => globRe(g).test(p) || globRe(g).test(nome));
  if (/\.(test|spec)\./i.test(nome)) return true;                       // foo.test.*, foo.spec.*
  if (/^test_.*\.py$/i.test(nome)) return true;                         // test_*.py
  if (/_test\.py$/i.test(nome)) return true;                            // *_test.py
  if (/_test\.go$/i.test(nome)) return true;                            // *_test.go
  if (/(^|\/)__tests__\//.test(p)) return true;                         // .../__tests__/...
  if (/(^|\/)tests\//.test(p)) return true;                             // tests/... ou .../tests/...
  return false;
}

// Custo em USD do slice: PEAK nos dias uteis (UTC) das 01h-04h e 06h-10h; senao OFF-PEAK. Precos por
// milhao de tokens via env (defaults da DeepSeek nativa). Pura -> testavel no selftest.
export function custoUSD(tin: number, tout: number, when: Date = new Date()): number {
  const dia = when.getUTCDay();   // 0=domingo, 6=sabado
  const hora = when.getUTCHours();
  const peak = dia >= 1 && dia <= 5 && ((hora >= 1 && hora < 4) || (hora >= 6 && hora < 10));
  const inP = Number(process.env.HERMES_PRICE_IN_PEAK ?? "0.30");
  const inO = Number(process.env.HERMES_PRICE_IN_OFFPEAK ?? "0.15");
  const outP = Number(process.env.HERMES_PRICE_OUT_PEAK ?? "1.20");
  const outO = Number(process.env.HERMES_PRICE_OUT_OFFPEAK ?? "0.60");
  return (tin / 1e6) * (peak ? inP : inO) + (tout / 1e6) * (peak ? outP : outO);
}

// Evento de metrica do slice (o dashboard consome pra agregar a run). Tipado localmente pra compilar
// mesmo antes do union Evento ganhar a variante "metrica" (quando ganhar, continua valido).
type EventoMetrica = {
  t: "metrica"; slice: number; iteracoes: number; passouDePrimeira: boolean;
  tocouNoTeste: number; falhasAmbiente: number; tokensIn: number; tokensOut: number; custoUSD: number; ms: number;
};

// Resolve um caminho relativo garantindo que fica DENTRO do projeto; senao null.
export function dentro(base: string, rel: string): string | null {
  const alvo = path.resolve(base, rel);
  return alvo === base || alvo.startsWith(base + path.sep) ? alvo : null;
}

// Ferramentas expostas ao agente (formato Anthropic tool-use).
export const FERRAMENTAS: Ferramenta[] = [
  { name: "ler_arquivo", description: "Le o conteudo de um arquivo do projeto (caminho relativo).",
    input_schema: { type: "object", properties: { caminho: { type: "string" } }, required: ["caminho"] } },
  { name: "listar", description: "Lista arquivos/pastas de um diretorio do projeto (relativo). Use '.' pra raiz.",
    input_schema: { type: "object", properties: { caminho: { type: "string" } }, required: ["caminho"] } },
  { name: "buscar", description: "Busca um regex (ou texto) nos arquivos do projeto e devolve 'arquivo:linha: texto'. caminho opcional restringe a uma pasta.",
    input_schema: { type: "object", properties: { padrao: { type: "string" }, caminho: { type: "string" } }, required: ["padrao"] } },
  { name: "escrever_arquivo", description: "Escreve/substitui o conteudo COMPLETO e final de um arquivo (sem cercas markdown). Use pra arquivo NOVO; pra mudar arquivo existente prefira editar_arquivo.",
    input_schema: { type: "object", properties: { caminho: { type: "string" }, conteudo: { type: "string" } }, required: ["caminho", "conteudo"] } },
  { name: "editar_arquivo", description: "Troca UM trecho de um arquivo existente: 'antigo' tem que aparecer exatamente uma vez (copie do ler_arquivo, com indentacao; inclua contexto se repetir).",
    input_schema: { type: "object", properties: { caminho: { type: "string" }, antigo: { type: "string" }, novo: { type: "string" } }, required: ["caminho", "antigo", "novo"] } },
  { name: "rodar_comando", description: "Roda um comando de verificacao permitido (build/teste/typecheck) na raiz do projeto.",
    input_schema: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] } },
];

export type CtxAgente = {
  base: string; escritos: Set<string>; comandos: string[]; cmds: string[]; emit: Emitir; sliceIdx: number;
  alvos: string[]; exes: Set<string>;
  falhasCmd: number; falhasAmbiente: number; tokensIn: number; tokensOut: number; tocouNoTeste: number;
  ultimaVerificacaoOk: boolean | null; signal?: AbortSignal;
};

// Executa UMA ferramenta e devolve o texto de resultado que volta pro agente (nunca lanca).
export async function execFerramenta(ctx: CtxAgente, nome: string, input: any): Promise<string> {
  const { base, emit, sliceIdx } = ctx;
  const tool = (alvo: string | undefined, ok: boolean, resumo?: string) => emit({ t: "tool", slice: sliceIdx, nome, alvo, ok, resumo });
  try {
    if (nome === "ler_arquivo") {
      const caminho = String(input?.caminho ?? "");
      const alvo = dentro(base, caminho);
      if (!alvo) { tool(caminho, false, "fora do projeto"); return "ERRO: caminho fora do projeto"; }
      try { const c = await fs.readFile(alvo, "utf8"); tool(caminho, true); return c; }
      catch { tool(caminho, false, "nao existe"); return "ERRO: arquivo nao existe"; }
    }
    if (nome === "listar") {
      const caminho = String(input?.caminho ?? ".");
      const alvo = dentro(base, caminho);
      if (!alvo) { tool(caminho, false, "fora do projeto"); return "ERRO: caminho fora do projeto"; }
      try {
        const itens = await fs.readdir(alvo, { withFileTypes: true });
        tool(caminho, true);
        return itens.map((e) => (e.isDirectory() ? e.name + "/" : e.name)).join("\n") || "(vazio)";
      } catch { tool(caminho, false, "nao existe"); return "ERRO: diretorio nao existe"; }
    }
    if (nome === "buscar") {
      const padrao = String(input?.padrao ?? "");
      const caminho = String(input?.caminho ?? ".");
      const dir = dentro(base, caminho);
      if (!dir) { tool(caminho, false, "fora do projeto"); return "ERRO: caminho fora do projeto"; }
      let re: RegExp;
      try { re = new RegExp(padrao, "i"); } catch { re = new RegExp(padrao.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"); }
      let arquivos: string[];
      try { arquivos = (await fs.readdir(dir, { recursive: true })) as string[]; }
      catch { tool(caminho, false, "nao existe"); return "ERRO: diretorio nao existe"; }
      const achados: string[] = [];
      for (const f of arquivos) {
        const rel = path.relative(base, path.join(dir, f)).replace(/\\/g, "/");
        if (/(^|\/)(node_modules|\.git|dist|build)(\/|$)/.test(rel)) continue;
        let c: string;
        try { const st = await fs.stat(path.join(dir, f)); if (!st.isFile() || st.size > 1e6) continue; c = await fs.readFile(path.join(dir, f), "utf8"); }
        catch { continue; }
        const linhas = c.split("\n");
        for (let i = 0; i < linhas.length && achados.length < 100; i++) {
          if (re.test(linhas[i])) achados.push(`${rel}:${i + 1}: ${linhas[i].trim().slice(0, 200)}`);
        }
        if (achados.length >= 100) { achados.push("(cortado em 100 resultados; refine o padrao)"); break; }
      }
      tool(padrao, true);
      return achados.join("\n") || "(nenhum resultado)";
    }
    if (nome === "escrever_arquivo" || nome === "editar_arquivo") {
      const rel = String(input?.caminho ?? "");
      const alvo = dentro(base, rel);
      if (!alvo) { tool(rel, false, "fora do projeto"); return "ERRO: caminho fora do projeto"; }
      let atual = "";
      try { atual = await fs.readFile(alvo, "utf8"); } catch {}
      let conteudo: string;
      if (nome === "editar_arquivo") {
        if (!atual) { tool(rel, false, "nao existe"); return "ERRO: arquivo nao existe (use escrever_arquivo pra criar)"; }
        // arquivo CRLF: o modelo costuma mandar so \n, entao casa o final de linha do arquivo
        const eol = (s: string) => (atual.includes("\r\n") ? s.replace(/\r?\n/g, "\r\n") : s);
        const antigo = eol(String(input?.antigo ?? ""));
        input = { ...input, novo: eol(String(input?.novo ?? "")) };
        const n = antigo ? atual.split(antigo).length - 1 : 0;
        if (n !== 1) {
          tool(rel, false, n ? `trecho aparece ${n}x` : "trecho nao encontrado");
          return n ? `ERRO: 'antigo' aparece ${n} vezes; inclua mais contexto pra ficar unico`
                   : "ERRO: 'antigo' nao encontrado; releia o arquivo e copie o trecho exato";
        }
        conteudo = atual.replace(antigo, () => String(input?.novo ?? ""));
      } else {
        conteudo = String(input?.conteudo ?? "");
      }
      // Trava: teste que JA existe e' imutavel (criar teste novo continua permitido). Antes do guard destrutivo.
      if (ehTeste(rel) && atual) {
        ctx.tocouNoTeste++;
        tool(rel, false, "arquivo de teste (imutavel)");
        return "RECUSADO (teste imutavel): altere o codigo, nao o teste";
      }
      const ignorado = await gitOk(base, ["check-ignore", "-q", "--", rel]);
      const proibido = escritaProibida(rel, ctx.alvos, ignorado, ctx.exes);
      if (proibido) { tool(rel, false, proibido); return `RECUSADO (fora do que o swarm pode escrever): ${proibido}`; }
      const motivo = atual ? destrutivo(rel, atual, conteudo) : (conteudo.trim() ? null : "saida vazia");
      if (motivo) { tool(rel, false, motivo); return `RECUSADO (original preservado): ${motivo}`; }
      await fs.mkdir(path.dirname(alvo), { recursive: true });
      await fs.writeFile(alvo, conteudo, "utf8");
      ctx.escritos.add(rel);
      tool(rel, true);
      const patch = await git(base, ["diff", "--", rel]).catch(() => "(diff indisponivel)");
      emit({ t: "diff", arquivo: rel, patch });
      return "ok";
    }
    if (nome === "rodar_comando") {
      const cmd = String(input?.comando ?? "").trim();
      if (!ctx.cmds.includes(cmd)) { tool(cmd, false, "nao permitido"); return `ERRO: comando nao permitido. Allowlist: ${ctx.cmds.join(" | ") || "(vazia)"}`; }
      emit({ t: "comando", slice: sliceIdx, cmd, status: "rodando" }); // UI mostra "rodando <cmd> ha Ns"
      const { code, saida } = await rodarShell(cmd, base, ctx.signal);
      const ok = code === 0;
      ctx.comandos.push(ok ? cmd : cmd + " (exit " + code + ")");
      ctx.ultimaVerificacaoOk = ok;
      emit({ t: "tool", slice: sliceIdx, nome, alvo: cmd, ok, resumo: ok ? undefined : "exit " + code, saida });
      if (ok) return `exit 0\n${saida}`;
      // ambiente nao se conserta editando codigo: para a run (ENV-FAILED) em vez de deixar o agente improvisar
      if (ehFalhaAmbiente(saida)) { ctx.falhasAmbiente++; throw new AmbienteError(cmd, saida); }
      ctx.falhasCmd++;
      return `exit ${code}\n${saida}`;
    }
    tool(nome, false, "ferramenta desconhecida");
    return `ERRO: ferramenta desconhecida: ${nome}`;
  } catch (e: any) {
    if (e instanceof CanceladoError || e instanceof AmbienteError) throw e;
    tool(nome, false, String(e?.message ?? e));
    return "ERRO: " + (e?.message ?? e);
  }
}

// UM agente: loop multi-turn tool_use<->tool_result ate end_turn ou o teto de turnos.
// msgFn injetavel pro selftest (client fake, sem rede). sliceIdx identifica o card/feed no dashboard
// (slices do plano usam 1..N; a tarefa de reparo do gate usa N+tentativa). cmds e' a allowlist resolvida.
// Erro de API/turno vira slice falha COM os tokens ja gastos; cancelamento (CanceladoError) sobe.
export async function agente(
  base: string, feature: string, t: Tarefa, emit: Emitir, sliceIdx: number, cmds: string[], msgFn: MensagemFn = mensagemReal,
  signal?: AbortSignal,
): Promise<{
  escritos: string[]; comandos: string[]; ok: boolean; motivo: string; semMudancas: boolean;
  iteracoes: number; passouDePrimeira: boolean; tocouNoTeste: number; falhasAmbiente: number; tokensIn: number; tokensOut: number;
}> {
  const sys =
    "Voce e um agente CODER de um swarm. Implemente a tarefa editando o projeto pelas ferramentas. " +
    "Fluxo: ache o que importa (buscar/listar/ler_arquivo); mude arquivo existente com editar_arquivo (trecho " +
    "antigo -> novo) e crie arquivo novo com escrever_arquivo (conteudo COMPLETO, sem cercas ```); havendo comando de verificacao permitido rode " +
    "com rodar_comando e conserte os erros ate passar. Ao EDITAR arquivo existente, preserve toda a estrutura; " +
    "mude so o que a tarefa pede. Quando terminar, responda um resumo curto (sem mais tool calls).";
  const user =
    `Feature: ${feature}\nTarefa: ${t.tarefa}\nArquivos-alvo: ${t.arquivos_alvo.join(", ") || "(voce decide)"}\n` +
    `Detalhes: ${t.descricao}\n` +
    (cmds.length ? `Comandos de verificacao permitidos: ${cmds.join(" | ")}` : "Sem comandos de verificacao disponiveis.");
  const ctx: CtxAgente = {
    base, escritos: new Set(), comandos: [], cmds, emit, sliceIdx,
    alvos: t.arquivos_alvo, exes: exesDe(cmds),
    falhasCmd: 0, falhasAmbiente: 0, tokensIn: 0, tokensOut: 0, tocouNoTeste: 0,
    ultimaVerificacaoOk: null, signal,
  };
  const fim = (ok: boolean, motivo: string, semMudancas = false) => ({
    escritos: [...ctx.escritos], comandos: ctx.comandos, ok, motivo, semMudancas,
    iteracoes: ctx.falhasCmd, passouDePrimeira: ok && ctx.falhasCmd === 0,
    tocouNoTeste: ctx.tocouNoTeste, falhasAmbiente: ctx.falhasAmbiente, tokensIn: ctx.tokensIn, tokensOut: ctx.tokensOut,
  });
  const opts = {
    signal,
    onProgresso: (tokens: number) => emit({ t: "gerando", slice: sliceIdx, tokens }),
    onTentativa: (n: number, motivo: string) => emit({ t: "log", texto: `[T${sliceIdx}] ${motivo} -> tentativa ${n}` }),
  };
  const messages: Msg[] = [{ role: "user", content: user }];
  try {
    for (let turno = 0; turno < MAX_TURNS; turno++) {
      if (signal?.aborted) throw new CanceladoError();
      const { blocos, stop, usage } = await msgFn(sys, messages, FERRAMENTAS, opts);
      if (usage) { ctx.tokensIn += Number(usage.in ?? 0); ctx.tokensOut += Number(usage.out ?? 0); }
      messages.push({ role: "assistant", content: blocos });
      const usos = blocos.filter((b: any) => b?.type === "tool_use");
      if (stop !== "tool_use" || usos.length === 0) {
        if (ctx.escritos.size) return fim(true, "");
        // nada escrito: so conta como ok se a ultima verificacao rodada passou (trabalho ja feito antes)
        if (ctx.ultimaVerificacaoOk) return fim(true, "", true);
        return fim(false, "nenhum arquivo escrito");
      }
      const resultados = [];
      for (const u of usos) {
        const out = await execFerramenta(ctx, u.name, u.input);
        resultados.push({ type: "tool_result", tool_use_id: u.id, content: out });
      }
      messages.push({ role: "user", content: resultados });
    }
    return fim(false, `teto de ${MAX_TURNS} turnos atingido`);
  } catch (e: any) {
    if (e instanceof CanceladoError || signal?.aborted) throw new CanceladoError();
    if (e instanceof AmbienteError) { e.tokensIn = ctx.tokensIn; e.tokensOut = ctx.tokensOut; throw e; } // custo da slice nao some
    return fim(false, `erro: ${String(e?.message ?? e).slice(0, 120)}`);
  }
}

export type Resultado = {
  tarefa: string; ok: boolean; escritos: string[]; comandos: string[]; motivo: string;
  iteracoes: number; passouDePrimeira: boolean; tocouNoTeste: number; falhasAmbiente: number; tokensIn: number; tokensOut: number;
};

// Executa o plano SERIAL: um agente por slice, na ordem. Emite "fila" pra todas de saida, depois
// "rodando"/"ok"/"incompleta" conforme cada uma processa, e uma "metrica" por slice. PARA na primeira
// slice que falhar (as seguintes costumam depender dela) ou no cancelamento: o resto vira "pulada".
export async function construir(
  cwd: string, feature: string, plano: Tarefa[], emit: Emitir, cmds: string[], signal?: AbortSignal,
  msgFn: MensagemFn = mensagemReal,
): Promise<{ escritos: string[]; rejeitados: string[]; resultados: Resultado[]; cancelado: boolean; ambiente?: AmbienteError }> {
  const base = path.resolve(cwd);
  const escritos: string[] = [];
  const rejeitados: string[] = [];
  const resultados: Resultado[] = [];
  const emitMetrica = (m: EventoMetrica) => emit(m as unknown as Evento);
  const pular = (de: number, motivo: string) => {
    for (let i = de; i < plano.length; i++) emit({ t: "slice", idx: i + 1, total: plano.length, tarefa: plano[i].tarefa, status: "pulada", motivo });
  };
  for (let idx = 0; idx < plano.length; idx++) {
    emit({ t: "slice", idx: idx + 1, total: plano.length, tarefa: plano[idx].tarefa, status: "fila" });
  }
  for (let idx = 0; idx < plano.length; idx++) {
    const t = plano[idx];
    const sliceIdx = idx + 1;
    const inicio = Date.now();
    emit({ t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa, status: "rodando" });
    let r;
    try {
      r = await agente(base, feature, t, emit, sliceIdx, cmds, msgFn, signal);
    } catch (e) {
      if (e instanceof AmbienteError) {
        const ms = Date.now() - inicio;
        emit({ t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa, status: "incompleta", motivo: "falha de ambiente: " + e.cmd, ms });
        emitMetrica({
          t: "metrica", slice: sliceIdx, iteracoes: 0, passouDePrimeira: false, tocouNoTeste: 0, falhasAmbiente: 1,
          tokensIn: e.tokensIn, tokensOut: e.tokensOut, custoUSD: custoUSD(e.tokensIn, e.tokensOut), ms,
        });
        pular(idx + 1, "falha de ambiente");
        return { escritos, rejeitados: [...rejeitados, `${t.tarefa} (falha de ambiente: ${e.cmd})`], resultados, cancelado: false, ambiente: e };
      }
      // ponytail: tokens da slice cancelada nao entram na metrica; cancelar e' raro
      emit({ t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa, status: "incompleta", motivo: "cancelado", ms: Date.now() - inicio });
      pular(idx + 1, "run cancelada");
      return { escritos, rejeitados, resultados, cancelado: true };
    }
    escritos.push(...r.escritos);
    if (!r.ok) rejeitados.push(`${t.tarefa} (${r.motivo})`);
    const res: Resultado = {
      tarefa: t.tarefa, ok: r.ok, escritos: r.escritos, comandos: r.comandos, motivo: r.motivo,
      iteracoes: r.iteracoes, passouDePrimeira: r.passouDePrimeira, tocouNoTeste: r.tocouNoTeste, falhasAmbiente: r.falhasAmbiente,
      tokensIn: r.tokensIn, tokensOut: r.tokensOut,
    };
    resultados.push(res);
    const ms = Date.now() - inicio;
    emit({
      t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa,
      status: r.ok ? "ok" : "incompleta", escritos: r.escritos, comandos: r.comandos, motivo: r.motivo, ms,
      semMudancas: r.semMudancas || undefined,
    });
    emitMetrica({
      t: "metrica", slice: sliceIdx, iteracoes: res.iteracoes, passouDePrimeira: res.passouDePrimeira,
      tocouNoTeste: res.tocouNoTeste, falhasAmbiente: res.falhasAmbiente, tokensIn: res.tokensIn, tokensOut: res.tokensOut,
      custoUSD: custoUSD(res.tokensIn, res.tokensOut), ms,
    });
    if (!r.ok) { pular(idx + 1, `slice ${sliceIdx} falhou`); break; }
  }
  return { escritos, rejeitados, resultados, cancelado: false };
}

export async function diffStaged(cwd: string): Promise<string> {
  await git(cwd, ["add", "-A"]);
  return await git(cwd, ["diff", "--cached"]).catch(() => "");
}

// Gate deterministico: roda os comandos resolvidos por-projeto em serie contra o cwd; qualquer exit != 0
// falha e para ali (fail-closed). cmds/tentativa injetaveis pro selftest e pro loop de reparo.
export async function gate(
  cwd: string, emit: Emitir, cmds: string[] = [], tentativa = 0, signal?: AbortSignal,
): Promise<{ ok: boolean; cmd: string; saida: string; rodou: boolean; ambiente: boolean }> {
  for (const cmd of cmds) {
    emit({ t: "gate", cmd, status: "rodando", tentativa: tentativa || undefined });
    // ponytail: cancelamento no gate vira falha comum (como antes); o rodar ja checa signal.aborted
    const r = await rodarShell(cmd, cwd, signal).catch(() => ({ code: "cancelado", saida: "cancelado", timeout: false }));
    if (r.code === 0) { emit({ t: "gate", cmd, status: "ok", tentativa: tentativa || undefined, saida: r.saida }); continue; }
    emit({ t: "gate", cmd, status: "falha", tentativa: tentativa || undefined, saida: r.saida });
    return { ok: false, cmd, saida: r.saida, rodou: true, ambiente: ehFalhaAmbiente(r.saida) };
  }
  return { ok: true, cmd: "", saida: "", rodou: cmds.length > 0, ambiente: false };
}

export async function revisar(cwd: string, feature: string, diff: string, emit: Emitir): Promise<{ ok: boolean; ajustes: string }> {
  // diff cortado = veredito sobre o que o modelo nao viu; melhor nao opinar
  if (diff.length > 12000) return { ok: true, ajustes: `diff grande (${diff.length} chars), revisao fica com o Claude` };
  emit({ t: "fase", nome: "revisor", info: "conferindo..." });
  const sys =
    "Voce e um REVISOR. Recebe a feature e um diff. Responda APENAS JSON " +
    `{"ok": boolean, "ajustes": "texto curto"}. ok=true se o diff implementa a feature de forma coerente e nao quebra arquivos.`;
  const user = `Feature: ${feature}\n\nDiff:\n${diff}`;
  try {
    const out = await texto(sys, user);
    const m = out.match(/\{[\s\S]*\}/); // extrai o objeto JSON mesmo que venha cercado de texto
    const j = JSON.parse(m ? m[0] : out);
    return { ok: !!j.ok, ajustes: String(j.ajustes || "") };
  } catch (e: any) {
    return { ok: true, ajustes: "revisor indisponivel: " + (e?.message ?? e) };
  }
}

export async function commit(cwd: string, feature: string, emit: Emitir): Promise<void> {
  await ensureIdentity(cwd);
  await git(cwd, ["commit", "-m", "feat: " + feature]);
  emit({ t: "fase", nome: "commit", info: "commit local feito" });
}