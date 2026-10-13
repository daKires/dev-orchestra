// Spec da G3 (front): o reducer marca a slice/run como pausada e poe instrucao/pausa no feed da slice;
// "pausada" nao conta como run terminada (CA-3, 4, 5, 6, 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg } from "./estado.ts";
import { feedDaSlice, pedidoAtivo } from "./layout.ts";

const T = 1_000_000;
const ID = "r1";
const base: Msg[] = [
  { swarm: ID, ev: { t: "run", feature: "f", cwd: "D:/p", total: 2, ts: T } },
  { swarm: ID, ev: { t: "slice", idx: 1, total: 2, tarefa: "a", status: "rodando", ts: T + 1 } },
];
const ev = (e: object): Msg => ({ swarm: ID, ev: e } as Msg);

test("pausa: slice e run ficam pausadas; retomada volta a rodando com o motivo no feed (CA-4, 5, 6)", () => {
  let e = aplicar(vazio, [...base, ev({ t: "pausa", slice: 1, estado: "pausada", ts: T + 2 })]);
  let r = e.runs[ID];
  assert.equal(r.status, "pausada");
  assert.equal(r.slices.find((s) => s.idx === 1)!.pausada, true);
  assert.equal(pedidoAtivo("D:/p", [r]), true, "pausada nao e' fim de run");
  e = aplicar(e, [ev({ t: "pausa", slice: 1, estado: "retomada", motivo: "teto de 30 min", ts: T + 3 })]);
  r = e.runs[ID];
  assert.equal(r.status, "rodando");
  assert.equal(r.slices.find((s) => s.idx === 1)!.pausada, false);
  const feed = feedDaSlice(r, 1).filter((l) => l.ferramenta === "pausa").map((l) => l.texto);
  assert.deepEqual(feed, ["pausada", "retomada: teto de 30 min"]);
});

test("instrucao entregue e descartada aparecem no feed da slice (CA-3, 9)", () => {
  const e = aplicar(vazio, [
    ...base,
    ev({ t: "instrucao", slice: 1, texto: "use fetch", ts: T + 2 }),
    ev({ t: "instrucao", slice: 1, texto: "tarde", descartada: true, ts: T + 3 }),
    ev({ t: "instrucao", slice: 2, texto: "de outra", ts: T + 4 }),
  ]);
  const feed = feedDaSlice(e.runs[ID], 1).filter((l) => l.ferramenta === "instrução").map((l) => [l.texto, l.erro]);
  assert.deepEqual(feed, [["use fetch", false], ["descartada (slice terminou) · tarde", true]]);
});

test("run que termina depois de pausada fica com o status do painel (CA-7)", () => {
  const e = aplicar(vazio, [
    ...base,
    ev({ t: "pausa", slice: 1, estado: "pausada", ts: T + 2 }),
    ev({ t: "painel", status: "CANCELED", branch: "b", linhas: [], ts: T + 3 }),
  ]);
  assert.equal(e.runs[ID].status, "CANCELED");
  assert.equal(pedidoAtivo("D:/p", [e.runs[ID]]), false);
});
