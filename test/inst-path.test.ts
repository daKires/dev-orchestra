// Spec do PR2/S2 (CA-7, CA-8): os processos filhos acham node/npm mesmo com o PATH velho da ferramenta.
// rodarShell (gate e comandos dos agentes) poe a pasta do node na frente do PATH; o PATH do serve/PTY
// comeca com bin/ + pasta do node; existe bin/canvas.cmd pro Windows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.DEV_ORCHESTRA_RUNS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "inst-path-runs-"));
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "inst-path-plan-"));
process.env.DEV_ORCHESTRA_CANVAS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "inst-path-canvas-"));
process.env.DEV_ORCHESTRA_AGENTES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "inst-path-ag-"));
const H: any = await import("../dist/swarm.js");
const ui: any = await import("../dist/ui.js");

test("rodarShell resolve `npm --version` com o PATH sem node/npm (CA-8)", { timeout: 60000 }, async () => {
  const antes = process.env.PATH;
  const sistema = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:\\Windows", "System32") : "/usr/bin:/bin";
  process.env.PATH = sistema;
  try {
    const r = await H.rodarShell("npm --version", os.tmpdir());
    assert.equal(r.code, 0, r.saida);
    assert.match(r.saida, /\d+\.\d+\.\d+/);
  } finally { process.env.PATH = antes; }
});

test("PATH do serve/PTY comeca com bin/ e logo depois a pasta do node (CA-7)", () => {
  const env = ui.envClaude();
  const partes = String(env.PATH ?? "").split(path.delimiter);
  assert.equal(path.resolve(partes[0]), path.join(RAIZ, "bin"));
  assert.equal(path.resolve(partes[1]), path.dirname(process.execPath));
});

test("bin/canvas.cmd existe e chama o canvas.mjs da mesma pasta (CA-7)", () => {
  const cmd = path.join(RAIZ, "bin", "canvas.cmd");
  assert.ok(existsSync(cmd), "bin/canvas.cmd");
  const t = readFileSync(cmd, "utf8");
  assert.match(t, /%~dp0canvas\.mjs/);
  assert.match(t, /%\*/, "repassa os argumentos");
});
