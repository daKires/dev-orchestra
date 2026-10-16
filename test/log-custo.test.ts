// Spec do PR3/S4 (CA-20, CA-21): custo por provedor e codigo morto removido.
import { test } from "node:test";
import assert from "node:assert/strict";

const H: any = await import("../dist/swarm.js");
const D: any = await import("../dist/deepseek.js");
const C: any = await import("../dist/claude-pty.js");
const pico = new Date(Date.UTC(2024, 0, 3, 2, 0, 0));   // quarta 02:00 UTC
const fora = new Date(Date.UTC(2024, 0, 7, 12, 0, 0));  // domingo 12:00 UTC

test("escolherProvedor expoe o id do provedor (go/deepseek/openrouter) (CA-21)", () => {
  assert.equal(D.escolherProvedor(undefined, undefined, "g").id, "go");
  assert.equal(D.escolherProvedor("d", undefined).id, "deepseek");
  assert.equal(D.escolherProvedor(undefined, "o").id, "openrouter");
});

test("custoUSD por provedor: Go (assinatura) = 0; DeepSeek e OpenRouter com os precos de hoje (CA-21)", () => {
  assert.equal(H.custoUSD(1e6, 1e6, pico, "go"), 0);
  assert.equal(H.custoUSD(1e6, 1e6, fora, "go"), 0);
  for (const p of ["deepseek", "openrouter"]) {
    assert.ok(Math.abs(H.custoUSD(1e6, 1e6, pico, p) - 1.5) < 1e-9, p + " pico");
    assert.ok(Math.abs(H.custoUSD(1e6, 1e6, fora, p) - 0.75) < 1e-9, p + " fora de pico");
  }
});

test("codigo morto removido: texto() do revisor e MODELOS_CLAUDE (CA-20)", () => {
  assert.equal("texto" in D, false, "deepseek.ts sem texto()");
  assert.equal("MODELOS_CLAUDE" in C, false, "claude-pty.ts sem MODELOS_CLAUDE");
});
