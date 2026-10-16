// Regressao do caso real (Windows com node/npm fora do PATH): o `--instalar` tem que funcionar com o
// PATH so' do sistema. O npm roda os scripts do pacote (ex.: prepare), que chamam `node` pelo PATH:
// o install precisa da pasta do node na frente do PATH, nao so' do npm-cli.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(RAIZ, "bin", "dev-orchestra.mjs");

test("--instalar funciona com PATH sem node/npm", { timeout: 180000 }, () => {
  const home = mkdtempSync(path.join(os.tmpdir(), "inst-sem-path-"));
  mkdirSync(path.join(home, ".claude"));
  const chave = "sk-go-123456789abcd";
  writeFileSync(path.join(home, ".claude.json"), JSON.stringify({ mcpServers: { "dev-orchestra": {
    command: "node", args: ["x"], env: { OPENCODE_GO_API_KEY: chave, DEV_ORCHESTRA_MODEL: "glm-5.2" } } } }));
  const env: NodeJS.ProcessEnv = { ...process.env, USERPROFILE: home, HOME: home, DEV_ORCHESTRA_NAO_ABRIR: "1" };
  delete env.Path;
  env.PATH = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : "/usr/bin:/bin";
  const r = spawnSync(process.execPath, [BIN, "--instalar"], { env, encoding: "utf8" });
  // sem as palavras que o doctor le' como falha de AMBIENTE: aqui elas sao o bug, nao o ambiente
  const saida = ((r.stdout ?? "") + (r.stderr ?? "")).replace(/n.o . reconhecido|not recognized|command not found/gi, "[comando fora do PATH]");
  assert.equal(r.status, 0, saida);
  assert.ok(existsSync(path.join(home, ".dev-orchestra", "app", "node_modules", "@modelcontextprotocol", "sdk")), "deps instaladas");
  const mcp = JSON.parse(readFileSync(path.join(home, ".claude.json"), "utf8")).mcpServers["dev-orchestra"];
  assert.equal(mcp.command, process.execPath, "node absoluto gravado");
});
