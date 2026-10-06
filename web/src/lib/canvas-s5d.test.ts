// Spec da S5d (F2): filtro das runs de UM projeto pro canvas automatico.
// A run pertence ao projeto quando a RAIZ do cwd bate (worktree conta como o projeto), comparando a
// grafia canonica (separadores, barra final e caixa indiferentes) — mesma regra do grupo do useCanvas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, runsDoProjeto, type Msg, type Run } from "./estado.ts";

const T = 1_000_000;

function runDe(id: string, cwd: string, ts = T): Run {
  const msgs: Msg[] = [
    {
      swarm: id,
      ev: { t: "run", feature: "f-" + id, cwd, total: 1, ts, plano: [{ tarefa: "x", arquivos_alvo: [], descricao: "" }] },
    },
  ];
  return aplicar(vazio, msgs).runs[id];
}

test("runsDoProjeto: mesma raiz (grafia, barra final e worktree contam como o projeto)", () => {
  const runs = [
    runDe("a", "D:/Proj", T),
    runDe("b", "D:\\Proj\\.claude\\worktrees\\feat", T + 1),
    runDe("c", "d:/proj/", T + 2),
    runDe("d", "D:/Outro", T + 3),
  ];
  assert.deepEqual(runsDoProjeto(runs, "D:/Proj").map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(runsDoProjeto(runs, "D:\\Proj").map((r) => r.id).sort(), ["a", "b", "c"]);
  assert.deepEqual(runsDoProjeto(runs, "D:/Outro").map((r) => r.id), ["d"]);
  assert.deepEqual(runsDoProjeto(runs, "D:/Nada"), []);
});
