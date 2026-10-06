// Spec da S1 (F4): logica pura do navegador controlado por agentes (CA-7a, 7b, 7c).
import { test } from "node:test";
import assert from "node:assert/strict";
import { urlPermitida, formatarLeitura, resolverElemento, nomeShot, SCRIPT_LEITURA, type Elemento } from "./navegador.ts";

test("urlPermitida: so http/https (inclui localhost) (CA-7a)", () => {
  for (const u of ["https://www.youtube.com", "http://localhost:5173", "HTTPS://notion.so/x?y=1", "http://127.0.0.1:4123/"]) assert.equal(urlPermitida(u), true, u);
  for (const u of ["file:///C:/x", "javascript:alert(1)", "chrome://settings", "about:blank", "ftp://x", "nao e url", ""]) assert.equal(urlPermitida(u), false, u);
});

const els: Elemento[] = [
  { n: 1, papel: "link", rotulo: "Início" },
  { n: 2, papel: "campo", rotulo: "Pesquisar" },
  { n: 16, papel: "botão", rotulo: "Inscrever-se" },
  { n: 17, papel: "botão", rotulo: "Inscrever-se no canal" },
];

test("formatarLeitura: cabecalho, texto cortado e elementos numerados (CA-7b)", () => {
  const t = formatarLeitura({ titulo: "Castor - YouTube", url: "https://youtube.com/@castor", texto: "a".repeat(7000), elementos: els });
  const linhas = t.split("\n");
  assert.equal(linhas[0], "# Castor - YouTube");
  assert.equal(linhas[1], "https://youtube.com/@castor");
  assert.ok(t.includes("a".repeat(6000) + "…"), "texto cortado em 6000 com reticencias");
  assert.ok(!t.includes("a".repeat(6001)));
  assert.ok(t.includes('Elementos:\n[1] link "Início"\n[2] campo "Pesquisar"\n[16] botão "Inscrever-se"'));
  const vazio = formatarLeitura({ titulo: "", url: "https://x.com", texto: "oi", elementos: [] });
  assert.ok(vazio.includes("Elementos: (nenhum)"));
  assert.ok(!vazio.includes("…"));
  assert.equal(formatarLeitura({ titulo: "t", url: "u", texto: "abcdef", elementos: [] }, 3).includes("abc…"), true, "limite configuravel");
});

test("resolverElemento: numero, texto unico, ambiguo e inexistente (CA-7b)", () => {
  assert.deepEqual(resolverElemento(els, "16"), { ok: els[2] });
  assert.deepEqual(resolverElemento(els, "pesquisar"), { ok: els[1] });
  assert.deepEqual(resolverElemento(els, "início"), { ok: els[0] });
  const amb = resolverElemento(els, "inscrever") as { erro: string };
  assert.match(amb.erro, /amb[ií]guo/);
  assert.match(amb.erro, /16/);
  assert.match(amb.erro, /17/);
  assert.equal((resolverElemento(els, "99") as { erro: string }).erro, "elemento 99 não existe; rode read de novo");
  assert.equal((resolverElemento(els, "comprar") as { erro: string }).erro, 'nenhum elemento com o texto "comprar"; rode read de novo');
});

test("nomeShot: slug do nome + data/hora local (CA-7b)", () => {
  assert.equal(nomeShot("Pesquisa Ótima", new Date(2026, 9, 6, 14, 5, 9)), "pesquisa-otima-20261006-140509.png");
});

test("SCRIPT_LEITURA: script de pagina que marca os interativos com data-hermes-n (CA-7b)", () => {
  assert.equal(typeof SCRIPT_LEITURA, "string");
  assert.ok(SCRIPT_LEITURA.includes("data-hermes-n"));
  assert.ok(SCRIPT_LEITURA.length > 100);
});
