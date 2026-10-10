// Spec da S1 (F4): logica pura dos agentes Claude Code via PTY (CA-4d, 4e, 4f).
import { test } from "node:test";
import assert from "node:assert/strict";
import { argsClaude, settingsHooks, textoParaPty, MODELOS_CLAUDE } from "./claude-pty.ts";
import { validarAgente } from "./agentes.ts";

test("argsClaude: prompt de sistema, settings, modelo opcional e --continue (CA-4d, 4h)", () => {
  assert.deepEqual(argsClaude({ prompt: "P", settingsPath: "C:\\s.json" }), ["--append-system-prompt", "P", "--settings", "C:\\s.json"]);
  assert.deepEqual(argsClaude({ prompt: "P", settingsPath: "s", modelo: "opus" }), ["--append-system-prompt", "P", "--settings", "s", "--model", "opus"]);
  assert.deepEqual(argsClaude({ prompt: "P", settingsPath: "s", modelo: "", continuar: true }), ["--continue", "--append-system-prompt", "P", "--settings", "s"]);
});

test("MODELOS_CLAUDE: padrao + opus/sonnet/haiku (CA-5)", () => {
  assert.deepEqual(MODELOS_CLAUDE, ["", "opus", "sonnet", "haiku"]);
});

test("settingsHooks: UserPromptSubmit/Stop/Notification chamam canvas status com a identidade (CA-4e)", () => {
  const s = settingsHooks("ag-1", "tok");
  const cmd = (ev: string) => (s.hooks as any)[ev][0].hooks[0];
  assert.deepEqual(cmd("UserPromptSubmit"), { type: "command", command: "canvas --eu ag-1:tok status ocupado" });
  assert.deepEqual(cmd("Stop"), { type: "command", command: "canvas --eu ag-1:tok status ocioso" });
  assert.deepEqual(cmd("Notification"), { type: "command", command: "canvas --eu ag-1:tok status aguardando" });
  for (const ev of ["UserPromptSubmit", "Stop"]) assert.equal((s.hooks as any)[ev][0].matcher, "");
  assert.equal((s.hooks as any).Notification[0].matcher, "permission_prompt", "inatividade/login nao travam a fila");
  assert.deepEqual(Object.keys(s.hooks).sort(), ["Notification", "Stop", "UserPromptSubmit"]);
});

test("textoParaPty: colagem entre colchetes + Enter (CA-4f)", () => {
  assert.equal(textoParaPty("[pergunta de Líder · q-1] oi"), "\x1b[200~[pergunta de Líder · q-1] oi\x1b[201~\r");
});

test("validarAgente aceita tipo claude sem base/sessao (CA-4d)", () => {
  const a = { id: "ag-c1", projeto: "D:\\p", cwd: "D:\\p", base: "", sessao: "", nome: "Claude", papel: "dev", modelo: "", instrucao: "", tipo: "claude", origem: "canvas" };
  assert.deepEqual(validarAgente(a), a);
  assert.equal(validarAgente({ ...a, tipo: "gpt" }), null);
});

test("argsClaude com prompt inicial: vai como ultimo argumento posicional (G2, CA-G2a2)", () => {
  assert.deepEqual(argsClaude({ prompt: "P", settingsPath: "s", modelo: "sonnet", inicial: '/orchestra "f"' }), ["--append-system-prompt", "P", "--settings", "s", "--model", "sonnet", '/orchestra "f"']);
  assert.deepEqual(argsClaude({ prompt: "P", settingsPath: "s" }).length, 4, "sem inicial, nada muda");
});
