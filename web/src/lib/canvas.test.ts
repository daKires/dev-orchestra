// Spec da S3: logica pura do canvas no front (CA-2, CA-8, CA-10, CA-11a, CA-12, CA-14).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarOpsLocal, paiDoNo, mdBlocos, limitarZoom, checarImagem, CORES_NOTA, CORES_FORMA } from "./canvas.ts";
import type { No } from "../../../src/canvas.ts";

const no = (id: string, x: number, y: number, w: number, h: number, over: Partial<No> = {}): No =>
  ({ id, tipo: "nota", x, y, w, h, dados: {}, rev: 1, ...over });

test("aplicarOpsLocal: mesma regra de rev do hub (CA-14)", () => {
  let s = aplicarOpsLocal({ nos: [], arestas: [] }, [{ op: "upsert", tipo: "no", item: no("a", 0, 0, 10, 10, { rev: 3 }) }]);
  s = aplicarOpsLocal(s, [{ op: "upsert", tipo: "no", item: no("a", 5, 0, 10, 10, { rev: 2 }) }]);
  assert.equal(s.nos[0].x, 0);
  s = aplicarOpsLocal(s, [{ op: "upsert", tipo: "aresta", item: { id: "e", de: "a", para: "a", rev: 1 } }]);
  s = aplicarOpsLocal(s, [{ op: "remove", tipo: "no", item: { id: "a", rev: 4 } }]);
  assert.equal(s.nos.length, 0);
  assert.equal(s.arestas.length, 0, "aresta do no removido some");
});

test("paiDoNo: no' inteiramente dentro de um grupo vira filho; o menor grupo vence (CA-12)", () => {
  const grande = no("G", 0, 0, 1000, 1000, { tipo: "grupo" });
  const pequeno = no("g", 100, 100, 300, 300, { tipo: "grupo" });
  assert.equal(paiDoNo(no("a", 150, 150, 50, 50), [grande, pequeno]), "g");
  assert.equal(paiDoNo(no("b", 600, 600, 50, 50), [grande, pequeno]), "G");
  assert.equal(paiDoNo(no("c", 380, 380, 50, 50), [pequeno]), undefined, "parcialmente fora nao entra");
  assert.equal(paiDoNo(no("d", 2000, 0, 10, 10), [grande]), undefined);
  assert.equal(paiDoNo(pequeno, [pequeno]), undefined, "grupo nao e' pai de si mesmo");
});

test("mdBlocos: titulos, listas, codigo, negrito e paragrafos (CA-8)", () => {
  const b = mdBlocos("# Ideia\n## Sub\n- um **forte**\n* dois `cod`\n\nlinha a\nlinha b\n\n```\nx = 1\n```");
  assert.deepEqual(b.map((x) => x.tipo), ["titulo", "titulo", "item", "item", "paragrafo", "codigo"]);
  assert.equal((b[0] as any).nivel, 1);
  assert.equal((b[1] as any).nivel, 2);
  assert.deepEqual((b[2] as any).trechos, [{ texto: "um " }, { texto: "forte", negrito: true }]);
  assert.deepEqual((b[3] as any).trechos, [{ texto: "dois " }, { texto: "cod", codigo: true }]);
  assert.deepEqual((b[4] as any).trechos, [{ texto: "linha a linha b" }]);
  assert.equal((b[5] as any).texto, "x = 1");
  assert.deepEqual(mdBlocos(""), []);
  assert.deepEqual(mdBlocos("<script>x</script>")[0], { tipo: "paragrafo", trechos: [{ texto: "<script>x</script>" }] }, "html vira texto");
});

test("limitarZoom: 10% a 200% (CA-2)", () => {
  assert.equal(limitarZoom(0.01), 0.1);
  assert.equal(limitarZoom(5), 2);
  assert.equal(limitarZoom(0.61), 0.61);
  assert.equal(limitarZoom(Number.NaN), 1);
});

test("checarImagem: so imagem ate 25MB, mensagem em PT-BR (CA-10)", () => {
  assert.equal(checarImagem("ref.png", 1000), null);
  assert.equal(checarImagem("ref.JPEG", 1000), null);
  assert.match(checarImagem("x.exe", 10) ?? "", /formato/i);
  assert.match(checarImagem("doc.pdf", 10) ?? "", /formato/i);
  assert.match(checarImagem("big.png", 25 * 1024 * 1024 + 1) ?? "", /25 ?MB/);
});

test("paletas: 5 cores de nota e 5 de forma (CA-8, CA-11a)", () => {
  assert.deepEqual(Object.keys(CORES_NOTA).sort(), ["amarelo", "azul", "lilas", "rosa", "verde"]);
  assert.deepEqual(Object.keys(CORES_FORMA).sort(), ["amarelo", "cinza", "lilas", "verde", "vermelho"]);
});
