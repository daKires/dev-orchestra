// Spec da S5: mensagens SSE do canvas convivem com o reducer de runs (CA-14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, ehMsgCanvas, vazio, type Msg } from "./estado.ts";

const opMsg = { canvasOp: { projeto: "D:\\p", ops: [{ op: "upsert", tipo: "no", item: { id: "n", tipo: "nota", x: 0, y: 0, w: 1, h: 1, dados: {}, rev: 1 } }] } };

test("ehMsgCanvas: reconhece {canvasOp}/{canvas} e nada mais", () => {
  assert.equal(ehMsgCanvas(opMsg), true);
  assert.equal(ehMsgCanvas({ canvas: { projeto: "D:\\p", nos: [], arestas: [] } }), true);
  assert.equal(ehMsgCanvas({ swarm: "r", ev: { t: "log", texto: "x" } }), false);
  assert.equal(ehMsgCanvas({ planejadores: [] }), false);
  assert.equal(ehMsgCanvas(null), false);
});

test("aplicar ignora mensagens do canvas sem tocar runs/planejadores", () => {
  const base = aplicar(vazio, [{ swarm: "r", ev: { t: "run", feature: "f", cwd: "D:/p", total: 1, ts: 1 } } as Msg]);
  const depois = aplicar(base, [opMsg as unknown as Msg]);
  assert.deepEqual(depois.runs, base.runs);
  assert.deepEqual(depois.planejadores, base.planejadores);
  const comPlan = aplicar(depois, [{ planejadores: [] } as Msg]);
  assert.deepEqual(comPlan.planejadores, []);
});
