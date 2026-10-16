// Spec do PR2/S1 (CA-5, CA-6): o setup nunca depende de `npm`/`node` no PATH.
// comandoNpm acha o npm-cli.js ao lado do node em execucao; as configs de MCP gravam o node absoluto.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOD = "../dist/setup.js";
const S: any = await import(MOD).catch(() => ({}));
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (p: string) => JSON.parse(readFileSync(p, "utf8"));

test("comandoNpm: npm-cli.js ao lado do node; sem ele -> null (CA-5)", () => {
  assert.equal(typeof S.comandoNpm, "function", "setup.ts exporta comandoNpm");
  const node = path.join("C:", "nodejs", "node.exe");
  const cli = path.join("C:", "nodejs", "node_modules", "npm", "bin", "npm-cli.js");
  assert.deepEqual(S.comandoNpm(node, (p: string) => p === cli), { comando: node, args: [cli] });
  assert.equal(S.comandoNpm(node, () => false), null);
});

test("bin instala as deps pelo comandoNpm, nao por `npm` no PATH (CA-5)", () => {
  const bin = readFileSync(path.join(RAIZ, "bin", "dev-orchestra.mjs"), "utf8");
  assert.match(bin, /comandoNpm/);
  assert.equal(/spawnSync\(\s*"npm /.test(bin), false, "nada de spawnSync(\"npm ...\") direto");
});

test("salvar grava o node absoluto nas 5 ferramentas; padrao = process.execPath (CA-6)", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "inst-node-"));
  for (const d of [".claude", path.join(".config", "opencode"), ".codex", ".cursor", ".gemini"]) mkdirSync(path.join(home, d), { recursive: true });
  const skills = await fs.mkdtemp(path.join(os.tmpdir(), "inst-node-sk-"));
  const app = path.join(home, ".dev-orchestra", "app", "dist", "index.js");
  const cfg = { provedor: "go", modelo: "glm-5.2", chave: "sk-go-123456789abcd", ferramentas: ["claude", "opencode", "codex", "cursor", "antigravity"], app, skillsDir: skills };
  const node = "C:\\outro\\node.exe";
  const r = S.salvar(home, { ...cfg, node });
  assert.deepEqual(r.erros, {});
  assert.equal(json(path.join(home, ".claude.json")).mcpServers["dev-orchestra"].command, node);
  assert.deepEqual(json(path.join(home, ".config", "opencode", "opencode.json")).mcp["dev-orchestra"].command, [node, app]);
  assert.equal(json(path.join(home, ".cursor", "mcp.json")).mcpServers["dev-orchestra"].command, node);
  for (const d of ["config", "antigravity"]) assert.equal(json(path.join(home, ".gemini", d, "mcp_config.json")).mcpServers["dev-orchestra"].command, node);
  assert.ok(readFileSync(path.join(home, ".codex", "config.toml"), "utf8").includes('command = "C:\\\\outro\\\\node.exe"'), "codex com node escapado");
  S.salvar(home, cfg);
  assert.equal(json(path.join(home, ".claude.json")).mcpServers["dev-orchestra"].command, process.execPath, "sem cfg.node -> process.execPath");
});
