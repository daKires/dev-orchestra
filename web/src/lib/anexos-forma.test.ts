// Spec da S4 (CA-5, frontend): o dialog "Nova feature" ganha descricao OPCIONAL (multi-linha) e
// anexos de IMAGEM/DOCUMENTO (audio/video ficaram fora — o planejador nao ouve/assiste). Regras
// puras em estado.ts, testadas aqui; o componente so' reflete. Limites combinados: ate 10 anexos,
// 25MB cada; extensoes aceitas: png jpg jpeg gif webp (imagem) e pdf txt md docx (documento).
// problemaAnexo devolve null (ok) ou uma mensagem em PT-BR dizendo o motivo — o teste so' ancora
// o MOTIVO (regex solta), nao o texto exato, pra nao ditar copy.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as estado from "./estado.ts";

const MB = 1024 * 1024;
const arq = (nome: string, tamanho = 1000) => ({ nome, tamanho });

test("as funcoes de anexo da S4 existem em estado.ts", () => {
  assert.equal(typeof estado.problemaAnexo, "function", "problemaAnexo");
  assert.equal(typeof estado.nomeSeguroAnexo, "function", "nomeSeguroAnexo");
});

test("problemaAnexo: aceita imagens e documentos dentro dos limites (CA-5)", () => {
  for (const n of ["a.png", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.pdf", "g.txt", "h.md", "i.docx", "FOTO.PNG"]) {
    assert.equal(estado.problemaAnexo(arq(n), 0), null, n);
  }
  assert.equal(estado.problemaAnexo(arq("grande.png", 25 * MB), 0), null, "exatos 25MB passam");
  assert.equal(estado.problemaAnexo(arq("x.png"), 9), null, "o 10o arquivo ainda passa");
});

test("problemaAnexo: recusa tipo fora da lista (audio/video/executavel etc.) (CA-5)", () => {
  for (const n of ["x.exe", "x.mp3", "x.mp4", "x.zip", "x.js", "semextensao"]) {
    const msg = estado.problemaAnexo(arq(n), 0);
    assert.ok(typeof msg === "string" && msg.length > 0, n + " recusado");
    assert.match(msg!, /tipo|formato|extens|imagem|documento/i, n + " -> mensagem cita o motivo");
  }
});

test("problemaAnexo: recusa arquivo acima de 25MB (CA-5)", () => {
  const msg = estado.problemaAnexo(arq("pesado.png", 25 * MB + 1), 0);
  assert.ok(msg, "recusado");
  assert.match(msg!, /25|MB|tamanho/i);
});

test("problemaAnexo: recusa quando ja' tem 10 anexos (CA-5)", () => {
  const msg = estado.problemaAnexo(arq("x.png"), 10);
  assert.ok(msg, "recusado");
  assert.match(msg!, /10/);
});

test("nomeSeguroAnexo: tira diretorio e traversal, fica so' o nome do arquivo (CA-5)", () => {
  assert.equal(estado.nomeSeguroAnexo("foto.png"), "foto.png");
  assert.equal(estado.nomeSeguroAnexo("C:\\users\\eu\\foto.png"), "foto.png");
  assert.equal(estado.nomeSeguroAnexo("../../etc/secreto.pdf"), "secreto.pdf");
  assert.equal(estado.nomeSeguroAnexo("..\\..\\x.png"), "x.png");
  assert.equal(estado.nomeSeguroAnexo("a/b/c.md"), "c.md");
});

test("podeCriar: a descricao NAO entra na regra — segue so' projeto+feature (CA-5)", () => {
  assert.equal(estado.podeCriar("D:\\p", "f"), true);
  assert.equal(estado.podeCriar("D:\\p", "  "), false);
  assert.equal(estado.podeCriar(" ", "f"), false);
});
