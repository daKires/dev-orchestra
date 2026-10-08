// Claude no app usa o login da conta: tira as variaveis da sessao Claude Code/desktop que abriu o app.
// E o tamanho do xterm chega no PTY (POST /agentes/:id/tamanho), inclusive no retomar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.HERMES_AGENTES_DIR ??= await fs.mkdtemp(path.join(os.tmpdir(), "hermes-env-"));
process.env.HERMES_UI_PORT ??= "4197";
const ui = await import("./ui.js");
const BASE = `http://127.0.0.1:${process.env.HERMES_UI_PORT}`;

test("envClaude: remove ANTHROPIC_* e CLAUDE_CODE_*, mantem PATH e CLAUDE_CONFIG_DIR", () => {
  const env = ui.envClaude({ PATH: "x", ANTHROPIC_BASE_URL: "u", ANTHROPIC_API_KEY: "k", CLAUDE_CODE_SESSION_ID: "s", CLAUDECODE: "1", CLAUDE_CONFIG_DIR: "c" });
  assert.deepEqual(env, { PATH: "x", CLAUDE_CONFIG_DIR: "c" });
});

test("tamanho do xterm vai pro PTY e e' reusado no retomar", async (t) => {
  const tamanhos: Array<[number, number]> = [];
  const spawns: Array<{ cols?: number; rows?: number; env: Record<string, string | undefined> }> = [];
  const pty = {
    spawn(o: { cols?: number; rows?: number; env: Record<string, string | undefined> }) {
      spawns.push(o);
      return { pid: 1, write() {}, kill() {}, onData() {}, onExit() {}, resize: (c: number, r: number) => { tamanhos.push([c, r]); } };
    },
  };
  await ui.iniciarUI({ pty } as any);
  t.after(() => ui.pararUI());
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "wt-"));
  const post = (u: string, b: unknown) => fetch(BASE + u, { method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify(b) });
  const { id } = await (await post("/agentes", { projeto: cwd, cwd, tipo: "claude", papel: "livre" })).json() as { id: string };
  assert.equal(spawns[0].env.CLAUDECODE, undefined, "spawn sem as variaveis da sessao");
  assert.equal((await post(`/agentes/${id}/tamanho`, { cols: 80, rows: 24 })).status, 204);
  assert.deepEqual(tamanhos, [[80, 24]]);
  assert.equal((await post(`/agentes/${id}/tamanho`, { cols: 2, rows: 24 })).status, 400);
  assert.equal((await post(`/agentes/${id}/reiniciar`, {})).status, 200);
  assert.equal(spawns[1].cols, 80);
  assert.equal(spawns[1].rows, 24);
});
