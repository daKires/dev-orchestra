import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { appendFileSync, writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  baseline, construir, commit, slug, destrutivo, agente, gate,
  resolverComandos, custoUSD, ehTeste, ehFalhaAmbiente, preflight, textoPreflight, recusaComando, escritaProibida, exesDe, AmbienteError,
  acharRunMorta, marcarInterrompida,
  PAUSA_MAX_MS,
  type Tarefa, type Override, type CaixaSlice,
} from "./swarm.js";
import { iniciarUI, emitir as emitirUI, linhaDe, lerRuns, runAtual, arquivoCancel, RUNS_DIR, comoAbrirDashboard, type Evento } from "./ui.js";
import { tomarInstrucoes, pausada, esperarRetomada, retomarSlice, estaPausada } from "./instrucoes.js";
import { iniciar, esperar } from "./runs.js";
import { escolherProvedor, comTentativas, CanceladoError, retentavel, erroHttp } from "./deepseek.js";
import { paraOpenAI, novoEstado, consumirSSE, finalizar } from "./openai.js";

const WIDTH = 64;
const SEP = "+" + "-".repeat(WIDTH - 2) + "+";

// Arquivo de log ao vivo (retrocompat; o dashboard web e' a UI principal agora). orchestra define DEV_ORCHESTRA_LOG.
const LOG_FILE = process.env.DEV_ORCHESTRA_LOG || path.join(os.tmpdir(), "dev-orchestra-run.log");
function toFile(s: string) { try { appendFileSync(LOG_FILE, s); } catch {} }

// Porta do dashboard (mesma regra do ui.ts): DEV_ORCHESTRA_UI_PORT ou 4123.
const PORTA_DASH = Number(process.env.DEV_ORCHESTRA_UI_PORT || "4123");
const URL_DASH = `http://127.0.0.1:${PORTA_DASH}`;

// S3: na PRIMEIRA run do processo, abre o dashboard (app Dev Orchestra instalado vence; senao o navegador
// do sistema). DEV_ORCHESTRA_ABRIR_LOG troca o abrir por um append JSON (hook de teste). Nunca derruba a run.
let dashboardAberto = false;
function abrirDashboard(url: string): void {
  if (dashboardAberto) return;
  dashboardAberto = true;
  try {
    let exe: string | null = null;
    if (process.platform === "win32") {
      const p = path.join(process.env.LOCALAPPDATA ?? "", "Programs", "Dev Orchestra", "Dev Orchestra.exe");
      if (existsSync(p)) exe = p;
    }
    const { comando, args } = comoAbrirDashboard(exe, url, process.platform);
    const log = process.env.DEV_ORCHESTRA_ABRIR_LOG;
    if (log) { appendFileSync(log, JSON.stringify({ comando, args }) + "\n"); return; }
    spawn(comando, args, { detached: true, stdio: "ignore", windowsHide: true }).unref();
  } catch {}
}

// Cor ANSI por tipo de linha (pra quem ainda acompanha via arquivo/stderr). O painel final fica sem cor.
function pintar(chave: string, texto: string): string {
  const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", blue: "\x1b[1;34m" };
  let c = "";
  if (/^Tarefa \d+\//.test(chave)) c = C.blue;
  else if (/ERRO|FAILED|FALHA/.test(chave)) c = C.red;
  else if (/REJEITADO|BLOQUEADO|INCOMPLETA|ATENCAO/.test(chave)) c = C.yellow;
  else if (/-> ok|concluida| OK|commit local/.test(chave)) c = C.green;
  else if (/^\[T\d+\] (ler|listar|buscar|escrever|editar|rodar)/.test(chave)) c = C.cyan;
  return c ? c + texto + C.reset : texto;
}

// Painel brutalista: ASCII puro, largura fixa.
function row(text: string): string {
  const inner = WIDTH - 4;
  const t = text.length > inner ? text.slice(0, inner - 1) + "~" : text;
  return "| " + t.padEnd(inner, " ") + " |";
}
function frame(opts: { titulo: string; cwd: string; linhas: string[]; status: string }): string {
  const out: string[] = [SEP, row(opts.titulo), row("CWD: " + opts.cwd), SEP];
  if (opts.linhas.length === 0) out.push(row("> (sem saida)"));
  else for (const l of opts.linhas) out.push(row(l));
  out.push(SEP, row("STATUS: " + opts.status), SEP);
  return out.join("\n");
}

// Roda o swarm: baseline -> agentes (serial) -> GATE -> commit local. NAO revisa nem repara sozinho:
// quem decide (e conserta) e' o orquestrador que chamou o MCP (gate falhou = GATE-FAILED com a saida).
// Todo evento vai pro dashboard web (SSE) E deriva uma linha pro stderr/arquivo (retrocompat). Nunca lanca.
// Allowlist/gate vem do package.json do ALVO (override do planner vence; fallback pro env legado).
async function rodar(cwd: string, feature: string, plano: Tarefa[], override?: Override, onLinha?: (l: string) => void): Promise<string> {
  try { writeFileSync(LOG_FILE, ""); } catch {} // trunca: cada run comeca limpa
  const vivo: string[] = [];
  const header = ["", SEP, row("DEV ORCHESTRA // " + feature), row("CWD: " + cwd), SEP].join("\n") + "\n";
  process.stderr.write(header);
  toFile(header);
  const emit = (ev: Evento) => {
    emitirUI(ev);
    const l = linhaDe(ev);
    if (l) {
      vivo.push(l);
      onLinha?.(l);
      const linha = pintar(l, row("> " + l)) + "\n";
      process.stderr.write(linha);
      toFile(linha);
    }
  };
  // Resolve a verificacao POR-PROJETO (package.json do alvo), com override opcional e fallback pro env.
  const { cmds, gate: gateCmds, origem, scripts } = await resolverComandos(cwd, override);
  emit({ t: "run", feature, cwd, total: plano.length, plano, cmds, gate: gateCmds, pid: process.pid });
  // Cancelamento: SO pelo botao da UI (arquivo <run>.cancel, visto por poll de 1s).
  const porArquivo = new AbortController();
  const cancelFile = arquivoCancel(runAtual());
  const poll = setInterval(() => { if (existsSync(cancelFile)) porArquivo.abort(); }, 1000);
  const signal = porArquivo.signal;
  try {
    emit({ t: "fase", nome: "comandos", info: origem + (cmds.length ? " (" + cmds.length + " cmd)" : " (sem comandos)") });
    // PREFLIGHT (antes de baseline/agentes, custo $0): roda allowlist + gate pelo MESMO shell dos agentes.
    // Ambiente quebrado ou comando recusado (exec, migrate...) = ENV-FAILED sem tocar no repo.
    emit({ t: "fase", nome: "preflight", info: "rodando " + new Set([...cmds, ...gateCmds]).size + " cmd na baseline..." });
    const pf = await preflight(cwd, cmds, gateCmds, scripts, signal);
    const pfTexto = textoPreflight(pf.itens);
    if (pfTexto) emit({ t: "log", texto: "PREFLIGHT\n" + pfTexto });
    if (!pf.ok) {
      const ruins = pf.itens.filter((i) => i.classe === "ambiente" || i.classe === "recusado");
      const linhas = ruins.map((i) => (i.classe === "ambiente" ? "AMBIENTE: " : "RECUSADO: ") + i.cmd);
      emit({ t: "painel", status: "ENV-FAILED", branch: "", linhas: [...linhas, ...pfTexto.split("\n")] });
      const painel = frame({ titulo: "DEV ORCHESTRA // AMBIENTE (custo $0)", cwd, linhas, status: "ENV-FAILED" }) +
        "\n" + pfTexto + "\nNenhum agente rodou. Conserte o ambiente/comandos e rode doctor_orchestra de novo.";
      toFile(painel + "\n");
      return painel;
    }
    const { baselineRef, branch, base: baseRun } = await baseline(cwd, feature, emit); // foto do original ANTES dos agentes
    // Retomada: pula o prefixo ja' ok da run morta. EPERM (processo de outro usuario) conta como vivo.
    const vivoPid = (pid: number): boolean => {
      try { process.kill(pid, 0); return true; } catch (e: any) { return e?.code === "EPERM"; }
    };
    const morta = acharRunMorta(lerRuns(RUNS_DIR), cwd, feature, plano, vivoPid);
    if (morta) {
      marcarInterrompida(RUNS_DIR, morta.de, runAtual());
      emit({ t: "log", texto: "RETOMANDO run " + morta.de + (morta.slices.length ? ": pulando S" + morta.slices.join(",S") : ": nada a pular") });
    }
    // G3/S2: caixa de instrucoes/pausa de cada slice, ligada aos arquivos da run corrente em RUNS_DIR.
    const caixaDe = (idx: number): CaixaSlice => {
      const id = runAtual();
      return {
        tomar: () => tomarInstrucoes(RUNS_DIR, id, idx),
        pausada: () => pausada(RUNS_DIR, id, idx),
        esperar: async () => {
          let r: "retomada" | "teto";
          try {
            r = await esperarRetomada({ pausada: () => pausada(RUNS_DIR, id, idx), tetoMs: PAUSA_MAX_MS, signal });
          } catch (e) {
            if (signal.aborted) throw new CanceladoError();
            throw e;
          }
          if (r === "teto") retomarSlice(RUNS_DIR, id, idx); // teto: apaga o .pausa pra slice seguir
          return r;
        },
      };
    };
    const { rejeitados, resultados, cancelado, ambiente } = await construir(cwd, feature, plano, emit, cmds, signal, undefined, caixaDe, morta ? { de: morta.de, slices: morta.slices } : undefined);
    const parou = cancelado || rejeitados.length > 0; // slice falhou ou cancelou: sem gate, sem commit

    // GATE deterministico (fail-closed): sem comandos resolvidos, g.rodou=false e segue como antes.
    // Sem reparo interno: gate falhou = GATE-FAILED direto, com a saida na mao do orquestrador.
    let g = { ok: true, cmd: "", saida: "", rodou: false, ambiente: false };
    if (!parou) g = await gate(cwd, emit, gateCmds, 0, signal);

    let status: string;
    const amb = ambiente ? { cmd: ambiente.cmd, saida: ambiente.saida } : g.ambiente ? { cmd: g.cmd, saida: g.saida } : null;
    if (cancelado || signal.aborted) {
      status = "CANCELED"; // para e mantem os arquivos no working tree; nada commitado
    } else if (amb) {
      status = "ENV-FAILED"; // ambiente quebrou no meio: para tudo, sem commit
    } else if (parou) {
      status = "NEEDS-REVIEW"; // slice falhou: resto pulado, sem gate/commit
    } else if (g.rodou && !g.ok) {
      status = "GATE-FAILED"; // fail-closed: nao revisa nem commita codigo que nao passou no gate
    } else {
      status = "COMPLETE"; // gate passou (ou nao havia gate): commit direto, sem revisor
      if (signal.aborted) status = "CANCELED"; // ultimo ponto de corte: depois do commit o cancel e' ignorado
      else try { await commit(cwd, feature, emit); } catch (e: any) {
        emit({ t: "fase", nome: "commit", info: String(e?.message ?? e) });
        status = "COMMIT-SKIP";
      }
    }

    // Painel final: resumo por tarefa (nao o log inteiro).
    const linhas: string[] = [];
    for (const r of resultados) {
      linhas.push((r.ok ? "[ok] " : "[!!] ") + r.tarefa);
      if (r.escritos.length) linhas.push("     arq: " + r.escritos.join(", "));
      if (r.comandos.length) linhas.push("     cmd: " + r.comandos.join(", "));
      if (!r.ok) linhas.push("     motivo: " + r.motivo);
    }
    if (g.rodou) linhas.push("GATE: " + (g.ok ? "OK" : "FALHOU (" + g.cmd + ")"));
    if (amb) linhas.push("AMBIENTE: " + amb.cmd, ...amb.saida.trim().split("\n").slice(-6).map((s) => "  | " + s.trim()));
    linhas.push("branch " + branch);
    if (baselineRef) linhas.push("REVERTER: git checkout " + baselineRef.slice(0, 8) + " -- .");
    const painel = frame({ titulo: "DEV ORCHESTRA // " + branch, cwd, linhas, status });
    emit({ t: "painel", status, branch, baseline: baselineRef, ...(baseRun ? { base: baseRun } : {}), linhas });
    toFile(painel + "\n");
    // o frame corta linha longa: a saida completa do que falhou vai DEPOIS do painel (orquestrador decide)
    const falha = amb ?? (g.rodou && !g.ok && !parou && !cancelado ? { cmd: g.cmd, saida: g.saida } : null);
    return falha ? painel + "\nSAIDA (" + falha.cmd + "):\n" + falha.saida.trim().slice(-1500) : painel;
  } catch (e: any) {
    emit({ t: "log", texto: "ERRO: " + (e?.message ?? e) });
    emit({ t: "painel", status: "FAILED", branch: "", linhas: vivo });
    const painel = frame({ titulo: "DEV ORCHESTRA // FALHA", cwd, linhas: vivo, status: "FAILED" });
    toFile(painel + "\n");
    return painel;
  } finally {
    clearInterval(poll);
    try { unlinkSync(cancelFile); } catch {}
  }
}

// Self-check offline (sem API): painel, slug, parse do plano, guardas, gate, eventos, e o loop do agente com client fake.
if (process.argv.includes("--selftest")) {
  assert.strictEqual(row("x").length, WIDTH);
  assert.strictEqual(row("y".repeat(300)).length, WIDTH);
  for (const ln of frame({ titulo: "t", cwd: "c", linhas: ["a"], status: "OK" }).split("\n")) assert.strictEqual(ln.length, WIDTH);
  assert.strictEqual(slug("Adicionar Dark Mode!"), "adicionar-dark-mode");
  assert.strictEqual(slug("Cafe com Leite"), "cafe-com-leite");
  // guarda anti-destruicao: HTML truncado (perdeu </html>) e' rejeitado; edicao valida passa
  const htmlOk = "<!DOCTYPE html><html><body>oi</body></html>\n";
  assert.ok(destrutivo("static/index.html", htmlOk, "<!DOCTYPE html><html><body>:root{--x:1}")); // truncou
  assert.strictEqual(destrutivo("static/index.html", htmlOk, "<!DOCTYPE html><html><body>novo conteudo aqui</body></html>\n"), null);
  assert.ok(destrutivo("a.js", "x".repeat(1000), "y")); // encolheu demais
  // parse do plano no schema de slices
  const p = JSON.parse('[{"tarefa":"t","arquivos_alvo":["a.js"],"descricao":"x"}]') as Tarefa[];
  assert.strictEqual(p[0].tarefa, "t");
  assert.strictEqual(p[0].arquivos_alvo[0], "a.js");
  // Sem teto de tentativas internas: quem repara o gate e' o orquestrador, nao o swarm (S1)
  // ehTeste: reconhece os padroes comuns de arquivo de teste (pura, offline)
  assert.strictEqual(ehTeste("src/foo.test.ts"), true);
  assert.strictEqual(ehTeste("a/__tests__/x.ts"), true);
  assert.strictEqual(ehTeste("test_x.py"), true);
  assert.strictEqual(ehTeste("x_test.go"), true);
  assert.strictEqual(ehTeste("src/index.ts"), false);
  // custoUSD: mesma quantidade de tokens custa MAIS no pico (quarta 02:00 UTC) que off-peak (domingo 12:00 UTC)
  const quartaPico = new Date(Date.UTC(2024, 0, 3, 2, 0, 0)); // quarta-feira, 02:00 UTC (peak)
  const domingoOff = new Date(Date.UTC(2024, 0, 7, 12, 0, 0)); // domingo, 12:00 UTC (off-peak)
  // provedor explicito: o default e' o provedor do ambiente (go = assinatura -> 0)
  assert.ok(custoUSD(1e6, 1e6, quartaPico, "deepseek") > custoUSD(1e6, 1e6, domingoOff, "deepseek"), "peak > off-peak");
  assert.strictEqual(custoUSD(1e6, 1e6, quartaPico, "go"), 0, "Go e' assinatura: custo por token 0");
  // classificacao de falha de ambiente (incidente career-copilot 05/10: saida real com mojibake do cmd.exe)
  assert.strictEqual(ehFalhaAmbiente("'pnpm' n\uFFFDo \uFFFD reconhecido como um comando interno\r\nou externo"), true);
  assert.strictEqual(ehFalhaAmbiente("bash: lune: command not found"), true);
  assert.strictEqual(ehFalhaAmbiente("Error: Cannot find native binding. npm has a bug related to optional dependencies"), true);
  assert.strictEqual(ehFalhaAmbiente('ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL  Command "vitest" not found'), true);
  assert.strictEqual(ehFalhaAmbiente("Error: Cannot find module '@rolldown/binding-win32-x64-msvc'"), true);
  assert.strictEqual(ehFalhaAmbiente("Error: Cannot find module './profile.service'"), false, "import relativo = spec sem implementacao");
  assert.strictEqual(ehFalhaAmbiente("Error [ERR_MODULE_NOT_FOUND]: Cannot find module 'C:\\Users\\x\\subtrai.js' imported from C:\\Users\\x\\subtrai.test.js"), false, "caminho absoluto Windows = import local");
  assert.strictEqual(ehFalhaAmbiente("Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/tmp/x/subtrai.js' imported from /tmp/x/subtrai.test.js"), false);
  assert.strictEqual(ehFalhaAmbiente("Cannot find module 'file:///C:/x/subtrai.js'"), false);
  assert.strictEqual(ehFalhaAmbiente("connect ECONNREFUSED 127.0.0.1:5432"), true);
  assert.strictEqual(ehFalhaAmbiente("tests/run.luau:12: assertion failed"), false);
  assert.strictEqual(ehFalhaAmbiente("TypeError: Cannot read properties of undefined (reading 'parse')"), false);
  // recusaComando: exec e efeito fora do git (texto ou corpo do script); args depois de ' -- ' nao contam
  const sc = { "db:migrate": "prisma migrate dev", setup: "pnpm i && prisma db push", "db:generate": "prisma generate", test: "vitest run" };
  assert.match(recusaComando("pnpm --filter api exec vitest run", sc) ?? "", /exec/);
  assert.match(recusaComando("node_modules\\.bin\\pnpm.CMD db:migrate", sc) ?? "", /migrate/);
  assert.match(recusaComando("pnpm setup", sc) ?? "", /efeito/, "migrate escondido no corpo do script");
  assert.strictEqual(recusaComando("pnpm db:generate", sc), null);
  assert.strictEqual(recusaComando("pnpm test -- src/reset-password.spec.ts", sc), null, "arquivo de teste com 'reset' passa");
  // escritaProibida: denylist + excecao por arquivos_alvo (nunca node_modules)
  const ex = exesDe(["node_modules\\.bin\\pnpm.CMD typecheck", '"C:/x/lune.exe" run t']);
  assert.ok(ex.has("pnpm") && ex.has("lune"));
  assert.ok(escritaProibida("pnpm.cmd", [], false, ex));
  assert.ok(escritaProibida("pnpm", [], false, ex));
  assert.ok(escritaProibida("node_modules/.bin/pnpm.CMD", ["node_modules/.bin/pnpm.CMD"], false, ex), "node_modules sem excecao");
  assert.ok(escritaProibida("packages/db/prisma/migrations/2026_init/migration.sql", [], false, ex));
  assert.ok(escritaProibida("packages/db/src/generated/enums.ts", [], true, ex), "ignorado pelo git");
  assert.strictEqual(escritaProibida("prisma/migrations/x.sql", ["prisma/migrations/x.sql"], false, ex), null, "listado em arquivos_alvo");
  assert.strictEqual(escritaProibida("src/app.ts", [], false, ex), null);
  assert.strictEqual(escritaProibida("Makefile", [], false, ex), null, "sem extensao mas nao e' exe de comando");
  // preflight: ok / esperada / ambiente / timeout / recusado (offline via node -e)
  await (async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-pf-"));
    const n = `"${process.execPath}" -e`;
    const pf = await preflight(cwd, [`${n} "process.exit(0)"`, `${n} "process.exit(1)"`], [`${n} "process.exit(0)"`, "nao-existe-xyz"], {});
    assert.deepStrictEqual(pf.itens.map((i) => i.classe), ["ok", "esperada", "ambiente"], "dedupe + classes");
    assert.strictEqual(pf.ok, false);
    assert.strictEqual((await preflight(cwd, [`${n} "process.exit(1)"`], [], {})).ok, true, "falha de teste e' esperada");
    const lento = await preflight(cwd, [`${n} "setTimeout(()=>{},5000)"`], [], {}, undefined, 300);
    assert.strictEqual(lento.itens[0].classe, "ambiente", "timeout = ambiente");
    const rec = await preflight(cwd, ["pnpm db:migrate"], [], { "db:migrate": "prisma migrate dev" });
    assert.strictEqual(rec.itens[0].classe, "recusado");
    assert.match(textoPreflight(pf.itens), /\[AMBIENTE\]\s+nao-existe-xyz/);
  })();
  // escolherProvedor: nativa/OpenRouter/nenhuma (CA-1, CA-2, CA-4 -- pura, sem mexer em env em runtime)
  assert.strictEqual(escolherProvedor("dk", undefined).useAuthToken, false); // so' nativa
  assert.strictEqual(escolherProvedor(undefined, "or").useAuthToken, true); // so' OpenRouter
  assert.strictEqual(escolherProvedor(undefined, "or").baseURL, "https://openrouter.ai/api");
  assert.strictEqual(escolherProvedor(undefined, "or").model, "deepseek/deepseek-v4.1-flash");
  assert.strictEqual(escolherProvedor("dk", "or").useAuthToken, false); // as duas: nativa vence
  assert.strictEqual(escolherProvedor(undefined, undefined).useAuthToken, false); // nenhuma: cai no erro de obter()
  // OpenCode Go: vence as outras chaves e usa o formato OpenAI com DeepSeek V4.1 Flash
  assert.strictEqual(escolherProvedor("dk", "or", "go").kind, "openai");
  assert.strictEqual(escolherProvedor(undefined, undefined, "go").baseURL, "https://opencode.ai/zen/go/v1");
  assert.strictEqual(escolherProvedor(undefined, undefined, "go").model, "deepseek-v4.1-flash");
  assert.strictEqual(escolherProvedor("dk", "or").kind, "anthropic"); // sem chave Go: igual a hoje
  // ida Anthropic -> OpenAI: system, tool_use -> tool_calls, thinking -> reasoning_content, tool_result -> role tool
  (() => {
    const { messages: om, tools: ot } = paraOpenAI("sys", [
      { role: "user", content: "faz" },
      { role: "assistant", content: [
        { type: "thinking", thinking: "penso" }, { type: "text", text: "vou ler" },
        { type: "tool_use", id: "c1", name: "listar", input: { caminho: "." } },
      ] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "c1", content: "a.ts" }] },
    ], [{ name: "listar", description: "lista", input_schema: { type: "object" } }]);
    assert.deepStrictEqual(om[0], { role: "system", content: "sys" });
    assert.deepStrictEqual(om[1], { role: "user", content: "faz" });
    assert.strictEqual(om[2].content, "vou ler");
    assert.strictEqual(om[2].reasoning_content, "penso");
    assert.deepStrictEqual(om[2].tool_calls[0], { id: "c1", type: "function", function: { name: "listar", arguments: '{"caminho":"."}' } });
    assert.deepStrictEqual(om[3], { role: "tool", tool_call_id: "c1", content: "a.ts" });
    assert.deepStrictEqual(ot[0], { type: "function", function: { name: "listar", description: "lista", parameters: { type: "object" } } });
  })();
  // volta OpenAI -> Anthropic: tool_call fatiado em 3 pedacos (e um chunk SSE cortado ao meio), raciocinio, usage
  (() => {
    const est = novoEstado();
    const sse = (o: unknown) => "data: " + JSON.stringify(o) + "\n\n";
    const meio = sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: 'inho":' } }] } }] });
    let resto = consumirSSE(sse({ choices: [{ delta: { reasoning_content: "hmm" } }] }) +
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t9", function: { name: "ler_arquivo", arguments: '{"cam' } }] } }] }) +
      meio.slice(0, 30), est);
    resto = consumirSSE(resto + meio.slice(30) +
      sse({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"a.ts"}' } }] }, finish_reason: "tool_calls" }] }) +
      sse({ choices: [], usage: { prompt_tokens: 7, completion_tokens: 3 } }) + "data: [DONE]\n\n", est);
    assert.strictEqual(resto, "");
    const r = finalizar(est);
    assert.strictEqual(r.stop, "tool_use");
    assert.deepStrictEqual(r.blocos, [
      { type: "thinking", thinking: "hmm" },
      { type: "tool_use", id: "t9", name: "ler_arquivo", input: { caminho: "a.ts" } },
    ]);
    assert.deepStrictEqual(r.usage, { in: 7, out: 3 });
    const txt = novoEstado();
    consumirSSE(sse({ choices: [{ delta: { content: "pronto" }, finish_reason: "stop" }] }), txt);
    assert.deepStrictEqual(finalizar(txt), { blocos: [{ type: "text", text: "pronto" }], stop: "end_turn", usage: { in: 0, out: 0 } });
    // argumentos com JSON quebrado viram input {} (a ferramenta reclama; a slice nao cai)
    const ruim = novoEstado();
    consumirSSE(sse({ choices: [{ delta: { tool_calls: [{ index: 0, id: "x", function: { name: "listar", arguments: "{quebrado" } }] }, finish_reason: "tool_calls" }] }), ruim);
    assert.deepStrictEqual(finalizar(ruim).blocos[0].input, {});
    assert.throws(() => consumirSSE(sse({ error: { message: "boom" } }), novoEstado()), /boom/);
  })();
  // teto de uso do Go nao re-tenta; rate limit comum e 5xx re-tentam
  assert.strictEqual(retentavel(erroHttp(402, "insufficient balance")), false);
  assert.match(erroHttp(402, "x").message, /limite de uso/);
  assert.strictEqual(retentavel(erroHttp(429, "monthly usage limit reached")), false);
  assert.strictEqual(retentavel(erroHttp(429, "rate limit, slow down")), true);
  assert.strictEqual(retentavel(erroHttp(503, "busy")), true);
  assert.strictEqual(retentavel(erroHttp(400, "bad request")), false);
  // linhaDe(): cada tipo de evento produz uma string (nao abre servidor)
  const amostras: Evento[] = [
    { t: "run", feature: "f", cwd: "c", total: 1 },
    { t: "fase", nome: "baseline", info: "abc" },
    { t: "slice", idx: 1, total: 1, tarefa: "t", status: "rodando" },
    { t: "slice", idx: 1, total: 1, tarefa: "t", status: "ok", escritos: ["a.ts"], comandos: [] },
    { t: "slice", idx: 1, total: 1, tarefa: "t", status: "incompleta", motivo: "x" },
    { t: "tool", slice: 1, nome: "ler_arquivo", alvo: "a.ts", ok: true },
    { t: "gate", cmd: "npm test", status: "ok" },
    { t: "diff", arquivo: "a.ts", patch: "@@ x" },
    { t: "painel", status: "COMPLETE", branch: "b", linhas: [] },
    { t: "log", texto: "linha crua" },
  ];
  for (const ev of amostras) assert.strictEqual(typeof linhaDe(ev), "string");
  assert.strictEqual(linhaDe({ t: "slice", idx: 1, total: 1, tarefa: "t", status: "fila" }), "");

  // Barramento em disco: dois arquivos *.jsonl viram dois swarms com seus eventos agrupados (multi-swarm)
  await (async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-runs-"));
    await fsp.writeFile(path.join(dir, "aaa11111.jsonl"),
      JSON.stringify({ t: "run", feature: "f1", cwd: "c1", total: 2 }) + "\n" +
      JSON.stringify({ t: "slice", idx: 1, total: 2, tarefa: "t", status: "ok" }) + "\n");
    await fsp.writeFile(path.join(dir, "bbb22222.jsonl"),
      JSON.stringify({ t: "run", feature: "f2", cwd: "c2", total: 1 }) + "\n" +
      "linha corrompida nao derruba\n"); // linha invalida e' ignorada, nao lanca
    const m = lerRuns(dir);
    assert.strictEqual(m.size, 2, "dois swarms");
    assert.strictEqual(m.get("aaa11111")!.length, 2);
    assert.strictEqual(m.get("bbb22222")!.length, 1, "linha invalida descartada");
    assert.strictEqual((m.get("aaa11111")![0] as any).feature, "f1");
    assert.strictEqual(lerRuns(path.join(dir, "nao-existe")).size, 0, "pasta inexistente -> vazio");
  })();

  // Loop do agente com client FAKE (sem rede). Prova o ciclo tool_use->tool_result e as guardas.
  const nada = () => {};
  const alvo: Tarefa = { tarefa: "t", arquivos_alvo: [], descricao: "d" };
  function fake(respostas: any[]) {
    let i = 0; const recebidos: string[] = [];
    const fn = async (_s: string, messages: any[]) => {
      const last = messages[messages.length - 1];
      if (last && Array.isArray(last.content)) for (const b of last.content) if (b?.type === "tool_result") recebidos.push(String(b.content));
      return respostas[Math.min(i++, respostas.length - 1)];
    };
    return { fn, recebidos };
  }
  const fim = { blocos: [{ type: "text", text: "fim" }], stop: "end_turn" };
  await (async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-st-"));
    // CA-5: escrever fora do projeto e' recusado
    const g = fake([{ blocos: [{ type: "tool_use", id: "a", name: "escrever_arquivo", input: { caminho: "../fora.txt", conteudo: "x" } }], stop: "tool_use" }, fim]);
    await agente(base, "f", alvo, nada, 1, [], g.fn as any);
    assert.ok(g.recebidos.some((r) => r.startsWith("ERRO: caminho fora")), "path guard");
    // CA-6: comando fora da allowlist e' bloqueado (allowlist vazia no selftest)
    const c = fake([{ blocos: [{ type: "tool_use", id: "b", name: "rodar_comando", input: { comando: "rm -rf /" } }], stop: "tool_use" }, fim]);
    await agente(base, "f", alvo, nada, 1, [], c.fn as any);
    assert.ok(c.recebidos.some((r) => r.includes("nao permitido")), "allowlist");
    // executavel inexistente no meio da run = AmbienteError (a run para em ENV-FAILED), com o custo da slice
    const amb = fake([{ blocos: [{ type: "tool_use", id: "e", name: "rodar_comando", input: { comando: "nao-existe-xyz" } }], stop: "tool_use", usage: { in: 10, out: 2 } }, fim]);
    await assert.rejects(agente(base, "f", alvo, nada, 1, ["nao-existe-xyz"], amb.fn as any),
      (e: any) => e instanceof AmbienteError && e.cmd === "nao-existe-xyz" && e.tokensIn === 10);
    // construir: slice com ambiente para a run, resto "pulada", devolve ambiente
    const evs: Evento[] = [];
    const cr = await construir(base, "f", [alvo, { ...alvo, tarefa: "t2" }], (ev) => evs.push(ev), ["nao-existe-xyz"], undefined,
      fake([{ blocos: [{ type: "tool_use", id: "e", name: "rodar_comando", input: { comando: "nao-existe-xyz" } }], stop: "tool_use" }]).fn as any);
    assert.strictEqual(cr.ambiente?.cmd, "nao-existe-xyz");
    assert.ok(evs.some((ev) => ev.t === "slice" && ev.idx === 2 && ev.status === "pulada"));
    // shim de executavel recusado no meio da run (o agente do incidente criou pnpm.cmd)
    const sh = fake([{ blocos: [{ type: "tool_use", id: "s", name: "escrever_arquivo", input: { caminho: "pnpm.cmd", conteudo: "@echo off\n" } }], stop: "tool_use" }, fim]);
    await agente(base, "f", alvo, nada, 1, ["pnpm typecheck"], sh.fn as any);
    assert.ok(sh.recebidos.some((r) => r.startsWith("RECUSADO (fora do que")), "shim recusado");
    // editar_arquivo: troca trecho unico (inclusive em arquivo CRLF); ausente/repetido e' recusado; buscar acha a linha
    await fsp.writeFile(path.join(base, "e.txt"), "a = 1\r\nb = 2\r\nb = 2\r\n");
    const ed = fake([
      { blocos: [{ type: "tool_use", id: "e1", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "a = 1\n", novo: "a = 9\n" } }], stop: "tool_use" },
      { blocos: [{ type: "tool_use", id: "e2", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "b = 2", novo: "x" } }], stop: "tool_use" },
      { blocos: [{ type: "tool_use", id: "e3", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "zzz", novo: "x" } }], stop: "tool_use" },
      { blocos: [{ type: "tool_use", id: "e4", name: "buscar", input: { padrao: "a = 9" } }], stop: "tool_use" },
      fim,
    ]);
    await agente(base, "f", alvo, nada, 1, [], ed.fn as any);
    assert.strictEqual(ed.recebidos[0], "ok", "edicao unica aplicada");
    assert.ok(ed.recebidos[1].includes("aparece 2 vezes"), "trecho repetido recusado");
    assert.ok(ed.recebidos[2].includes("nao encontrado"), "trecho ausente recusado");
    assert.strictEqual(ed.recebidos[3], "e.txt:1: a = 9", "buscar acha a linha editada");
    assert.strictEqual(await fsp.readFile(path.join(base, "e.txt"), "utf8"), "a = 9\r\nb = 2\r\nb = 2\r\n", "CRLF preservado");
    // CA-4 + escrita valida: ciclo completo devolve tool_result "ok" e registra o arquivo
    const w = fake([{ blocos: [{ type: "tool_use", id: "c", name: "escrever_arquivo", input: { caminho: "novo.txt", conteudo: "conteudo valido\n" } }], stop: "tool_use" }, fim]);
    const r = await agente(base, "f", { tarefa: "t", arquivos_alvo: ["novo.txt"], descricao: "d" }, nada, 1, [], w.fn as any);
    assert.ok(w.recebidos.some((x) => x === "ok"), "tool_result ok");
    assert.deepStrictEqual(r.escritos, ["novo.txt"]);
    assert.strictEqual(r.ok, true);
  })();

  // Trava anti-alterar-teste: teste que JA existe e' imutavel; criar teste NOVO continua permitido.
  await (async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-tst-"));
    await fsp.writeFile(path.join(base, "foo.test.ts"), "// teste existente\n");
    const t = fake([
      { blocos: [{ type: "tool_use", id: "t1", name: "escrever_arquivo", input: { caminho: "foo.test.ts", conteudo: "// sobrescrito\n" } }], stop: "tool_use" },
      { blocos: [{ type: "tool_use", id: "t2", name: "escrever_arquivo", input: { caminho: "novo.test.ts", conteudo: "// teste novo\n" } }], stop: "tool_use" },
      fim,
    ]);
    await agente(base, "f", alvo, nada, 1, [], t.fn as any);
    assert.ok(t.recebidos.some((r) => r.startsWith("RECUSADO (teste imutavel")), "teste existente recusado");
    assert.ok(t.recebidos.some((r) => r === "ok"), "teste novo permitido");
    assert.strictEqual(await fsp.readFile(path.join(base, "foo.test.ts"), "utf8"), "// teste existente\n", "teste original preservado");
  })();

  // gate(): skip (sem comandos) / passa / falha (offline, via node -e)
  await (async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-gate-"));
    const eventos: Evento[] = [];
    const e = (ev: Evento) => eventos.push(ev);
    const skip = await gate(cwd, e, []);
    assert.strictEqual(skip.rodou, false, "sem comandos: gate nao roda");
    assert.strictEqual(skip.ok, true);
    const okCmd = `"${process.execPath}" -e "process.exit(0)"`;
    const passa = await gate(cwd, e, [okCmd]);
    assert.strictEqual(passa.ok, true);
    assert.strictEqual(passa.rodou, true);
    const failCmd = `"${process.execPath}" -e "process.exit(1)"`;
    const falha = await gate(cwd, e, [failCmd]);
    assert.strictEqual(falha.ok, false);
    assert.ok(eventos.some((ev) => ev.t === "gate" && ev.status === "falha"));
  })();

  // comTentativas: ocioso re-tenta o MESMO turno e desiste na 3a; erro transitorio + sucesso volta; cancelado nao re-tenta (CA-2/3)
  await (async () => {
    const tentativas: number[] = [];
    let chamadas = 0;
    const trava = (sinal: AbortSignal) => { chamadas++; return new Promise<never>((_, falha) => sinal.addEventListener("abort", () => falha(new Error("aborted")))); };
    await assert.rejects(
      comTentativas(trava, { ociosoMs: 30, esperas: [1], tentativas: 3, onTentativa: (n) => tentativas.push(n) }),
      /sem resposta.*3 tentativas/,
    );
    assert.strictEqual(chamadas, 3, "3 tentativas no total");
    assert.deepStrictEqual(tentativas, [2, 3]);
    let vez = 0;
    const volta = await comTentativas(async () => { if (++vez === 1) throw new Error("terminated"); return "ok"; }, { esperas: [1] });
    assert.strictEqual(volta, "ok", "conexao caida re-tenta e recupera");
    await assert.rejects(comTentativas(async () => { throw Object.assign(new Error("bad"), { status: 400 }); }, { esperas: [1] }), /bad/);
    const ctrl = new AbortController();
    const p = comTentativas(trava, { signal: ctrl.signal, ociosoMs: 10_000 });
    ctrl.abort();
    await assert.rejects(p, CanceladoError);
  })();

  // agente: erro de API vira slice falha COM tokens; sem escrita + verificacao ok = ok (sem mudancas) (CA-2/4)
  await (async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-ag-"));
    const t0: Tarefa = { tarefa: "t", arquivos_alvo: [], descricao: "d" };
    let n = 0;
    const cai = async () => {
      if (++n === 1) return { blocos: [{ type: "tool_use", id: "l", name: "listar", input: { caminho: "." } }], stop: "tool_use", usage: { in: 10, out: 5 } };
      throw new Error("terminated (apos 3 tentativas)");
    };
    const r1 = await agente(base, "f", t0, nada, 1, [], cai as any);
    assert.strictEqual(r1.ok, false);
    assert.ok(r1.motivo.startsWith("erro:"), r1.motivo);
    assert.strictEqual(r1.tokensIn, 10, "tokens preservados");
    const ok0 = `"${process.execPath}" -e "process.exit(0)"`;
    const verifica = fake([{ blocos: [{ type: "tool_use", id: "v", name: "rodar_comando", input: { comando: ok0 } }], stop: "tool_use" }, fim]);
    const r2 = await agente(base, "f", t0, nada, 1, [ok0], verifica.fn as any);
    assert.strictEqual(r2.ok, true, "verificacao passou");
    assert.strictEqual(r2.semMudancas, true);
    const r3 = await agente(base, "f", t0, nada, 1, [], fake([fim]).fn as any);
    assert.strictEqual(r3.ok, false, "sem escrita e sem verificacao = falha");
  })();

  // construir: 1a slice falha -> resto "pulada"; signal abortado -> cancelado (CA-3/4)
  await (async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-cons-"));
    const plano2: Tarefa[] = [{ tarefa: "a", arquivos_alvo: [], descricao: "" }, { tarefa: "b", arquivos_alvo: [], descricao: "" }];
    const evs: Evento[] = [];
    const r = await construir(base, "f", plano2, (e) => evs.push(e), [], undefined, fake([fim]).fn as any);
    assert.strictEqual(r.cancelado, false);
    assert.strictEqual(r.rejeitados.length, 1, "parou na primeira");
    assert.ok(evs.some((e) => e.t === "slice" && e.idx === 2 && e.status === "pulada"), "slice 2 pulada");
    assert.ok(!evs.some((e) => e.t === "slice" && e.idx === 2 && e.status === "rodando"), "slice 2 nao rodou");
    const ctrl = new AbortController();
    ctrl.abort();
    const c = await construir(base, "f", plano2, () => {}, [], ctrl.signal, fake([fim]).fn as any);
    assert.strictEqual(c.cancelado, true);
  })();

  // arquivo por run: duas runs no mesmo processo = dois arquivos, nenhum truncado (CA-5)
  (() => {
    emitirUI({ t: "run", feature: "st1", cwd: "c", total: 0 });
    const a = runAtual();
    emitirUI({ t: "log", texto: "x" });
    emitirUI({ t: "run", feature: "st2", cwd: "c", total: 0 });
    const b = runAtual();
    assert.notStrictEqual(a, b, "ids distintos");
    const m = lerRuns(path.dirname(arquivoCancel(a)));
    assert.strictEqual(m.get(a)!.length, 2, "run 1 intacta");
    assert.strictEqual(m.get(b)!.length, 1);
    for (const id of [a, b]) { try { unlinkSync(path.join(path.dirname(arquivoCancel(id)), id + ".jsonl")); } catch {} }
  })();

  // commit() faz stage: arquivo novo/editado pelo swarm entra no commit (antes dava "Command failed: git commit")
  await (async () => {
    const base = await fsp.mkdtemp(path.join(os.tmpdir(), "dev-orchestra-cm-"));
    await fsp.writeFile(path.join(base, "a.txt"), "a\n");
    await baseline(base, "cm", nada);
    await fsp.writeFile(path.join(base, "novo.js"), "x\n");
    await commit(base, "cm", nada);
    const { execFileSync } = await import("node:child_process");
    assert.strictEqual(execFileSync("git", ["status", "--porcelain"], { cwd: base }).toString(), "", "tudo commitado");
    assert.ok(execFileSync("git", ["show", "--name-only", "HEAD"], { cwd: base }).toString().includes("novo.js"));
  })();

  console.log("selftest ok");
  process.exit(0);
}

// ATENCAO (nao usar `node --test dist/`): no Node 22, passar a PASTA pro test runner faz ele executar
// TODO arquivo da pasta — este modulo incluso. Ao ser carregado assim, o topo deste arquivo sobe o MCP
// stdio e o processo fica BLOCKADO no stdin pra sempre, travando a suite inteira (dist/web, o bundle do
// dashboard, tem o mesmo risco). Por isso o `npm test` lista os arquivos de teste EXPLICITAMENTE
// (ver package.json); arquivos passados a mao sao sempre executados, mesmo fora dos padroes *.test.js.
const server = new McpServer({ name: "dev-orchestra", version: "3.0.0" });
server.registerTool(
  "executar_orchestra",
  {
    title: "Executar Orchestra (swarm)",
    description:
      "Implementa uma feature num diretorio via swarm DeepSeek (ASSINCRONA). O planejador monta SLICES e passa o plano; " +
      "cada slice roda em serie como um agente DeepSeek (le/edita arquivos e roda comandos de verificacao " +
      "permitidos), depois um GATE deterministico (typecheck/testes) e so entao commit local. Se o gate falhar a run " +
      "volta GATE-FAILED com a saida pro planejador decidir. " +
      "A allowlist e o gate sao resolvidos do package.json do alvo (override opcional em cada um). " +
      "Esta tool dispara a run em background e volta NA HORA com o runId; acompanhe com status_orchestra. " +
      "Progresso ao vivo no dashboard web (ver stderr pra URL).",
    inputSchema: {
      cwd: z.string().describe("Pasta do projeto onde implementar"),
      feature: z.string().describe("Descricao da feature"),
      plano: z
        .array(
          z.object({
            tarefa: z.string().describe("Titulo curto da slice"),
            arquivos_alvo: z.array(z.string()).describe("Arquivos que a slice deve tocar (relativos); pode ser vazio"),
            descricao: z.string().describe("O que fazer nessa slice"),
          }),
        )
        .describe("Plano do Claude: slices de alto nivel (um agente por slice, pode tocar varios arquivos)"),
      override: z
        .object({
          cmds: z.array(z.string()).optional().describe("Allowlist explicita de comandos permitidos (vence o package.json)"),
          gate: z.array(z.string()).optional().describe("Comandos do GATE explicitos (vence o package.json)"),
        })
        .optional()
        .describe("Override opcional da allowlist/gate (senao resolve do package.json do alvo)"),
    },
  },
  async ({ cwd, feature, plano, override }) => {
    try {
      const runId = iniciar((progresso) => rodar(cwd, feature, plano as Tarefa[], override as Override | undefined, progresso));
      abrirDashboard(URL_DASH);
      return {
        content: [{
          type: "text",
          text:
            `RUN INICIADA: ${runId}\n` +
            `dashboard: ${URL_DASH}\n` +
            `chame status_orchestra com runId=${runId} ate vir o painel final (cancelar: botao do dashboard)`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text", text: "ERRO: " + (e?.message ?? e) }], isError: true };
    }
  },
);

server.registerTool(
  "doctor_orchestra",
  {
    title: "Doctor Orchestra (preflight)",
    description:
      "Roda o MESMO preflight da run, sem agentes e sem custo: cada comando da allowlist + gate na baseline, " +
      "pelo shell do bridge (mesmo PATH/node dos agentes). Classifica: ok | esperada (falha de teste/typecheck, " +
      "normal antes da implementacao) | AMBIENTE (executavel/node/binding/pacote/servico/timeout) | RECUSADO " +
      "(exec, migrate/seed/... na allowlist). Qualquer AMBIENTE/RECUSADO faz executar_orchestra abortar (ENV-FAILED).",
    inputSchema: {
      cwd: z.string().describe("Pasta do projeto"),
      override: z
        .object({ cmds: z.array(z.string()).optional(), gate: z.array(z.string()).optional() })
        .optional()
        .describe("Mesmo override que sera passado ao executar_orchestra"),
    },
  },
  async ({ cwd, override }) => {
    try {
      // ponytail: sincrono; se o cliente do OpenCode cortar chamada longa, vira assincrono como a run
      const { cmds, gate: g, scripts } = await resolverComandos(cwd, override as Override | undefined);
      const pf = await preflight(cwd, cmds, g, scripts);
      const txt = textoPreflight(pf.itens) || "(nenhum comando resolvido)";
      return { content: [{ type: "text", text: (pf.ok ? "PREFLIGHT OK\n" : "PREFLIGHT FALHOU (a run abortaria em ENV-FAILED)\n") + txt }] };
    } catch (e: any) {
      return { content: [{ type: "text", text: "ERRO: " + (e?.message ?? e) }], isError: true };
    }
  },
);

server.registerTool(
  "status_orchestra",
  {
    title: "Status Orchestra (swarm)",
    description:
      "Consulta o andamento de uma run assincrona iniciada por executar_orchestra. " +
      "Aguarda ate ~20s: se a run terminar, devolve o painel final; senao devolve as ultimas linhas e " +
      "pede pra chamar de novo.",
    inputSchema: {
      runId: z.string().describe("runId devolvido por executar_orchestra"),
    },
  },
  async ({ runId }) => {
    try {
      const r = await esperar(runId, 20000);
      if ("fim" in r) return { content: [{ type: "text", text: r.fim }] };
      const linhas = r.rodando.length ? r.rodando.join("\n") : "(sem saida ainda)";
      // G3/S2: se a run corrente esta pausada (ultimo evento de pausa), o prefixo vira PAUSADA.
      const evs: Evento[] = (() => {
        try {
          return readFileSync(path.join(RUNS_DIR, runAtual() + ".jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
        } catch { return []; }
      })();
      const prefixo = estaPausada(evs) ? "PAUSADA" : "RODANDO";
      return {
        content: [{
          type: "text",
          text: `${prefixo} ${runId}\n${linhas}\nchame status_orchestra de novo`,
        }],
      };
    } catch (e: any) {
      return { content: [{ type: "text", text: "ERRO: " + (e?.message ?? e) }], isError: true };
    }
  },
);

if (process.argv.includes("--ui")) {
  // Modo dashboard-only: NAO conecta o MCP stdio. Ceder a porta encerra o processo.
  // sempreAssumir: abrir o app SEMPRE derruba o node --ui anterior (mesmo com dist igual) e passa a
  // servir a porta com o codigo mais atualizado — evita o dashboard caindo/desatualizado no looping.
  await iniciarUI({ onCeder: () => process.exit(0), sempreAssumir: true });
} else {
  await server.connect(new StdioServerTransport());
  void iniciarUI();
  process.stderr.write("[dev-orchestra] listening (stdio)\n");
}