// Spec do canvas so' visualizacao (CA-1..CA-3): sem barra, menu, inspetor nem criacao; ReactFlow so' leitura.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const comp = (n: string) => new URL(`../components/${n}`, import.meta.url);

test("componentes de edicao do canvas foram removidos", () => {
  for (const n of ["Barra", "Inspetor", "MenuContexto", "NovoAgente", "NovoNavegador"]) {
    assert.equal(existsSync(comp(`canvas/${n}.tsx`)), false, n);
  }
});

test("Canvas e' so' leitura: pan e zoom, sem selecao/arrasto/conexao", () => {
  const src = readFileSync(comp("Canvas.tsx"), "utf8");
  for (const prop of ["selectionOnDrag={false}", "elementsSelectable={false}", "nodesDraggable={false}", "nodesConnectable={false}"]) {
    assert.ok(src.includes(prop), prop);
  }
  for (const fora of ["<Barra", "MenuContexto", "Inspetor", "onConnect=", "onNodeDragStop=", "onPaneContextMenu="]) {
    assert.ok(!src.includes(fora), fora);
  }
});

test("layout redimensionavel e persistido (CA-7..CA-10)", () => {
  const ids: Record<string, string> = {
    "../App.tsx": "hermes.layout.app",
    "Canvas.tsx": "hermes.layout.canvas",
    "Sidebar.tsx": "hermes.layout.sidebar",
    "canvas/PainelRun.tsx": "hermes.layout.diff",
  };
  for (const [arq, id] of Object.entries(ids)) {
    const src = readFileSync(comp(arq), "utf8");
    assert.ok(src.includes(`useDefaultLayout({ id: "${id}"`), `${arq}: ${id}`);
    assert.ok(src.includes("<ResizableHandle"), `${arq}: divisoria`);
  }
  assert.ok(!readFileSync(comp("Canvas.tsx"), "utf8").includes("CHAVE_PAINEL"), "painel fixo antigo");
});
