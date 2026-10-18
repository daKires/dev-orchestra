// Spec do partir-ui (S3 navegador-hub.ts: navegador dos agentes e driver injetado): refactor sem mudar comportamento (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando, definidos } from "./partir-ui-util.js";

test("src/navegador-hub.ts existe e dist/navegador-hub.js exporta o que o resto usa", async () => {
  assert.ok(fonte("src/navegador-hub.ts").length > 0, "src/navegador-hub.ts ainda nao foi criado");
  assert.deepEqual(faltando(await modulo("dist/navegador-hub.js"), ['definirNavegador', 'pararNavegador', 'resolverNavegador', 'elementosDoNavegador']), []);
});

test("src/ui.ts nao define mais o que foi pro navegador-hub.ts", () => {
  assert.deepEqual(definidos(fonte("src/ui.ts"), ['function resolverNavegador(', 'function navegadoresAcessiveis(', 'function elementosDoNavegador(', 'browserCache']), []);
});

test("src/navegador-hub.ts nao importa ui.js (dependencia de mao unica)", () => {
  assert.doesNotMatch(fonte("src/navegador-hub.ts") || "import x from './ui.js'", /from ["']\.\/ui\.js["']/);
});
