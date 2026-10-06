// Spec do F2.1: modelo padrao, ocupado/ocioso, deltas do OpenCode 1.18 e aviso so com itens (CA-4a, 5, 9).
// Mesmo harness (OpenCode falso) da S3.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execSync } from "node:child_process";
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
test("F2.1: modelo padrao, ocupado na lista, deltas ao vivo, aviso so com itens (CA-4a, 5, 9)", async (t) => {
    const falso = openCodeFalso();
    await new Promise((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
    const baseFalso = `http://127.0.0.1:${falso.srv.address().port}`;
    const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
    execSync("git init -q", { cwd });
    await ui.iniciarUI({ subirServe: async () => ({ base: baseFalso, pid: 1 }), matarProcesso: () => { } });
    t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });
    const ctrl = new AbortController();
    t.after(() => ctrl.abort());
    const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
    let texto = "";
    (async () => { const rd = sse.body.getReader(); const dec = new TextDecoder(); for (;;) {
        const { done, value } = await rd.read();
        if (done)
            return;
        texto += dec.decode(value, { stream: true });
    } })().catch(() => { });
    const projeto = "D:\f21";
    const { id } = await (await post("/agentes", { projeto, cwd, papel: "livre" })).json();
    const eu = async () => (await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent(projeto)}`)).json()).find((a) => a.id === id);
    assert.equal((await eu()).modelo, "opencode-go/glm-5.2", "modelo padrao quando nao informado");
    assert.equal((await eu()).ocupado, false);
    assert.ok(await ate(() => falso.chamadas.some((c) => c.rota === "/event")));
    falso.emitir({ type: "session.status", properties: { sessionID: "ses_1", status: { type: "busy" } } });
    assert.ok(await ate(async () => (await eu()).ocupado === true), "busy -> ocupado");
    falso.emitir({ type: "message.updated", properties: { sessionID: "ses_1", info: { id: "mA", role: "assistant", sessionID: "ses_1" } } });
    falso.emitir({ type: "message.part.updated", properties: { sessionID: "ses_1", part: { id: "pA", messageID: "mA", sessionID: "ses_1", type: "text", text: "" } } });
    falso.emitir({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "mA", partID: "pA", field: "text", delta: "texto-" } });
    falso.emitir({ type: "message.part.delta", properties: { sessionID: "ses_1", messageID: "mA", partID: "pA", field: "text", delta: "ao-vivo" } });
    assert.ok(await ate(() => texto.includes("texto-ao-vivo")), "deltas viram {agenteLinhas} acumulado");
    falso.emitir({ type: "session.idle", properties: { sessionID: "ses_1" } });
    assert.ok(await ate(async () => (await eu()).ocupado === false), "idle -> ocioso");
    assert.ok(await ate(() => /"ocupado":false/.test(texto.slice(texto.lastIndexOf('"agentes"')))), "broadcast {agentes} com ocupado");
    const no = (nid, tipo, dados) => ({ id: nid, tipo, x: 0, y: 0, w: 10, h: 10, dados, rev: Date.now() });
    const avisos = () => falso.chamadas.filter((c) => c.rota.endsWith("/prompt_async") && /contexto atualizado/.test(JSON.stringify(c.corpo)));
    await post("/canvas/op", { projeto, ops: [{ op: "upsert", tipo: "no", item: no("ag:" + id, "agente", { agenteId: id }) }] });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(avisos().length, 0, "sem itens ligados (so README) nao avisa");
    await post("/canvas/op", { projeto, ops: [
            { op: "upsert", tipo: "no", item: no("n1", "nota", { titulo: "Ideia", corpo: "x" }) },
            { op: "upsert", tipo: "aresta", item: { id: "e1", de: "n1", para: "ag:" + id, rev: Date.now() } },
        ] });
    assert.ok(await ate(() => avisos().length === 1), "com item ligado, avisa");
    const msg = JSON.stringify(avisos()[0].corpo);
    assert.match(msg, /Ideia\.md/);
    assert.doesNotMatch(msg, /atualizado: [^"]*README\.md,|, README\.md/, "README nao entra na lista de nomes alterados");
});
