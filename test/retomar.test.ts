// Spec da retomada (CA-1..4, CA-6): run morta (sem painel, pid morto) no mesmo cwd+feature tem o
// prefixo de slices ok pulado na run nova; a morta ganha painel INTERROMPIDA.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const TMP = mkdtempSync(path.join(os.tmpdir(), "retomar-"));
process.env.DEV_ORCHESTRA_RUNS_DIR = path.join(TMP, "runs");
process.env.DEV_ORCHESTRA_AGENTES_DIR = path.join(TMP, "agentes");
process.env.DEV_ORCHESTRA_CANVAS_DIR = path.join(TMP, "canvas");
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = path.join(TMP, "plan");
// import dinamico: acharRunMorta/marcarInterrompida ainda nao existem no .d.ts
const S: any = await import("../dist/swarm.js");
const ui: any = await import("../dist/ui.js");

const CWD = "D:/proj/app";
const plano = [
  { tarefa: "A", arquivos_alvo: [], descricao: "a" },
  { tarefa: "B", arquivos_alvo: [], descricao: "b" },
  { tarefa: "C", arquivos_alvo: [], descricao: "c" },
];
const morto = () => false;
const vivo = () => true;

// eventos de uma run: status por slice (idx 1-based), painel opcional
function run(o: { feature?: string; cwd?: string; pid?: number | null; ts?: number; status: string[]; tarefas?: string[]; painel?: boolean; semMudancas?: boolean }) {
  const ts = o.ts ?? 1000;
  const tarefas = o.tarefas ?? plano.map((p) => p.tarefa);
  const evs: any[] = [{
    t: "run", feature: o.feature ?? "retomar run", cwd: o.cwd ?? CWD, total: tarefas.length,
    plano: tarefas.map((t) => ({ tarefa: t, arquivos_alvo: [], descricao: "" })), ts,
    ...(o.pid === null ? {} : { pid: o.pid ?? 4242 }),
  }];
  tarefas.forEach((t, i) => evs.push({ t: "slice", idx: i + 1, total: tarefas.length, tarefa: t, status: "fila", ts }));
  o.status.forEach((s, i) => evs.push({
    t: "slice", idx: i + 1, total: tarefas.length, tarefa: tarefas[i], status: s, ts: ts + i + 1,
    ...(o.semMudancas && s === "ok" ? { semMudancas: true } : {}),
  }));
  if (o.painel) evs.push({ t: "painel", status: "NEEDS-REVIEW", branch: "b", linhas: [], ts: ts + 99 });
  return evs;
}

test("run morta com S1 ok e S2 rodando: pula S1 (CA-1)", () => {
  const runs = new Map([["m1", run({ status: ["ok", "rodando"] })]]);
  assert.deepEqual(S.acharRunMorta(runs, CWD, "retomar run", plano, morto), { de: "m1", slices: [1] });
});

test("prefixo para na primeira slice nao-ok ou com tarefa diferente (CA-1)", () => {
  const r1 = new Map([["m1", run({ status: ["ok", "incompleta", "ok"] })]]);
  assert.deepEqual(S.acharRunMorta(r1, CWD, "retomar run", plano, morto).slices, [1]);
  const r2 = new Map([["m1", run({ status: ["ok", "ok", "rodando"], tarefas: ["A", "X", "C"] })]]);
  assert.deepEqual(S.acharRunMorta(r2, CWD, "retomar run", plano, morto).slices, [1]);
  const r3 = new Map([["m1", run({ status: ["ok", "ok"], tarefas: ["Z", "B", "C"] })]]);
  assert.deepEqual(S.acharRunMorta(r3, CWD, "retomar run", plano, morto), { de: "m1", slices: [] }, "achou a morta, mas nada a pular");
});

test("ok (sem mudancas) conta como ok; plano mais curto pula so o que existe", () => {
  const runs = new Map([["m1", run({ status: ["ok", "ok", "rodando"], semMudancas: true })]]);
  assert.deepEqual(S.acharRunMorta(runs, CWD, "retomar run", plano, morto).slices, [1, 2]);
  assert.deepEqual(S.acharRunMorta(runs, CWD, "retomar run", plano.slice(0, 1), morto).slices, [1]);
});

test("nada a retomar: painel, processo vivo, outro cwd ou outra feature (CA-3)", () => {
  const com = (evs: any[]) => new Map([["m1", evs]]);
  assert.equal(S.acharRunMorta(com(run({ status: ["ok"], painel: true })), CWD, "retomar run", plano, morto), null, "tem painel");
  assert.equal(S.acharRunMorta(com(run({ status: ["ok"] })), CWD, "retomar run", plano, vivo), null, "pid vivo");
  assert.equal(S.acharRunMorta(com(run({ status: ["ok"], cwd: "D:/outro" })), CWD, "retomar run", plano, morto), null, "outro cwd");
  assert.equal(S.acharRunMorta(com(run({ status: ["ok"], feature: "outra" })), CWD, "retomar run", plano, morto), null, "outra feature");
  assert.equal(S.acharRunMorta(new Map(), CWD, "retomar run", plano, morto), null, "sem runs");
});

test("run sem pid (antiga) conta como morta; vivo() nao e' chamado sem pid", () => {
  let chamou = false;
  const runs = new Map([["m1", run({ status: ["ok"], pid: null })]]);
  const r = S.acharRunMorta(runs, CWD, "retomar run", plano, () => { chamou = true; return true; });
  assert.deepEqual(r, { de: "m1", slices: [1] });
  assert.equal(chamou, false);
});

test("cwd casa com barra/maiuscula diferente (Windows)", { skip: process.platform !== "win32" }, () => {
  const runs = new Map([["m1", run({ status: ["ok"], cwd: "d:\\proj\\APP" })]]);
  assert.deepEqual(S.acharRunMorta(runs, CWD, "retomar run", plano, morto)?.slices, [1]);
});

test("varias runs mortas: vale a mais recente", () => {
  const runs = new Map([
    ["velha", run({ status: ["ok", "ok"], ts: 1000 })],
    ["nova", run({ status: ["ok", "rodando"], ts: 5000 })],
  ]);
  assert.deepEqual(S.acharRunMorta(runs, CWD, "retomar run", plano, morto), { de: "nova", slices: [1] });
});

test("marcarInterrompida grava painel INTERROMPIDA com 'retomada por <novo>' no jsonl da morta (CA-2)", () => {
  const dir = mkdtempSync(path.join(TMP, "runs-"));
  writeFileSync(path.join(dir, "m1.jsonl"), run({ status: ["ok", "rodando"] }).map((e) => JSON.stringify(e)).join("\n") + "\n");
  S.marcarInterrompida(dir, "m1", "novo-1");
  const evs = ui.lerRuns(dir).get("m1");
  const p = evs[evs.length - 1];
  assert.equal(p.t, "painel");
  assert.equal(p.status, "INTERROMPIDA");
  assert.ok(p.linhas.some((l: string) => l.includes("retomada por novo-1")));
  // depois de marcada, nao e' mais candidata
  assert.equal(S.acharRunMorta(ui.lerRuns(dir), CWD, "retomar run", plano, morto), null);
});

test("construir pula as slices da retomada sem chamar o modelo e roda as seguintes (CA-1, CA-4)", async () => {
  const cwd = mkdtempSync(path.join(TMP, "proj-"));
  const chamadas: { sys: string; user: string }[] = [];
  const fn = async (sys: string, messages: any[]) => {
    chamadas.push({ sys, user: String(messages[0].content) });
    return { blocos: [{ type: "text", text: "fim" }], stop: "end_turn" };
  };
  const eventos: any[] = [];
  const r = await S.construir(cwd, "retomar run", plano.slice(0, 2), (e: any) => eventos.push(e), [], undefined, fn, undefined, { de: "m1", slices: [1] });
  assert.equal(chamadas.length, 1, "so a S2 chamou o modelo");
  assert.match(chamadas[0].user, /Tarefa: B/);
  const s1 = eventos.filter((e) => e.t === "slice" && e.idx === 1).pop();
  assert.equal(s1.status, "ok");
  assert.match(s1.motivo, /retomada de m1/);
  assert.equal(eventos.some((e) => e.t === "slice" && e.idx === 1 && e.status === "rodando"), false, "S1 nunca roda");
  assert.equal(r.resultados[0].ok, true);
  assert.equal(r.resultados[0].tarefa, "A");
});

test("prompt do coder: so o comando da slice e encerrar assim que passar (CA-6)", async () => {
  const cwd = mkdtempSync(path.join(TMP, "proj-"));
  let sys = "";
  const fn = async (s: string) => { sys = s; return { blocos: [{ type: "text", text: "fim" }], stop: "end_turn" }; };
  await S.agente(cwd, "f", plano[0], () => {}, 1, ["npm test"], fn);
  assert.match(sys, /so o comando de verificacao desta slice/i);
  assert.match(sys, /assim que passar, encerre/i);
});
