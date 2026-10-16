// Spec da S3 (F1.5): duplicar/colar e ordem z (CA-E2, E3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicarNos, ordemZ } from "./canvas.ts";
import type { No, Snapshot } from "../../../src/canvas.ts";

const no = (id: string, x: number, over: Partial<No> = {}): No => ({ id, tipo: "nota", x, y: 0, w: 10, h: 10, dados: {}, rev: 1, ...over });
let n = 0;
const novoId = () => "novo" + ++n;

test("duplicarNos: ids novos, +24px e so' as arestas internas (CA-E2, E3)", () => {
  n = 0;
  const s: Snapshot = {
    nos: [no("a", 0), no("b", 100), no("c", 200)],
    arestas: [{ id: "e1", de: "a", para: "b", rev: 1 }, { id: "e2", de: "b", para: "c", rev: 1 }],
  };
  const r = duplicarNos(s, ["a", "b"], novoId);
  assert.equal(r.nos.length, 2);
  assert.ok(r.nos.every((x) => !["a", "b", "c"].includes(x.id)), "ids novos");
  assert.deepEqual(r.nos.map((x) => [x.x, x.y]).sort((p, q) => p[0] - q[0]), [[24, 24], [124, 24]]);
  assert.equal(r.arestas.length, 1, "e2 sai (c nao foi copiado)");
  const [ca, cb] = [r.nos.find((x) => x.x === 24)!, r.nos.find((x) => x.x === 124)!];
  assert.equal(r.arestas[0].de, ca.id);
  assert.equal(r.arestas[0].para, cb.id);
  assert.ok(!["e1", "e2"].includes(r.arestas[0].id));
  assert.equal(s.nos.length, 3, "nao muta o snapshot");
});

test("duplicarNos: regiao leva os filhos, que apontam pro novo pai (CA-E3)", () => {
  n = 0;
  const s: Snapshot = { nos: [no("g", 0, { tipo: "grupo" }), no("f", 5, { pai: "g" }), no("solto", 50, { pai: "outra" })], arestas: [] };
  const r = duplicarNos(s, ["g"], novoId);
  assert.equal(r.nos.length, 2);
  const g2 = r.nos.find((x) => x.tipo === "grupo")!;
  const f2 = r.nos.find((x) => x.tipo === "nota")!;
  assert.equal(f2.pai, g2.id);
  const solto = duplicarNos(s, ["solto"], novoId).nos[0];
  assert.equal(solto.pai, "outra", "pai fora da copia e' mantido");
  assert.deepEqual(duplicarNos(s, [], novoId), { nos: [], arestas: [] });
});

test("ordemZ: frente = maior z + 1; tras = menor z - 1; so' devolve os alterados (CA-E2)", () => {
  const nos = [no("a", 0, { dados: { z: 3 } }), no("b", 0), no("c", 0, { dados: { z: -2, cor: "rosa" } })];
  const f = ordemZ(nos, ["b"], "frente");
  assert.deepEqual(f.map((x) => [x.id, x.dados.z]), [["b", 4]]);
  const t = ordemZ(nos, ["a", "b"], "tras");
  assert.deepEqual(t.map((x) => [x.id, x.dados.z]).sort(), [["a", -3], ["b", -3]]);
  const c = ordemZ(nos, ["c"], "frente")[0];
  assert.equal(c.dados.cor, "rosa", "preserva os outros dados");
});
