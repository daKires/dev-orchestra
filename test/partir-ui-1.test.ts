// Spec do partir-ui (S1 hub.ts: runs, planejadores, SSE e utilitarios HTTP): refactor sem mudar comportamento (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando, definidos } from "./partir-ui-util.js";

test("src/hub.ts existe e dist/hub.js exporta o que o resto usa", async () => {
  assert.ok(fonte("src/hub.ts").length > 0, "src/hub.ts ainda nao foi criado");
  assert.deepEqual(faltando(await modulo("dist/hub.js"), ['RUNS_DIR', 'PLANEJADORES_DIR', 'CANVAS_DIR', 'AGENTES_DIR', 'migrarDadosAntigos', 'comoAbrirDashboard', 'runAtual', 'arquivoCancel', 'emitir', 'lerRuns', 'lerPlanejadores', 'limparPlanejadores', 'linhaDe', 'versaoUI', 'hostLocal', 'broadcast', 'lerCorpo']), []);
});

test("src/ui.ts nao define mais o que foi pro hub.ts", () => {
  assert.deepEqual(definidos(fonte("src/ui.ts"), ['function emitir(', 'function lerRuns(', 'function lerPlanejadores(', 'function limparPlanejadores(', 'function linhaDe(', 'function rescan(', 'function podar(', 'function hostLocal(', 'function lerCorpo(', 'function servirEstatico(']), []);
});

test("src/hub.ts nao importa ui.js (dependencia de mao unica)", () => {
  assert.doesNotMatch(fonte("src/hub.ts") || "import x from './ui.js'", /from ["']\.\/ui\.js["']/);
});
