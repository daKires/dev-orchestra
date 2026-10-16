// Spec do PR4 (CA-22..27), parte backend: "hermes" sai do produto. So' sobram as migracoes do legado
// (entrada `hermes-bridge` e env `HERMES_*` lidas pelo setup; pasta antiga <tmp>/hermes migrada pelo hub).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { RAIZ, varrerHermes } from "./varrer-hermes.js";

const MOD = "../dist/setup.js";
const S: any = await import(MOD).catch(() => ({}));
const MOD_SWARM = "../dist/swarm.js"; // em variavel: o tsc nao exige o modulo antes do rename existir

test("nenhum 'hermes' em src/, bin/, setup/, README e package.json fora da migracao (CA-22, CA-24)", () => {
  const achados = varrerHermes(["src", "bin", "setup"], ["README.md", "package.json"]);
  assert.deepEqual(achados, [], "sobrou hermes:\n" + achados.join("\n"));
});

test("src/hermes.ts virou src/swarm.ts (CA-27)", () => {
  assert.ok(existsSync(path.join(RAIZ, "src", "swarm.ts")));
  assert.equal(existsSync(path.join(RAIZ, "src", "hermes.ts")), false);
});

test("setup migra HERMES_* pra DEV_ORCHESTRA_* (Claude e Codex) e o modelo legado continua valendo (CA-23)", () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "rename-home-"));
  mkdirSync(path.join(home, ".claude"));
  mkdirSync(path.join(home, ".codex"));
  const chave = "sk-go-123456789abcd";
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "hermes-bridge": {
    command: "node", args: ["x"], env: { OPENCODE_GO_API_KEY: chave, HERMES_MODEL: "kimi-k3", HERMES_MAX_TURNS: "9" } } } }));
  writeFileSync(path.join(home, ".codex", "config.toml"),
    `[mcp_servers.dev-orchestra]\ncommand = "node"\nargs = ["x"]\n\n[mcp_servers.dev-orchestra.env]\nOPENCODE_GO_API_KEY = "${chave}"\nHERMES_MODEL = "kimi-k3"\nHERMES_GATE_TIMEOUT_MS = "5"\n`);
  assert.deepEqual(S.lerAtual(home), { provedor: "go", modelo: "kimi-k3", chaveMascarada: "sk-…abcd" }, "le o HERMES_MODEL legado");
  const skills = mkdtempSync(path.join(os.tmpdir(), "rename-sk-"));
  const r = S.salvar(home, { provedor: "go", modelo: "kimi-k3", chave: "", ferramentas: ["claude", "codex"], app: "C:\\app\\index.js", skillsDir: skills });
  assert.deepEqual(r.erros, {});
  const env = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8")).mcpServers["dev-orchestra"].env;
  assert.deepEqual(env, { DEV_ORCHESTRA_MAX_TURNS: "9", OPENCODE_GO_API_KEY: chave, DEV_ORCHESTRA_MODEL: "kimi-k3" });
  const toml = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
  assert.match(toml, /DEV_ORCHESTRA_MODEL = "kimi-k3"/);
  assert.match(toml, /DEV_ORCHESTRA_GATE_TIMEOUT_MS = "5"/);
  assert.equal(/HERMES_/.test(toml), false, "nada de HERMES_ no TOML regravado");
  assert.deepEqual(S.lerAtual(home), { provedor: "go", modelo: "kimi-k3", chaveMascarada: "sk-…abcd" }, "le o nome novo");
});

test("commit do swarm sai como Dev Orchestra Swarm quando o repo nao tem identidade (CA-24)", async () => {
  const vazio = path.join(mkdtempSync(path.join(os.tmpdir(), "rename-gitcfg-")), "gitconfig");
  writeFileSync(vazio, "");
  process.env.GIT_CONFIG_GLOBAL = vazio;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  const W: any = await import(MOD_SWARM).catch(() => ({}));
  assert.equal(typeof W.baseline, "function", "dist/swarm.js exporta baseline");
  const cwd = mkdtempSync(path.join(os.tmpdir(), "rename-repo-"));
  writeFileSync(path.join(cwd, "a.txt"), "a\n");
  await W.baseline(cwd, "f", () => {});
  assert.equal(execFileSync("git", ["log", "-1", "--format=%an <%ae>"], { cwd, encoding: "utf8" }).trim(), "Dev Orchestra Swarm <swarm@dev-orchestra.local>");
});
