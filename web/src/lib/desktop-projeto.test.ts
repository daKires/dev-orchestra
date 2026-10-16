// Teste extra da S6 (F4): o id de projeto calculado no front (crypto.subtle) tem que ser o MESMO
// sha1 hex do idProjeto do hub (raiz normalizada: barras '/', minusculas, sem barra final).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { idProjetoFront, particaoDoProjeto } from "./desktop.ts";

const idProjetoHub = (raiz: string): string =>
  createHash("sha1")
    .update(raiz.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(), "utf8")
    .digest("hex");

test("idProjetoFront: sha1 da raiz normalizada, igual ao idProjeto do hub", async () => {
  for (const raiz of ["D:\\Proj\\Roblox\\", "d:/proj/roblox", "/home/u/Proj", "C:/a/b///"]) {
    assert.equal(await idProjetoFront(raiz), idProjetoHub(raiz), raiz);
  }
});

test("idProjetoFront: grafias diferentes da mesma pasta dao o mesmo id", async () => {
  assert.equal(await idProjetoFront("D:\\Proj\\Roblox"), await idProjetoFront("d:/proj/roblox/"));
});

test("particaoDoProjeto: persist:dev-orchestra-<idProjeto>", async () => {
  const id = await idProjetoFront("D:\\Proj\\Roblox");
  assert.equal(particaoDoProjeto(id), "persist:dev-orchestra-" + idProjetoHub("D:\\Proj\\Roblox"));
});
