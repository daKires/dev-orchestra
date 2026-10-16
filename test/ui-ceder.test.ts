// Regressao (F3 S0): ceder()/pararUI precisam fechar as pontes do /event e cancelar reconexoes em voo.
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


test("ceder() fecha as pontes do /event (o hub antigo nao fica pendurado)", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const conexoes = () => falso.srv.getConnections ? new Promise<number>((ok) => falso.srv.getConnections((_e, n) => ok(n))) : Promise.resolve(0);
  const dir = process.env.HERMES_AGENTES_DIR!;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ag-pendura.json"), JSON.stringify({
    id: "ag-pendura", projeto: "D:\cd", cwd: "D:\cd", base: baseFalso, sessao: "ses_1", nome: "P", papel: "livre",
    modelo: "opencode-go/glm-5.2", instrucao: "", tipo: "opencode", origem: "canvas",
  }));
  let cedeu = false;
  await ui.iniciarUI({ onCeder: () => { cedeu = true; }, subirServe: async () => ({ base: baseFalso, pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });
  assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")), "ponte aberta");
  assert.ok(await ate(async () => (await conexoes()) > 0));
  assert.equal((await post("/ceder", {})).status, 204);
  assert.ok(await ate(() => cedeu));
  assert.ok(await ate(async () => (await conexoes()) === 0, 3000), "ceder fechou a conexao do /event");
});

test("corrida: reconexao em voo nao abre ponte depois de ceder/pararUI", async (t) => {
  const eventos: number[] = [];
  const lento = http.createServer((req, res) => {
    const rota = (req.url || "/").split("?")[0];
    if (rota === "/doc") { setTimeout(() => { res.writeHead(200); res.end("{}"); }, 700); return; }
    if (rota === "/event") { eventos.push(Date.now()); res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: {}\n\n"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((ok) => lento.listen(0, "127.0.0.1", () => ok()));
  const base = `http://127.0.0.1:${(lento.address() as net.AddressInfo).port}`;
  const dir = process.env.HERMES_AGENTES_DIR!;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ag-lento.json"), JSON.stringify({
    id: "ag-lento", projeto: "D:\lt", cwd: "D:\lt", base, sessao: "ses_1", nome: "L", papel: "livre",
    modelo: "opencode-go/glm-5.2", instrucao: "", tipo: "opencode", origem: "canvas",
  }));
  let cedeu = false;
  await ui.iniciarUI({ onCeder: () => { cedeu = true; }, subirServe: async () => ({ base, pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => { ui.pararUI(); lento.closeAllConnections(); lento.close(); });
  await new Promise((r) => setTimeout(r, 150)); // /doc ainda em voo
  assert.equal((await post("/ceder", {})).status, 204);
  assert.ok(await ate(() => cedeu));
  await new Promise((r) => setTimeout(r, 1500)); // o /doc lento responde aqui
  assert.deepEqual(eventos, [], "nenhuma ponte aberta depois de ceder");
});

test("corrida (pararUI): reconexao em voo nao abre ponte depois de pararUI", async (t) => {
  const eventos: number[] = [];
  const lento = http.createServer((req, res) => {
    const rota = (req.url || "/").split("?")[0];
    if (rota === "/doc") { setTimeout(() => { res.writeHead(200); res.end("{}"); }, 700); return; }
    if (rota === "/event") { eventos.push(Date.now()); res.writeHead(200, { "Content-Type": "text/event-stream" }); res.write("data: {}\n\n"); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((ok) => lento.listen(0, "127.0.0.1", () => ok()));
  const base = `http://127.0.0.1:${(lento.address() as net.AddressInfo).port}`;
  const dir = process.env.HERMES_AGENTES_DIR!;
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ag-lento2.json"), JSON.stringify({
    id: "ag-lento2", projeto: "D:\lt", cwd: "D:\lt", base, sessao: "ses_1", nome: "L", papel: "livre",
    modelo: "opencode-go/glm-5.2", instrucao: "", tipo: "opencode", origem: "canvas",
  }));
    await ui.iniciarUI({ subirServe: async () => ({ base, pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => { ui.pararUI(); lento.closeAllConnections(); lento.close(); });
  await new Promise((r) => setTimeout(r, 150)); // /doc ainda em voo
  ui.pararUI();
  await new Promise((r) => setTimeout(r, 1500)); // o /doc lento responde aqui
  assert.deepEqual(eventos, [], "nenhuma ponte aberta depois de pararUI");
});

test("assumirPorta: o app reaberto toma a porta de volta de outro hub (hermes com o app aberto)", async (t) => {
  await ui.iniciarUI({ sempreAssumir: true, subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  assert.equal((await post("/ceder", {})).status, 204); // um hub stdio pegou a porta (simulado abaixo)
  await new Promise((r) => setTimeout(r, 200));
  let cedeu = false;
  const outro = http.createServer((req, res) => {
    if (req.url === "/versao") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ versao: 1 })); return; }
    if (req.url === "/ceder") { res.writeHead(204); res.end(); cedeu = true; setTimeout(() => { outro.closeAllConnections(); outro.close(); }, 20); return; }
    res.writeHead(404); res.end();
  });
  await new Promise<void>((ok) => outro.listen(PORTA, "127.0.0.1", () => ok()));
  await ui.assumirPorta();
  assert.ok(cedeu, "pediu pro outro hub ceder");
  const r = await fetch(BASE + "/versao");
  assert.ok((await r.json() as { versao: number }).versao !== 1, "a porta voltou pro hub do app");
});
