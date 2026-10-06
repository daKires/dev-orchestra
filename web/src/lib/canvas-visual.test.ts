// Spec da S1 (F1.5): tokens visuais do Castor para notas, formas e arestas (CA-V1, V2, V3, V5).
import { test } from "node:test";
import assert from "node:assert/strict";
import { estiloNota, estiloForma, pontaDaAresta, CORES_NOTA, CORES_FORMA } from "./canvas.ts";

test("estiloNota: tokens exatos do Castor para amarelo, rosa e azul (CA-V2)", () => {
  assert.deepEqual(estiloNota("amarelo"), { fundo: "#ffe066", borda: "#e5c33f", cabecalho: "#fff0a8", texto: "#3d3312" });
  assert.deepEqual(estiloNota("rosa"), { fundo: "#f5c4dc", borda: "#d99abb", cabecalho: "#fbe0ed", texto: "#512c40" });
  assert.deepEqual(estiloNota("azul"), { fundo: "#aabaff", borda: "#919fe0", cabecalho: "#ccd5ff", texto: "#303953" });
  assert.deepEqual(estiloNota("lilas"), { fundo: "#d6c8f5", borda: "#b5a3e0", cabecalho: "#e8defa", texto: "#3b2f5c" });
  assert.deepEqual(estiloNota("verde"), { fundo: "#bfe8c8", borda: "#8fcc9c", cabecalho: "#dcf3e1", texto: "#1f4a2a" });
});

test("estiloNota: cor desconhecida cai no amarelo; texto nunca e' branco (CA-V2)", () => {
  assert.deepEqual(estiloNota("foguete"), estiloNota("amarelo"));
  assert.deepEqual(estiloNota(undefined), estiloNota("amarelo"));
  for (const c of Object.keys(CORES_NOTA)) {
    assert.doesNotMatch(estiloNota(c).texto.toLowerCase(), /^#(fff|ffffff|eee|eeeeee)$/, c);
    assert.equal(CORES_NOTA[c as keyof typeof CORES_NOTA], estiloNota(c).fundo, "CORES_NOTA = fundo da nota " + c);
  }
});

test("estiloForma: preenchimento do Castor e texto escuro #242326 (CA-V3)", () => {
  assert.deepEqual(estiloForma("verde"), { fundo: "#46bb94", texto: "#242326" });
  assert.deepEqual(estiloForma("amarelo"), { fundo: "#c6be62", texto: "#242326" });
  assert.deepEqual(estiloForma("vermelho"), { fundo: "#df7971", texto: "#242326" });
  assert.deepEqual(estiloForma("cinza"), { fundo: "#a4a1aa", texto: "#242326" });
  assert.deepEqual(estiloForma("lilas"), { fundo: "#b9a8e6", texto: "#242326" });
  assert.deepEqual(estiloForma("xyz"), estiloForma("cinza"));
  for (const c of Object.keys(CORES_FORMA)) assert.equal(CORES_FORMA[c as keyof typeof CORES_FORMA], estiloForma(c).fundo);
});

test("pontaDaAresta: seta so' entre duas formas (CA-V5)", () => {
  assert.equal(pontaDaAresta("forma", "forma"), true);
  assert.equal(pontaDaAresta("nota", "forma"), false);
  assert.equal(pontaDaAresta("forma", "imagem"), false);
  assert.equal(pontaDaAresta("nota", "agente"), false);
  assert.equal(pontaDaAresta(undefined, "forma"), false);
});
