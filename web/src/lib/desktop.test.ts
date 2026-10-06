// Spec da S6 (F4): utilitarios do front para o app desktop (CA-7a, 4d, 16d).
import { test } from "node:test";
import assert from "node:assert/strict";
import { emDesktop, temaXterm, particaoDoProjeto } from "./desktop.ts";

test("emDesktop: so com a ponte do preload (window.hermesDesktop) (CA-16d)", () => {
  assert.equal(emDesktop({}), false);
  assert.equal(emDesktop({ hermesDesktop: { registrarNavegador() {} } }), true);
  assert.equal(emDesktop(undefined), false);
});

test("temaXterm: cores do canvas Castor (CA-4d)", () => {
  assert.equal(temaXterm.background, "#1c1c1c");
  assert.equal(temaXterm.foreground, "#dedee3");
  assert.equal(temaXterm.cursor, "#74aaff");
});

test("particaoDoProjeto: persistente e isolada por projeto (CA-7a)", () => {
  assert.equal(particaoDoProjeto("abc123"), "persist:hermes-abc123");
  assert.notEqual(particaoDoProjeto("a"), particaoDoProjeto("b"));
});
