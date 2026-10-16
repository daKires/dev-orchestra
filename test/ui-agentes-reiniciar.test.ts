// Spec do F2.3: reiniciar a sessao de um agente encerrado (CA-4a).
// Mesmo harness (OpenCode falso) da S3.
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

test("POST /agentes/:id/reiniciar: sobe serve, cria sessao nova, reabre a ponte e volta a 'ok'", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const dir = process.env.HERMES_AGENTES_DIR!;
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "ag-velho.json"), JSON.stringify({
    id: "ag-velho", projeto: "D:\rs", cwd: "D:\rs", base: "http://127.0.0.1:1", sessao: "ses_morta", nome: "Velho", papel: "dev",
    modelo: "opencode-go/glm-5.2", instrucao: "x", tipo: "opencode", origem: "canvas",
  }));
  const subidas: string[] = [];
  await ui.iniciarUI({ subirServe: async (cwd: string) => { subidas.push(cwd); return { base: baseFalso, pid: 5 }; }, matarProcesso: () => {} } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });

  const eu = async () => ((await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent("D:\rs")}`)).json()) as Array<{ id: string; status: string }>).find((a) => a.id === "ag-velho")!;
  assert.ok(await ate(async () => (await eu()).status === "encerrado", 4000), "comeca encerrado (serve morto)");

  assert.equal((await post("/agentes/ag-velho/reiniciar", {}, false)).status, 400, "sem X-Hermes");
  assert.equal((await post("/agentes/ag-nao/reiniciar", {})).status, 404);
  const r = await post("/agentes/ag-velho/reiniciar", {});
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { id: "ag-velho", status: "ok" });
  assert.deepEqual(subidas, ["D:\rs"], "subiu serve na cwd do agente");
  assert.ok(falso.chamadas.some((c) => c.metodo === "POST" && c.rota === "/session"), "sessao nova");
  assert.equal((await eu()).status, "ok");
  assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")), "ponte reaberta");

  const salvo = JSON.parse(await fs.readFile(path.join(dir, "ag-velho.json"), "utf8"));
  assert.equal(salvo.base, baseFalso, "registro atualizado com o serve novo");
  assert.equal(salvo.sessao, "ses_1");

  await post("/agentes/ag-velho/mensagem", { texto: "oi" });
  assert.ok(falso.chamadas.some((c) => c.rota === "/session/ses_1/prompt_async"), "mensagem vai para a sessao nova");
});
