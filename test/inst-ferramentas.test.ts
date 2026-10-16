// Spec do PR2/S3 (CA-9): quem configurou SO o Codex ou SO o Antigravity tambem tem config atual:
// lerAtual acha provedor/modelo, chaveAtual acha a chave e o salvar com chave vazia reaproveita.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOD = "../dist/setup.js";
const S: any = await import(MOD).catch(() => ({}));
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHAVE = "sk-go-123456789abcd";

async function homeCodex(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inst-codex-"));
  mkdirSync(path.join(home, ".codex"));
  writeFileSync(path.join(home, ".codex", "config.toml"),
    'model = "gpt-5"\n\n[mcp_servers.dev-orchestra]\ncommand = "node"\nargs = ["C:\\\\x\\\\index.js"]\n\n' +
    `[mcp_servers.dev-orchestra.env]\nOPENCODE_GO_API_KEY = "${CHAVE}"\nHERMES_MODEL = "glm-5.2"\n`);
  return home;
}

async function homeAntigravity(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inst-ag-"));
  mkdirSync(path.join(home, ".gemini", "antigravity"), { recursive: true });
  writeFileSync(path.join(home, ".gemini", "antigravity", "mcp_config.json"), JSON.stringify({ mcpServers: { "dev-orchestra": {
    command: "node", args: ["x"], env: { OPENCODE_GO_API_KEY: CHAVE, HERMES_MODEL: "kimi-k3" } } } }));
  return home;
}

test("lerAtual enxerga Codex e Antigravity (CA-9)", async () => {
  assert.deepEqual(S.lerAtual(await homeCodex()), { provedor: "go", modelo: "glm-5.2", chaveMascarada: "sk-…abcd" });
  assert.deepEqual(S.lerAtual(await homeAntigravity()), { provedor: "go", modelo: "kimi-k3", chaveMascarada: "sk-…abcd" });
});

test("chaveAtual(home, provedor) acha a chave no Codex e no Antigravity; bin usa ela (CA-9)", async () => {
  assert.equal(typeof S.chaveAtual, "function", "setup.ts exporta chaveAtual");
  assert.equal(S.chaveAtual(await homeCodex(), "go"), CHAVE);
  assert.equal(S.chaveAtual(await homeAntigravity(), "go"), CHAVE);
  assert.equal(S.chaveAtual(await homeAntigravity(), "deepseek"), "", "outro provedor -> vazio");
  const bin = readFileSync(path.join(RAIZ, "bin", "dev-orchestra.mjs"), "utf8");
  assert.equal(/function chaveAtual/.test(bin), false, "uma busca so', no setup.ts");
  assert.match(bin, /chaveAtual/);
});

test("salvar com chave vazia reaproveita a do Codex (CA-9)", async () => {
  const home = await homeCodex();
  const skills = await fs.mkdtemp(path.join(os.tmpdir(), "inst-codex-sk-"));
  const r = S.salvar(home, { provedor: "go", modelo: "glm-5.2", chave: "", ferramentas: ["codex"], app: "C:\\app\\index.js", skillsDir: skills });
  assert.deepEqual(r.erros, {});
  assert.ok(readFileSync(path.join(home, ".codex", "config.toml"), "utf8").includes(`OPENCODE_GO_API_KEY = "${CHAVE}"`));
});

test("ferramentasConfiguradas inclui o Codex e o Antigravity (CA-9)", async () => {
  assert.deepEqual(S.ferramentasConfiguradas(await homeCodex()), ["codex"]);
  assert.deepEqual(S.ferramentasConfiguradas(await homeAntigravity()), ["antigravity"]);
});
