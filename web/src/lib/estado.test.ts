import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, alerta, kpis, porProjeto, projetoDe, progresso, statusVisivel, parseDiff, vazio, type Msg } from "./estado.ts";

const T0 = 1_000_000;
const run = (id: string, cwd: string, ts = T0): Msg => ({ swarm: id, ev: { t: "run", feature: "f-" + id, cwd, total: 2, ts, plano: [
  { tarefa: "a", arquivos_alvo: ["x.luau"], descricao: "faz a" }, { tarefa: "b", arquivos_alvo: [], descricao: "faz b" },
] } });

test("runs nunca se misturam e o painel de uma nao vaza pra outra (CA-11)", () => {
  let e = aplicar(vazio, [run("r1", "D:/p/Roblox"), { swarm: "r1", ev: { t: "painel", status: "COMPLETE", branch: "b1", linhas: [], ts: T0 + 5 } }]);
  e = aplicar(e, [run("r2", "D:/p/Roblox", T0 + 10)]);
  assert.equal(e.runs.r1.status, "COMPLETE");
  assert.equal(e.runs.r2.status, "rodando");
  assert.equal(e.runs.r2.feature, "f-r2");
  assert.equal(e.runs.r2.metricas.length, 0);
});

test("slice carrega o plano e o progresso conta ok/incompleta/pulada", () => {
  const e = aplicar(vazio, [
    run("r", "D:/p/X"),
    { swarm: "r", ev: { t: "slice", idx: 1, total: 2, tarefa: "a", status: "incompleta", motivo: "erro", ts: T0 + 1 } },
    { swarm: "r", ev: { t: "slice", idx: 2, total: 2, tarefa: "b", status: "pulada", motivo: "slice 1 falhou", ts: T0 + 2 } },
  ]);
  assert.equal(e.runs.r.slices[0].plano?.descricao, "faz a");
  assert.deepEqual(progresso(e.runs.r), { feitas: 2, total: 2 });
});

test("alerta: sem resposta > 60s acende; comando rodando nao acende ate o timeout (CA-10)", () => {
  let e = aplicar(vazio, [run("r", "D:/p/X")]);
  assert.equal(alerta(e.runs.r, T0 + 30_000), null);
  assert.match(alerta(e.runs.r, T0 + 61_000) ?? "", /sem resposta há 61s/);
  e = aplicar(e, [{ swarm: "r", ev: { t: "comando", slice: 1, cmd: "lune run tests/s1", status: "rodando", ts: T0 + 1000 } }]);
  assert.equal(alerta(e.runs.r, T0 + 100_000), null, "teste legitimo rodando");
  assert.match(alerta(e.runs.r, T0 + 130_000) ?? "", /além do timeout/);
  e = aplicar(e, [{ swarm: "r", ev: { t: "tool", slice: 1, nome: "rodar_comando", alvo: "x", ok: true, ts: T0 + 131_000 } }]);
  assert.equal(e.runs.r.atividade, null, "comando terminou");
});

test("gerando vira atividade; painel encerra; run sem painel ha 10min = INTERROMPIDA", () => {
  let e = aplicar(vazio, [run("r", "D:/p/X"), { swarm: "r", ev: { t: "gerando", slice: 1, tokens: 900, ts: T0 + 5 } }]);
  assert.deepEqual(e.runs.r.atividade, { tipo: "gerando", slice: 1, tokens: 900, ts: T0 + 5 });
  assert.equal(statusVisivel(e.runs.r, T0 + 11 * 60_000), "INTERROMPIDA");
  e = aplicar(e, [{ swarm: "r", ev: { t: "painel", status: "CANCELED", branch: "b", linhas: ["x"], ts: T0 + 6 } }]);
  assert.equal(e.runs.r.atividade, null);
  assert.equal(statusVisivel(e.runs.r, T0 + 11 * 60_000), "CANCELED");
  assert.equal(alerta(e.runs.r, T0 + 11 * 60_000), null);
});

test("kpis e agrupamento por projeto (mais novo primeiro)", () => {
  const met = (slice: number, primeira: boolean, amb: number): Msg => ({ swarm: "a", ev: {
    t: "metrica", slice, iteracoes: primeira ? 0 : 2, passouDePrimeira: primeira, tocouNoTeste: 0, falhasAmbiente: amb,
    tokensIn: 100, tokensOut: 50, custoUSD: 0.01, ts: T0 } });
  const e = aplicar(vazio, [run("a", "D:/p/Roblox", T0), met(1, true, 0), met(2, false, 1), run("b", "D:/p/Central", T0 + 50), run("c", "D:\\p\\Roblox", T0 + 20)]);
  const k = kpis(e.runs.a);
  assert.equal(k.passouDePrimeira, 0.5);
  assert.equal(k.mediaIteracoes, 1);
  assert.equal(k.falhasAmbiente, 1);
  assert.ok(Math.abs(k.custo - 0.02) < 1e-9);
  const g = porProjeto(e);
  assert.deepEqual(g.map((x) => x.projeto), ["Central", "Roblox"]);
  assert.deepEqual(g[1].runs.map((x) => x.id), ["c", "a"], "barra invertida = mesma pasta; mais nova primeiro");
});

test("drop remove a run", () => {
  const e = aplicar(aplicar(vazio, [run("r", "D:/p/X")]), [{ swarm: "r", drop: true }]);
  assert.equal(e.runs.r, undefined);
});

test("parseDiff numera linhas antigas e novas", () => {
  const p = "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n";
  const l = parseDiff(p);
  assert.deepEqual(l.filter((x) => x.tipo !== "meta").map((x) => [x.tipo, x.velha, x.nova]), [
    ["hunk", undefined, undefined], ["ctx", 1, 1], ["rem", 2, undefined], ["add", undefined, 2], ["ctx", 3, 3],
  ]);
});

test("worktree do Claude Code vira o nome do projeto e agrupa com ele", () => {
  assert.equal(projetoDe("D:\\p\\Roblox\\.claude\\worktrees\\f2-902b41\\"), "Roblox");
  const e = aplicar(vazio, [run("a", "D:\\p\\Roblox", T0), run("b", "D:/p/Roblox/.claude/worktrees/wt-1", T0 + 10)]);
  const g = porProjeto(e);
  assert.deepEqual(g.map((x) => x.projeto), ["Roblox"]);
  assert.deepEqual(g[0].runs.map((x) => x.id), ["b", "a"]);
});
