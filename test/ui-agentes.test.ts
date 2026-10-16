// Spec da S3 (F2): rotas /agentes, ponte do /event do OpenCode e contexto em disco (CA-4a, 4c, 5, 9).
// Um OpenCode FALSO (http local) faz o papel do `opencode serve`; o spawn real nunca roda.
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

test("agentes: criar, conversar, ponte do /event, modelo, abortar, encerrar (CA-4a, 4c, 5)", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const mortos: number[] = [];
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  execSync("git init -q", { cwd });
  await ui.iniciarUI({ subirServe: async () => ({ base: baseFalso, pid: 4242 }), matarProcesso: (pid: number) => { mortos.push(pid); } } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });

  const ctrl = new AbortController();
  t.after(() => ctrl.abort());
  const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
  let texto = "";
  (async () => { const rd = sse.body!.getReader(); const dec = new TextDecoder(); for (;;) { const { done, value } = await rd.read(); if (done) return; texto += dec.decode(value, { stream: true }); } })().catch(() => {});

  assert.equal((await post("/agentes", { projeto: "D:\\p", cwd, papel: "designer" }, false)).status, 400, "sem X-Hermes");
  assert.equal((await post("/agentes", { projeto: "D:\\p", papel: "designer" })).status, 400, "sem cwd");
  assert.equal((await post("/agentes", { projeto: "D:\\p", cwd, papel: "pirata" })).status, 400, "papel invalido");

  const r = await post("/agentes", { projeto: "D:\\p", cwd, papel: "designer", modelo: "opencode-go/glm-5.2" });
  assert.equal(r.status, 200);
  const { id, status } = await r.json() as { id: string; status: string };
  assert.match(id, /^ag-[a-z0-9-]+$/);
  assert.equal(status, "ok");
  assert.ok(falso.chamadas.some((c) => c.metodo === "POST" && c.rota === "/session"), "criou sessao no OpenCode");

  const lista = await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent("D:\\p")}`)).json() as Array<{ id: string; nome: string; papel: string; status: string }>;
  const eu = lista.find((a) => a.id === id)!;
  assert.equal(eu.nome, "Designer");
  assert.equal(eu.papel, "designer");

  const hist = await (await fetch(`${BASE}/agentes/${id}/historico`)).json() as Array<{ texto: string }>;
  assert.deepEqual(hist.map((l) => l.texto), ["historico"]);

  assert.equal((await post(`/agentes/${id}/mensagem`, { texto: "oi" })).status, 204);
  const prompt = falso.chamadas.find((c) => c.rota.endsWith("/prompt_async"))!;
  assert.ok(prompt, "mensagem chegou no prompt_async");
  assert.deepEqual(prompt.corpo.parts, [{ type: "text", text: "oi" }]);
  assert.deepEqual(prompt.corpo.model, { providerID: "opencode-go", modelID: "glm-5.2" });
  assert.match(prompt.corpo.system, /README\.md/, "instrucao manda ler o contexto");

  assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")), "hub assinou o /event");
  falso.emitir({ type: "message.part.updated", properties: { part: { id: "px", sessionID: "ses_1", messageID: "mx", type: "text", text: "resposta-do-agente" } } });
  assert.ok(await ate(() => texto.includes('"agenteLinhas"') && texto.includes("resposta-do-agente")), "evento virou {agenteLinhas} no SSE");

  const modelos = await (await fetch(`${BASE}/agentes/modelos?cwd=${encodeURIComponent(cwd)}`)).json() as string[];
  assert.deepEqual(modelos.sort(), ["opencode-go/glm-5.2", "opencode-go/kimi-k3"]);
  assert.equal((await post(`/agentes/${id}/modelo`, { modelo: "opencode-go/kimi-k3" })).status, 204);
  await post(`/agentes/${id}/mensagem`, { texto: "de novo" });
  const ultimo = falso.chamadas.filter((c) => c.rota.endsWith("/prompt_async")).pop()!;
  assert.deepEqual(ultimo.corpo.model, { providerID: "opencode-go", modelID: "kimi-k3" });

  assert.equal((await post(`/agentes/${id}/abortar`, {})).status, 204);
  assert.ok(falso.chamadas.some((c) => c.rota === "/session/ses_1/abort"));

  assert.equal((await post("/agentes/ag-nao-existe/mensagem", { texto: "x" })).status, 404);
  assert.equal((await post(`/agentes/${id}/mensagem`, { texto: "x" }, false)).status, 400);

  assert.equal((await post(`/agentes/${id}/encerrar`, {})).status, 204);
  assert.ok(falso.chamadas.some((c) => c.metodo === "DELETE" && c.rota === "/session/ses_1"), "apagou a sessao");
  assert.deepEqual(mortos, [4242], "ultimo agente do worktree: serve encerrado");
  const depois = await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent("D:\\p")}`)).json() as Array<{ id: string }>;
  assert.ok(!depois.some((a) => a.id === id), "saiu da lista");
});

test("agentes: falha ao subir o serve vira status 'falhou' com mensagem (CA-5)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => { throw new Error("opencode nao encontrado"); }, matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  const r = await post("/agentes", { projeto: "D:\\q", cwd, papel: "dev" });
  assert.equal(r.status, 200);
  const j = await r.json() as { id: string; status: string; erro: string };
  assert.equal(j.status, "falhou");
  assert.match(j.erro, /opencode/);
});

test("contexto: ligar nota ao agente grava .orchestra/contexto e avisa uma vez (CA-9)", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  execSync("git init -q", { cwd });
  await ui.iniciarUI({ subirServe: async () => ({ base: baseFalso, pid: 7 }), matarProcesso: () => {} } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });

  const projeto = "D:\\ctx";
  const { id } = await (await post("/agentes", { projeto, cwd, papel: "designer" })).json() as { id: string };
  const no = (nid: string, tipo: string, dados: Record<string, unknown>) => ({ id: nid, tipo, x: 0, y: 0, w: 10, h: 10, dados, rev: Date.now() });
  const r = await post("/canvas/op", { projeto, ops: [
    { op: "upsert", tipo: "no", item: no("ag:" + id, "agente", { agenteId: id }) },
    { op: "upsert", tipo: "no", item: no("n1", "nota", { titulo: "Direção", corpo: "use azul" }) },
    { op: "upsert", tipo: "aresta", item: { id: "e1", de: "n1", para: "ag:" + id, rev: Date.now() } },
  ] });
  assert.ok(r.status === 200 || r.status === 204);

  const dir = path.join(cwd, ".orchestra", "contexto", id);
  assert.ok(await ate(() => existsSync(path.join(dir, "Direção.md")) && existsSync(path.join(dir, "README.md"))), "arquivos de contexto gravados");
  assert.equal(await fs.readFile(path.join(dir, "Direção.md"), "utf8"), "# Direção\n\nuse azul\n");
  const exclude = await fs.readFile(path.join(cwd, ".git", "info", "exclude"), "utf8");
  assert.match(exclude, /^\.orchestra\/$/m, ".orchestra/ fora do git status");
  assert.equal(execSync("git status --porcelain", { cwd }).toString().trim(), "");

  const avisos = () => falso.chamadas.filter((c) => c.rota.endsWith("/prompt_async") && /contexto atualizado/.test(JSON.stringify(c.corpo)));
  assert.ok(await ate(() => avisos().length === 1), "um aviso de contexto");
  await new Promise((r2) => setTimeout(r2, 400));
  assert.equal(avisos().length, 1, "nao repete");

  await post("/canvas/op", { projeto, ops: [{ op: "remove", tipo: "aresta", item: { id: "e1", rev: Date.now() + 10 } }] });
  assert.ok(await ate(() => !existsSync(path.join(dir, "Direção.md"))), "desligar remove o arquivo");
});
