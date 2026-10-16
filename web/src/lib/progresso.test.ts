// Spec S3: o total de slices e' o maior entre o plano e as slices ja' vistas (CA-8: "2/4", nao "2/3").
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, progresso, vazio, type Msg } from "./estado.ts";

const plano = (n: number) => Array.from({ length: n }, (_, i) => ({ tarefa: `t${i + 1}`, arquivos_alvo: [], descricao: "" }));
type Ev = Record<string, unknown>;
const run = (n: number, extra: Ev[]): Msg[] => [
  { swarm: "r", ev: { t: "run", feature: "f", cwd: "D:/p", total: n, ts: 1, plano: plano(n) } },
  ...extra.map((ev) => ({ swarm: "r", ev }) as Msg),
];
const slice = (idx: number, status: string) => ({ t: "slice", idx, total: 4, tarefa: `t${idx}`, status, ts: 2 + idx }) as Ev;

test("plano de 4 com 3 slices vistas (ok, ok, rodando): 2/4", () => {
  const e = aplicar(vazio, run(4, [slice(1, "ok"), slice(2, "ok"), slice(3, "rodando")]));
  assert.deepEqual(progresso(e.runs.r), { feitas: 2, total: 4 });
});

test("sem nenhuma slice ainda: 0/4", () => {
  assert.deepEqual(progresso(aplicar(vazio, run(4, [])).runs.r), { feitas: 0, total: 4 });
});

test("mais slices vistas que o plano (plano antigo): conta as vistas", () => {
  const e = aplicar(vazio, run(1, [slice(1, "ok"), slice(2, "ok")]));
  assert.deepEqual(progresso(e.runs.r), { feitas: 2, total: 2 });
});
