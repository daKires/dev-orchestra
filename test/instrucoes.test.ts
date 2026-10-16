// Spec da G3 (logica pura + disco): caixa de instrucoes e pausa por slice, validacao das acoes e espera
// da retomada com teto (CA-1, 2, 5, 6, 7, 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  arquivoInstrucao, arquivoPausa, gravarInstrucao, tomarInstrucoes, pausarSlice, retomarSlice, pausada,
  validarAcaoSlice, validarTexto, esperarRetomada, estaPausada,
} from "../dist/instrucoes.js";

const dir = () => mkdtempSync(path.join(tmpdir(), "hermes-g3-"));

test("tomarInstrucoes: devolve so' as da slice, em ordem, e mantem as das outras (CA-1, 2)", () => {
  const d = dir();
  assert.deepEqual(tomarInstrucoes(d, "r1", 2), [], "sem arquivo: vazio");
  gravarInstrucao(d, "r1", 2, "use fetch");
  gravarInstrucao(d, "r1", 3, "outra slice");
  gravarInstrucao(d, "r1", 2, "e logue");
  assert.deepEqual(tomarInstrucoes(d, "r1", 2), ["use fetch", "e logue"]);
  assert.deepEqual(tomarInstrucoes(d, "r1", 2), [], "consumidas");
  assert.deepEqual(tomarInstrucoes(d, "r1", 3), ["outra slice"]);
  assert.ok(arquivoInstrucao(d, "r1").endsWith("r1.instrucao.jsonl"));
});

test("pausar/retomar: .pausa marca a slice; retomar apaga e grava o texto opcional (CA-4, 5)", () => {
  const d = dir();
  assert.equal(pausada(d, "r1", 2), false);
  pausarSlice(d, "r1", 2);
  assert.ok(existsSync(arquivoPausa(d, "r1")));
  assert.equal(pausada(d, "r1", 2), true);
  assert.equal(pausada(d, "r1", 3), false, "pausa e' da slice 2");
  retomarSlice(d, "r1", 2, "segue com cuidado");
  assert.equal(existsSync(arquivoPausa(d, "r1")), false);
  assert.deepEqual(tomarInstrucoes(d, "r1", 2), ["segue com cuidado"]);
  pausarSlice(d, "r1", 2);
  retomarSlice(d, "r1", 2);
  assert.deepEqual(tomarInstrucoes(d, "r1", 2), [], "retomar sem texto nao grava instrucao");
  const resto = existsSync(arquivoInstrucao(d, "r1")) ? readFileSync(arquivoInstrucao(d, "r1"), "utf8") : "";
  assert.ok(!resto.includes("undefined"));
});

const T = 1_000;
const run = (extra: object[] = []) => [
  { t: "run", feature: "f", cwd: "c", total: 3, ts: T },
  { t: "slice", idx: 1, total: 3, tarefa: "a", status: "rodando", ts: T + 1 },
  { t: "slice", idx: 1, total: 3, tarefa: "a", status: "ok", ts: T + 2 },
  { t: "slice", idx: 2, total: 3, tarefa: "b", status: "rodando", ts: T + 3 },
  { t: "slice", idx: 3, total: 3, tarefa: "c", status: "fila", ts: T },
  ...extra,
] as any[];

test("validarAcaoSlice: so' a slice rodando de run viva passa; o resto da' erro claro (CA-8)", () => {
  assert.equal(validarAcaoSlice(run(), 2, false), null);
  assert.deepEqual(validarAcaoSlice(run(), 1, false), { status: 409, erro: "slice S1 não está rodando (ok)" });
  assert.deepEqual(validarAcaoSlice(run(), 3, false), { status: 409, erro: "slice S3 não está rodando (fila)" });
  assert.deepEqual(validarAcaoSlice(run(), 4, false), { status: 409, erro: "slice S4 não está rodando (reparo do gate ou inexistente)" });
  assert.deepEqual(validarAcaoSlice(run(), 2, true), { status: 409, erro: "a run já terminou" }, "cancelada");
  assert.deepEqual(
    validarAcaoSlice(run([{ t: "painel", status: "CANCELED", branch: "", linhas: [], ts: T + 9 }]), 2, false),
    { status: 409, erro: "a run já terminou" },
  );
  assert.deepEqual(validarAcaoSlice(null, 2, false), { status: 404, erro: "run desconhecida" });
});

test("validarTexto: obrigatorio no instruir, opcional no retomar, teto de 4000 (CA-8)", () => {
  assert.equal(validarTexto("use fetch", true), null);
  assert.equal(validarTexto("  ", true), "instrução vazia");
  assert.equal(validarTexto(undefined, true), "instrução vazia");
  assert.equal(validarTexto(undefined, false), null);
  assert.equal(validarTexto("", false), null);
  assert.equal(validarTexto("x".repeat(4000), true), null);
  assert.equal(validarTexto("x".repeat(4001), true), "instrução acima de 4000 caracteres");
  assert.equal(validarTexto(42, false), "instrução inválida");
});

test("esperarRetomada: retoma quando a pausa some, estoura no teto e para no cancelamento (CA-5, 6, 7)", async () => {
  let agora = 0;
  const dormir = async (ms: number) => { agora += ms; };
  let voltas = 0;
  assert.equal(await esperarRetomada({ pausada: () => ++voltas < 3, tetoMs: 60_000, agora: () => agora, dormir }), "retomada");
  agora = 0;
  assert.equal(await esperarRetomada({ pausada: () => true, tetoMs: 5_000, agora: () => agora, dormir }), "teto");
  assert.ok(agora >= 5_000 && agora < 7_000, "nao passa muito do teto");
  const ctrl = new AbortController();
  agora = 0;
  const p = esperarRetomada({ pausada: () => true, tetoMs: 60_000, agora: () => agora, dormir: async (ms) => { agora += ms; if (agora > 3_000) ctrl.abort(); }, signal: ctrl.signal });
  await assert.rejects(p);
});

test("estaPausada: o ultimo evento de pausa da run decide (status_orchestra mostra PAUSADA) (CA-4)", () => {
  assert.equal(estaPausada(run()), false);
  assert.equal(estaPausada(run([{ t: "pausa", slice: 2, estado: "pausada", ts: T + 4 }])), true);
  assert.equal(estaPausada(run([{ t: "pausa", slice: 2, estado: "pausada", ts: T + 4 }, { t: "pausa", slice: 2, estado: "retomada", ts: T + 5 }])), false);
});
