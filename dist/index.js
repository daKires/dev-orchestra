import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import assert from "node:assert";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { appendFileSync, writeFileSync } from "node:fs";
import { baseline, construir, diffStaged, commit, revisar, slug, destrutivo, agente, gate, resolverComandos, podeReparar, custoUSD, ehTeste, existeExecutavel, ehFalhaAmbiente, } from "./hermes.js";
import { iniciarUI, emitir as emitirUI, linhaDe, lerRuns } from "./ui.js";
import { escolherProvedor } from "./deepseek.js";
const WIDTH = 64;
const SEP = "+" + "-".repeat(WIDTH - 2) + "+";
// Arquivo de log ao vivo (retrocompat; o dashboard web e' a UI principal agora). orchestra define HERMES_LOG.
const LOG_FILE = process.env.HERMES_LOG || path.join(os.tmpdir(), "hermes-run.log");
function toFile(s) { try {
    appendFileSync(LOG_FILE, s);
}
catch { } }
// Cor ANSI por tipo de linha (pra quem ainda acompanha via arquivo/stderr). O painel final fica sem cor.
function pintar(chave, texto) {
    const C = { reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", blue: "\x1b[1;34m" };
    let c = "";
    if (/^Tarefa \d+\//.test(chave))
        c = C.blue;
    else if (/ERRO|FAILED|FALHA/.test(chave))
        c = C.red;
    else if (/REJEITADO|BLOQUEADO|INCOMPLETA|ATENCAO/.test(chave))
        c = C.yellow;
    else if (/-> ok|concluida| OK|commit local/.test(chave))
        c = C.green;
    else if (/^\[T\d+\] (ler|listar|buscar|escrever|editar|rodar)/.test(chave))
        c = C.cyan;
    return c ? c + texto + C.reset : texto;
}
// Painel brutalista: ASCII puro, largura fixa.
function row(text) {
    const inner = WIDTH - 4;
    const t = text.length > inner ? text.slice(0, inner - 1) + "~" : text;
    return "| " + t.padEnd(inner, " ") + " |";
}
function frame(opts) {
    const out = [SEP, row(opts.titulo), row("CWD: " + opts.cwd), SEP];
    if (opts.linhas.length === 0)
        out.push(row("> (sem saida)"));
    else
        for (const l of opts.linhas)
            out.push(row(l));
    out.push(SEP, row("STATUS: " + opts.status), SEP);
    return out.join("\n");
}
// Roda o swarm: baseline -> agentes (serial) -> GATE (+reparo) -> revisor -> commit local.
// Todo evento vai pro dashboard web (SSE) E deriva uma linha pro stderr/arquivo (retrocompat). Nunca lanca.
// Allowlist/gate vem do package.json do ALVO (override do planner vence; fallback pro env legado).
async function rodar(cwd, feature, plano, override) {
    try {
        writeFileSync(LOG_FILE, "");
    }
    catch { } // trunca: cada run comeca limpa
    const vivo = [];
    const header = ["", SEP, row("HERMES SWARM // " + feature), row("CWD: " + cwd), SEP].join("\n") + "\n";
    process.stderr.write(header);
    toFile(header);
    const emit = (ev) => {
        emitirUI(ev);
        const l = linhaDe(ev);
        if (l) {
            vivo.push(l);
            const linha = pintar(l, row("> " + l)) + "\n";
            process.stderr.write(linha);
            toFile(linha);
        }
    };
    emit({ t: "run", feature, cwd, total: plano.length });
    try {
        const base = path.resolve(cwd);
        // Resolve a verificacao POR-PROJETO (package.json do alvo), com override opcional e fallback pro env.
        const { cmds: cmdsBrutos, gate: gateCmds, origem } = await resolverComandos(cwd, override);
        // Checagem previa (antes de baseline/agentes, custo $0): gate com executavel inexistente aborta a
        // run inteira (senao terminaria em GATE-FAILED); allowlist so perde o comando e avisa.
        for (const c of gateCmds)
            if (!(await existeExecutavel(c, cwd)))
                throw new Error("comando do gate nao existe: " + c);
        const cmds = [];
        for (const c of cmdsBrutos) {
            if (await existeExecutavel(c, cwd))
                cmds.push(c);
            else
                emit({ t: "fase", nome: "comandos", info: "removido (nao existe): " + c });
        }
        emit({ t: "fase", nome: "comandos", info: origem + (cmds.length ? " (" + cmds.length + " cmd)" : " (sem comandos)") });
        const { baselineRef, branch } = await baseline(cwd, feature, emit); // foto do original ANTES dos agentes
        const { rejeitados, resultados, escritos } = await construir(cwd, feature, plano, emit, cmds);
        // GATE deterministico (fail-closed): sem comandos resolvidos, g.rodou=false e segue como antes.
        let g = await gate(cwd, emit, gateCmds);
        let tentativa = 0;
        while (!g.ok && podeReparar(tentativa)) {
            tentativa++;
            const sliceIdx = plano.length + tentativa;
            const inicioReparo = Date.now();
            const r = await agente(base, feature, {
                tarefa: "reparo: " + g.cmd,
                arquivos_alvo: escritos,
                descricao: `O comando "${g.cmd}" falhou apos as edicoes. Saida:\n${g.saida}\n\nConserte os arquivos ate o comando passar.`,
            }, emit, sliceIdx, cmds);
            // metrica do slice de reparo (analogo ao emitMetrica de construir), pro dashboard agregar a run
            emit({
                t: "metrica", slice: sliceIdx, iteracoes: r.iteracoes, passouDePrimeira: r.passouDePrimeira,
                tocouNoTeste: r.tocouNoTeste, falhasAmbiente: r.falhasAmbiente, tokensIn: r.tokensIn, tokensOut: r.tokensOut,
                custoUSD: custoUSD(r.tokensIn, r.tokensOut), ms: Date.now() - inicioReparo,
            });
            g = await gate(cwd, emit, gateCmds, tentativa);
        }
        let status;
        let rev = null;
        if (g.rodou && !g.ok) {
            status = "GATE-FAILED"; // fail-closed: nao revisa nem commita codigo que nao passou no gate
        }
        else {
            const diff = await diffStaged(cwd);
            rev = await revisar(cwd, feature, diff, emit);
            emit({ t: "fase", nome: "revisor", info: (rev.ok ? "OK" : "ATENCAO") + (rev.ajustes ? " - " + rev.ajustes : "") });
            status = rejeitados.length ? "NEEDS-REVIEW" : "COMPLETE";
            try {
                await commit(cwd, feature, emit);
            }
            catch (e) {
                emit({ t: "fase", nome: "commit", info: String(e?.message ?? e) });
                if (status === "COMPLETE")
                    status = "COMMIT-SKIP";
            }
        }
        // Painel final: resumo por tarefa (nao o log inteiro).
        const linhas = [];
        for (const r of resultados) {
            linhas.push((r.ok ? "[ok] " : "[!!] ") + r.tarefa);
            if (r.escritos.length)
                linhas.push("     arq: " + r.escritos.join(", "));
            if (r.comandos.length)
                linhas.push("     cmd: " + r.comandos.join(", "));
            if (!r.ok)
                linhas.push("     motivo: " + r.motivo);
        }
        if (g.rodou)
            linhas.push("GATE: " + (g.ok ? "OK" : "FALHOU (" + g.cmd + ")"));
        linhas.push("branch " + branch);
        if (rev)
            linhas.push("REVISOR: " + (rev.ok ? "OK" : "ATENCAO"));
        if (baselineRef)
            linhas.push("REVERTER: git checkout " + baselineRef.slice(0, 8) + " -- .");
        const painel = frame({ titulo: "HERMES // " + branch, cwd, linhas, status });
        emit({ t: "painel", status, branch, baseline: baselineRef, linhas });
        toFile(painel + "\n");
        return painel;
    }
    catch (e) {
        emit({ t: "log", texto: "ERRO: " + (e?.message ?? e) });
        emit({ t: "painel", status: "FAILED", branch: "", linhas: vivo });
        const painel = frame({ titulo: "HERMES // FALHA", cwd, linhas: vivo, status: "FAILED" });
        toFile(painel + "\n");
        return painel;
    }
}
// Self-check offline (sem API): painel, slug, parse do plano, guardas, gate, reparo, eventos, e o loop do agente com client fake.
if (process.argv.includes("--selftest")) {
    assert.strictEqual(row("x").length, WIDTH);
    assert.strictEqual(row("y".repeat(300)).length, WIDTH);
    for (const ln of frame({ titulo: "t", cwd: "c", linhas: ["a"], status: "OK" }).split("\n"))
        assert.strictEqual(ln.length, WIDTH);
    assert.strictEqual(slug("Adicionar Dark Mode!"), "adicionar-dark-mode");
    assert.strictEqual(slug("Cafe com Leite"), "cafe-com-leite");
    // guarda anti-destruicao: HTML truncado (perdeu </html>) e' rejeitado; edicao valida passa
    const htmlOk = "<!DOCTYPE html><html><body>oi</body></html>\n";
    assert.ok(destrutivo("static/index.html", htmlOk, "<!DOCTYPE html><html><body>:root{--x:1}")); // truncou
    assert.strictEqual(destrutivo("static/index.html", htmlOk, "<!DOCTYPE html><html><body>novo conteudo aqui</body></html>\n"), null);
    assert.ok(destrutivo("a.js", "x".repeat(1000), "y")); // encolheu demais
    // parse do plano no schema de slices
    const p = JSON.parse('[{"tarefa":"t","arquivos_alvo":["a.js"],"descricao":"x"}]');
    assert.strictEqual(p[0].tarefa, "t");
    assert.strictEqual(p[0].arquivos_alvo[0], "a.js");
    // podeReparar: teto de tentativas (CA-G6, sem precisar mexer em env em runtime)
    assert.strictEqual(podeReparar(0, 0), false);
    assert.strictEqual(podeReparar(0, 1), true);
    assert.strictEqual(podeReparar(1, 1), false);
    // ehTeste: reconhece os padroes comuns de arquivo de teste (pura, offline)
    assert.strictEqual(ehTeste("src/foo.test.ts"), true);
    assert.strictEqual(ehTeste("a/__tests__/x.ts"), true);
    assert.strictEqual(ehTeste("test_x.py"), true);
    assert.strictEqual(ehTeste("x_test.go"), true);
    assert.strictEqual(ehTeste("src/index.ts"), false);
    // custoUSD: mesma quantidade de tokens custa MAIS no pico (quarta 02:00 UTC) que off-peak (domingo 12:00 UTC)
    const quartaPico = new Date(Date.UTC(2024, 0, 3, 2, 0, 0)); // quarta-feira, 02:00 UTC (peak)
    const domingoOff = new Date(Date.UTC(2024, 0, 7, 12, 0, 0)); // domingo, 12:00 UTC (off-peak)
    assert.ok(custoUSD(1e6, 1e6, quartaPico) > custoUSD(1e6, 1e6, domingoOff), "peak > off-peak");
    // checagem previa de executavel + classificacao de falha de ambiente (CA-4/5/6)
    assert.strictEqual(await existeExecutavel(`"${process.execPath}" -e 1`, process.cwd()), true, "node existe");
    assert.strictEqual(await existeExecutavel("nao-existe-xyz src", process.cwd()), false, "nome solto inexistente");
    assert.strictEqual(await existeExecutavel("C:/nao/existe.exe src", process.cwd()), false, "caminho inexistente");
    assert.strictEqual(ehFalhaAmbiente("'selene' nao e reconhecido como um comando interno"), true);
    assert.strictEqual(ehFalhaAmbiente("bash: lune: command not found"), true);
    assert.strictEqual(ehFalhaAmbiente("tests/run.luau:12: assertion failed"), false);
    // escolherProvedor: nativa/OpenRouter/nenhuma (CA-1, CA-2, CA-4 -- pura, sem mexer em env em runtime)
    assert.strictEqual(escolherProvedor("dk", undefined).useAuthToken, false); // so' nativa
    assert.strictEqual(escolherProvedor(undefined, "or").useAuthToken, true); // so' OpenRouter
    assert.strictEqual(escolherProvedor(undefined, "or").baseURL, "https://openrouter.ai/api");
    assert.strictEqual(escolherProvedor(undefined, "or").model, "deepseek/deepseek-v4.1-flash");
    assert.strictEqual(escolherProvedor("dk", "or").useAuthToken, false); // as duas: nativa vence
    assert.strictEqual(escolherProvedor(undefined, undefined).useAuthToken, false); // nenhuma: cai no erro de obter()
    // linhaDe(): cada tipo de evento produz uma string (nao abre servidor)
    const amostras = [
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
    for (const ev of amostras)
        assert.strictEqual(typeof linhaDe(ev), "string");
    assert.strictEqual(linhaDe({ t: "slice", idx: 1, total: 1, tarefa: "t", status: "fila" }), "");
    // Barramento em disco: dois arquivos *.jsonl viram dois swarms com seus eventos agrupados (multi-swarm)
    await (async () => {
        const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-runs-"));
        await fsp.writeFile(path.join(dir, "aaa11111.jsonl"), JSON.stringify({ t: "run", feature: "f1", cwd: "c1", total: 2 }) + "\n" +
            JSON.stringify({ t: "slice", idx: 1, total: 2, tarefa: "t", status: "ok" }) + "\n");
        await fsp.writeFile(path.join(dir, "bbb22222.jsonl"), JSON.stringify({ t: "run", feature: "f2", cwd: "c2", total: 1 }) + "\n" +
            "linha corrompida nao derruba\n"); // linha invalida e' ignorada, nao lanca
        const m = lerRuns(dir);
        assert.strictEqual(m.size, 2, "dois swarms");
        assert.strictEqual(m.get("aaa11111").length, 2);
        assert.strictEqual(m.get("bbb22222").length, 1, "linha invalida descartada");
        assert.strictEqual(m.get("aaa11111")[0].feature, "f1");
        assert.strictEqual(lerRuns(path.join(dir, "nao-existe")).size, 0, "pasta inexistente -> vazio");
    })();
    // Loop do agente com client FAKE (sem rede). Prova o ciclo tool_use->tool_result e as guardas.
    const nada = () => { };
    const alvo = { tarefa: "t", arquivos_alvo: [], descricao: "d" };
    function fake(respostas) {
        let i = 0;
        const recebidos = [];
        const fn = async (_s, messages) => {
            const last = messages[messages.length - 1];
            if (last && Array.isArray(last.content))
                for (const b of last.content)
                    if (b?.type === "tool_result")
                        recebidos.push(String(b.content));
            return respostas[Math.min(i++, respostas.length - 1)];
        };
        return { fn, recebidos };
    }
    const fim = { blocos: [{ type: "text", text: "fim" }], stop: "end_turn" };
    await (async () => {
        const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-st-"));
        // CA-5: escrever fora do projeto e' recusado
        const g = fake([{ blocos: [{ type: "tool_use", id: "a", name: "escrever_arquivo", input: { caminho: "../fora.txt", conteudo: "x" } }], stop: "tool_use" }, fim]);
        await agente(base, "f", alvo, nada, 1, [], g.fn);
        assert.ok(g.recebidos.some((r) => r.startsWith("ERRO: caminho fora")), "path guard");
        // CA-6: comando fora da allowlist e' bloqueado (allowlist vazia no selftest)
        const c = fake([{ blocos: [{ type: "tool_use", id: "b", name: "rodar_comando", input: { comando: "rm -rf /" } }], stop: "tool_use" }, fim]);
        await agente(base, "f", alvo, nada, 1, [], c.fn);
        assert.ok(c.recebidos.some((r) => r.includes("nao permitido")), "allowlist");
        // executavel inexistente conta como falha de ambiente, nao como iteracao
        const amb = fake([{ blocos: [{ type: "tool_use", id: "e", name: "rodar_comando", input: { comando: "nao-existe-xyz" } }], stop: "tool_use" }, fim]);
        const ra = await agente(base, "f", alvo, nada, 1, ["nao-existe-xyz"], amb.fn);
        assert.strictEqual(ra.falhasAmbiente, 1, "falha de ambiente contada");
        assert.strictEqual(ra.iteracoes, 0, "ambiente nao conta iteracao");
        // editar_arquivo: troca trecho unico (inclusive em arquivo CRLF); ausente/repetido e' recusado; buscar acha a linha
        await fsp.writeFile(path.join(base, "e.txt"), "a = 1\r\nb = 2\r\nb = 2\r\n");
        const ed = fake([
            { blocos: [{ type: "tool_use", id: "e1", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "a = 1\n", novo: "a = 9\n" } }], stop: "tool_use" },
            { blocos: [{ type: "tool_use", id: "e2", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "b = 2", novo: "x" } }], stop: "tool_use" },
            { blocos: [{ type: "tool_use", id: "e3", name: "editar_arquivo", input: { caminho: "e.txt", antigo: "zzz", novo: "x" } }], stop: "tool_use" },
            { blocos: [{ type: "tool_use", id: "e4", name: "buscar", input: { padrao: "a = 9" } }], stop: "tool_use" },
            fim,
        ]);
        await agente(base, "f", alvo, nada, 1, [], ed.fn);
        assert.strictEqual(ed.recebidos[0], "ok", "edicao unica aplicada");
        assert.ok(ed.recebidos[1].includes("aparece 2 vezes"), "trecho repetido recusado");
        assert.ok(ed.recebidos[2].includes("nao encontrado"), "trecho ausente recusado");
        assert.strictEqual(ed.recebidos[3], "e.txt:1: a = 9", "buscar acha a linha editada");
        assert.strictEqual(await fsp.readFile(path.join(base, "e.txt"), "utf8"), "a = 9\r\nb = 2\r\nb = 2\r\n", "CRLF preservado");
        // CA-4 + escrita valida: ciclo completo devolve tool_result "ok" e registra o arquivo
        const w = fake([{ blocos: [{ type: "tool_use", id: "c", name: "escrever_arquivo", input: { caminho: "novo.txt", conteudo: "conteudo valido\n" } }], stop: "tool_use" }, fim]);
        const r = await agente(base, "f", { tarefa: "t", arquivos_alvo: ["novo.txt"], descricao: "d" }, nada, 1, [], w.fn);
        assert.ok(w.recebidos.some((x) => x === "ok"), "tool_result ok");
        assert.deepStrictEqual(r.escritos, ["novo.txt"]);
        assert.strictEqual(r.ok, true);
    })();
    // Trava anti-alterar-teste: teste que JA existe e' imutavel; criar teste NOVO continua permitido.
    await (async () => {
        const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-tst-"));
        await fsp.writeFile(path.join(base, "foo.test.ts"), "// teste existente\n");
        const t = fake([
            { blocos: [{ type: "tool_use", id: "t1", name: "escrever_arquivo", input: { caminho: "foo.test.ts", conteudo: "// sobrescrito\n" } }], stop: "tool_use" },
            { blocos: [{ type: "tool_use", id: "t2", name: "escrever_arquivo", input: { caminho: "novo.test.ts", conteudo: "// teste novo\n" } }], stop: "tool_use" },
            fim,
        ]);
        await agente(base, "f", alvo, nada, 1, [], t.fn);
        assert.ok(t.recebidos.some((r) => r.startsWith("RECUSADO (teste imutavel")), "teste existente recusado");
        assert.ok(t.recebidos.some((r) => r === "ok"), "teste novo permitido");
        assert.strictEqual(await fsp.readFile(path.join(base, "foo.test.ts"), "utf8"), "// teste existente\n", "teste original preservado");
    })();
    // gate(): skip (sem comandos) / passa / falha (offline, via node -e)
    await (async () => {
        const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-gate-"));
        const eventos = [];
        const e = (ev) => eventos.push(ev);
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
    // Reparo: gate falha -> agente (fake) "conserta" -> gate re-roda com tentativa e passa
    await (async () => {
        const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-repair-"));
        const eventos = [];
        const e = (ev) => eventos.push(ev);
        const cmd = `"${process.execPath}" -e "process.exit(require('fs').existsSync('ok.flag')?0:1)"`;
        let g = await gate(base, e, [cmd]);
        assert.strictEqual(g.ok, false, "gate deveria falhar sem o flag");
        let vez = 0;
        const msgFn = async () => {
            vez++;
            if (vez === 1) {
                await fsp.writeFile(path.join(base, "ok.flag"), "ok");
                return { blocos: [{ type: "tool_use", id: "r", name: "escrever_arquivo", input: { caminho: "reparado.txt", conteudo: "ok\n" } }], stop: "tool_use" };
            }
            return fim;
        };
        await agente(base, "f", { tarefa: "reparo", arquivos_alvo: [], descricao: "conserta" }, e, 99, [], msgFn);
        g = await gate(base, e, [cmd], 1);
        assert.strictEqual(g.ok, true, "gate deveria passar apos o reparo");
        assert.ok(eventos.some((ev) => ev.t === "gate" && ev.tentativa === 1 && ev.status === "ok"));
    })();
    console.log("selftest ok");
    process.exit(0);
}
const server = new McpServer({ name: "hermes-bridge", version: "3.0.0" });
server.registerTool("executar_orchestra", {
    title: "Executar Orchestra (Hermes swarm)",
    description: "Implementa uma feature num diretorio via swarm DeepSeek. O Claude planeja em SLICES e passa o plano; " +
        "cada slice roda em serie como um agente DeepSeek (le/edita arquivos e roda comandos de verificacao " +
        "permitidos), depois um GATE deterministico (typecheck/testes) e so entao revisor + commit local. " +
        "A allowlist e o gate sao resolvidos do package.json do alvo (override opcional em cada um). " +
        "Progresso ao vivo no dashboard web (ver stderr pra URL).",
    inputSchema: {
        cwd: z.string().describe("Pasta do projeto onde implementar"),
        feature: z.string().describe("Descricao da feature"),
        plano: z
            .array(z.object({
            tarefa: z.string().describe("Titulo curto da slice"),
            arquivos_alvo: z.array(z.string()).describe("Arquivos que a slice deve tocar (relativos); pode ser vazio"),
            descricao: z.string().describe("O que fazer nessa slice"),
        }))
            .describe("Plano do Claude: slices de alto nivel (um agente por slice, pode tocar varios arquivos)"),
        override: z
            .object({
            cmds: z.array(z.string()).optional().describe("Allowlist explicita de comandos permitidos (vence o package.json)"),
            gate: z.array(z.string()).optional().describe("Comandos do GATE explicitos (vence o package.json)"),
        })
            .optional()
            .describe("Override opcional da allowlist/gate (senao resolve do package.json do alvo)"),
    },
}, async ({ cwd, feature, plano, override }) => ({
    content: [{ type: "text", text: await rodar(cwd, feature, plano, override) }],
}));
await server.connect(new StdioServerTransport());
iniciarUI();
process.stderr.write("[hermes-bridge] listening (stdio)\n");
