// Spec da Run B (CA-16, 18): o canvas aceita os nos automaticos das fases (pedido, gate, diff).
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIPOS_NO, validarOps } from "./canvas.ts";

test("tipos pedido, gate e diff existem e passam na validacao do upsert", () => {
  for (const tipo of ["pedido", "gate", "diff"]) {
    assert.ok((TIPOS_NO as readonly string[]).includes(tipo), tipo);
    const op = { op: "upsert", tipo: "no", item: { id: `${tipo}:r1`, tipo, x: 0, y: 0, w: 10, h: 10, rev: 1, dados: { auto: true, runId: "r1" } } };
    assert.notEqual(validarOps([op]), null, tipo);
  }
  assert.equal(validarOps([{ op: "upsert", tipo: "no", item: { id: "x", tipo: "inexistente", x: 0, y: 0, w: 1, h: 1, rev: 1, dados: {} } }]), null);
});
