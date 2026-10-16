// Spec da S4 (F2): layout automatico de runs e agentes no canvas (CA-4b, 5b, 11b, 13a, 15).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { layoutRuns, layoutAgentes } from "./layout.ts";
import type { No, Snapshot } from "../../../src/canvas.ts";

const T = 1_000_000;
function runDe(id: string, extra: Msg[] = [], ts = T): Run {
  const msgs: Msg[] = [
    { swarm: id, ev: { t: "run", feature: "f-" + id, cwd: "D:/p", total: 2, ts, plano: [
      { tarefa: "modelo", arquivos_alvo: [], descricao: "" }, { tarefa: "tela", arquivos_alvo: [], descricao: "" },
    ] } },
    ...extra,
  ];
  return aplicar(vazio, msgs).runs[id];
}
const vazioS: Snapshot = { nos: [], arestas: [] };

test("layoutRuns: run terminada recolhida = 1 card na coluna Runs, mais recente em cima (CA-15; G1: so' a ativa abre sozinha)", () => {
  const fim = (id: string): Msg => ({ swarm: id, ev: { t: "painel", status: "COMPLETE", branch: "b", linhas: [], ts: T + 5000 } });
  const a = runDe("ra", [fim("ra")], T);
  const b = runDe("rb", [fim("rb")], T + 1000);
  const l = layoutRuns([a, b], vazioS);
  const cards = l.nos.filter((n) => n.tipo === "run");
  assert.deepEqual(cards.map((n) => n.id), ["run:rb", "run:ra"]);
  assert.equal(cards[0].x, cards[1].x, "mesma coluna");
  assert.ok(cards[0].y < cards[1].y);
  assert.ok(cards.every((n) => n.dados.auto === true && n.dados.runId));
  assert.equal(l.nos.length, 2, "recolhidas nao geram regiao");
  assert.equal(l.arestas.length, 0);
});

test("layoutRuns: geometria salva dos filhos e' ignorada, os dados ficam (canvas-fase2 CA-2)", () => {
  const r = runDe("rz");
  const nos: No[] = [
    { id: "run:rz", tipo: "run", x: 0, y: 0, w: 280, h: 170, dados: { auto: true, runId: "rz", expandida: true }, rev: 1 },
    { id: "worker:rz:1", tipo: "worker", x: 777, y: 888, w: 999, h: 999, dados: { auto: true, marca: 1 }, pai: "fase2:rz", rev: 1 },
    { id: "pedido:rz", tipo: "pedido", x: 5, y: 5000, w: 1, h: 1, dados: { auto: true }, pai: "fase1:rz", rev: 1 },
    { id: "gate:rz", tipo: "gate", x: 5, y: 5000, w: 1, h: 1, dados: { auto: true }, pai: "fase3:rz", rev: 1 },
    { id: "diff:rz", tipo: "diff", x: 5, y: 5000, w: 1, h: 1, dados: { auto: true }, pai: "fase3:rz", rev: 1 },
  ];
  const l = layoutRuns([r], { nos, arestas: [] }).nos;
  const por = (id: string) => l.find((x) => x.id === id)!;
  const f2 = por("fase2:rz");
  const w1 = por("worker:rz:1");
  assert.deepEqual([w1.x, w1.y, w1.w, w1.h], [f2.x + 24, f2.y + 24, 260, 64]);
  assert.equal(w1.dados.marca, 1, "dados salvos continuam mesclados");
  assert.deepEqual([por("pedido:rz").y, por("pedido:rz").w], [por("fase1:rz").y + 24, 300]);
  assert.deepEqual([por("gate:rz").y, por("gate:rz").w], [por("fase3:rz").y + 24, 420]);
  assert.equal(por("diff:rz").y, por("gate:rz").y + 220 + 32);
});

// Run de 4 slices (S1 ok, S2 ok, S3 rodando, S4 sem evento) — o cenario dos prints.
function run4(id: string, fim = false): Run {
  const sl = (idx: number, status: string): Msg => ({ swarm: id, ev: { t: "slice", idx, total: 4, tarefa: `t${idx}`, status, ts: T + idx } as never });
  const msgs: Msg[] = [
    { swarm: id, ev: { t: "run", feature: "f", cwd: "D:/p", total: 4, ts: T, plano: [1, 2, 3, 4].map((k) => ({ tarefa: `t${k}`, arquivos_alvo: [], descricao: "" })) } },
    sl(1, "ok"), sl(2, "ok"), sl(3, fim ? "ok" : "rodando"),
  ];
  if (fim) msgs.push(sl(4, "ok"), { swarm: id, ev: { t: "painel", status: "COMPLETE", branch: "b", linhas: [], ts: T + 9 } });
  return aplicar(vazio, msgs).runs[id];
}
const cardExp = (id: string): No => ({ id: `run:${id}`, tipo: "run", x: 0, y: 0, w: 280, h: 170, dados: { auto: true, runId: id, expandida: true }, rev: 1 });
const workerSalvo = (id: string, k: number, y: number, dados: Record<string, unknown>): No =>
  ({ id: `worker:${id}:${k}`, tipo: "worker", x: 999, y, w: 260, h: 64, dados: { auto: true, ...dados }, pai: `fase2:${id}`, rev: 1 });

/** Workers da run em ordem + a fase 2; confere coluna empilhada (GAP 32), mesmo x e fase envolvendo. */
function conferirColuna(l: No[], id: string): No[] {
  const ws = [1, 2, 3, 4].map((k) => l.find((n) => n.id === `worker:${id}:${k}`)!);
  const f2 = l.find((n) => n.id === `fase2:${id}`)!;
  assert.equal(ws[0].y, f2.y + 24);
  for (let k = 1; k < 4; k++) {
    assert.equal(ws[k].x, ws[0].x, `S${k + 1} na mesma coluna`);
    assert.equal(ws[k].y, ws[k - 1].y + ws[k - 1].h + 32, `S${k + 1} logo abaixo da S${k}`);
  }
  assert.ok(ws[3].y + ws[3].h + 24 <= f2.y + f2.h, "fase 2 envolve a ultima slice");
  return ws;
}

test("layoutRuns: cenario dos prints — posicoes velhas salvas nao sobrepoem nem abrem buraco (CA-1)", () => {
  const nos = [cardExp("rp"),
    workerSalvo("rp", 1, 100, { aberta: true, vivaNoClique: 3 }),
    workerSalvo("rp", 2, 200, { aberta: false, vivaNoClique: 3 }),
    workerSalvo("rp", 4, 5000, {})];
  const ws = conferirColuna(layoutRuns([run4("rp")], { nos, arestas: [] }).nos, "rp");
  assert.deepEqual(ws.map((w) => w.dados.aberta), [true, false, true, false], "S1 aberta pelo clique, S3 viva");
  assert.deepEqual(ws.map((w) => w.h), [380, 64, 380, 64]);
});

test("layoutRuns: varias abertas ao mesmo tempo empilham sem sobrepor (CA-2)", () => {
  const nos = [cardExp("rv"), ...[1, 2, 4].map((k) => workerSalvo("rv", k, 0, { aberta: true, vivaNoClique: 3 }))];
  const ws = conferirColuna(layoutRuns([run4("rv")], { nos, arestas: [] }).nos, "rv");
  assert.ok(ws.every((w) => w.dados.aberta === true && w.h === 380));
});

test("layoutRuns: clique so' vale com a mesma slice viva; trocou a viva, segue a viva (CA-3)", () => {
  const nos = [cardExp("rq"),
    workerSalvo("rq", 2, 0, { aberta: true, vivaNoClique: 2 }),   // abriu quando a S2 era a viva
    workerSalvo("rq", 3, 0, { aberta: false, vivaNoClique: 2 }),  // recolheu a S3 antes dela rodar
    workerSalvo("rq", 1, 0, { aberta: true })];                   // salvo antigo, sem vivaNoClique
  const ws = conferirColuna(layoutRuns([run4("rq")], { nos, arestas: [] }).nos, "rq");
  assert.deepEqual(ws.map((w) => w.dados.aberta), [false, false, true, false]);
});

test("layoutRuns: recolher a viva vale enquanto ela for a viva (CA-3)", () => {
  const nos = [cardExp("rr"), workerSalvo("rr", 3, 0, { aberta: false, vivaNoClique: 3 })];
  const ws = conferirColuna(layoutRuns([run4("rr")], { nos, arestas: [] }).nos, "rr");
  assert.deepEqual(ws.map((w) => w.dados.aberta), [false, false, false, false]);
});

test("layoutRuns: run terminada (sem viva = 0) recolhe tudo; clique feito depois do fim vale (CA-3)", () => {
  const nos = [cardExp("rt"),
    workerSalvo("rt", 3, 0, { aberta: true, vivaNoClique: 3 }),
    workerSalvo("rt", 2, 0, { aberta: true, vivaNoClique: 0 })];
  const ws = conferirColuna(layoutRuns([run4("rt", true)], { nos, arestas: [] }).nos, "rt");
  assert.deepEqual(ws.map((w) => w.dados.aberta), [false, true, false, false]);
});

test("layoutAgentes: so planejadores sem no' no canvas, em coluna (CA-5b)", () => {
  const ags = [
    { id: "plan-a", origem: "planejador" as const },
    { id: "plan-b", origem: "planejador" as const },
    { id: "plan-c", origem: "planejador" as const },
    { id: "ag-1", origem: "canvas" as const },
  ];
  const snap: Snapshot = { nos: [{ id: "ag:plan-c", tipo: "agente", x: 0, y: 0, w: 1, h: 1, dados: { agenteId: "plan-c", oculto: true }, rev: 1 }], arestas: [] };
  const l = layoutAgentes(ags, snap);
  assert.deepEqual(l.map((n) => n.id), ["ag:plan-a", "ag:plan-b"], "oculto e canvas ficam de fora");
  assert.equal(l[0].x, l[1].x);
  assert.ok(l[1].y >= l[0].y + l[0].h);
  assert.deepEqual(l[0].dados, { agenteId: "plan-a" });
  assert.equal(l[0].tipo, "agente");
  assert.ok(l[0].w >= 500 && l[0].h >= 300, "terminal grande como no Castor");
});

