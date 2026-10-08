// Spec do fix (F1.5): ao reconstruir os nos do xyflow a partir do hub, as medidas e a selecao
// do no' antigo sao preservadas; sem `measured` o xyflow nao calcula alcas e nao desenha arestas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mesclarNosRf } from "./canvas.ts";

test("mesclarNosRf: preserva measured e selected do no' antigo de mesmo id", () => {
  const antigos = [
    { id: "a", position: { x: 0, y: 0 }, data: {}, measured: { width: 170, height: 130 }, selected: true },
    { id: "b", position: { x: 0, y: 0 }, data: {}, measured: { width: 50, height: 40 } },
  ];
  const novos = [
    { id: "a", position: { x: 10, y: 20 }, data: { v: 2 }, width: 170, height: 130 },
    { id: "c", position: { x: 5, y: 5 }, data: {} },
  ];
  const r = mesclarNosRf(novos, antigos);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0].measured, { width: 170, height: 130 });
  assert.equal(r[0].selected, true);
  assert.deepEqual(r[0].position, { x: 10, y: 20 }, "posicao e dados vem do novo");
  assert.deepEqual(r[0].data, { v: 2 });
  assert.equal(r[1].measured, undefined, "no' novo sem antigo fica sem measured");
  assert.equal(r[1].selected, undefined);
  assert.equal(novos[0].hasOwnProperty("measured"), false, "nao muta a entrada");
});
