// Spec da S2 (F1.5): o hub aceita o tipo de no' "texto" (CA-F6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validarOps, aplicarOps, TIPOS_NO } from "../dist/canvas.js";

test("tipo texto e' valido e aplicavel (CA-F6)", () => {
  assert.ok((TIPOS_NO as readonly string[]).includes("texto"));
  const item = { id: "t1", tipo: "texto", x: 0, y: 0, w: 240, h: 48, dados: { texto: "Ideias", tamanho: "g" }, rev: 1 };
  const ops = validarOps([{ op: "upsert", tipo: "no", item }]);
  assert.ok(ops, "validarOps aceita texto");
  const s = aplicarOps({ nos: [], arestas: [] }, ops!);
  assert.equal(s.nos[0].tipo, "texto");
});
