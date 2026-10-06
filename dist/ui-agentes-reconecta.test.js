// Spec do F2.2: o hub reabre a ponte do /event para agentes recarregados do disco (CA-4a, "hub reconecta").
// Mesmo harness (OpenCode falso) da S3.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
function portaLivre() {
    return new Promise((ok, falha) => {
        const s = net.createServer();
        s.once("error", falha);
        s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => ok(p)); });
    });
}
function openCodeFalso() {
    const chamadas = [];
    const sse = new Set();
    let n = 0;
    const srv = http.createServer((req, res) => {
        let corpo = "";
        req.on("data", (d) => { corpo += d; });
        req.on("end", () => {
            const rota = (req.url || "/").split("?")[0];
            let j = null;
            try {
                j = corpo ? JSON.parse(corpo) : null;
            }
            catch { }
            chamadas.push({ metodo: req.method || "", rota, corpo: j });
            if (rota === "/event") {
                res.writeHead(200, { "Content-Type": "text/event-stream" });
                res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
                sse.add(res);
                res.on("close", () => sse.delete(res));
                return;
            }
            if (rota === "/doc") {
                res.writeHead(200);
                res.end("{}");
                return;
            }
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
            if (/^\/session\/[^/]+\/(prompt_async|abort)$/.test(rota)) {
                res.writeHead(204);
                res.end();
                return;
            }
            if (/^\/session\/[^/]+$/.test(rota) && req.method === "DELETE") {
                res.writeHead(200);
                res.end("true");
                return;
            }
            res.writeHead(404);
            res.end();
        });
    });
    const emitir = (ev) => { for (const r of sse)
        r.write(`data: ${JSON.stringify(ev)}\n\n`); };
    return { srv, chamadas, emitir };
}
const PORTA = await portaLivre();
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
const ui = await import("./ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;
const post = (rota, body, hermes = true) => fetch(BASE + rota, {
    method: "POST", headers: { "Content-Type": "application/json", ...(hermes ? { "X-Hermes": "1" } : {}) }, body: JSON.stringify(body),
});
const ate = async (cond, ms = 3000) => {
    for (let i = 0; i < ms / 50; i++) {
        if (await cond())
            return true;
        await new Promise((r) => setTimeout(r, 50));
    }
    return false;
};
test("agente gravado em disco: ao subir o hub, a ponte reabre e o card recebe ao vivo; serve morto vira 'encerrado'", async (t) => {
    const falso = openCodeFalso();
    await new Promise((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
    const baseFalso = `http://127.0.0.1:${falso.srv.address().port}`;
    const dir = process.env.HERMES_AGENTES_DIR;
    await fs.mkdir(dir, { recursive: true });
    const reg = (id, base, sessao) => ({
        id, projeto: "D:\rc", cwd: "D:\rc", base, sessao, nome: id, papel: "livre", modelo: "opencode-go/glm-5.2",
        instrucao: "", tipo: "opencode", origem: "canvas",
    });
    await fs.writeFile(path.join(dir, "ag-vivo.json"), JSON.stringify(reg("ag-vivo", baseFalso, "ses_9")));
    await fs.writeFile(path.join(dir, "ag-morto.json"), JSON.stringify(reg("ag-morto", "http://127.0.0.1:1", "ses_x")));
    const ctrl = new AbortController();
    t.after(() => ctrl.abort());
    await ui.iniciarUI({ subirServe: async () => { throw new Error("nao deveria subir"); }, matarProcesso: () => { } });
    t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });
    assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")), "hub reabriu a ponte do agente carregado do disco");
    const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
    let texto = "";
    (async () => { const rd = sse.body.getReader(); const dec = new TextDecoder(); for (;;) {
        const { done, value } = await rd.read();
        if (done)
            return;
        texto += dec.decode(value, { stream: true });
    } })().catch(() => { });
    await new Promise((r) => setTimeout(r, 200));
    falso.emitir({ type: "message.part.updated", properties: { sessionID: "ses_9", part: { id: "pz", messageID: "mz", sessionID: "ses_9", type: "text", text: "voltei-ao-vivo" } } });
    assert.ok(await ate(() => texto.includes("voltei-ao-vivo")), "evento do serve chega no SSE do hub");
    const lista = async () => await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent("D:\rc")}`)).json();
    assert.ok(await ate(async () => (await lista()).find((a) => a.id === "ag-morto")?.status === "encerrado", 4000), "serve inacessivel -> status encerrado");
    assert.notEqual((await lista()).find((a) => a.id === "ag-vivo")?.status, "encerrado");
});
