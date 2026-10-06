// Spec da S2 (F2): contexto dos agentes a partir do canvas (CA-9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { itensDeContexto, planoArquivos, diffContexto, FilaAvisos } from "./agentes.ts";
import type { No, Snapshot } from "./canvas.ts";

const no = (id: string, tipo: No["tipo"], dados: Record<string, unknown> = {}, over: Partial<No> = {}): No =>
  ({ id, tipo, x: 0, y: 0, w: 10, h: 10, dados, rev: 1, ...over });
const ar = (id: string, de: string, para: string) => ({ id, de, para, rev: 1 });

test("itensDeContexto: nota/imagem ligadas em qualquer direcao + itens de grupo ligado (CA-9)", () => {
  const s: Snapshot = {
    nos: [
      no("ag", "agente", { agenteId: "ag-1" }),
      no("n1", "nota", { titulo: "Direção", corpo: "use azul" }),
      no("n2", "nota", { titulo: "Outra", corpo: "" }),
      no("i1", "imagem", { url: "/canvas/asset/abc/x.png", nome: "ref.png" }),
      no("f1", "forma", { texto: "x" }),
      no("g", "grupo", { titulo: "Refs" }),
      no("i2", "imagem", { url: "/canvas/asset/abc/y.png", nome: "jardim.png" }, { pai: "g" }),
      no("solta", "nota", { titulo: "Solta" }),
    ],
    arestas: [ar("e1", "n1", "ag"), ar("e2", "ag", "i1"), ar("e3", "ag", "f1"), ar("e4", "g", "ag"), ar("e5", "n2", "f1")],
  };
  const itens = itensDeContexto(s, "ag");
  assert.deepEqual(itens.map((i) => i.noId).sort(), ["i1", "i2", "n1"]);
  const n1 = itens.find((i) => i.noId === "n1")!;
  assert.deepEqual(n1, { noId: "n1", tipo: "nota", titulo: "Direção", corpo: "use azul" });
  const i1 = itens.find((i) => i.noId === "i1")!;
  assert.deepEqual(i1, { noId: "i1", tipo: "imagem", titulo: "ref.png", url: "/canvas/asset/abc/x.png" });
  assert.deepEqual(itensDeContexto(s, "naoexiste"), []);
});

test("planoArquivos: nomes saneados, colisao (2), imagem mantem extensao, README lista tudo (CA-9)", () => {
  const p = planoArquivos([
    { noId: "a", tipo: "nota", titulo: "Direção do projeto", corpo: "texto" },
    { noId: "b", tipo: "nota", titulo: "Direção do projeto", corpo: "outro" },
    { noId: "c", tipo: "nota", titulo: 'a/b:c*?"<>|', corpo: "" },
    { noId: "d", tipo: "nota", titulo: "", corpo: "sem titulo" },
    { noId: "e", tipo: "imagem", titulo: "jardim.png", url: "/canvas/asset/abc/1.png" },
  ]);
  const nomes = p.arquivos.map((a) => a.nome);
  assert.deepEqual(nomes, ["Direção do projeto.md", "Direção do projeto (2).md", "abc.md", "Nota.md", "jardim.png"]);
  assert.equal(p.arquivos[0].conteudo, "# Direção do projeto\n\ntexto\n");
  assert.equal(p.arquivos[4].url, "/canvas/asset/abc/1.png");
  assert.equal(p.arquivos[4].conteudo, undefined);
  assert.match(p.readme, /^# Contexto do canvas/);
  for (const n of nomes) assert.ok(p.readme.includes(n), "README cita " + n);
  assert.match(p.readme, /imagem/);
  assert.equal(planoArquivos([]).arquivos.length, 0);
  assert.match(planoArquivos([]).readme, /nenhum item/i);
});

test("diffContexto: grava novos/alterados, remove sobras, mantem iguais (CA-9)", () => {
  const d = diffContexto(
    [{ nome: "README.md", assinatura: "r2" }, { nome: "a.md", assinatura: "1" }, { nome: "b.md", assinatura: "novo" }, { nome: "c.png", assinatura: "u" }],
    [{ nome: "README.md", assinatura: "r1" }, { nome: "a.md", assinatura: "1" }, { nome: "velho.md", assinatura: "x" }],
  );
  assert.deepEqual(d.gravar.sort(), ["README.md", "b.md", "c.png"]);
  assert.deepEqual(d.remover, ["velho.md"]);
});

test("FilaAvisos: junta nomes, segura enquanto ocupado, no maximo 1 a cada 5s (CA-9)", () => {
  const f = new FilaAvisos(5000);
  assert.equal(f.liberar("ag", 0), null, "nada pendente");
  f.adicionar("ag", ["a.md"]);
  f.adicionar("ag", ["b.png", "a.md"]);
  f.marcarOcupado("ag");
  assert.equal(f.liberar("ag", 1000), null, "ocupado segura");
  f.marcarOcioso("ag");
  assert.equal(f.liberar("ag", 1000), "contexto atualizado: a.md, b.png (leia .orchestra/contexto/ag/README.md)");
  assert.equal(f.liberar("ag", 1001), null, "ja liberou");
  f.adicionar("ag", ["c.md"]);
  assert.equal(f.liberar("ag", 3000), null, "menos de 5s desde o ultimo aviso");
  assert.equal(f.liberar("ag", 6000), "contexto atualizado: c.md (leia .orchestra/contexto/ag/README.md)");
  f.adicionar("outro", ["x.md"]);
  assert.match(f.liberar("outro", 0) ?? "", /x\.md/, "agente desconhecido conta como ocioso; filas independentes");
});
