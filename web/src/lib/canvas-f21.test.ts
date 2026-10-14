// Spec do F2.1 (front): inspetor so' para itens editaveis; fases da run sem cobrir o conteudo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { inspecionavel } from "./canvas.ts";
import { layoutRuns } from "./layout.ts";
import { aplicar, vazio, type Msg } from "./estado.ts";
import type { No } from "../../../canvas.ts";

const no = (tipo: No["tipo"], dados: Record<string, unknown> = {}) => ({ tipo, dados });

test("inspecionavel: so nota/forma/imagem/grupo/texto feitos a mao", () => {
  for (const t of ["nota", "forma", "imagem", "grupo", "texto"] as const) assert.equal(inspecionavel(no(t)), true, t);
  for (const t of ["agente", "run", "worker", "arquivo", "explorador", "navegador"] as const) assert.equal(inspecionavel(no(t)), false, t);
  assert.equal(inspecionavel(no("forma", { auto: true })), false, "forma do fluxograma automatico");
  assert.equal(inspecionavel(no("grupo", { auto: true })), false, "regiao automatica da run");
});

test("layoutRuns: as fases nao cobrem os itens do usuario", () => {
  const T = 1_000_000;
  const msgs: Msg[] = [{ swarm: "r1", ev: { t: "run", feature: "Tela de login", cwd: "D:/p", total: 2, ts: T, plano: [
    { tarefa: "a", arquivos_alvo: [], descricao: "" }, { tarefa: "b", arquivos_alvo: [], descricao: "" },
  ] } }];
  const run = aplicar(vazio, msgs).runs.r1;
  const usuario: No[] = [
    { id: "n1", tipo: "nota", x: 0, y: 0, w: 300, h: 260, dados: {}, rev: 1 },
    { id: "n2", tipo: "imagem", x: 500, y: 900, w: 200, h: 200, dados: {}, rev: 1 },
  ];
  const recolhida = layoutRuns([run], { nos: usuario, arestas: [] });
  const card = recolhida.nos.find((n) => n.id === "run:r1")!;
  assert.ok(card.x + card.w <= 0 - 80, "coluna de runs a esquerda de todo o conteudo do usuario");

  const exp = layoutRuns([run], { nos: [...usuario, { ...card, dados: { ...card.dados, expandida: true } }], arestas: [] });
  const f1 = exp.nos.find((n) => n.id === "fase1:r1")!, f3 = exp.nos.find((n) => n.id === "fase3:r1")!;
  assert.ok(f1.x >= card.x + card.w, "fases a direita do card");
  assert.ok(f3.x + f3.w <= 0 - 40, "as 3 fases nao invadem o conteudo do usuario (menor x = 0)");

});
