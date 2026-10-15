// Spec da S4 (CA-9..12): setup.ts — funcoes que o `npx dev-orchestra` usa pra detectar as ferramentas,
// ler a config atual, gravar o MCP + env em cada uma, instalar as skills e limpar o legado. Tudo recebe
// `home` (pasta do usuario) pra rodar em pasta temporaria. Sem dependencia nova (TOML por bloco).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const MOD = "./setup.js"; // caminho em variavel: o tsc nao exige o modulo antes da S4 existir
const S = await import(MOD).catch(() => ({}));
const temSetup = () => assert.equal(typeof S.salvar, "function", "setup.ts exporta salvar");
const APP = path.join("C:", "x", "dev-orchestra", "dist", "index.js");
async function homeTmp(ferramentas = []) {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "s4-home-"));
    const pastas = {
        claude: ".claude", opencode: path.join(".config", "opencode"), codex: ".codex", cursor: ".cursor", antigravity: ".gemini",
    };
    for (const f of ferramentas)
        mkdirSync(path.join(home, pastas[f]), { recursive: true });
    return home;
}
async function skillsTmp() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "s4-skills-"));
    for (const n of ["orchestra", "plan-sdd"]) {
        mkdirSync(path.join(dir, n), { recursive: true });
        writeFileSync(path.join(dir, n, "SKILL.md"), `---\nname: ${n}\ndescription: x\n---\nnovo ${n}\n`);
    }
    return dir;
}
const json = (p) => JSON.parse(readFileSync(p, "utf8"));
const base = (home, skills, extra = {}) => ({
    provedor: "go", modelo: "glm-5.2", chave: "sk-go-123456789abcd", ferramentas: [], app: APP, skillsDir: skills, perfis: [], ...extra,
});
test("PROVEDORES e mascarar (CA-9/12)", () => {
    temSetup();
    assert.deepEqual(Object.keys(S.PROVEDORES).sort(), ["deepseek", "go", "openrouter"]);
    assert.equal(S.PROVEDORES.go.env, "OPENCODE_GO_API_KEY");
    assert.equal(S.PROVEDORES.deepseek.env, "DEEPSEEK_API_KEY");
    assert.equal(S.PROVEDORES.openrouter.env, "OPENROUTER_API_KEY");
    assert.ok(S.PROVEDORES.go.modelos.includes("deepseek-v4.1-flash"));
    assert.equal(S.mascarar("sk-go-123456789abcd"), "sk-…abcd");
    assert.equal(S.mascarar("curta"), "•••");
});
test("detectar: ferramenta existe quando a pasta de config existe (CA-7)", async () => {
    temSetup();
    const home = await homeTmp(["claude", "codex"]);
    assert.deepEqual(S.detectar(home), { claude: true, opencode: false, codex: true, cursor: false, antigravity: false });
});
test("Claude Code: grava dev-orchestra, remove hermes-bridge, preserva env extra e outros servidores, faz backup (CA-9)", async () => {
    temSetup();
    const home = await homeTmp(["claude"]);
    const arq = path.join(home, ".claude.json");
    const antes = {
        numStartups: 7,
        mcpServers: {
            outro: { type: "stdio", command: "x" },
            "hermes-bridge": { type: "stdio", command: "node", args: ["velho.js"], env: { HERMES_MAX_TURNS: "100", DEEPSEEK_API_KEY: "sk-velha", HERMES_MODEL: "velho" } },
        },
    };
    writeFileSync(arq, JSON.stringify(antes));
    const r = S.salvar(home, base(home, await skillsTmp(), { ferramentas: ["claude"] }));
    assert.deepEqual(r.erros, {});
    const j = json(arq);
    assert.equal(j.numStartups, 7);
    assert.deepEqual(j.mcpServers.outro, antes.mcpServers.outro);
    assert.equal("hermes-bridge" in j.mcpServers, false);
    assert.deepEqual(j.mcpServers["dev-orchestra"], {
        type: "stdio", command: "node", args: [APP],
        env: { HERMES_MAX_TURNS: "100", OPENCODE_GO_API_KEY: "sk-go-123456789abcd", HERMES_MODEL: "glm-5.2" },
    }, "chave de outro provedor sai (senao a prioridade do bridge escolheria ela)");
    assert.deepEqual(json(arq + ".bak-dev-orchestra"), antes);
});
test("OpenCode, Cursor e Antigravity (2 caminhos) no formato de cada um (CA-9)", async () => {
    temSetup();
    const home = await homeTmp(["opencode", "cursor", "antigravity"]);
    const oc = path.join(home, ".config", "opencode", "opencode.json");
    writeFileSync(oc, JSON.stringify({ $schema: "https://opencode.ai/config.json", mcp: { "hermes-bridge": { type: "local", command: ["node", "v.js"], environment: { HERMES_MAX_TURNS: "50" }, enabled: true } } }));
    const r = S.salvar(home, base(home, await skillsTmp(), { ferramentas: ["opencode", "cursor", "antigravity"], provedor: "deepseek", modelo: "deepseek-flash", chave: "sk-ds-abcdefghij" }));
    assert.deepEqual(r.erros, {});
    const env = { DEEPSEEK_API_KEY: "sk-ds-abcdefghij", HERMES_MODEL: "deepseek-flash" };
    const o = json(oc);
    assert.equal(o.$schema, "https://opencode.ai/config.json");
    assert.equal("hermes-bridge" in o.mcp, false);
    assert.deepEqual(o.mcp["dev-orchestra"], { type: "local", command: ["node", APP], environment: { HERMES_MAX_TURNS: "50", ...env }, enabled: true });
    assert.deepEqual(json(path.join(home, ".cursor", "mcp.json")).mcpServers["dev-orchestra"], { command: "node", args: [APP], env });
    for (const p of [path.join(home, ".gemini", "config", "mcp_config.json"), path.join(home, ".gemini", "antigravity", "mcp_config.json")])
        assert.deepEqual(json(p).mcpServers["dev-orchestra"], { command: "node", args: [APP], env }, p);
});
test("Codex: bloco TOML proprio, idempotente, sem mexer no resto do arquivo (CA-9)", async () => {
    temSetup();
    const home = await homeTmp(["codex"]);
    const toml = path.join(home, ".codex", "config.toml");
    writeFileSync(toml, 'model = "gpt-5"\n\n[mcp_servers.outro]\ncommand = "x"\n');
    const cfg = base(home, await skillsTmp(), { ferramentas: ["codex"], provedor: "openrouter", modelo: "deepseek/deepseek-v4.1-flash", chave: "sk-or-v1-abcdefgh" });
    S.salvar(home, cfg);
    S.salvar(home, cfg); // rodar de novo nao duplica
    const t = readFileSync(toml, "utf8");
    assert.match(t, /^model = "gpt-5"$/m);
    assert.match(t, /\[mcp_servers\.outro\]\ncommand = "x"/);
    assert.equal(t.split("[mcp_servers.dev-orchestra]").length - 1, 1, "um bloco so'");
    assert.equal(t.split("[mcp_servers.dev-orchestra.env]").length - 1, 1);
    assert.match(t, /\[mcp_servers\.dev-orchestra\]\ncommand = "node"\nargs = \["C:\\\\x\\\\dev-orchestra\\\\dist\\\\index\.js"\]/);
    assert.match(t, /OPENROUTER_API_KEY = "sk-or-v1-abcdefgh"/);
    assert.match(t, /HERMES_MODEL = "deepseek\/deepseek-v4\.1-flash"/);
    assert.ok(existsSync(toml + ".bak-dev-orchestra"));
});
test("JSON corrompido: nao sobrescreve e devolve o erro daquela ferramenta (borda)", async () => {
    temSetup();
    const home = await homeTmp(["claude", "cursor"]);
    writeFileSync(path.join(home, ".claude.json"), "{ quebrado");
    const r = S.salvar(home, base(home, await skillsTmp(), { ferramentas: ["claude", "cursor"] }));
    assert.ok(r.erros.claude, "erro do claude");
    assert.equal(readFileSync(path.join(home, ".claude.json"), "utf8"), "{ quebrado");
    assert.ok(r.ok.includes("cursor"), "as outras seguem");
});
test("skills: orchestra sempre atualizada; plan-sdd so' se nao existir (CA-10)", async () => {
    temSetup();
    const home = await homeTmp(["claude", "opencode", "codex", "cursor", "antigravity"]);
    const pessoal = path.join(home, ".claude", "skills", "plan-sdd", "SKILL.md");
    mkdirSync(path.dirname(pessoal), { recursive: true });
    writeFileSync(pessoal, "minha plan-sdd");
    const velha = path.join(home, ".claude", "skills", "orchestra", "SKILL.md");
    mkdirSync(path.dirname(velha), { recursive: true });
    writeFileSync(velha, "orchestra velha");
    S.salvar(home, base(home, await skillsTmp(), { ferramentas: ["claude", "opencode", "codex", "cursor", "antigravity"] }));
    const dirs = [
        [".claude", "skills"], [".config", "opencode", "skills"], [".codex", "skills"], [".cursor", "skills"],
        [".gemini", "skills"], [".gemini", "antigravity", "skills"],
    ];
    for (const d of dirs)
        assert.match(readFileSync(path.join(home, ...d, "orchestra", "SKILL.md"), "utf8"), /novo orchestra/, d.join("/"));
    assert.equal(readFileSync(pessoal, "utf8"), "minha plan-sdd", "nao sobrescreve a plan-sdd do usuario");
    assert.match(readFileSync(path.join(home, ".codex", "skills", "plan-sdd", "SKILL.md"), "utf8"), /novo plan-sdd/);
});
test("legado: apaga /orchestra antigo e a linha do profile.ps1 do $PROFILE, com backup (CA-10)", async () => {
    temSetup();
    const home = await homeTmp(["claude", "opencode"]);
    const cmdClaude = path.join(home, ".claude", "commands", "orchestra.md");
    const cmdOc = path.join(home, ".config", "opencode", "commands", "orchestra.md");
    for (const p of [cmdClaude, cmdOc]) {
        mkdirSync(path.dirname(p), { recursive: true });
        writeFileSync(p, "velho");
    }
    const outro = path.join(home, ".claude", "commands", "outro.md");
    writeFileSync(outro, "fica");
    const perfil = path.join(home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1");
    mkdirSync(path.dirname(perfil), { recursive: true });
    writeFileSync(perfil, 'Set-Alias x y\n. "D:\\repo\\mcp-hermes-bridge\\setup\\profile.ps1"\n$env:A = 1\n');
    S.salvar(home, base(home, await skillsTmp(), { ferramentas: ["claude"], perfis: [perfil, path.join(home, "nao-existe.ps1")] }));
    assert.equal(existsSync(cmdClaude), false);
    assert.equal(existsSync(cmdOc), false);
    assert.equal(existsSync(outro), true);
    assert.equal(readFileSync(perfil, "utf8"), "Set-Alias x y\n$env:A = 1\n");
    assert.ok(existsSync(perfil + ".bak-dev-orchestra"));
    assert.equal(existsSync(path.join(home, "nao-existe.ps1")), false, "nao cria perfil que nao existia");
});
test("lerAtual: provedor/modelo atuais e chave mascarada; chave em branco mantem a atual (CA-12)", async () => {
    temSetup();
    const home = await homeTmp(["claude", "cursor"]);
    const skills = await skillsTmp();
    assert.deepEqual(S.lerAtual(home), { provedor: null, modelo: null, chaveMascarada: null });
    S.salvar(home, base(home, skills, { ferramentas: ["claude"] }));
    assert.deepEqual(S.lerAtual(home), { provedor: "go", modelo: "glm-5.2", chaveMascarada: "sk-…abcd" });
    S.salvar(home, base(home, skills, { ferramentas: ["claude", "cursor"], modelo: "kimi-k3", chave: "" }));
    const env = json(path.join(home, ".cursor", "mcp.json")).mcpServers["dev-orchestra"].env;
    assert.deepEqual(env, { OPENCODE_GO_API_KEY: "sk-go-123456789abcd", HERMES_MODEL: "kimi-k3" });
});
test("chave em branco sem chave atual e' erro (CA-12)", async () => {
    temSetup();
    const home = await homeTmp(["claude"]);
    assert.throws(() => S.salvar(home, base(home, "", { ferramentas: ["claude"], chave: "" })), /chave/i);
});
test("localDoApp: clone git aponta pro clone; pacote do npx vai pra ~/.dev-orchestra/app (CA-11)", async () => {
    temSetup();
    const home = await homeTmp();
    const clone = await fs.mkdtemp(path.join(os.tmpdir(), "s4-clone-"));
    mkdirSync(path.join(clone, ".git"));
    assert.deepEqual(S.localDoApp(clone, home), { app: path.join(clone, "dist", "index.js"), copiar: false });
    const pacote = await fs.mkdtemp(path.join(os.tmpdir(), "s4-npx-"));
    assert.deepEqual(S.localDoApp(pacote, home), { app: path.join(home, ".dev-orchestra", "app", "dist", "index.js"), copiar: true });
});
test("copiarApp: copia o pacote sem node_modules nem .git (CA-11)", async () => {
    temSetup();
    const pacote = await fs.mkdtemp(path.join(os.tmpdir(), "s4-pkg-"));
    for (const f of ["package.json", path.join("dist", "index.js"), path.join("node_modules", "x", "i.js"), path.join(".git", "HEAD")]) {
        mkdirSync(path.dirname(path.join(pacote, f)), { recursive: true });
        writeFileSync(path.join(pacote, f), "x");
    }
    const destino = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "s4-dest-")), "app");
    S.copiarApp(pacote, destino);
    assert.ok(existsSync(path.join(destino, "dist", "index.js")));
    assert.ok(existsSync(path.join(destino, "package.json")));
    assert.equal(existsSync(path.join(destino, "node_modules")), false);
    assert.equal(existsSync(path.join(destino, ".git")), false);
});
test("testarChave: chamada minima ao provedor certo; erro vira mensagem em PT-BR (CA-8)", async () => {
    temSetup();
    const chamadas = [];
    const ok = async (url, init) => { chamadas.push({ url, init }); return { ok: true, status: 200, text: async () => "{}" }; };
    assert.deepEqual(await S.testarChave("go", "glm-5.2", "sk-go-1", ok), { ok: true });
    assert.match(chamadas[0].url, /^https:\/\/opencode\.ai\/zen\/go\/v1\//);
    assert.match(JSON.stringify(chamadas[0].init.headers), /Bearer sk-go-1/);
    // OpenCode Go recusa (400 MissingSessionID) sem esse header — achado na validacao real da tela
    assert.match(String(chamadas[0].init.headers["x-opencode-session"] ?? ""), /\S{8,}/, "header x-opencode-session no Go");
    assert.equal(JSON.parse(chamadas[0].init.body).model, "glm-5.2");
    await S.testarChave("deepseek", "deepseek-flash", "sk-ds-1", ok);
    assert.match(chamadas[1].url, /^https:\/\/api\.deepseek\.com\/anthropic\//);
    assert.match(JSON.stringify(chamadas[1].init.headers), /sk-ds-1/);
    await S.testarChave("openrouter", "deepseek/deepseek-v4.1-flash", "sk-or-1", ok);
    assert.match(chamadas[2].url, /^https:\/\/openrouter\.ai\/api\//);
    const ruim = async () => ({ ok: false, status: 401, text: async () => '{"error":"invalid api key"}' });
    const r = await S.testarChave("go", "glm-5.2", "errada", ruim);
    assert.equal(r.ok, false);
    assert.match(r.erro, /401/);
    assert.match(r.erro, /chave|recusou|inválid/i);
    const caiu = async () => { throw new Error("ENOTFOUND"); };
    assert.equal((await S.testarChave("go", "glm-5.2", "x", caiu)).ok, false);
});
