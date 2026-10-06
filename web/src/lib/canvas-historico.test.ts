// Spec da S4 (F1.5): desfazer/refazer local por ops inversas (CA-E4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { inversoDe, Historico, aplicarOpsLocal } from "./canvas.ts";
import type { No, Op, Snapshot } from "../../../canvas.ts";

const no = (id: string, x = 0, rev = 1): No => ({ id, tipo: "nota", x, y: 0, w: 10, h: 10, dados: {}, rev });

test("inversoDe: criar -> remover (CA-E4)", () => {
  const antes: Snapshot = { nos: [], arestas: [] };
  const inv = inversoDe(antes, [{ op: "upsert", tipo: "no", item: no("a") }], 50);
  assert.deepEqual(inv, [{ op: "remove", tipo: "no", item: { id: "a", rev: 50 } }]);
});

test("inversoDe: editar -> volta o item anterior com rev novo (CA-E4)", () => {
  const antes: Snapshot = { nos: [no("a", 0)], arestas: [] };
  const inv = inversoDe(antes, [{ op: "upsert", tipo: "no", item: no("a", 99, 2) }], 50);
  assert.deepEqual(inv, [{ op: "upsert", tipo: "no", item: { ...no("a", 0), rev: 50 } }]);
});

test("inversoDe: remover no' restaura o no' e as arestas dele; aplicar volta ao estado anterior (CA-E4)", () => {
  const antes: Snapshot = { nos: [no("a"), no("b")], arestas: [{ id: "e", de: "a", para: "b", rev: 1 }] };
  const ops: Op[] = [{ op: "remove", tipo: "no", item: { id: "a", rev: 2 } }];
  const depois = aplicarOpsLocal(antes, ops);
  const inv = inversoDe(antes, ops, 50);
  const volta = aplicarOpsLocal(depois, inv);
  assert.deepEqual(volta.nos.map((x) => x.id).sort(), ["a", "b"]);
  assert.deepEqual(volta.arestas.map((x) => x.id), ["e"]);
  assert.ok(volta.nos.every((x) => x.id !== "a" || x.rev === 50));
});

test("inversoDe: lote em ordem reversa e remove de item inexistente nao gera nada (CA-E4)", () => {
  const antes: Snapshot = { nos: [], arestas: [] };
  const ops: Op[] = [
    { op: "upsert", tipo: "no", item: no("a") },
    { op: "upsert", tipo: "aresta", item: { id: "e", de: "a", para: "a", rev: 1 } },
  ];
  const inv = inversoDe(antes, ops, 7);
  assert.deepEqual(inv.map((o) => [o.op, o.tipo, o.item.id]), [["remove", "aresta", "e"], ["remove", "no", "a"]]);
  assert.deepEqual(inversoDe(antes, [{ op: "remove", tipo: "no", item: { id: "zz", rev: 1 } }], 7), []);
});

test("Historico: desfazer/refazer, acao nova limpa o refazer, limite 100 (CA-E4)", () => {
  const h = new Historico();
  const op = (id: string): Op[] => [{ op: "upsert", tipo: "no", item: no(id) }];
  const inv = (id: string): Op[] => [{ op: "remove", tipo: "no", item: { id, rev: 1 } }];
  assert.equal(h.desfazer(), null);
  h.registrar(inv("a"), op("a"));
  h.registrar(inv("b"), op("b"));
  assert.deepEqual(h.desfazer(), inv("b"));
  assert.deepEqual(h.refazer(), op("b"));
  assert.equal(h.refazer(), null);
  assert.deepEqual(h.desfazer(), inv("b"));
  h.registrar(inv("c"), op("c"));
  assert.equal(h.refazer(), null, "acao nova limpa o refazer");

  const g = new Historico();
  for (let i = 0; i < 105; i++) g.registrar(inv("x" + i), op("x" + i));
  let k = 0;
  while (g.desfazer()) k++;
  assert.equal(k, 100);
});
