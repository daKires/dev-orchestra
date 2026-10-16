// Spec da F5: auto-organizar o canvas em faixas por tipo, respeitando os fixados (CA-1..4).
import { test } from "node:test";
import assert from "node:assert/strict";
import { organizarPorTipo, alternarFixado, aplicarOpsLocal, paiDoNo, ESPACO_ORGANIZAR, LARGURA_ORGANIZAR } from "./canvas.ts";
import type { No, Snapshot, TipoNo } from "../../../src/canvas.ts";

const no = (id: string, tipo: TipoNo, x: number, y: number, w = 300, h = 200, dados: Record<string, unknown> = {}): No =>
  ({ id, tipo, x, y, w, h, dados, rev: 1 });
const aplicar = (nos: No[]) => {
  const s: Snapshot = { nos, arestas: [] };
  const ops = organizarPorTipo(nos, 99);
  return { ops, porId: new Map(aplicarOpsLocal(s, ops).nos.map((n) => [n.id, n])) };
};
const sobrepoe = (a: No, b: No) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test("faixas na ordem Agentes -> Navegadores -> Runs/Workers -> Notas/Imagens/Arquivos -> Formas/Regioes (CA-2)", () => {
  const nos = [
    no("f", "forma", 10, 10, 120, 80),
    no("n", "nota", 900, -400),
    no("r", "run", -300, 50, 420, 240),
    no("b", "navegador", 2000, 2000, 900, 620),
    no("a", "agente", 500, 900, 620, 420),
  ];
  const { porId } = aplicar(nos);
  const a = porId.get("a")!, b = porId.get("b")!, r = porId.get("r")!, n = porId.get("n")!, f = porId.get("f")!;
  assert.deepEqual([a.x, a.y], [0, 0], "primeira faixa comeca na origem");
  assert.ok(b.y >= a.y + a.h + ESPACO_ORGANIZAR, "navegadores abaixo dos agentes");
  assert.ok(r.y >= b.y + b.h + ESPACO_ORGANIZAR, "runs abaixo dos navegadores");
  assert.ok(n.y >= r.y + r.h + ESPACO_ORGANIZAR, "notas abaixo dos runs");
  assert.ok(f.y >= n.y + n.h + ESPACO_ORGANIZAR, "formas por ultimo");
});

test("mesma faixa: lado a lado com espacamento fixo e quebra de linha na largura maxima (CA-2)", () => {
  const nos = Array.from({ length: 6 }, (_, i) => no("a" + i, "agente", i * 37, 3000 - i * 400, 620, 420));
  const { porId } = aplicar(nos);
  const a0 = porId.get("a0")!, a1 = porId.get("a1")!;
  assert.equal(a1.y, a0.y);
  assert.equal(a1.x, a0.x + a0.w + ESPACO_ORGANIZAR);
  const todos = [...porId.values()];
  for (const n of todos) assert.ok(n.x + n.w <= LARGURA_ORGANIZAR, "nenhum card passa da largura maxima");
  assert.ok(new Set(todos.map((n) => n.y)).size >= 2, "quebrou em mais de uma linha");
  for (let i = 0; i < todos.length; i++) for (let j = i + 1; j < todos.length; j++) assert.ok(!sobrepoe(todos[i], todos[j]));
});

test("fixado nao se move, nao gera op e ninguem e' colocado em cima dele (CA-1, CA-2)", () => {
  const fixo = no("fixo", "nota", 0, 0, 700, 500, { fixado: true });
  const nos = [fixo, no("a", "agente", 3000, 3000, 620, 420), no("n", "nota", -900, 40)];
  const { ops, porId } = aplicar(nos);
  assert.ok(!ops.some((o) => o.item.id === "fixo"), "nenhuma op para o fixado");
  assert.deepEqual(porId.get("fixo"), fixo);
  for (const id of ["a", "n"]) assert.ok(!sobrepoe(porId.get(id)!, fixo), `${id} nao sobrepoe o fixado`);
});

test("regiao: move como bloco com os filhos e rearruma por dentro, crescendo se precisar (CA-3)", () => {
  const g = no("g", "grupo", 5000, 5000, 900, 400);
  const filhos = [no("c1", "forma", 5600, 5100, 200, 120), no("c2", "nota", 5050, 5050, 300, 200), no("c3", "nota", 5300, 5150, 300, 200)];
  const { porId } = aplicar([g, ...filhos, no("a", "agente", 0, 9000, 620, 420)]);
  const g2 = porId.get("g")!;
  assert.notDeepEqual([g2.x, g2.y], [5000, 5000], "a regiao foi para a faixa de Formas/Regioes");
  const grupos = [g2];
  const fs = filhos.map((f) => porId.get(f.id)!);
  for (const f of fs) assert.equal(paiDoNo(f, grupos), "g", `${f.id} continua dentro da regiao`);
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) assert.ok(!sobrepoe(fs[i], fs[j]), "filhos sem sobreposicao");
  const c2 = porId.get("c2")!, c1 = porId.get("c1")!;
  assert.ok(c2.y < c1.y, "por dentro tambem segue a ordem das faixas (nota antes de forma)");
});

test("canvas vazio ou tudo fixado: nenhuma op; ops so de upsert com o rev dado (CA-2, CA-4)", () => {
  assert.deepEqual(organizarPorTipo([], 5), []);
  assert.deepEqual(organizarPorTipo([no("x", "nota", 1, 1, 10, 10, { fixado: true })], 5), []);
  const ops = organizarPorTipo([no("a", "agente", 900, 900), no("b", "nota", 50, 50)], 7);
  assert.ok(ops.length > 0 && ops.every((o) => o.op === "upsert" && o.tipo === "no" && o.item.rev === 7));
});

test("alternarFixado: fixa os selecionados; se todos ja fixados, desafixa (CA-1)", () => {
  const nos = [no("a", "nota", 0, 0), no("b", "agente", 0, 0, 620, 420, { fixado: true, agenteId: "ag-1" })];
  const fixar = alternarFixado(nos, ["a", "b"], 3);
  assert.deepEqual(fixar.map((o) => [o.item.id, (o.item as No).dados.fixado]), [["a", true], ["b", true]]);
  assert.equal((fixar[1].item as No).dados.agenteId, "ag-1", "preserva os outros dados");
  const soltar = alternarFixado([no("b", "agente", 0, 0, 620, 420, { fixado: true })], ["b"], 4);
  assert.equal((soltar[0].item as No).dados.fixado, false);
  assert.equal(soltar[0].item.rev, 4);
});

test("organizar nao mexe em nos automaticos das runs (dados.auto); quem posiciona e' o layoutRuns (G1 fix)", () => {
  const nos = [
    no("run:r1", "run", 5000, 5000, 280, 170, { auto: true, runId: "r1" }),
    no("worker:r1:1", "worker", 6000, 5000, 260, 64, { auto: true }),
    no("n", "nota", 900, 900),
  ];
  const ops = organizarPorTipo(nos, 3);
  assert.ok(ops.every((o) => !String(o.item.id).startsWith("run:") && !String(o.item.id).startsWith("worker:")));
  assert.ok(ops.some((o) => o.item.id === "n"), "o resto continua sendo organizado");
});
