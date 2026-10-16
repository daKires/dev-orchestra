// Spec da S2 (F3): rotas /cli, identidade por token, fila de entregas, /arvore e PATH do serve.
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


test("F3: identidade, list/ask/reply/tell, fila, limites, conversas, flow/file/note, arvore e PATH", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  execSync("git init -q", { cwd });
  await fs.mkdir(path.join(cwd, "src"), { recursive: true });
  await fs.writeFile(path.join(cwd, "src", "a.ts"), "export const a = 1;\n");
  await fs.writeFile(path.join(cwd, "README.md"), "# oi\n");
  execSync("git add -A", { cwd });
  await fs.writeFile(path.join(cwd, "novo.txt"), "nao rastreado\n");
  const envs: Array<Record<string, string | undefined>> = [];
  await ui.iniciarUI({
    subirServe: async (_cwd: string, env?: Record<string, string | undefined>) => { envs.push(env ?? {}); return { base: baseFalso, pid: 3 }; },
    matarProcesso: () => {},
  } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });

  const ctrl = new AbortController();
  t.after(() => ctrl.abort());
  const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
  let texto = "";
  (async () => { const rd = sse.body!.getReader(); const dec = new TextDecoder(); for (;;) { const { done, value } = await rd.read(); if (done) return; texto += dec.decode(value, { stream: true }); } })().catch(() => {});

  const projeto = "D:\\f3";
  const lid = (await (await post("/agentes", { projeto, cwd, papel: "lider", nome: "Líder" })).json() as { id: string }).id;
  const des = (await (await post("/agentes", { projeto, cwd, papel: "designer", nome: "Designer" })).json() as { id: string }).id;
  const rev = (await (await post("/agentes", { projeto, cwd, papel: "revisor", nome: "Revisor" })).json() as { id: string }).id;

  // PATH do serve com bin/ na frente
  assert.ok(envs.length >= 1, "subirServe recebeu env");
  const pathVar = envs[0].PATH ?? envs[0].Path ?? "";
  assert.match(pathVar.split(path.delimiter)[0], /[\\/]bin$/, "bin/ do hermes-bridge no inicio do PATH");

  // identidade: token no registro, fora do GET /agentes, dentro do system
  const tokenDe = async (id: string) => JSON.parse(await fs.readFile(path.join(process.env.HERMES_AGENTES_DIR!, id + ".json"), "utf8")).token as string;
  const tLid = await tokenDe(lid);
  const tDes = await tokenDe(des);
  assert.ok(tLid && tLid.length >= 16);
  const lista = await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent(projeto)}`)).text();
  assert.ok(!lista.includes(tLid), "token nunca sai no GET /agentes");
  await post(`/agentes/${lid}/mensagem`, { texto: "oi" });
  const sys = falso.chamadas.filter((c) => c.rota.endsWith("/prompt_async")).pop()!.corpo.system as string;
  assert.ok(sys.includes(`canvas --eu ${lid}:${tLid}`), "instrucao traz a identidade");

  const cli = (cmd: string, corpo: unknown, eu: string) => fetch(`${BASE}/cli/${cmd}`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1", "X-Eu": eu }, body: JSON.stringify(corpo),
  });
  const r403 = await cli("list", {}, `${lid}:errado`);
  assert.equal(r403.status, 403);
  assert.match(await r403.text(), /identidade inválida/);
  assert.equal((await fetch(`${BASE}/cli/list`, { method: "POST", headers: { "X-Eu": `${lid}:${tLid}` }, body: "{}" })).status, 400, "sem X-Hermes");

  // canvas: Lider ligado ao Designer (Revisor solto)
  const no = (nid: string, tipo: string, dados: Record<string, unknown>, x = 0, y = 0) => ({ id: nid, tipo, x, y, w: 620, h: 420, dados, rev: Date.now() });
  await post("/canvas/op", { projeto, ops: [
    { op: "upsert", tipo: "no", item: no("ag:" + lid, "agente", { agenteId: lid }, 0, 1000) },
    { op: "upsert", tipo: "no", item: no("ag:" + des, "agente", { agenteId: des }, 800, 1000) },
    { op: "upsert", tipo: "no", item: no("ag:" + rev, "agente", { agenteId: rev }, 1600, 1000) },
    { op: "upsert", tipo: "aresta", item: { id: "e-ld", de: "ag:" + lid, para: "ag:" + des, rev: Date.now() } },
  ] });

  const eL = `${lid}:${tLid}`;
  const eD = `${des}:${tDes}`;
  let r = await cli("list", {}, eL);
  assert.equal(r.status, 200);
  const txtList = await r.text();
  assert.match(txtList, new RegExp(`designer \\(${des}\\) — Designer, ocioso`));
  assert.ok(!txtList.includes(rev), "Revisor nao esta conectado");

  r = await cli("ask", { alvo: "revisor", texto: "x" }, eL);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /não está conectado a você/);

  // ask com alvo ocioso: entrega na hora
  const antes = falso.chamadas.length;
  r = await cli("ask", { alvo: "designer", texto: "Proponha um título" }, eL);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /pergunta q-1 enviada a Designer/);
  const entregaD = falso.chamadas.slice(antes).find((c) => c.rota === "/session/ses_2/prompt_async")!;
  assert.ok(entregaD, "chegou na sessao do Designer");
  assert.equal(entregaD.corpo.parts[0].text, '[pergunta de Líder · q-1] Proponha um título -- responda com: canvas reply q-1 "<resultado>"');
  assert.ok(await ate(() => /"conversas":\[[^\]]*"q":"q-1"/.test(texto)), "{conversas} no SSE");

  // reply do Designer volta para o Lider
  r = await cli("reply", { q: "q-1", texto: "Construa com tudo à vista" }, eD);
  assert.equal(r.status, 200);
  assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/session/ses_1/prompt_async" && c.corpo.parts[0].text === "[resposta de Designer · q-1] Construa com tudo à vista")));
  r = await cli("reply", { q: "q-1", texto: "de novo" }, eD);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /q-1 já respondida/);

  // alvo ocupado: enfileira e entrega no idle
  assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")));
  falso.emitir({ type: "session.status", properties: { sessionID: "ses_2", status: { type: "busy" } } });
  await new Promise((ok) => setTimeout(ok, 200));
  const marca = falso.chamadas.length;
  r = await cli("tell", { alvo: des, texto: "implemente a seção" }, eL);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /enfileirada \(Designer ocupado\)/);
  await new Promise((ok) => setTimeout(ok, 300));
  assert.ok(!falso.chamadas.slice(marca).some((c) => c.rota === "/session/ses_2/prompt_async"), "nao entrega com o alvo ocupado");
  falso.emitir({ type: "session.idle", properties: { sessionID: "ses_2" } });
  assert.ok(await ate(() => falso.chamadas.slice(marca).some((c) => c.rota === "/session/ses_2/prompt_async" && c.corpo.parts[0].text === "[mensagem de Líder] implemente a seção")), "entregue no idle");

  // limite de 3 pendentes
  for (let i = 0; i < 3; i++) assert.equal((await cli("ask", { alvo: "designer", texto: "p" + i }, eL)).status, 200);
  r = await cli("ask", { alvo: "designer", texto: "p4" }, eL);
  assert.equal(r.status, 400);
  assert.match(await r.text(), /limite/);

  // flow / file / note viram ops no canvas
  assert.equal((await cli("flow-add", { chave: "ideia", forma: "elipse", texto: "Ideia" }, eL)).status, 200);
  assert.equal((await cli("flow-add", { chave: "fim", forma: "retangulo", texto: "Pronto", cor: "verde" }, eL)).status, 200);
  assert.equal((await cli("flow-link", { a: "ideia", b: "fim", rotulo: "ok" }, eL)).status, 200);
  assert.equal((await cli("file", { caminho: "src/a.ts", status: "pronta para revisar" }, eD)).status, 200);
  assert.equal((await cli("file", { caminho: "../fora.txt", status: "x" }, eD)).status, 400, "traversal recusado");
  assert.equal((await cli("note", { titulo: "Decisões", corpo: "azul" }, eD)).status, 200);
  assert.equal((await cli("flow-add", { chave: "x", forma: "estrela", texto: "x" }, eL)).status, 400);
  const snap = await (await fetch(`${BASE}/canvas?projeto=${encodeURIComponent(projeto)}`)).json() as { nos: Array<{ id: string }>; arestas: Array<{ de: string; para: string }> };
  const ids = snap.nos.map((n) => n.id);
  for (const id of [`flowreg:${lid}`, `flow:${lid}:ideia`, `flow:${lid}:fim`, `arq-ag:${des}:src/a.ts`, `nota-ag:${des}:decisoes`]) assert.ok(ids.includes(id), id);
  assert.ok(snap.arestas.some((a) => a.de === `flow:${lid}:ideia` && a.para === `flow:${lid}:fim`));

  // arvore e preview
  const arv = await (await fetch(`${BASE}/arvore?agente=${des}`)).json() as string[];
  assert.deepEqual([...arv].sort(), ["README.md", "novo.txt", "src/a.ts"]);
  const prev = await fetch(`${BASE}/arquivo?agente=${des}&caminho=${encodeURIComponent("src/a.ts")}`);
  assert.equal(prev.status, 200);
  assert.equal(await prev.text(), "export const a = 1;\n");
  assert.equal((await fetch(`${BASE}/arquivo?agente=${des}&caminho=${encodeURIComponent("../x")}`)).status, 400);
  assert.equal((await fetch(`${BASE}/arvore?agente=ag-nao`)).status, 404);
});
