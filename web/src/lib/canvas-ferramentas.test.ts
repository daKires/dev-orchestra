// Spec da S2 (F1.5): ferramentas, arrasto e criacao de cards (CA-F1, F2, F5, F6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { ferramentaDoAtalho, retanguloDeArrasto, noNovo, TAMANHO_PADRAO } from "./canvas.ts";

test("ferramentaDoAtalho: V H N R C T (maiuscula ou minuscula) e nada mais (CA-F1)", () => {
  assert.equal(ferramentaDoAtalho("v"), "selecionar");
  assert.equal(ferramentaDoAtalho("H"), "mao");
  assert.equal(ferramentaDoAtalho("n"), "nota");
  assert.equal(ferramentaDoAtalho("r"), "regiao");
  assert.equal(ferramentaDoAtalho("C"), "seta");
  assert.equal(ferramentaDoAtalho("t"), "texto");
  assert.equal(ferramentaDoAtalho("x"), null);
  assert.equal(ferramentaDoAtalho("Enter"), null);
  assert.equal(ferramentaDoAtalho(""), null);
});

test("TAMANHO_PADRAO: medidas dos cards novos (CA-F2)", () => {
  assert.deepEqual(TAMANHO_PADRAO.nota, { w: 300, h: 260 });
  assert.deepEqual(TAMANHO_PADRAO.forma, { w: 160, h: 80 });
  assert.deepEqual(TAMANHO_PADRAO.regiao, { w: 480, h: 320 });
  assert.deepEqual(TAMANHO_PADRAO.texto, { w: 240, h: 48 });
});

test("retanguloDeArrasto: clique usa o tamanho padrao no ponto clicado (CA-F2)", () => {
  assert.deepEqual(retanguloDeArrasto({ x: 100, y: 50 }, { x: 102, y: 51 }, { w: 300, h: 260 }), { x: 100, y: 50, w: 300, h: 260 });
});

test("retanguloDeArrasto: arrasto normalizado em qualquer direcao, minimo 40 (CA-F2, F5)", () => {
  assert.deepEqual(retanguloDeArrasto({ x: 10, y: 10 }, { x: 210, y: 110 }, { w: 1, h: 1 }), { x: 10, y: 10, w: 200, h: 100 });
  assert.deepEqual(retanguloDeArrasto({ x: 210, y: 110 }, { x: 10, y: 10 }, { w: 1, h: 1 }), { x: 10, y: 10, w: 200, h: 100 });
  assert.deepEqual(retanguloDeArrasto({ x: 0, y: 0 }, { x: 300, y: 10 }, { w: 1, h: 1 }), { x: 0, y: 0, w: 300, h: 40 });
});

test("noNovo: cada ferramenta de criacao gera o no' certo (CA-F2, F5, F6)", () => {
  const r = { x: 5, y: 6, w: 70, h: 80 };
  const nota = noNovo("nota", r, "n1")!;
  assert.equal(nota.tipo, "nota");
  assert.deepEqual([nota.id, nota.x, nota.y, nota.w, nota.h], ["n1", 5, 6, 70, 80]);
  assert.deepEqual(nota.dados, { titulo: "Nota", corpo: "", cor: "amarelo" });
  assert.ok(typeof nota.rev === "number" && nota.rev > 0);

  assert.deepEqual(noNovo("forma", r, "f1", { forma: "elipse" })!.dados, { forma: "elipse", texto: "", cor: "verde" });
  assert.deepEqual(noNovo("forma", r, "f2", { forma: "losango" })!.dados, { forma: "losango", texto: "", cor: "amarelo" });
  assert.deepEqual(noNovo("forma", r, "f3")!.dados, { forma: "retangulo", texto: "", cor: "cinza" });

  const reg = noNovo("regiao", r, "g1")!;
  assert.equal(reg.tipo, "grupo");
  assert.deepEqual(reg.dados, { titulo: "Região", cor: "cinza" });

  const txt = noNovo("texto", r, "t1")!;
  assert.equal(txt.tipo, "texto");
  assert.deepEqual(txt.dados, { texto: "", tamanho: "m" });

  assert.equal(noNovo("selecionar", r, "x"), null);
  assert.equal(noNovo("mao", r, "x"), null);
  assert.equal(noNovo("seta", r, "x"), null);
});
