// Spec da S3 (CA-5/CA-6): o MCP se chama dev-orchestra e, na 1a run do processo, abre o app Hermes (se
// instalado) ou o navegador no dashboard. So' uma vez por processo; a URL vem sempre na resposta da tool.
// HERMES_ABRIR_LOG: em vez de abrir, grava o comando (uma linha JSON) nesse arquivo — usado pelos testes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const DIST = path.dirname(fileURLToPath(import.meta.url));
const RAIZ = path.join(DIST, "..");
test("comoAbrirDashboard: app instalado vence; senao o navegador do sistema (CA-6)", async () => {
    const { comoAbrirDashboard } = (await import("./ui.js"));
    assert.equal(typeof comoAbrirDashboard, "function", "ui.ts exporta comoAbrirDashboard");
    const url = "http://127.0.0.1:4123";
    assert.deepEqual(comoAbrirDashboard("C:\\x\\Hermes.exe", url, "win32"), { comando: "C:\\x\\Hermes.exe", args: [] });
    assert.deepEqual(comoAbrirDashboard(null, url, "win32"), { comando: "cmd", args: ["/c", "start", "", url] });
    assert.deepEqual(comoAbrirDashboard(null, url, "darwin"), { comando: "open", args: [url] });
    assert.deepEqual(comoAbrirDashboard(null, url, "linux"), { comando: "xdg-open", args: [url] });
});
function portaLivre() {
    return new Promise((ok, falha) => {
        const s = net.createServer();
        s.once("error", falha);
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
    });
}
async function repoAlvo() {
    const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "s3-alvo-")));
    const git = (...a) => execFileSync("git", a, { cwd });
    git("init", "-q");
    git("config", "user.email", "t@t");
    git("config", "user.name", "t");
    await fs.writeFile(path.join(cwd, "app.txt"), "oi\n");
    git("add", ".");
    git("commit", "-qm", "base");
    return cwd;
}
const texto = (r) => r.content.map((c) => c.text).join("\n");
test("MCP dev-orchestra abre o dashboard uma vez e sempre devolve a URL (CA-5/CA-6)", { timeout: 240000 }, async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "s3-hub-"));
    const porta = await portaLivre();
    const abrirLog = path.join(tmp, "abrir.log");
    const env = {};
    for (const [k, v] of Object.entries(process.env))
        if (v !== undefined)
            env[k] = v;
    Object.assign(env, {
        HERMES_UI_PORT: String(porta),
        HERMES_RUNS_DIR: path.join(tmp, "runs"),
        HERMES_AGENTES_DIR: path.join(tmp, "agentes"),
        HERMES_CANVAS_DIR: path.join(tmp, "canvas"),
        HERMES_PLANEJADORES_DIR: path.join(tmp, "plan"),
        HERMES_ABRIR_LOG: abrirLog,
        LOCALAPPDATA: path.join(tmp, "sem-app"), // sem Hermes.exe -> navegador
        OPENCODE_GO_API_KEY: "", DEEPSEEK_API_KEY: "", OPENROUTER_API_KEY: "",
    });
    const client = new Client({ name: "s3", version: "1.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(DIST, "index.js")], env, stderr: "ignore" }));
    try {
        assert.equal(client.getServerVersion()?.name, "dev-orchestra");
        const url = `http://127.0.0.1:${porta}`;
        for (let i = 0; i < 2; i++) {
            const cwd = await repoAlvo();
            const ini = texto(await client.callTool({ name: "executar_orchestra", arguments: { cwd, feature: "s3 " + i, plano: [], override: { cmds: [], gate: [`node -e "process.exit(0)"`] } } }));
            assert.ok(ini.includes(url), "a resposta traz a URL do dashboard: " + ini);
            const runId = ini.match(/RUN INICIADA: (\S+)/)?.[1];
            assert.ok(runId);
            for (let k = 0; k < 20; k++) {
                const s = texto(await client.callTool({ name: "status_orchestra", arguments: { runId } }, undefined, { timeout: 120000 }));
                if (/STATUS: /.test(s))
                    break;
            }
        }
        const linhas = (await fs.readFile(abrirLog, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
        assert.equal(linhas.length, 1, "abre so' na 1a run do processo");
        assert.ok(linhas[0].includes(url), linhas[0]);
    }
    finally {
        await client.close();
    }
});
test("nome hermes-bridge saiu do bridge (CA-5)", () => {
    for (const arq of ["index.ts", "ui.ts", "deepseek.ts"])
        assert.equal(readFileSync(path.join(RAIZ, arq), "utf8").includes("hermes-bridge"), false, arq);
    assert.match(readFileSync(path.join(RAIZ, "deepseek.ts"), "utf8"), /"user-agent": "dev-orchestra\//);
});
