// Spec da S5 (F1.5): miniatura do canvas nos cards de projeto (CA-P1).
import { test } from "node:test";
import assert from "node:assert/strict";
import { miniatura, estiloNota, estiloForma } from "./canvas.ts";
import type { No, Snapshot } from "../../../canvas.ts";

const no = (id: string, x: number, y: number, w: number, h: number, over: Partial<No> = {}): No =>
  ({ id, tipo: "nota", x, y, w, h, dados: {}, rev: 1, ...over });
const perto = (a: number, b: number) => Math.abs(a - b) < 0.01;

test("miniatura: vazio -> nada (CA-P1)", () => {
  assert.deepEqual(miniatura({ nos: [], arestas: [] }, 200, 120), { retangulos: [], linhas: [] });
});

test("miniatura: escala preservando proporcao e centralizando com margem 4 (CA-P1)", () => {
  const s: Snapshot = { nos: [no("a", 0, 0, 1000, 100)], arestas: [] };
  const m = miniatura(s, 200, 200);
  const r = m.retangulos[0];
  assert.ok(perto(r.w, 192), "largura = 200 - 2*4");
  assert.ok(perto(r.h, 19.2), "altura proporcional");
  assert.ok(perto(r.x, 4));
  assert.ok(perto(r.y, (200 - 19.2) / 2), "centralizado na vertical");
});

test("miniatura: varios nos no mesmo referencial + linhas entre centros (CA-P1)", () => {
  const s: Snapshot = {
    nos: [no("a", 100, 100, 100, 100), no("b", 300, 100, 100, 100, { tipo: "forma", dados: { cor: "verde" } })],
    arestas: [{ id: "e", de: "a", para: "b", rev: 1 }, { id: "x", de: "a", para: "sumiu", rev: 1 }],
  };
  const m = miniatura(s, 300, 100);
  assert.equal(m.retangulos.length, 2);
  const [a, b] = m.retangulos;
  assert.ok(perto(b.x - a.x, 2 * a.w), "distancia proporcional");
  assert.equal(m.linhas.length, 1, "aresta para no inexistente e' ignorada");
  const l = m.linhas[0];
  assert.ok(perto(l.x1, a.x + a.w / 2) && perto(l.y1, a.y + a.h / 2));
  assert.ok(perto(l.x2, b.x + b.w / 2));
});

test("miniatura: cor por tipo (CA-P1)", () => {
  const s: Snapshot = {
    nos: [
      no("n", 0, 0, 10, 10, { dados: { cor: "rosa" } }),
      no("f", 20, 0, 10, 10, { tipo: "forma", dados: { cor: "vermelho" } }),
      no("i", 40, 0, 10, 10, { tipo: "imagem" }),
    ],
    arestas: [],
  };
  const c = miniatura(s, 100, 100).retangulos.map((r) => r.cor);
  assert.equal(c[0], estiloNota("rosa").fundo);
  assert.equal(c[1], estiloForma("vermelho").fundo);
  assert.equal(c[2], "#1c1c1c", "demais tipos = cor do card");
});
