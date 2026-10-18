// Spec do partir-ui (S6): ui.ts vira roteador + porta, com a mesma API publica de hoje (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo } from "./partir-ui-util.js";

const API = [
  "AGENTES_DIR", "CANVAS_DIR", "PLANEJADORES_DIR", "RUNS_DIR", "arquivoCancel", "assumirPorta", "comoAbrirDashboard",
  "emitir", "envClaude", "hostLocal", "iniciarUI", "lerPlanejadores", "lerRuns", "limparPlanejadores", "linhaDe",
  "migrarDadosAntigos", "pararUI", "runAtual", "versaoUI",
];

test("src/ui.ts tem menos de 400 linhas", () => {
  const linhas = fonte("src/ui.ts").split("\n").length;
  assert.ok(linhas < 400, `ui.ts com ${linhas} linhas`);
});

test("dist/ui.js exporta exatamente a API de hoje", async () => {
  assert.deepEqual(Object.keys(await modulo("dist/ui.js")).sort(), [...API].sort());
});
