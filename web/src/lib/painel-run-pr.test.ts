import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { aplicar, vazio } from "./estado.ts";

test("PainelRun pede confirmacao para Abrir PR, mostra estado de carregamento e abre URL em nova aba", () => {
  const src = readFileSync(new URL("../components/canvas/PainelRun.tsx", import.meta.url), "utf8");
  assert.ok(src.includes('setConfirmar("pr")'), "Abrir PR abre modal de confirmacao");
  assert.ok(!src.includes('onClick={() => void acao("pr")}'), "Abrir PR nao dispara acao sem confirmar");
  assert.ok(src.includes("Abrindo PR…"), "mostra feedback de carregamento no botao PR");
  assert.ok(src.includes("Fazendo merge…"), "mostra feedback de carregamento no botao merge");
  assert.ok(src.includes('window.open(j.url, "_blank"'), "abre URL do PR em nova aba");
});

test("estado guarda base do evento painel na Run", () => {
  const e = aplicar(vazio, [
    { swarm: "r1", ev: { t: "run", feature: "feat", cwd: "D:/p/X", total: 1, ts: 100 } },
    { swarm: "r1", ev: { t: "painel", status: "COMPLETE", branch: "orchestra/feat", base: "master", linhas: [], ts: 200 } },
  ]);
  assert.equal(e.runs.r1.base, "master");
});
