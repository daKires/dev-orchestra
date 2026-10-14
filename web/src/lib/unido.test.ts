// Spec da tela unida (Run A): funcoes puras da sidebar, do painel e da 1a abertura (CA-2, 5, 8, 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { agentesDoPool, badgesArquivos, projetoInicial, runAtiva, runDaSelecao } from "./unido.ts";

const T = 1_000_000;
const ev = (id: string, e: object): Msg => ({ swarm: id, ev: e } as Msg);
function run(id: string, cwd: string, ts: number, fim?: string): Run {
  const msgs: Msg[] = [ev(id, { t: "run", feature: "f-" + id, cwd, total: 1, ts })];
  if (fim) msgs.push(ev(id, { t: "painel", status: fim, branch: "b", linhas: [], ts: ts + 1 }));
  return aplicar(vazio, msgs).runs[id];
}

test("badgesArquivos: A para arquivo novo, M para modificado; sem run = vazio (CA-5)", () => {
  const r = aplicar(vazio, [
    ev("r", { t: "run", feature: "f", cwd: "D:/p", total: 1, ts: T }),
    ev("r", { t: "diff", arquivo: "src/novo.ts", patch: "diff --git a/src/novo.ts b/src/novo.ts\nnew file mode 100644\n--- /dev/null\n+++ b/src/novo.ts\n@@ -0,0 +1 @@\n+x", ts: T + 1 }),
    ev("r", { t: "diff", arquivo: "src\\velho.ts", patch: "--- a/src/velho.ts\n+++ b/src/velho.ts\n@@ -1 +1 @@\n-a\n+b", ts: T + 2 }),
  ]).runs.r;
  const b = badgesArquivos(r);
  assert.equal(b.get("src/novo.ts"), "A");
  assert.equal(b.get("src/velho.ts"), "M", "caminho normalizado com '/'");
  assert.equal(b.size, 2);
  assert.equal(badgesArquivos(null).size, 0);
});

test("runAtiva: a rodando mais recente; senao a mais recente; vazio = null (CA-9, 13)", () => {
  const velhaRodando = run("a", "D:/p", T);
  const novaTerminada = run("b", "D:/p", T + 100, "COMPLETE");
  const novaRodando = run("c", "D:/p", T + 50);
  const agora = T + 200;
  assert.equal(runAtiva([velhaRodando, novaTerminada, novaRodando], agora)?.id, "c");
  assert.equal(runAtiva([novaTerminada, run("d", "D:/p", T, "GATE-FAILED")], agora)?.id, "b");
  assert.equal(runAtiva([], agora), null);
});

test("projetoInicial: salvo vence; senao a raiz da run ativa (worktree vira raiz); sem nada = null (CA-2)", () => {
  const r = run("w", "D:/proj/.claude/worktrees/x", T);
  assert.equal(projetoInicial("D:/outro", [r], T + 1), "D:/outro");
  assert.equal(projetoInicial(null, [r], T + 1), "D:/proj");
  assert.equal(projetoInicial("", [r], T + 1), "D:/proj");
  assert.equal(projetoInicial(null, [], T + 1), null);
});

test("runDaSelecao: 1 no' de run (dados.runId ou id fase/gate/pedido/run) -> runId; resto -> null (CA-9)", () => {
  assert.equal(runDaSelecao([{ id: "worker:r1:2", dados: { runId: "r1", idx: 2 } }]), "r1");
  assert.equal(runDaSelecao([{ id: "arq:r1:a.ts", dados: { runId: "r1" } }]), "r1");
  assert.equal(runDaSelecao([{ id: "run:r9", dados: {} }]), "r9");
  for (const p of ["fase1", "fase2", "fase3", "gate", "pedido", "diff"]) {
    assert.equal(runDaSelecao([{ id: `${p}:r7`, dados: {} }]), "r7", p);
  }
  assert.equal(runDaSelecao([{ id: "nota1", dados: { titulo: "x" } }]), null, "no' do usuario");
  assert.equal(runDaSelecao([]), null, "nada selecionado");
  assert.equal(runDaSelecao([{ id: "run:a", dados: {} }, { id: "run:b", dados: {} }]), null, "2+ nos");
});

test("agentesDoPool: agentes do canvas (sem encerrados) + Swarm quando ha run rodando (CA-8)", () => {
  const ags = [
    { id: "c1", nome: "Claude", modelo: "opus", ocupado: true, status: "ok" },
    { id: "o1", nome: "OpenCode", modelo: "kimi", ocupado: false, status: "ok" },
    { id: "x", nome: "Velho", modelo: "m", ocupado: false, status: "encerrado" },
  ];
  const rod = run("s", "D:/p", T);
  const pool = agentesDoPool(ags, [rod, run("t", "D:/p", T - 10, "COMPLETE")], T + 1);
  assert.deepEqual(pool, [
    { id: "c1", nome: "Claude", modelo: "opus", executando: true, foco: "ag:c1" },
    { id: "o1", nome: "OpenCode", modelo: "kimi", executando: false, foco: "ag:o1" },
    { id: "swarm", nome: "Swarm", modelo: "", executando: true, foco: "run:s" },
  ]);
  assert.equal(agentesDoPool(ags, [run("t", "D:/p", T, "COMPLETE")], T + 1).some((a) => a.id === "swarm"), false);
});
