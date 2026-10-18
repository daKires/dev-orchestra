// Spec do partir-ui (S5 CLI): rotas /cli/* saem do ui.ts e vao pro agentes-hub.ts (CA-7).
import { test } from "node:test";
import assert from "node:assert/strict";
import { fonte, modulo, faltando } from "./partir-ui-util.js";

test("agentes-hub exporta rotasCli e o ui.ts nao trata mais /cli/", async () => {
  assert.deepEqual(faltando(await modulo("dist/agentes-hub.js"), ["rotasCli"]), []);
  assert.equal(fonte("src/ui.ts").includes('"/cli/"'), false);
});
