// Spec da S4/S5 (F3): visual da conversa e explorador (CA-6d, 13c).
import { test } from "node:test";
import assert from "node:assert/strict";
import { arestasEmConversa, ehLinhaColab, filtrarArvore, arvoreDeCaminhos } from "./colab.ts";

test("arestasEmConversa: marca a aresta entre os agentes, sentido e balao de 40 chars (CA-6d)", () => {
  const arestas = [
    { id: "e1", de: "ag:lid", para: "ag:des" },
    { id: "e2", de: "ag:dev", para: "ag:lid" },
    { id: "e3", de: "n1", para: "ag:lid" },
  ];
  const longo = "Proponha um título e um subtítulo claros para a página";
  const m = arestasEmConversa([{ q: "q-1", de: "lid", para: "des", texto: longo }, { q: "q-2", de: "lid", para: "dev", texto: "curto" }], arestas);
  assert.deepEqual(m.e1, { sentido: "direto", balao: longo.slice(0, 40) + "…" });
  assert.deepEqual(m.e2, { sentido: "reverso", balao: "curto" });
  assert.equal(m.e3, undefined);
  assert.deepEqual(arestasEmConversa([], arestas), {});
});

test("ehLinhaColab: destaca as mensagens entre agentes (CA-6d)", () => {
  assert.equal(ehLinhaColab("[pergunta de Líder · q-1] oi"), true);
  assert.equal(ehLinhaColab("[resposta de Designer · q-1] x"), true);
  assert.equal(ehLinhaColab("[mensagem de Líder] x"), true);
  assert.equal(ehLinhaColab("[sem resposta de Designer para q-1]"), true);
  assert.equal(ehLinhaColab("texto normal"), false);
  assert.equal(ehLinhaColab(" [pergunta de x]"), false);
});

test("filtrarArvore: busca sem diferenciar maiusculas; vazia = tudo (CA-13c)", () => {
  const c = ["src/App.tsx", "src/lib/canvas.ts", "README.md"];
  assert.deepEqual(filtrarArvore(c, ""), c);
  assert.deepEqual(filtrarArvore(c, "CANVAS"), ["src/lib/canvas.ts"]);
  assert.deepEqual(filtrarArvore(c, "src/"), ["src/App.tsx", "src/lib/canvas.ts"]);
});

test("arvoreDeCaminhos: pastas primeiro, ordem alfabetica, caminhos completos (CA-13c)", () => {
  assert.deepEqual(arvoreDeCaminhos(["src/a.ts", "README.md", "src/lib/b.ts"]), [
    { nome: "src", caminho: "src", filhos: [
      { nome: "lib", caminho: "src/lib", filhos: [{ nome: "b.ts", caminho: "src/lib/b.ts" }] },
      { nome: "a.ts", caminho: "src/a.ts" },
    ] },
    { nome: "README.md", caminho: "README.md" },
  ]);
  assert.deepEqual(arvoreDeCaminhos([]), []);
});
