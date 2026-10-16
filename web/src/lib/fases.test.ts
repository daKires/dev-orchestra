// Spec da Run B: run expandida em 3 fases, pipeline do card da run e resumo do gate (CA-15 a 19).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { layoutRuns, pipelineDaRun, resumoGate } from "./layout.ts";
import type { No, Snapshot } from "../../../src/canvas.ts";

const T = 1_000_000;
const ev = (id: string, e: object): Msg => ({ swarm: id, ev: { ts: T + 1, ...e } } as Msg);
function runDe(id: string, extra: object[] = [], ts = T, n = 2, cwd = "D:/p"): Run {
  const plano = Array.from({ length: n }, (_, i) => ({ tarefa: "t" + (i + 1), arquivos_alvo: [], descricao: "" }));
  const msgs: Msg[] = [{ swarm: id, ev: { t: "run", feature: "f-" + id, cwd, total: n, ts, plano } } as Msg];
  return aplicar(vazio, [...msgs, ...extra.map((e) => ev(id, e))]).runs[id];
}
const vazioS: Snapshot = { nos: [], arestas: [] };
const expandida = (id: string): Snapshot => ({
  nos: [{ id: "run:" + id, tipo: "run", x: 0, y: 0, w: 280, h: 170, dados: { auto: true, runId: id, expandida: true }, rev: 1 }],
  arestas: [],
});
const dentro = (f: No, p: No) => f.x >= p.x && f.y >= p.y && f.x + f.w <= p.x + p.w && f.y + f.h <= p.y + p.h;

test("run expandida: 3 fases lado a lado, na altura do card, com titulo e sem regiao antiga (CA-15)", () => {
  const l = layoutRuns([runDe("r")], vazioS); // ativa: abre sozinha
  const no = (id: string) => l.nos.find((n) => n.id === id)!;
  const card = no("run:r"), f = [1, 2, 3].map((k) => no(`fase${k}:r`));
  assert.ok(f.every((x) => x && x.tipo === "grupo"), "3 grupos de fase");
  assert.deepEqual(f.map((x) => x.dados.fase), [1, 2, 3]);
  assert.deepEqual(f.map((x) => x.dados.titulo), ["FASE 1 · PLANEJAMENTO", "FASE 2 · EXECUÇÃO DO SWARM", "FASE 3 · GATE E ENTREGA"]);
  assert.ok(f[0].x >= card.x + card.w, "fase 1 a direita do card");
  assert.ok(f[0].x + f[0].w <= f[1].x && f[1].x + f[1].w <= f[2].x, "lado a lado sem sobrepor");
  assert.ok(f.every((x) => x.y === card.y), "mesma altura do card");
  assert.ok(!l.nos.some((n) => n.id.startsWith("reg:") || n.id.startsWith("flow:") || n.id.startsWith("arq:")), "sem reg/flow/arq de run");
  const recolhida = layoutRuns([runDe("q", [{ t: "painel", status: "COMPLETE", branch: "b", linhas: [] }])], vazioS);
  assert.ok(!recolhida.nos.some((n) => n.id.startsWith("fase")), "terminada recolhida: so' o card");
});

test("conteudo das fases: pedido na 1, slices em coluna na 2, gate e diff na 3; todos dentro do pai (CA-16, 17, 18)", () => {
  const r = runDe("r", [
    { t: "slice", idx: 1, total: 2, tarefa: "t1", status: "ok", escritos: ["a.ts"] },
    { t: "diff", arquivo: "a.ts", patch: "@@" },
  ]);
  const l = layoutRuns([r], expandida("r"));
  const no = (id: string) => l.nos.find((n) => n.id === id)!;
  assert.equal(no("pedido:r").tipo, "pedido");
  assert.equal(no("pedido:r").pai, "fase1:r");
  const s = [1, 2].map((k) => no(`worker:r:${k}`));
  assert.ok(s.every((x) => x.pai === "fase2:r") && s[0].x === s[1].x && s[0].y + s[0].h <= s[1].y, "coluna na fase 2");
  assert.equal(no("gate:r").tipo, "gate");
  assert.equal(no("diff:r").tipo, "diff");
  assert.ok(no("gate:r").pai === "fase3:r" && no("diff:r").pai === "fase3:r");
  assert.ok(no("diff:r").y >= no("gate:r").y + no("gate:r").h, "diff abaixo do gate");
  for (const n of l.nos.filter((x) => x.pai)) assert.ok(dentro(n, no(n.pai!)), `${n.id} dentro de ${n.pai}`);
  for (const id of ["pedido:r", "gate:r", "diff:r"]) assert.deepEqual(no(id).dados, { auto: true, runId: "r" }, id);
});

test("arestas: pedido->run, run->slices, ultima slice->gate, gate->diff; sem slices run->gate (CA-15)", () => {
  const liga = (l: ReturnType<typeof layoutRuns>, de: string, para: string) => l.arestas.some((a) => a.de === de && a.para === para);
  const l = layoutRuns([runDe("r")], vazioS);
  for (const [de, para] of [["pedido:r", "run:r"], ["run:r", "worker:r:1"], ["run:r", "worker:r:2"], ["worker:r:2", "gate:r"], ["gate:r", "diff:r"]]) {
    assert.ok(liga(l, de, para), `${de} -> ${para}`);
  }
  const z = layoutRuns([runDe("z", [], T, 0)], expandida("z"));
  assert.ok(liga(z, "run:z", "gate:z"), "sem slices: run liga direto no gate");
});

test("planejador do mesmo cwd vai pra fase 1 da run mais recente expandida, abaixo do pedido (CA-16)", () => {
  const nova = runDe("n", [], T + 100), velha = runDe("v", [], T);
  const plans = [{ agId: "ag:p1", cwd: "d:\\p\\" }, { agId: "ag:outro", cwd: "D:/x" }];
  const l = layoutRuns([nova, velha], vazioS, undefined, plans);
  assert.equal(l.agentes.length, 1);
  const a = l.agentes[0];
  assert.equal(a.id, "ag:p1");
  assert.equal(a.pai, "fase1:n", "a mais recente daquele cwd");
  const f1 = l.nos.find((n) => n.id === "fase1:n")!, ped = l.nos.find((n) => n.id === "pedido:n")!;
  assert.ok(a.x >= f1.x && a.x + 620 <= f1.x + f1.w, "cabe na largura da fase 1 (card 620)");
  assert.ok(a.y >= ped.y + ped.h && a.y + 420 <= f1.y + f1.h, "abaixo do pedido e cabe na altura (card 420)");
  const fechada = layoutRuns([nova], { nos: [{ ...expandida("n").nos[0], dados: { auto: true, runId: "n", expandida: false } }], arestas: [] }, undefined, plans);
  assert.deepEqual(fechada.agentes, [], "run recolhida: planejador fica onde estava");
  assert.deepEqual(layoutRuns([nova], vazioS).agentes, [], "sem planejadores");
});

test("pipelineDaRun: pedido, plano, slices, gate e commit com status (CA-19)", () => {
  const r = runDe("p", [
    { t: "slice", idx: 1, total: 3, tarefa: "t1", status: "ok" },
    { t: "slice", idx: 2, total: 3, tarefa: "t2", status: "incompleta", motivo: "x" },
    { t: "slice", idx: 3, total: 3, tarefa: "t3", status: "rodando" },
    { t: "pausa", slice: 3, estado: "pausada" },
  ], T, 3);
  assert.deepEqual(pipelineDaRun(r), [
    { id: "pedido", rotulo: "Pedido", status: "ok" },
    { id: "plano", rotulo: "Plano", status: "ok" },
    { id: "s1", rotulo: "S1", status: "ok" },
    { id: "s2", rotulo: "S2", status: "falha" },
    { id: "s3", rotulo: "S3", status: "pausada" },
    { id: "gate", rotulo: "Gate", status: "fila" },
    { id: "commit", rotulo: "Commit", status: "fila" },
  ]);
  const ok = runDe("o", [
    { t: "slice", idx: 1, total: 1, tarefa: "t1", status: "ok" },
    { t: "gate", cmd: "npm test", status: "ok" },
    { t: "painel", status: "COMPLETE", branch: "b", linhas: [] },
  ], T, 1);
  assert.deepEqual(pipelineDaRun(ok).slice(-2).map((x) => x.status), ["ok", "ok"]);
  const falhou = runDe("f", [{ t: "gate", cmd: "npm test", status: "falha" }, { t: "painel", status: "GATE-FAILED", branch: "b", linhas: [] }], T, 0);
  assert.deepEqual(pipelineDaRun(falhou).map((x) => [x.id, x.status]), [["pedido", "ok"], ["plano", "rodando"], ["gate", "falha"], ["commit", "falha"]]);
  const vivo = runDe("g", [{ t: "gate", cmd: "npm test", status: "rodando" }], T, 0);
  assert.equal(pipelineDaRun(vivo).find((x) => x.id === "gate")!.status, "rodando");
});

test("resumoGate: so' a tentativa mais alta, na ordem dos gateCmds, com final e reparo (CA-18)", () => {
  assert.deepEqual(resumoGate(runDe("a")), { comandos: [], reparo: null, final: "aguardando" });
  const r = aplicar(vazio, [
    { swarm: "g", ev: { t: "run", feature: "f", cwd: "D:/p", total: 0, ts: T, plano: [], gate: ["npx tsc", "npm test"] } } as Msg,
    ev("g", { t: "gate", cmd: "npx tsc", status: "ok", saida: "ok0" }),
    ev("g", { t: "gate", cmd: "npm test", status: "falha", saida: "erro0" }),
    ev("g", { t: "gate", cmd: "npx tsc", status: "rodando", tentativa: 1 }),
    ev("g", { t: "gate", cmd: "npx tsc", status: "ok", tentativa: 1, saida: "ok1" }),
  ]).runs.g;
  r.gateCmds = ["npx tsc", "npm test"]; // garante a ordem configurada mesmo se o evento run nao a trouxer
  const g = resumoGate(r);
  assert.equal(g.reparo, 1);
  assert.deepEqual(g.comandos, [
    { cmd: "npx tsc", status: "ok", saida: "ok1" },
    { cmd: "npm test", status: "fila", saida: "" },
  ], "tentativa 1: npm test ainda nao rodou");
  assert.equal(g.final, "rodando", "tentativa em andamento (comando na fila)");
  r.gate.push({ t: "gate", cmd: "npm test", status: "ok", tentativa: 1, saida: "ok1" } as Run["gate"][number]);
  assert.equal(resumoGate(r).final, "ok");
  r.gate.push({ t: "gate", cmd: "npm test", status: "falha", tentativa: 2, saida: "x" } as Run["gate"][number]);
  const f = resumoGate(r);
  assert.deepEqual([f.reparo, f.final], [2, "falha"]);
});
