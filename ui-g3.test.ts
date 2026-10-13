// Spec da G3 (hub): POST /runs/instrucao e /runs/pausa gravam a caixa da slice em RUNS_DIR e recusam
// run desconhecida/terminada/cancelada, slice que nao esta rodando e texto invalido (CA-3, 4, 5, 8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, writeFileSync, appendFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}
const PORTA = await portaLivre();
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-g3-hub-"));
const RUNS = path.join(TMP, "runs");
await fs.mkdir(RUNS, { recursive: true });
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_RUNS_DIR = RUNS;
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
const ui = await import("./ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

const post = (rota: string, corpo: unknown) => fetch(BASE + rota, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify(corpo),
});
const linhas = (id: string) => {
  const f = path.join(RUNS, id + ".instrucao.jsonl");
  return existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
};

const ID = "run-g3-1";
const evs = [
  { t: "run", feature: "f", cwd: TMP, total: 3, ts: 1 },
  { t: "slice", idx: 1, total: 3, tarefa: "a", status: "ok", ts: 2 },
  { t: "slice", idx: 2, total: 3, tarefa: "b", status: "rodando", ts: 3 },
  { t: "slice", idx: 3, total: 3, tarefa: "c", status: "fila", ts: 1 },
];
writeFileSync(path.join(RUNS, ID + ".jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");

await ui.iniciarUI({} as any);
test.after(() => ui.pararUI());

test("instruir: grava a instrucao da slice rodando; texto vazio/grande e' 400 (CA-3, 8)", async () => {
  let r = await post(`/runs/instrucao?run=${ID}`, { slice: 2, texto: "use fetch" });
  assert.equal(r.status, 204, await r.text());
  assert.deepEqual(linhas(ID).map((l) => [l.slice, l.texto]), [[2, "use fetch"]]);
  r = await post(`/runs/instrucao?run=${ID}`, { slice: 2, texto: "   " });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /instrução vazia/);
  r = await post(`/runs/instrucao?run=${ID}`, { slice: 2, texto: "x".repeat(4001) });
  assert.equal(r.status, 400);
  assert.match(await r.text(), /acima de 4000/);
  assert.equal(linhas(ID).length, 1, "nada gravado nos erros");
});

test("slice que nao esta rodando, reparo do gate e run desconhecida dao erro claro (CA-8)", async () => {
  let r = await post(`/runs/instrucao?run=${ID}`, { slice: 1, texto: "x" });
  assert.equal(r.status, 409);
  assert.equal(await r.text(), "slice S1 não está rodando (ok)");
  r = await post(`/runs/instrucao?run=${ID}`, { slice: 3, texto: "x" });
  assert.equal(r.status, 409);
  assert.match(await r.text(), /S3 não está rodando \(fila\)/);
  r = await post(`/runs/pausa?run=${ID}`, { slice: 4, acao: "pausar" });
  assert.equal(r.status, 409);
  r = await post(`/runs/instrucao?run=nao-existe`, { slice: 2, texto: "x" });
  assert.equal(r.status, 404);
  r = await fetch(BASE + `/runs/instrucao?run=${ID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slice: 2, texto: "x" }) });
  assert.equal(r.status, 400, "sem X-Hermes");
  r = await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "explodir" });
  assert.equal(r.status, 400, "acao invalida");
});

test("pausar cria .pausa; retomar apaga e grava o texto opcional (CA-4, 5)", async () => {
  const pausa = path.join(RUNS, ID + ".pausa");
  let r = await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "pausar" });
  assert.equal(r.status, 204, await r.text());
  assert.ok(existsSync(pausa));
  r = await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "retomar", texto: "segue com cuidado" });
  assert.equal(r.status, 204);
  assert.equal(existsSync(pausa), false);
  assert.deepEqual(linhas(ID).at(-1).texto, "segue com cuidado");
  const antes = linhas(ID).length;
  await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "pausar" });
  r = await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "retomar" });
  assert.equal(r.status, 204, "retomar sem texto");
  assert.equal(linhas(ID).length, antes);
});

test("run cancelada ou com painel: 'a run já terminou' (CA-8)", async () => {
  const cancel = path.join(RUNS, ID + ".cancel");
  writeFileSync(cancel, "1");
  let r = await post(`/runs/instrucao?run=${ID}`, { slice: 2, texto: "x" });
  assert.equal(r.status, 409);
  assert.equal(await r.text(), "a run já terminou");
  unlinkSync(cancel);
  appendFileSync(path.join(RUNS, ID + ".jsonl"), JSON.stringify({ t: "painel", status: "COMPLETE", branch: "b", linhas: [], ts: 9 }) + "\n");
  await new Promise((ok) => setTimeout(ok, 1500)); // rescan do hub
  r = await post(`/runs/pausa?run=${ID}`, { slice: 2, acao: "pausar" });
  assert.equal(r.status, 409);
  assert.equal(await r.text(), "a run já terminou");
});

test("run com caracteres fora de [a-z0-9-] e' 400 e nao grava nada fora do RUNS_DIR (seguranca)", async () => {
  for (const run of ["../fora", "..%2Ffora", "RUN_X", "a/b"]) {
    const r = await post(`/runs/instrucao?run=${run}`, { slice: 2, texto: "x" });
    assert.equal(r.status, 400, run);
    const p = await post(`/runs/pausa?run=${run}`, { slice: 2, acao: "pausar" });
    assert.equal(p.status, 400, run);
  }
  assert.equal(existsSync(path.join(TMP, "fora.instrucao.jsonl")), false);
  assert.equal(existsSync(path.join(TMP, "fora.pausa")), false);
});
