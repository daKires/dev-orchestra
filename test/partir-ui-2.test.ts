// Spec do partir-ui (S2 canvas-hub.ts: canvas, projetos, assets e rotas /canvas*): refactor sem mudar comportamento (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando, definidos } from "./partir-ui-util.js";

test("src/canvas-hub.ts existe e dist/canvas-hub.js exporta o que o resto usa", async () => {
  assert.ok(fonte("src/canvas-hub.ts").length > 0, "src/canvas-hub.ts ainda nao foi criado");
  assert.deepEqual(faltando(await modulo("dist/canvas-hub.js"), ['rotasCanvas', 'lerCanvas', 'aplicarOpsProjeto', 'descarregarCanvas']), []);
});

test("src/ui.ts nao define mais o que foi pro canvas-hub.ts", () => {
  assert.deepEqual(definidos(fonte("src/ui.ts"), ['function lerCanvas(', 'function gravarCanvasAgora(', 'function servirCanvasAsset(', 'function salvarProjeto(', 'function aplicarOpsProjeto(', '"/canvas/op"', '"/canvas/projetos"']), []);
});

test("src/canvas-hub.ts nao importa ui.js (dependencia de mao unica)", () => {
  assert.doesNotMatch(fonte("src/canvas-hub.ts") || "import x from './ui.js'", /from ["']\.\/ui\.js["']/);
});
