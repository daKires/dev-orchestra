// Spec do canvas com uma run por vez (CA-1, CA-2, CA-5, CA-6).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { layoutRuns, semOutrasRuns } from "./layout.ts";
import { runEmFoco, runsNovas } from "./unido.ts";
import type { No } from "../../../src/canvas.ts";

const T = 1_000_000;
function runDe(id: string, ts = T, fim = true): Run {
  const msgs: Msg[] = [{ swarm: id, ev: { t: "run", feature: "f-" + id, cwd: "D:/p", total: 1, ts, plano: [
    { tarefa: "a", arquivos_alvo: [], descricao: "" },
  ] } }];
  if (fim) msgs.push({ swarm: id, ev: { t: "painel", status: "COMPLETE", branch: "b", linhas: [], ts: ts + 10 } });
  return aplicar(vazio, msgs).runs[id];
}
const no = (id: string, dados: Record<string, unknown>): No => ({ id, tipo: "nota", x: 0, y: 0, w: 10, h: 10, dados, rev: 1 });

test("runEmFoco: a escolhida vence; invalida cai pra ativa; sem ativa a mais recente; vazio = null (CA-2)", () => {
  const velha = runDe("a", T), nova = runDe("b", T + 1000), viva = runDe("c", T + 500, false);
  assert.equal(runEmFoco([velha, nova], "a", T + 2000)?.id, "a");
  assert.equal(runEmFoco([velha, nova, viva], "sumiu", T + 2000)?.id, "c");
  assert.equal(runEmFoco([velha, nova], null, T + 2000)?.id, "b");
  assert.equal(runEmFoco([], "a", T), null);
});

test("semOutrasRuns: tira os nos automaticos de outras runs e mantem o resto (CA-1)", () => {
  const nos = [
    no("run:A", { auto: true, runId: "A" }), no("worker:A:1", { auto: true, runId: "A" }),
    no("run:B", { auto: true, runId: "B" }), no("fase2:B", { auto: true, runId: "B" }), no("worker:B:1", { auto: true, runId: "B" }),
    no("nota-1", { texto: "minha" }), no("ag:x", { agenteId: "x" }),
  ];
  assert.deepEqual(semOutrasRuns(nos, "A").map((n) => n.id), ["run:A", "worker:A:1", "nota-1", "ag:x"]);
  assert.deepEqual(semOutrasRuns(nos, null).map((n) => n.id), ["nota-1", "ag:x"]);
});

test("layoutRuns com so' a run em foco gera nos apenas dela; planejador do cwd vai pra fase 1 dela (CA-1, CA-5)", () => {
  const a = runDe("A");
  const snap = { nos: [{ ...no("run:A", { auto: true, runId: "A", expandida: true }), tipo: "run" as const }], arestas: [] };
  const l = layoutRuns([a], snap, T, [{ agId: "ag:p", cwd: "d:\\p\\" }, { agId: "ag:q", cwd: "D:/outro" }]);
  assert.ok(l.nos.every((n) => n.id.endsWith(":A") || n.id.includes(":A:")), l.nos.map((n) => n.id).join(","));
  assert.deepEqual(l.agentes.map((g) => [g.id, g.pai]), [["ag:p", "fase1:A"]]);
});

test("runsNovas: nao vistas e fora do foco brilham; vistas null = nenhuma (CA-6)", () => {
  const runs = [runDe("a"), runDe("b"), runDe("c")];
  assert.deepEqual([...runsNovas(runs, ["a"], "b")], ["c"]);
  assert.deepEqual([...runsNovas(runs, ["a", "b", "c"], null)], []);
  assert.deepEqual([...runsNovas(runs, null, null)], []);
});
