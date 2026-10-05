// Spec da S1: modelo puro do canvas (CA-3, CA-10, CA-14). Roda direto com --experimental-strip-types.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aplicarOps, validarOps, validarAsset, mesclarProjetos, idProjeto, MAX_ASSET_BYTES,
  type No, type Aresta, type Snapshot,
} from "./canvas.ts";

const no = (id: string, rev = 1, over: Partial<No> = {}): No => ({ id, tipo: "nota", x: 0, y: 0, w: 200, h: 120, dados: { titulo: id }, rev, ...over });
const aresta = (id: string, de: string, para: string, rev = 1): Aresta => ({ id, de, para, rev });
const vazio: Snapshot = { nos: [], arestas: [] };

test("validarOps: aceita upsert/remove bem formados e rejeita o resto (CA-14)", () => {
  assert.ok(validarOps([{ op: "upsert", tipo: "no", item: no("a") }]));
  assert.ok(validarOps([{ op: "upsert", tipo: "aresta", item: aresta("e", "a", "b") }]));
  assert.ok(validarOps([{ op: "remove", tipo: "no", item: { id: "a", rev: 2 } }]));
  assert.equal(validarOps("x"), null);
  assert.equal(validarOps([{ op: "zap", tipo: "no", item: no("a") }]), null);
  assert.equal(validarOps([{ op: "upsert", tipo: "no", item: { ...no("a"), tipo: "foguete" } }]), null);
  assert.equal(validarOps([{ op: "upsert", tipo: "no", item: { ...no("a"), id: "" } }]), null);
  assert.equal(validarOps([{ op: "upsert", tipo: "no", item: { ...no("a"), x: "1" } }]), null);
  assert.equal(validarOps([{ op: "upsert", tipo: "aresta", item: { id: "e", de: "a", rev: 1 } }]), null);
  assert.equal(validarOps([{ op: "upsert", tipo: "no", item: no("a") }, { op: "upsert" }]), null, "um item ruim invalida o lote");
});

test("aplicarOps: upsert cria e atualiza; nao muta o snapshot original (CA-14)", () => {
  const s1 = aplicarOps(vazio, [{ op: "upsert", tipo: "no", item: no("a") }]);
  assert.equal(vazio.nos.length, 0);
  assert.equal(s1.nos.length, 1);
  const s2 = aplicarOps(s1, [{ op: "upsert", tipo: "no", item: no("a", 2, { x: 50 }) }]);
  assert.equal(s2.nos.length, 1);
  assert.equal(s2.nos[0].x, 50);
  assert.equal(s1.nos[0].x, 0);
});

test("aplicarOps: rev menor e' ignorado, rev maior sobrescreve (ultima escrita vence por item) (CA-14)", () => {
  let s = aplicarOps(vazio, [{ op: "upsert", tipo: "no", item: no("a", 5, { x: 10 }) }]);
  s = aplicarOps(s, [{ op: "upsert", tipo: "no", item: no("a", 3, { x: 99 }) }]);
  assert.equal(s.nos[0].x, 10);
  s = aplicarOps(s, [{ op: "upsert", tipo: "no", item: no("a", 6, { x: 20 }) }]);
  assert.equal(s.nos[0].x, 20);
  s = aplicarOps(s, [{ op: "remove", tipo: "no", item: { id: "a", rev: 4 } }]);
  assert.equal(s.nos.length, 1, "remove com rev velho nao apaga");
});

test("aplicarOps: ops em itens diferentes nunca se perdem (CA-14)", () => {
  let s = aplicarOps(vazio, [{ op: "upsert", tipo: "no", item: no("a") }, { op: "upsert", tipo: "no", item: no("b") }]);
  s = aplicarOps(s, [{ op: "upsert", tipo: "no", item: no("a", 2, { x: 1 }) }]);
  s = aplicarOps(s, [{ op: "upsert", tipo: "no", item: no("b", 2, { x: 2 }) }]);
  assert.deepEqual(s.nos.map((n) => [n.id, n.x]).sort(), [["a", 1], ["b", 2]]);
});

test("aplicarOps: remover no' remove as arestas dele e solta os filhos do grupo (CA-12)", () => {
  let s = aplicarOps(vazio, [
    { op: "upsert", tipo: "no", item: no("g", 1, { tipo: "grupo" }) },
    { op: "upsert", tipo: "no", item: no("a", 1, { pai: "g" }) },
    { op: "upsert", tipo: "no", item: no("b") },
    { op: "upsert", tipo: "aresta", item: aresta("e1", "a", "b") },
    { op: "upsert", tipo: "aresta", item: aresta("e2", "g", "b") },
  ]);
  s = aplicarOps(s, [{ op: "remove", tipo: "no", item: { id: "g", rev: 2 } }]);
  assert.deepEqual(s.nos.map((n) => n.id).sort(), ["a", "b"]);
  assert.equal(s.nos.find((n) => n.id === "a")!.pai, undefined);
  assert.deepEqual(s.arestas.map((e) => e.id), ["e1"]);
  s = aplicarOps(s, [{ op: "remove", tipo: "aresta", item: { id: "e1", rev: 2 } }]);
  assert.equal(s.arestas.length, 0);
});

test("validarAsset: so imagem, base64 valido, ate 25MB (CA-10)", () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");
  const ok = validarAsset("foto.PNG", png);
  assert.ok(ok);
  assert.equal(ok!.ext, "png");
  assert.equal(ok!.bytes.length, 7);
  assert.ok(validarAsset("..\\..\\x.jpg", png), "nome com traversal e' saneado, nao barra a imagem");
  assert.equal(validarAsset("virus.exe", png), null);
  assert.equal(validarAsset("doc.pdf", png), null);
  assert.equal(validarAsset("semext", png), null);
  assert.equal(validarAsset("a.png", "@@@nao-e-base64@@@"), null);
  assert.equal(validarAsset("a.png", ""), null);
  assert.equal(MAX_ASSET_BYTES, 25 * 1024 * 1024);
  assert.equal(validarAsset("a.png", Buffer.alloc(MAX_ASSET_BYTES + 1).toString("base64")), null);
});

test("idProjeto: mesma raiz em grafias diferentes da' o mesmo id (CA-3)", () => {
  assert.equal(idProjeto("D:\\Proj\\App\\"), idProjeto("d:/proj/app"));
  assert.notEqual(idProjeto("D:\\a"), idProjeto("D:\\b"));
  assert.match(idProjeto("D:\\a"), /^[0-9a-f]{40}$/);
});

test("mesclarProjetos: deduplica por raiz e mantem nome/cor salvos (CA-3)", () => {
  const r = mesclarProjetos(["D:\\x\\Site", "d:/x/site/", "D:\\x\\App"], [{ raiz: "D:\\x\\Site", nome: "Meu site", cor: "laranja" }, { raiz: "E:\\nova", nome: "Pesquisa" }]);
  assert.equal(r.length, 3);
  const site = r.find((p) => p.nome === "Meu site");
  assert.ok(site);
  assert.equal(site!.cor, "laranja");
  assert.ok(r.find((p) => p.nome === "App"), "descoberto sem salvo usa o nome da pasta");
  assert.ok(r.find((p) => p.nome === "Pesquisa"), "projeto so salvo (criado pela UI) aparece");
});
