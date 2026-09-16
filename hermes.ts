// O swarm Hermes: BASELINE -> AGENTES DeepSeek (serial, com ferramentas) -> GATE -> commit local.
// Quem planeja e o Claude; aqui chega o plano pronto (slices). Quem revisa/barra e o Claude (ver /orchestra).
import { mensagem as mensagemReal, texto, type MensagemFn, type Ferramenta, type Msg } from "./deepseek.js";
import { type Evento, type Emitir } from "./ui.js";
import { execFile, exec } from "node:child_process";
import { promisify } from "node:util";
import { promises as fs } from "node:fs";
import path from "node:path";

const pexec = promisify(execFile); // git
const pshell = promisify(exec);    // comandos allowlisted / gate (build/teste/typecheck)
const MAX_TURNS = Number(process.env.HERMES_MAX_TURNS || "25");
// allowlist de comandos que o agente pode rodar, ex.: "npm run build,npm test,npx tsc --noEmit"
const CMDS = (process.env.HERMES_CMDS || "").split(",").map((s) => s.trim()).filter(Boolean);
const CMD_TIMEOUT = Number(process.env.HERMES_CMD_TIMEOUT_MS || "120000");

// Gate deterministico: comandos que TEM que passar antes do commit (fail-closed). Vazio = sem gate (retrocompat).
const GATE_CMDS = (process.env.HERMES_GATE || "").split(",").map((s) => s.trim()).filter(Boolean);
export const REPAIR_TRIES = Number(process.env.HERMES_REPAIR_TRIES ?? "1");
export function podeReparar(tentativa: number, tries: number = REPAIR_TRIES): boolean {
  return tentativa < tries;
}

export type Tarefa = { tarefa: string; arquivos_alvo: string[]; descricao: string };

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
  { name: "escrever_arquivo", description: "Escreve/substitui o conteudo COMPLETO e final de um arquivo (sem cercas markdown).",
    input_schema: { type: "object", properties: { caminho: { type: "string" }, conteudo: { type: "string" } }, required: ["caminho", "conteudo"] } },
  { name: "rodar_comando", description: "Roda um comando de verificacao permitido (build/teste/typecheck) na raiz do projeto.",
    input_schema: { type: "object", properties: { comando: { type: "string" } }, required: ["comando"] } },
];

export type CtxAgente = { base: string; escritos: Set<string>; comandos: string[]; emit: Emitir; sliceIdx: number };

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
    if (nome === "escrever_arquivo") {
      const rel = String(input?.caminho ?? "");
      const alvo = dentro(base, rel);
      if (!alvo) { tool(rel, false, "fora do projeto"); return "ERRO: caminho fora do projeto"; }
      const conteudo = String(input?.conteudo ?? "");
      let atual = "";
      try { atual = await fs.readFile(alvo, "utf8"); } catch {}
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
      if (!CMDS.includes(cmd)) { tool(cmd, false, "nao permitido"); return `ERRO: comando nao permitido. Allowlist: ${CMDS.join(" | ") || "(vazia)"}`; }
      try {
        const { stdout, stderr } = await pshell(cmd, { cwd: base, windowsHide: true, timeout: CMD_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
        ctx.comandos.push(cmd);
        tool(cmd, true);
        return `exit 0\n${String(stdout + stderr).slice(-4000)}`;
      } catch (e: any) {
        ctx.comandos.push(cmd + " (exit " + (e?.code ?? "?") + ")");
        const saida = String((e?.stdout ?? "") + (e?.stderr ?? "") || e?.message || "").slice(-4000);
        tool(cmd, false, "exit " + (e?.code ?? "?"));
        return `exit ${e?.code ?? "?"}\n${saida}`;
      }
    }
    tool(nome, false, "ferramenta desconhecida");
    return `ERRO: ferramenta desconhecida: ${nome}`;
  } catch (e: any) {
    tool(nome, false, String(e?.message ?? e));
    return "ERRO: " + (e?.message ?? e);
  }
}

// UM agente: loop multi-turn tool_use<->tool_result ate end_turn ou o teto de turnos.
// msgFn injetavel pro selftest (client fake, sem rede). sliceIdx identifica o card/feed no dashboard
// (slices do plano usam 1..N; a tarefa de reparo do gate usa N+tentativa).
export async function agente(
  base: string, feature: string, t: Tarefa, emit: Emitir, sliceIdx: number, msgFn: MensagemFn = mensagemReal,
): Promise<{ escritos: string[]; comandos: string[]; ok: boolean; motivo: string }> {
  const sys =
    "Voce e um agente CODER de um swarm. Implemente a tarefa editando o projeto pelas ferramentas. " +
    "Fluxo: leia os arquivos relevantes (ler_arquivo/listar), edite com escrever_arquivo passando SEMPRE o " +
    "conteudo COMPLETO e final do arquivo (sem cercas ```), e havendo comando de verificacao permitido rode " +
    "com rodar_comando e conserte os erros ate passar. Ao EDITAR arquivo existente, preserve toda a estrutura; " +
    "mude so o que a tarefa pede. Quando terminar, responda um resumo curto (sem mais tool calls).";
  const user =
    `Feature: ${feature}\nTarefa: ${t.tarefa}\nArquivos-alvo: ${t.arquivos_alvo.join(", ") || "(voce decide)"}\n` +
    `Detalhes: ${t.descricao}\n` +
    (CMDS.length ? `Comandos de verificacao permitidos: ${CMDS.join(" | ")}` : "Sem comandos de verificacao disponiveis.");
  const ctx: CtxAgente = { base, escritos: new Set(), comandos: [], emit, sliceIdx };
  const messages: Msg[] = [{ role: "user", content: user }];
  for (let turno = 0; turno < MAX_TURNS; turno++) {
    const { blocos, stop } = await msgFn(sys, messages, FERRAMENTAS);
    messages.push({ role: "assistant", content: blocos });
    const usos = blocos.filter((b: any) => b?.type === "tool_use");
    if (stop !== "tool_use" || usos.length === 0) {
      const escritos = [...ctx.escritos];
      return { escritos, comandos: ctx.comandos, ok: escritos.length > 0, motivo: escritos.length ? "" : "nenhum arquivo escrito" };
    }
    const resultados = [];
    for (const u of usos) {
      const out = await execFerramenta(ctx, u.name, u.input);
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: out });
    }
    messages.push({ role: "user", content: resultados });
  }
  return { escritos: [...ctx.escritos], comandos: ctx.comandos, ok: false, motivo: `teto de ${MAX_TURNS} turnos atingido` };
}

export type Resultado = { tarefa: string; ok: boolean; escritos: string[]; comandos: string[]; motivo: string };

// Executa o plano SERIAL: um agente por slice, na ordem. Emite "fila" pra todas de saida (CA-U3),
// depois "rodando"/"ok"/"incompleta" conforme cada uma processa.
export async function construir(cwd: string, feature: string, plano: Tarefa[], emit: Emitir): Promise<{ escritos: string[]; rejeitados: string[]; resultados: Resultado[] }> {
  const base = path.resolve(cwd);
  const escritos: string[] = [];
  const rejeitados: string[] = [];
  const resultados: Resultado[] = [];
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
      r = await agente(base, feature, t, emit, sliceIdx);
    } catch (e: any) {
      const motivo = `erro: ${String(e?.message ?? e).slice(0, 80)}`;
      rejeitados.push(`${t.tarefa} (${motivo})`);
      resultados.push({ tarefa: t.tarefa, ok: false, escritos: [], comandos: [], motivo });
      emit({ t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa, status: "incompleta", motivo, ms: Date.now() - inicio });
      continue;
    }
    escritos.push(...r.escritos);
    if (!r.ok) rejeitados.push(`${t.tarefa} (${r.motivo})`);
    resultados.push({ tarefa: t.tarefa, ok: r.ok, escritos: r.escritos, comandos: r.comandos, motivo: r.motivo });
    emit({
      t: "slice", idx: sliceIdx, total: plano.length, tarefa: t.tarefa,
      status: r.ok ? "ok" : "incompleta", escritos: r.escritos, comandos: r.comandos, motivo: r.motivo, ms: Date.now() - inicio,
    });
  }
  return { escritos, rejeitados, resultados };
}

export async function diffStaged(cwd: string): Promise<string> {
  await git(cwd, ["add", "-A"]);
  return await git(cwd, ["diff", "--cached"]).catch(() => "");
}

// Gate deterministico: roda os comandos de HERMES_GATE em serie contra o cwd; qualquer exit != 0
// falha e para ali (fail-closed). cmds/tentativa injetaveis pro selftest e pro loop de reparo.
export async function gate(
  cwd: string, emit: Emitir, cmds: string[] = GATE_CMDS, tentativa = 0,
): Promise<{ ok: boolean; cmd: string; saida: string; rodou: boolean }> {
  for (const cmd of cmds) {
    emit({ t: "gate", cmd, status: "rodando", tentativa: tentativa || undefined });
    try {
      await pshell(cmd, { cwd, windowsHide: true, timeout: CMD_TIMEOUT, maxBuffer: 10 * 1024 * 1024 });
      emit({ t: "gate", cmd, status: "ok", tentativa: tentativa || undefined });
    } catch (e: any) {
      const saida = String((e?.stdout ?? "") + (e?.stderr ?? "") || e?.message || "").slice(-4000);
      emit({ t: "gate", cmd, status: "falha", tentativa: tentativa || undefined, saida });
      return { ok: false, cmd, saida, rodou: true };
    }
  }
  return { ok: true, cmd: "", saida: "", rodou: cmds.length > 0 };
}

export async function revisar(cwd: string, feature: string, diff: string, emit: Emitir): Promise<{ ok: boolean; ajustes: string }> {
  emit({ t: "fase", nome: "revisor", info: "conferindo..." });
  const sys =
    "Voce e um REVISOR. Recebe a feature e um diff. Responda APENAS JSON " +
    `{"ok": boolean, "ajustes": "texto curto"}. ok=true se o diff implementa a feature de forma coerente e nao quebra arquivos.`;
  const user = `Feature: ${feature}\n\nDiff:\n${diff.slice(0, 12000)}`;
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
