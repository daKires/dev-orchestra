// Spec da S2 (F4): navegador controlado pelos agentes via /cli/browser-* (driver falso) (CA-7a, 7b, 7c, 16d).
// Mesmo harness (OpenCode falso) da F2.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
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

type Chamada = { metodo: string; rota: string; corpo: any };
function openCodeFalso() {
  const chamadas: Chamada[] = [];
  const sse = new Set<http.ServerResponse>();
  let n = 0;
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => { corpo += d; });
    req.on("end", () => {
      const rota = (req.url || "/").split("?")[0];
      let j: any = null; try { j = corpo ? JSON.parse(corpo) : null; } catch {}
      chamadas.push({ metodo: req.method || "", rota, corpo: j });
      if (rota === "/event") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
        sse.add(res); res.on("close", () => sse.delete(res));
        return;
      }
      if (rota === "/doc") { res.writeHead(200); res.end("{}"); return; }
      if (rota === "/config/providers") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ providers: [{ id: "opencode-go", models: { "glm-5.2": {}, "kimi-k3": {} } }], default: {} }));
        return;
      }
      if (rota === "/session" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "ses_" + ++n, title: j?.title }));
        return;
      }
      if (/^\/session\/[^/]+\/message$/.test(rota) && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ info: { id: "m0", role: "assistant", sessionID: "ses_1" }, parts: [{ id: "h1", type: "text", text: "historico" }] }]));
        return;
      }
      if (/^\/session\/[^/]+\/(prompt_async|abort)$/.test(rota)) { res.writeHead(204); res.end(); return; }
      if (/^\/session\/[^/]+$/.test(rota) && req.method === "DELETE") { res.writeHead(200); res.end("true"); return; }
      res.writeHead(404); res.end();
    });
  });
  const emitir = (ev: unknown) => { for (const r of sse) r.write(`data: ${JSON.stringify(ev)}\n\n`); };
  return { srv, chamadas, emitir };
}

const PORTA = await portaLivre();
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
const ui = await import("../dist/ui.js");

const BASE = `http://127.0.0.1:${PORTA}`;
const post = (rota: string, body: unknown, hermes = true) => fetch(BASE + rota, {
  method: "POST", headers: { "Content-Type": "application/json", ...(hermes ? { "X-Hermes": "1" } : {}) }, body: JSON.stringify(body),
});
const ate = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  for (let i = 0; i < ms / 50; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};


type ChamadaNav = { op: string; noId: string; args: unknown[] };
function driverFalso() {
  const chamadas: ChamadaNav[] = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  return {
    chamadas,
    png,
    ler: async (noId: string) => { chamadas.push({ op: "ler", noId, args: [] }); return { titulo: "Busca", url: "https://www.google.com/", texto: "Google", elementos: [{ n: 1, papel: "campo", rotulo: "Pesquisar" }, { n: 2, papel: "botão", rotulo: "Estou com sorte" }] }; },
    clicar: async (noId: string, n: number) => { chamadas.push({ op: "clicar", noId, args: [n] }); },
    digitar: async (noId: string, n: number, valor: string, enter: boolean) => { chamadas.push({ op: "digitar", noId, args: [n, valor, enter] }); },
    navegar: async (noId: string, acao: string) => { chamadas.push({ op: "navegar", noId, args: [acao] }); },
    capturar: async (noId: string) => { chamadas.push({ op: "capturar", noId, args: [] }); return png; },
  };
}

async function montar(t: any, opts: { navegador?: unknown }) {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  execSync("git init -q", { cwd });
  await ui.iniciarUI({ subirServe: async () => ({ base: baseFalso, pid: 9 }), matarProcesso: () => {}, ...opts } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });
  const projeto = cwd; // projeto = a propria pasta
  const criar = async (nome: string) => (await (await post("/agentes", { projeto, cwd, papel: "livre", nome })).json() as { id: string }).id;
  const token = async (id: string) => JSON.parse(await fs.readFile(path.join(process.env.HERMES_AGENTES_DIR!, id + ".json"), "utf8")).token as string;
  const a = await criar("Líder");
  const b = await criar("Outro");
  const eA = `${a}:${await token(a)}`;
  const eB = `${b}:${await token(b)}`;
  const no = (nid: string, dados: Record<string, unknown>, x: number) => ({ id: nid, tipo: "agente", x, y: 0, w: 620, h: 420, dados, rev: Date.now() });
  await post("/canvas/op", { projeto, ops: [{ op: "upsert", tipo: "no", item: no("ag:" + a, { agenteId: a }, 0) }, { op: "upsert", tipo: "no", item: no("ag:" + b, { agenteId: b }, 2000) }] });
  const cli = (cmd: string, corpo: unknown, eu: string) => fetch(`${BASE}/cli/${cmd}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1", "X-Eu": eu }, body: JSON.stringify(corpo) });
  const snap = async () => await (await fetch(`${BASE}/canvas?projeto=${encodeURIComponent(projeto)}`)).json() as { nos: Array<{ id: string; tipo: string; dados: any }>; arestas: Array<{ de: string; para: string }> };
  return { projeto, cwd, a, b, eA, eB, cli, snap };
}

test("browser: create liga ao criador; read/click/type/nav pelo driver; acesso so com aresta (CA-7a, 7b, 7c)", async (t) => {
  const drv = driverFalso();
  const m = await montar(t, { navegador: drv });

  let r = await m.cli("browser-create", { nome: "pesquisa", url: "https://www.google.com" }, m.eA);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /navegador pesquisa aberto/);
  let s = await m.snap();
  const nav = s.nos.find((n) => n.tipo === "navegador")!;
  assert.ok(nav, "no' navegador criado");
  assert.equal(nav.id, "nav:pesquisa");
  assert.equal(nav.dados.url, "https://www.google.com");
  assert.equal(nav.dados.nome, "pesquisa");
  assert.equal(nav.dados.criador, m.a);
  assert.ok(s.arestas.some((e) => (e.de === "ag:" + m.a && e.para === nav.id) || (e.para === "ag:" + m.a && e.de === nav.id)), "ligado ao criador");

  r = await m.cli("browser-create", { nome: "x", url: "file:///C:/segredo.txt" }, m.eA);
  assert.equal(r.status, 400, "url proibida");

  r = await m.cli("browser-read", {}, m.eA);
  assert.equal(r.status, 200, "um unico navegador ligado: nav opcional");
  const txt = await r.text();
  assert.match(txt, /^# Busca/);
  assert.match(txt, /\[1\] campo "Pesquisar"/);
  assert.deepEqual(drv.chamadas.at(-1), { op: "ler", noId: "nav:pesquisa", args: [] });

  r = await m.cli("browser-type", { nav: "pesquisa", alvo: "pesquisar", valor: "castor", enter: true }, m.eA);
  assert.equal(r.status, 200);
  assert.deepEqual(drv.chamadas.at(-1), { op: "digitar", noId: "nav:pesquisa", args: [1, "castor", true] });
  r = await m.cli("browser-click", { alvo: "2" }, m.eA);
  assert.equal(r.status, 200);
  assert.deepEqual(drv.chamadas.at(-1), { op: "clicar", noId: "nav:pesquisa", args: [2] });
  r = await m.cli("browser-click", { alvo: "99" }, m.eA);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /elemento 99 não existe/);
  r = await m.cli("browser-nav", { acao: "back" }, m.eA);
  assert.equal(r.status, 200);
  assert.deepEqual(drv.chamadas.at(-1), { op: "navegar", noId: "nav:pesquisa", args: ["back"] });
  r = await m.cli("browser-nav", { acao: "javascript:alert(1)" }, m.eA);
  assert.equal(r.status, 400, "nav para url proibida");

  // outro agente sem aresta nao controla
  r = await m.cli("browser-read", { nav: "pesquisa" }, m.eB);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /navegador pesquisa não está conectado a você/);
  await post("/canvas/op", { projeto: m.projeto, ops: [{ op: "upsert", tipo: "aresta", item: { id: "e-b-nav", de: "ag:" + m.b, para: "nav:pesquisa", rev: Date.now() } }] });
  r = await m.cli("browser-read", { nav: "pesquisa" }, m.eB);
  assert.equal(r.status, 200, "com aresta, controla");
});

test("browser shot: PNG em .orchestra/shots, card de imagem ligado e .orchestra no exclude (CA-7b)", async (t) => {
  const drv = driverFalso();
  const m = await montar(t, { navegador: drv });
  await m.cli("browser-create", { nome: "pesquisa", url: "https://example.com" }, m.eA);
  const r = await m.cli("browser-shot", {}, m.eA);
  assert.equal(r.status, 200);
  const saida = (await r.text()).trim();
  const caminho = saida.split("\n").pop()!.trim();
  assert.match(caminho.replace(/\\/g, "/"), /\.orchestra\/shots\/pesquisa-\d{8}-\d{6}\.png$/);
  assert.ok(path.isAbsolute(caminho), "caminho absoluto para o agente abrir");
  assert.deepEqual(await fs.readFile(caminho), drv.png);
  const exclude = await fs.readFile(path.join(m.cwd, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^\.orchestra\/$/m);
  const s = await m.snap();
  const img = s.nos.find((n) => n.tipo === "imagem")!;
  assert.ok(img && String(img.dados.url).startsWith("/canvas/asset/"), "card de imagem com asset");
  assert.ok(s.arestas.some((e) => e.de === "nav:pesquisa" && e.para === img.id), "ligado ao navegador");
  const asset = await fetch(BASE + img.dados.url);
  assert.equal(asset.status, 200);
});

test("browser sem app (sem driver): erro 'abra o app Hermes' (CA-7c, 16d)", async (t) => {
  const m = await montar(t, {});
  const r = await m.cli("browser-create", { nome: "p", url: "https://example.com" }, m.eA);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /navegador indisponível: abra o app Hermes/);
});
