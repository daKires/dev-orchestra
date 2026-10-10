// Spec da S2: POST /nova-feature assincrono (CA-6/7/8) — validacao, protecao X-Hermes, 409 em
// concorrencia e eventos SSE {novaFeature}. O executor do orchestra-go.ps1 e' injetado (fake):
// o pwsh real nunca roda no teste. Mesmo esquema do hub.test.ts: env antes do import dinamico.
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
function portaLivre() {
    return new Promise((ok, falha) => {
        const s = net.createServer();
        s.once("error", falha);
        s.listen(0, "127.0.0.1", () => {
            const p = s.address().port;
            s.close(() => ok(p));
        });
    });
}
const PORTA = await portaLivre();
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-planf-"));
process.env.HERMES_AGENTES_DIR ??= await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-iso-")); // nunca os agentes reais da maquina
const ui = await import("./ui.js");
test("validarNovaFeature: aceita {projeto, feature} (trim) e rejeita o resto (CA-8)", () => {
    assert.deepEqual(ui.validarNovaFeature({ projeto: " D:\\p ", feature: " f " }), { projeto: "D:\\p", feature: "f" });
    assert.equal(ui.validarNovaFeature({}), null);
    assert.equal(ui.validarNovaFeature({ projeto: "", feature: "f" }), null);
    assert.equal(ui.validarNovaFeature({ projeto: "p" }), null);
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "   " }), null);
    assert.equal(ui.validarNovaFeature("texto"), null);
    assert.equal(ui.validarNovaFeature(null), null);
});
test("rota /nova-feature: 400 sem X-Hermes/body ruim, 202 + SSE rodando->ok, 409 concorrente, erro via SSE (CA-6/7/8)", async (t) => {
    const chamadas = [];
    const pendentes = [];
    let modo = "pendurar";
    await ui.iniciarUI({
        executarNovaFeature: (projeto, feature) => new Promise((ok, falha) => {
            chamadas.push([projeto, feature]);
            if (modo === "erro") {
                falha(new Error("orchestra-go: a pasta principal tem mudancas nao commitadas"));
                return;
            }
            pendentes.push({ projeto, feature, resolver: ok });
        }),
    });
    t.after(() => ui.pararUI());
    // cliente SSE acumulando o texto bruto
    const ctrl = new AbortController();
    t.after(() => ctrl.abort());
    const sse = await fetch(`http://127.0.0.1:${PORTA}/events`, { signal: ctrl.signal });
    assert.equal(sse.status, 200);
    let texto = "";
    const leitor = (async () => {
        const rd = sse.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
            const { done, value } = await rd.read();
            if (done)
                return;
            texto += dec.decode(value, { stream: true });
        }
    })().catch(() => { });
    void leitor;
    const ateConter = async (trecho) => {
        for (let i = 0; i < 100; i++) {
            if (texto.includes(trecho))
                return true;
            await new Promise((r) => setTimeout(r, 50));
        }
        return false;
    };
    const post = (body, hermes = true) => fetch(`http://127.0.0.1:${PORTA}/nova-feature`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(hermes ? { "X-Hermes": "1" } : {}) },
        // G2: o planejador passou a ser obrigatorio; corpos-objeto ganham um planejador valido.
        body: JSON.stringify(body && typeof body === "object" && !Array.isArray(body) ? { planejador: "opencode", modelo: "opencode-go/glm-5.2", ...body } : body),
    });
    assert.equal((await post({ projeto: "D:\\p", feature: "f" }, false)).status, 400, "sem X-Hermes");
    assert.equal((await post({ projeto: "", feature: "f" })).status, 400, "body invalido");
    assert.equal((await post("nao-obj")).status, 400, "body nao-objeto");
    assert.equal((await post({ projeto: "D:\\p", feature: "f" })).status, 202, "aceito dispara em background");
    assert.deepEqual(chamadas, [["D:\\p", "f"]], "executor chamado com projeto/feature");
    assert.ok(await ateConter('"novaFeature"'), "evento novaFeature saiu no SSE");
    assert.ok(await ateConter('"status":"rodando"'), "status rodando no SSE");
    assert.equal((await post({ projeto: "D:\\p", feature: "g" })).status, 409, "criacao em andamento -> 409");
    assert.equal(chamadas.length, 1, "segundo POST nao chamou o executor");
    pendentes[0].resolver({ url: "http://127.0.0.1:9/abc/session/s1" });
    assert.ok(await ateConter('"status":"ok"'), "status ok no SSE");
    assert.ok(await ateConter("127.0.0.1:9/abc/session/s1"), "url do chat no SSE");
    modo = "erro";
    assert.equal((await post({ projeto: "D:\\p", feature: "h" })).status, 202, "livre de novo apos concluir");
    assert.ok(await ateConter('"status":"erro"'), "falha do ps1 vira evento de erro");
    assert.ok(await ateConter("mudancas nao commitadas"), "mensagem do ps1 vai no evento");
});
