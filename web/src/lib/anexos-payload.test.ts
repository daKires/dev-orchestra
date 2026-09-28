// Extra da S4 (frontend, CA-5): o corpo do POST /nova-feature. Sem descricao e sem anexos o payload
// precisa sair EXATAMENTE { projeto, feature } (o hub antigo recusaria chaves extras); descricao em
// branco some, anexo vai como { nome, tipo, dadosB64 } (sem tamanho).
import { test } from "node:test";
import assert from "node:assert/strict";
import { corpoNovaFeature, tamanhoLegivel, type Anexo } from "./estado.ts";

const anexo = (nome = "x.png", tamanho = 12): Anexo => ({ nome, tamanho, tipo: "image/png", dadosB64: "QUJD" });

test("corpoNovaFeature: sem descricao e sem anexos sai EXATAMENTE { projeto, feature }", () => {
  assert.deepEqual(corpoNovaFeature(" D:\\p ", " f "), { projeto: "D:\\p", feature: "f" });
  assert.deepEqual(corpoNovaFeature("D:\\p", "f", "   ", []), { projeto: "D:\\p", feature: "f" });
});

test("corpoNovaFeature: descricao com trim e anexos no formato do hub (nome/tipo/dadosB64)", () => {
  assert.deepEqual(corpoNovaFeature("p", "f", "  texto\nlongo  "), { projeto: "p", feature: "f", descricao: "texto\nlongo" });
  const corpo = corpoNovaFeature("p", "f", "", [anexo("foto.png"), anexo("doc.pdf")]);
  assert.deepEqual(corpo.anexos, [
    { nome: "foto.png", tipo: "image/png", dadosB64: "QUJD" },
    { nome: "doc.pdf", tipo: "image/png", dadosB64: "QUJD" },
  ]);
  assert.ok(!("descricao" in corpo), "descricao em branco nao entra");
});

test("tamanhoLegivel: bytes, KB e MB com uma casa", () => {
  assert.equal(tamanhoLegivel(512), "512 B");
  assert.equal(tamanhoLegivel(2048), "2 KB");
  assert.equal(tamanhoLegivel(25 * 1024 * 1024), "25,0 MB");
});
