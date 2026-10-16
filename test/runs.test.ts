// Spec do modo assincrono (runs.ts): uma run ativa por vez, polling com espera limitada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { iniciar, esperar } from "../dist/runs.js";

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test("CA-1: iniciar devolve runId na hora e a run segue em background", async () => {
  let liberar!: (p: string) => void;
  const t0 = Date.now();
  const id = iniciar(() => new Promise<string>((ok) => { liberar = ok; }));
  assert.ok(Date.now() - t0 < 100, "nao espera a run");
  assert.equal(typeof id, "string");
  assert.ok(id.length > 0);
  liberar("PAINEL");
  assert.deepEqual(await esperar(id, 1000), { fim: "PAINEL" });
});

test("CA-2: esperar devolve rodando + ultimas linhas quando estoura o prazo", async () => {
  let liberar!: (p: string) => void;
  const id = iniciar((progresso) => {
    for (let i = 1; i <= 30; i++) progresso("linha " + i);
    return new Promise<string>((ok) => { liberar = ok; });
  });
  const t0 = Date.now();
  const r = await esperar(id, 50);
  assert.ok(Date.now() - t0 >= 40, "esperou o prazo");
  assert.ok("rodando" in r);
  const linhas = (r as { rodando: string[] }).rodando;
  assert.ok(linhas.length > 0 && linhas.length <= 20, "no maximo 20 linhas");
  assert.equal(linhas[linhas.length - 1], "linha 30", "as mais recentes");
  liberar("OK");
  assert.deepEqual(await esperar(id, 1000), { fim: "OK" });
});

test("CA-2: esperar volta assim que a run termina (nao espera o prazo todo)", async () => {
  const id = iniciar(async () => { await dormir(20); return "FIM"; });
  const t0 = Date.now();
  assert.deepEqual(await esperar(id, 5000), { fim: "FIM" });
  assert.ok(Date.now() - t0 < 1000);
});

test("CA-2: run terminada continua consultavel", async () => {
  const id = iniciar(async () => "PAINEL FINAL");
  assert.deepEqual(await esperar(id, 1000), { fim: "PAINEL FINAL" });
  assert.deepEqual(await esperar(id, 1000), { fim: "PAINEL FINAL" });
});

test("CA-3: segunda run com uma ativa e' recusada com erro claro, e nada roda", async () => {
  let liberar!: (p: string) => void;
  const id = iniciar(() => new Promise<string>((ok) => { liberar = ok; }));
  let rodou = false;
  assert.throws(
    () => iniciar(async () => { rodou = true; return "x"; }),
    (e: Error) => e.message.includes(id) && /rodando/.test(e.message),
  );
  assert.equal(rodou, false);
  liberar("A");
  await esperar(id, 1000);
  const id2 = iniciar(async () => "B"); // liberou o slot
  assert.deepEqual(await esperar(id2, 1000), { fim: "B" });
});

test("CA-5: runId desconhecido da erro claro", async () => {
  await assert.rejects(esperar("nao-existe", 10), (e: Error) => e.message.includes("nao-existe") && /nao existe/.test(e.message));
});

test("borda: run que rejeita vira fim com FAILED e libera o slot", async () => {
  const id = iniciar(async () => { throw new Error("explodiu"); });
  const r = await esperar(id, 1000);
  assert.ok("fim" in r);
  assert.match((r as { fim: string }).fim, /FAILED/);
  assert.match((r as { fim: string }).fim, /explodiu/);
  const id2 = iniciar(async () => "ok");
  assert.deepEqual(await esperar(id2, 1000), { fim: "ok" });
});
