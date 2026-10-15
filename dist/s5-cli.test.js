// Spec da S5 (CA-7/8): `node bin/dev-orchestra.mjs` (o que o npx roda) sobe a tela local, responde
// /estado, protege os POSTs, salva usando o setup.ts e encerra depois de salvar. Roda com HOME temporario;
// DEV_ORCHESTRA_NAO_ABRIR=1 nao abre o navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs, mkdirSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(RAIZ, "bin", "dev-orchestra.mjs");
async function subir() {
    assert.ok(existsSync(BIN), "bin/dev-orchestra.mjs existe");
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "s5-home-"));
    mkdirSync(path.join(home, ".claude"));
    const proc = spawn(process.execPath, [BIN], {
        env: { ...process.env, USERPROFILE: home, HOME: home, DEV_ORCHESTRA_NAO_ABRIR: "1" },
        stdio: ["ignore", "pipe", "pipe"],
    });
    let saida = "";
    proc.stdout.on("data", (d) => { saida += d; });
    proc.stderr.on("data", (d) => { saida += d; });
    const url = await new Promise((ok, falha) => {
        const t = setTimeout(() => falha(new Error("nao subiu: " + saida)), 15000);
        const ver = () => { const m = saida.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) {
            clearTimeout(t);
            ok(m[0]);
        } };
        proc.stdout.on("data", ver);
        proc.on("exit", () => falha(new Error("saiu antes de subir: " + saida)));
    });
    return { proc, url, home, saida: () => saida };
}
const post = (url, corpo, cabecalho = true) => fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cabecalho ? { "X-Dev-Orchestra": "1" } : {}) },
    body: JSON.stringify(corpo),
});
test("tela local: pagina em PT-BR, /estado e POST protegido (CA-7)", { timeout: 60000 }, async () => {
    const { proc, url } = await subir();
    try {
        const html = await (await fetch(url + "/")).text();
        for (const t of ["Dev Orchestra", "Implementadores", "Conectar em", "Salvar", "Testar"])
            assert.ok(html.includes(t), t);
        const e = await (await fetch(url + "/estado")).json();
        assert.deepEqual(e.ferramentas, { claude: true, opencode: false, codex: false, cursor: false, antigravity: false });
        assert.deepEqual(e.atual, { provedor: null, modelo: null, chaveMascarada: null });
        assert.deepEqual(Object.keys(e.provedores).sort(), ["deepseek", "go", "openrouter"]);
        assert.equal((await post(url + "/salvar", { provedor: "go" }, false)).status, 403, "POST sem X-Dev-Orchestra");
        assert.equal((await post(url + "/testar", {})).status, 400, "testar sem provedor/modelo");
    }
    finally {
        proc.kill();
    }
});
test("salvar grava o MCP apontando pro clone, nao vaza a chave e encerra (CA-9/11)", { timeout: 60000 }, async () => {
    const { proc, url, home, saida } = await subir();
    const saiu = new Promise((ok) => proc.on("exit", ok));
    const chave = "sk-go-123456789abcd";
    const r = await post(url + "/salvar", { provedor: "go", modelo: "glm-5.2", chave, ferramentas: ["claude"] });
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.deepEqual(j.ok, ["claude"]);
    assert.deepEqual(j.erros, {});
    assert.equal(JSON.stringify(j).includes(chave), false, "resposta nao devolve a chave");
    const cfg = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8"));
    assert.deepEqual(cfg.mcpServers["dev-orchestra"].args, [path.join(RAIZ, "dist", "index.js")], "rodando do clone aponta pro clone");
    assert.equal(cfg.mcpServers["dev-orchestra"].env.OPENCODE_GO_API_KEY, chave);
    assert.ok(existsSync(path.join(home, ".claude", "skills", "orchestra", "SKILL.md")));
    const codigo = await Promise.race([saiu, new Promise((ok) => setTimeout(() => ok("timeout"), 5000))]);
    assert.equal(codigo, 0, "encerra depois de salvar");
    assert.equal(saida().includes(chave), false, "a chave nunca vai pro stdout/stderr");
});
