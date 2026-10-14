// Spec da S4 (F2): layout automatico de runs e agentes no canvas (CA-4b, 5b, 11b, 13a, 15).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { layoutRuns, layoutAgentes } from "./layout.ts";
import type { No, Snapshot } from "../../../canvas.ts";

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

test("layoutRuns: posicoes salvas dos filhos vencem (CA-11b)", () => {
  const r = runDe("rz");
  const nos: No[] = [
    { id: "run:rz", tipo: "run", x: 0, y: 0, w: 280, h: 170, dados: { auto: true, runId: "rz", expandida: true }, rev: 1 },
    { id: "worker:rz:1", tipo: "worker", x: 777, y: 888, w: 260, h: 64, dados: { auto: true }, pai: "fase2:rz", rev: 1 },
  ];
  const n = layoutRuns([r], { nos, arestas: [] }).nos.find((x) => x.id === "worker:rz:1")!;
  assert.deepEqual([n.x, n.y], [777, 888]);
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

