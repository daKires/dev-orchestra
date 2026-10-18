// Spec do partir-ui (S4 agentes-hub.ts: agentes, PTY, ponte, colaboracao, contexto e rotas /agentes*): refactor sem mudar comportamento (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando, definidos } from "./partir-ui-util.js";

test("src/agentes-hub.ts existe e dist/agentes-hub.js exporta o que o resto usa", async () => {
  assert.ok(fonte("src/agentes-hub.ts").length > 0, "src/agentes-hub.ts ainda nao foi criado");
  assert.deepEqual(faltando(await modulo("dist/agentes-hub.js"), ['rotasAgentes', 'iniciarAgentes', 'pararAgentes', 'envClaude']), []);
});

test("src/ui.ts nao define mais o que foi pro agentes-hub.ts", () => {
  assert.deepEqual(definidos(fonte("src/ui.ts"), ['function subirPtyClaude(', 'function loopPonte(', 'function carregarAgentes(', 'function sincronizarContexto(', 'function entregarColab(', 'caminho === "/agentes"', '"/arvore"', '"/arquivo"']), []);
});

test("src/agentes-hub.ts nao importa ui.js (dependencia de mao unica)", () => {
  assert.doesNotMatch(fonte("src/agentes-hub.ts") || "import x from './ui.js'", /from ["']\.\/ui\.js["']/);
});
