// Spec da S2: rotas /canvas* no hub (CA-3, CA-10, CA-14). Mesmo esquema do hub.test.ts: env antes do
// import dinamico (porta, planejadores e pasta do canvas temporarios — nunca toca nos reais).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });
}

const PORTA = await portaLivre();
const DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-canvas-"));
process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-planc-"));
process.env.DEV_ORCHESTRA_CANVAS_DIR = DIR;
process.env.DEV_ORCHESTRA_AGENTES_DIR ??= await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-iso-")); // nunca os agentes reais da maquina
const ui = await import("../dist/ui.js");
const canvas = await import("../dist/canvas.js");

const BASE = `http://127.0.0.1:${PORTA}`;
const RAIZ = "D:\\proj\\Site";
const post = (rota: string, body: unknown, hermes = true) =>
  fetch(BASE + rota, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(hermes ? { "X-Dev-Orchestra": "1" } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const snapshot = async (raiz: string) => {
  const r = await fetch(`${BASE}/canvas?projeto=${encodeURIComponent(raiz)}`);
  assert.equal(r.status, 200);
  return (await r.json()) as { nos: Array<{ id: string; x: number }>; arestas: unknown[] };
};
const esperar = async (cond: () => Promise<boolean>): Promise<boolean> => {
  for (let i = 0; i < 60; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};
const nota = (id: string, rev: number, x = 0) => ({ id, tipo: "nota", x, y: 0, w: 200, h: 120, dados: { titulo: id, texto: "" }, rev });

test("rotas /canvas: snapshot, ops com X-Hermes, SSE e disco (CA-14)", async (t) => {
  // canvas ja' gravado em disco antes do hub subir: o GET tem que le-lo
  const outra = "D:\\proj\\Antigo";
  await fs.mkdir(path.join(DIR, canvas.idProjeto(outra)), { recursive: true });
  await fs.writeFile(path.join(DIR, canvas.idProjeto(outra), "canvas.json"), JSON.stringify({ nos: [nota("velha", 1)], arestas: [] }));

  await ui.iniciarUI();
  t.after(() => ui.pararUI());

  assert.deepEqual(await snapshot(RAIZ), { nos: [], arestas: [] }, "projeto novo comeca vazio");
  assert.deepEqual((await snapshot(outra)).nos.map((n) => n.id), ["velha"], "le canvas.json do disco");
  assert.equal((await fetch(`${BASE}/canvas`)).status, 400, "sem ?projeto");

  const ctrl = new AbortController();
  t.after(() => ctrl.abort());
  const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
  let texto = "";
  (async () => {
    const rd = sse.body!.getReader();
    const dec = new TextDecoder();
    for (;;) { const { done, value } = await rd.read(); if (done) return; texto += dec.decode(value, { stream: true }); }
  })().catch(() => {});

  const ops = [{ op: "upsert", tipo: "no", item: nota("n1", 1, 40) }];
  assert.equal((await post("/canvas/op", { projeto: RAIZ, ops }, false)).status, 400, "sem X-Hermes");
  assert.equal((await post("/canvas/op", "{nao json")).status, 400, "json quebrado");
  assert.equal((await post("/canvas/op", { projeto: RAIZ, ops: [{ op: "zap" }] })).status, 400, "op invalida");
  assert.equal((await post("/canvas/op", { ops })).status, 400, "sem projeto");
  const r = await post("/canvas/op", { projeto: RAIZ, ops });
  assert.ok(r.status === 200 || r.status === 204, "op aceita: " + r.status);

  assert.deepEqual((await snapshot(RAIZ)).nos.map((n) => [n.id, n.x]), [["n1", 40]]);
  assert.ok(await esperar(async () => texto.includes('"canvasOp"') && texto.includes('"n1"')), "op sai no SSE");

  // rev velho nao sobrescreve
  await post("/canvas/op", { projeto: RAIZ, ops: [{ op: "upsert", tipo: "no", item: nota("n1", 0, 999) }] });
  assert.equal((await snapshot(RAIZ)).nos[0].x, 40);

  const arq = path.join(DIR, canvas.idProjeto(RAIZ), "canvas.json");
  assert.ok(await esperar(async () => {
    try { return JSON.parse(await fs.readFile(arq, "utf8")).nos?.[0]?.id === "n1"; } catch { return false; }
  }), "persistido em <dir>/<idProjeto>/canvas.json");
});

test("rotas /canvas/asset: grava, serve e recusa invalido/traversal (CA-10)", async (t) => {
  await ui.iniciarUI();
  t.after(() => ui.pararUI());
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);
  assert.equal((await post("/canvas/asset", { projeto: RAIZ, nome: "a.png", dadosB64: bytes.toString("base64") }, false)).status, 400, "sem X-Hermes");
  assert.equal((await post("/canvas/asset", { projeto: RAIZ, nome: "a.exe", dadosB64: bytes.toString("base64") })).status, 400, "extensao proibida");
  assert.equal((await post("/canvas/asset", { projeto: RAIZ, nome: "a.png", dadosB64: "@@" })).status, 400, "base64 ruim");

  const r = await post("/canvas/asset", { projeto: RAIZ, nome: "ref.png", dadosB64: bytes.toString("base64") });
  assert.equal(r.status, 200);
  const { url } = (await r.json()) as { url: string };
  assert.match(url, /^\/canvas\/asset\//);
  const g = await fetch(BASE + url);
  assert.equal(g.status, 200);
  assert.match(g.headers.get("content-type") ?? "", /image\/png/);
  assert.deepEqual(Buffer.from(await g.arrayBuffer()), bytes);

  const id = canvas.idProjeto(RAIZ);
  const ruim = await fetch(`${BASE}/canvas/asset/${id}/..%2Fcanvas.json`);
  assert.ok(ruim.status === 400 || ruim.status === 404, "traversal recusado: " + ruim.status);
  assert.equal((await fetch(`${BASE}/canvas/asset/${id}/naoexiste.png`)).status, 404);
});

test("rotas /canvas/projetos: cria, renomeia e lista (CA-3)", async (t) => {
  await ui.iniciarUI();
  t.after(() => ui.pararUI());
  assert.equal((await post("/canvas/projetos", { raiz: "E:\\Pesquisa", nome: "Pesquisa", cor: "laranja" }, false)).status, 400, "sem X-Hermes");
  assert.equal((await post("/canvas/projetos", { nome: "sem raiz" })).status, 400, "sem raiz");
  // Pasta real: a lista esconde raiz que nao existe (conferido abaixo com "Sumiu").
  const pasta = await fs.mkdtemp(path.join(os.tmpdir(), "Pesquisa-"));
  t.after(() => fs.rm(pasta, { recursive: true, force: true }));
  let r = await post("/canvas/projetos", { raiz: pasta, nome: "Pesquisa", cor: "laranja" });
  assert.ok(r.status === 200 || r.status === 204);
  r = await post("/canvas/projetos", { raiz: pasta.replace(/\\/g, "/") + "/", nome: "Pesquisa 2", cor: "lilas" });
  assert.ok(r.status === 200 || r.status === 204);
  r = await post("/canvas/projetos", { raiz: path.join(pasta, "nao-existe"), nome: "Sumiu" });
  assert.ok(r.status === 200 || r.status === 204);

  const lista = (await (await fetch(`${BASE}/canvas/projetos`)).json()) as Array<{ raiz: string; nome: string; cor?: string }>;
  const p = lista.filter((x) => x.nome.startsWith("Pesquisa"));
  assert.equal(p.length, 1, "mesma raiz nao duplica");
  assert.equal(p[0].nome, "Pesquisa 2");
  assert.equal(p[0].cor, "lilas");
  assert.ok(!lista.some((x) => x.nome === "Sumiu"), "pasta inexistente nao aparece na lista");
  const salvo = JSON.parse(await fs.readFile(path.join(DIR, "projetos.json"), "utf8"));
  assert.ok(Array.isArray(salvo) && salvo.some((x: any) => x.nome === "Pesquisa 2"), "persistido em projetos.json");
  assert.ok(salvo.some((x: any) => x.nome === "Sumiu"), "escondida, mas nao apagada do projetos.json");
});
