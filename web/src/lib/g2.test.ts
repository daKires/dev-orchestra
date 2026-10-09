// Spec da G2 (front): aresta planejador->run, aresta de pedido animada so' enquanto a run nao acabou,
// e o "+ Feature" so' cria com planejador + modelo escolhidos (CA-G2a, b, e).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, podeCriarComPlanejador, type Msg, type Run } from "./estado.ts";
import { arestasPlanejadorRun, pedidoAtivo } from "./layout.ts";

const T = 1_000_000;
function runEm(id: string, cwd: string, fim?: string): Run {
  const msgs: Msg[] = [{ swarm: id, ev: { t: "run", feature: "f", cwd, total: 1, ts: T } }];
  if (fim) msgs.push({ swarm: id, ev: { t: "painel", status: fim, branch: "b", linhas: [], ts: T + 9 } });
  return aplicar(vazio, msgs).runs[id];
}

test("arestasPlanejadorRun: a run nascida no cwd do planejador ganha aresta ag:<planejador> -> run:<id> (CA-G2b)", () => {
  const plans = [{ agId: "ag:p1", cwd: "D:\\Proj\\.claude\\worktrees\\pdf" }, { agId: "ag:p2", cwd: "D:/outro" }];
  const runs = [runEm("r1", "d:/proj/.claude/worktrees/pdf/"), runEm("r2", "D:\\sem-planejador"), runEm("r3", "D:/Proj/.claude/worktrees/pdf")];
  const a = arestasPlanejadorRun(plans, runs);
  assert.deepEqual(a.map((x) => [x.de, x.para]).sort(), [["ag:p1", "run:r1"], ["ag:p1", "run:r3"]]);
  assert.ok(a.every((x) => x.id === `${x.de}->${x.para}`));
});

test("pedidoAtivo: anima enquanto o planejador planeja ou a run roda; para quando a run tem painel (CA-G2e)", () => {
  const cwd = "D:/p/.claude/worktrees/x";
  assert.equal(pedidoAtivo(cwd, []), true, "ainda planejando (sem run)");
  assert.equal(pedidoAtivo(cwd, [runEm("r1", cwd)]), true, "run rodando");
  assert.equal(pedidoAtivo(cwd, [runEm("r1", cwd, "COMPLETE")]), false, "acabou");
  assert.equal(pedidoAtivo(cwd, [runEm("r1", cwd, "CANCELED")]), false, "qualquer final para");
  assert.equal(pedidoAtivo(cwd, [runEm("r9", "D:/outro", "COMPLETE")]), true, "run de outro cwd nao conta");
});

test("podeCriarComPlanejador: sem escolha nao cria; claude ''|opus|sonnet|haiku; opencode provider/modelo (CA-G2a)", () => {
  assert.equal(podeCriarComPlanejador("D:\\p", "f"), false, "sem planejador escolhido");
  assert.equal(podeCriarComPlanejador("D:\\p", "f", { planejador: "claude", modelo: "" }), true, "padrao escolhido explicitamente");
  assert.equal(podeCriarComPlanejador("D:\\p", "f", { planejador: "claude", modelo: "sonnet" }), true);
  assert.equal(podeCriarComPlanejador("D:\\p", "f", { planejador: "claude", modelo: "gpt-9" }), false);
  assert.equal(podeCriarComPlanejador("D:\\p", "f", { planejador: "opencode", modelo: "opencode-go/glm-5.2" }), true);
  assert.equal(podeCriarComPlanejador("D:\\p", "f", { planejador: "opencode", modelo: "" }), false);
  assert.equal(podeCriarComPlanejador("D:\\p", "  ", { planejador: "claude", modelo: "opus" }), false, "feature vazia");
});
