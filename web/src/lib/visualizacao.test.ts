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
