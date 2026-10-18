// Spec do partir-ui (S4a agentes-hub.ts: registro, serve do OpenCode e ponte /event): fatia da S4, refactor sem mudar comportamento (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando, definidos } from "./partir-ui-util.js";

test("dist/agentes-hub.js exporta envClaude", async () => {
  assert.ok(fonte("src/agentes-hub.ts").length > 0, "src/agentes-hub.ts ainda nao foi criado");
  assert.deepEqual(faltando(await modulo("dist/agentes-hub.js"), ['envClaude']), []);
});

test("src/ui.ts nao define mais o que foi pro agentes-hub.ts nesta fatia", () => {
  assert.deepEqual(definidos(fonte("src/ui.ts"), ['function subirServeReal(', 'function carregarAgentes(', 'function listarAgentes(', 'function loopPonte(', 'function tratarEvento(', 'function reconectarPontes(']), []);
});

test("src/agentes-hub.ts nao importa ui.js", () => {
  assert.doesNotMatch(fonte("src/agentes-hub.ts") || "import x from './ui.js'", /from ["']\.\/ui\.js["']/);
});
