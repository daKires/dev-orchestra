// Spec da Run C (CA-22): a vista IDE antiga sai do codigo; o painel da run continua com Feed/Gate/Metricas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const comp = (n: string) => new URL(`../components/${n}`, import.meta.url);

test("componentes da vista antiga foram removidos", () => {
  for (const n of ["EditorArea.tsx", "PlanoView.tsx", "ChatPanel.tsx", "BottomPanel.tsx", "canvas/Projetos.tsx"]) {
    assert.equal(existsSync(comp(n)), false, n);
  }
});

test("estado.ts nao exporta mais as funcoes do chat lateral", () => {
  const src = readFileSync(new URL("./estado.ts", import.meta.url), "utf8");
  for (const fn of ["chatsDoProjeto", "chatsVisiveis", "filtrarFechados", "chatsEscondidos", "selecaoAposFechar", "modoPainelChat"]) {
    assert.ok(!src.includes(`function ${fn}(`), fn);
  }
});

test("PainelRun nao depende do BottomPanel e mantem Feed, Gate e Metricas", () => {
  const src = readFileSync(comp("canvas/PainelRun.tsx"), "utf8");
  assert.ok(!src.includes("BottomPanel"), "sem import do BottomPanel");
  for (const nome of ["Feed", "Gate", "Metricas"]) assert.ok(src.includes(`function ${nome}(`), nome);
});
