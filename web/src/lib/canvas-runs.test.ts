// Spec da S4 (F2): layout automatico de runs e agentes no canvas (CA-4b, 5b, 11b, 13a, 15).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { fluxoDoPlano, layoutRuns, layoutAgentes, linhasDoWorker } from "./layout.ts";
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

test("fluxoDoPlano: Inicio -> slices -> Gate -> Pronto com cor por status (CA-11b)", () => {
  const r = runDe("r1", [
    { swarm: "r1", ev: { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "ok", ts: T + 1 } },
    { swarm: "r1", ev: { t: "slice", idx: 2, total: 2, tarefa: "tela", status: "rodando", ts: T + 2 } },
  ]);
  const f = fluxoDoPlano(r);
  assert.deepEqual(f.nos.map((n) => n.id), ["flow:r1:inicio", "flow:r1:1", "flow:r1:2", "flow:r1:gate", "flow:r1:fim"]);
  assert.deepEqual(f.nos.map((n) => n.forma), ["elipse", "retangulo", "retangulo", "losango", "elipse"]);
  assert.deepEqual(f.nos.map((n) => n.cor), ["verde", "verde", "azul", "amarelo", "cinza"]);
  assert.deepEqual(f.nos.map((n) => n.texto), ["Início", "modelo", "tela", "Gate", "Pronto"]);
  assert.deepEqual(f.arestas.map((a) => [a.de, a.para]), [
    ["flow:r1:inicio", "flow:r1:1"], ["flow:r1:1", "flow:r1:2"], ["flow:r1:2", "flow:r1:gate"], ["flow:r1:gate", "flow:r1:fim"],
  ]);
});

test("fluxoDoPlano: slice ruim fica vermelha; gate e fim acompanham o resultado (CA-11b)", () => {
  const falhou = runDe("r2", [
    { swarm: "r2", ev: { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "incompleta", motivo: "x", ts: T + 1 } },
    { swarm: "r2", ev: { t: "slice", idx: 2, total: 2, tarefa: "tela", status: "pulada", ts: T + 2 } },
    { swarm: "r2", ev: { t: "gate", cmd: "npm test", status: "falha", ts: T + 3 } },
  ]);
  assert.deepEqual(fluxoDoPlano(falhou).nos.map((n) => n.cor), ["verde", "vermelho", "vermelho", "vermelho", "cinza"]);
  const ok = runDe("r3", [
    { swarm: "r3", ev: { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "ok", ts: T + 1 } },
    { swarm: "r3", ev: { t: "slice", idx: 2, total: 2, tarefa: "tela", status: "ok", ts: T + 2 } },
    { swarm: "r3", ev: { t: "gate", cmd: "npm test", status: "ok", ts: T + 3 } },
    { swarm: "r3", ev: { t: "painel", status: "COMPLETE", branch: "b", linhas: [], ts: T + 4 } },
  ]);
  assert.deepEqual(fluxoDoPlano(ok).nos.map((n) => n.cor), ["verde", "verde", "verde", "verde", "verde"]);
  const fila = runDe("r4");
  assert.deepEqual(fluxoDoPlano(fila).nos.map((n) => n.cor), ["verde", "cinza", "cinza", "amarelo", "cinza"], "slices do plano sem evento = fila");
});

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

test("layoutRuns: expandida gera regiao a direita com fluxo, workers e arquivos ligados (CA-4b, 13a, 15)", () => {
  const r = runDe("rx", [
    { swarm: "rx", ev: { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "ok", escritos: ["src/a.ts"], ts: T + 1 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "src/a.ts", patch: "@@", ts: T + 2 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "README.md", patch: "@@", ts: T + 3 } },
  ]);
  const salvo: No = { id: "run:rx", tipo: "run", x: 100, y: 50, w: 280, h: 110, dados: { auto: true, runId: "rx", expandida: true, vista: "fluxo", movido: true }, rev: 1 };
  const l = layoutRuns([r], { nos: [salvo], arestas: [] });
  const ids = l.nos.map((n) => n.id);
  const card = l.nos.find((n) => n.id === "run:rx")!;
  assert.deepEqual([card.x, card.y], [100, 50], "posicao salva vence");
  const reg = l.nos.find((n) => n.id === "reg:rx")!;
  assert.equal(reg.tipo, "grupo");
  assert.ok(reg.x >= card.x + card.w, "regiao a direita do card");
  for (const id of ["flow:rx:inicio", "flow:rx:1", "flow:rx:2", "flow:rx:gate", "flow:rx:fim", "worker:rx:1", "worker:rx:2", "arq:rx:src/a.ts", "arq:rx:README.md"]) {
    assert.ok(ids.includes(id), id);
    assert.equal(l.nos.find((n) => n.id === id)!.pai, "reg:rx", "filho da regiao: " + id);
  }
  assert.equal(l.nos.find((n) => n.id === "worker:rx:1")!.tipo, "worker");
  assert.deepEqual(l.nos.find((n) => n.id === "arq:rx:src/a.ts")!.dados, { auto: true, runId: "rx", arquivo: "src/a.ts" });
  const liga = (de: string, para: string) => l.arestas.some((e) => e.de === de && e.para === para);
  assert.ok(liga("worker:rx:1", "arq:rx:src/a.ts"), "arquivo ligado a slice que o escreveu");
  assert.ok(liga("run:rx", "arq:rx:README.md"), "arquivo sem slice liga na run");
  assert.ok(liga("run:rx", "flow:rx:inicio"));
  assert.ok(liga("flow:rx:1", "worker:rx:1"), "slice do fluxo liga no seu worker");
});

test("layoutRuns: posicoes salvas dos filhos vencem (CA-11b)", () => {
  const r = runDe("rz");
  const nos: No[] = [
    { id: "run:rz", tipo: "run", x: 0, y: 0, w: 280, h: 110, dados: { auto: true, runId: "rz", expandida: true, vista: "fluxo" }, rev: 1 },
    { id: "flow:rz:1", tipo: "forma", x: 777, y: 888, w: 160, h: 80, dados: { auto: true }, pai: "reg:rz", rev: 1 },
  ];
  const n = layoutRuns([r], { nos, arestas: [] }).nos.find((x) => x.id === "flow:rz:1")!;
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

test("linhasDoWorker: eventos da slice, erros marcados, atividade atual por ultimo (CA-4b)", () => {
  const r = runDe("rw", [
    { swarm: "rw", ev: { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "rodando", ts: T + 1 } },
    { swarm: "rw", ev: { t: "tool", slice: 1, nome: "ler_arquivo", alvo: "a.ts", ok: true, ts: T + 2 } },
    { swarm: "rw", ev: { t: "tool", slice: 2, nome: "outro", ok: true, ts: T + 3 } },
    { swarm: "rw", ev: { t: "tool", slice: 1, nome: "rodar_comando", alvo: "npm test", ok: false, resumo: "exit 1", ts: T + 4 } },
    { swarm: "rw", ev: { t: "gerando", slice: 1, tokens: 1234, ts: T + 5 } },
  ]);
  const l = linhasDoWorker(r, 1);
  assert.deepEqual(l.map((x) => [x.texto, x.erro]), [
    ["Slice 1/2: modelo", false],
    ["ler_arquivo a.ts", false],
    ["rodar_comando npm test — exit 1", true],
    ["→ gerando 1234 tokens…", false],
  ]);
  assert.deepEqual(linhasDoWorker(r, 2).map((x) => x.texto), ["outro"]);
});
