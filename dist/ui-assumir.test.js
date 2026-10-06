// Spec da S1: abrir o app (node index.js --ui) SEMPRE substitui o node do dashboard anterior (CA-1..CA-6).
// MESMO esquema do hub.test.ts: env ajustada ANTES do import dinamico de ui.js (nunca a porta 4123
// real nem os registros reais de %TEMP%\hermes\planejadores). Testes 100% na superficie publica
// (CLI --ui + HTTP): nenhum teste cita o nome de opcoes internas — a implementacao e' livre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const AQUI = path.dirname(fileURLToPath(import.meta.url)); // dist/
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
const PLAN = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-plan-a-"));
process.env.HERMES_PLANEJADORES_DIR = PLAN;
process.env.HERMES_AGENTES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-assumir-ag-")); // nunca os agentes reais
process.env.HERMES_CANVAS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-assumir-cv-"));
const ui = await import("./ui.js");
const ms = (n) => new Promise((r) => setTimeout(r, n));
// GET /versao responde na porta?
async function versaoOK(porta) {
    return fetch(`http://127.0.0.1:${porta}/versao`).then((r) => r.ok).catch(() => false);
}
// Aguarda /versao comecar a responder na porta (filho --ui ou modulo in-process).
async function esperarVersao(porta, msTotal = 15000) {
    for (let i = 0; i < Math.ceil(msTotal / 200) && !(await versaoOK(porta)); i++)
        await ms(200);
    return versaoOK(porta);
}
// Sobe um filho index.js --ui (o "app" de verdade, via CLI) numa porta isolada.
function subirUi(porta) {
    return spawn(process.execPath, [path.join(AQUI, "index.js"), "--ui"], {
        env: { ...process.env, HERMES_UI_PORT: String(porta), HERMES_PLANEJADORES_DIR: PLAN },
        stdio: ["ignore", "pipe", "pipe"],
    });
}
// O processo morreu em ate msTotal? (filho ja morto conta como morto)
function esperarMorte(f, msTotal = 10000) {
    if (f.exitCode !== null || f.signalCode !== null)
        return Promise.resolve(true);
    return new Promise((ok) => { f.once("exit", () => ok(true)); setTimeout(() => ok(false), msTotal); });
}
// Servidor falso na porta: versao > 0 finge ser um hub Hermes (/versao + /ceder); versao = 0 e' um
// processo ALHEIO (404 em tudo, nunca cede). Conta /ceder validos e qualquer POST (pro alheio).
function servidorFalso(porta, versao, fecharAoCeder = false) {
    return new Promise((ok) => {
        let cedes = 0;
        let posts = 0;
        const srv = http.createServer((req, res) => {
            const url = req.url || "/";
            if (versao > 0 && url === "/versao") {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ versao }));
                return;
            }
            if (versao > 0 && url === "/ceder" && req.method === "POST" && req.headers["x-hermes"] === "1") {
                cedes++;
                res.writeHead(204);
                res.end();
                if (fecharAoCeder)
                    setTimeout(() => { try {
                        srv.close();
                    }
                    catch { } srv.closeAllConnections?.(); }, 50);
                return;
            }
            if (req.method === "POST")
                posts++;
            res.writeHead(404);
            res.end();
        });
        srv.listen(porta, "127.0.0.1", () => ok({
            get cedes() { return cedes; },
            get posts() { return posts; },
            fechar: () => new Promise((f) => { try {
                srv.close();
            }
            catch { } srv.closeAllConnections?.(); f(); }),
        }));
    });
}
test("--ui assume a porta de um hub com versao MAIOR: /ceder e' incondicional (CA-1)", async (t) => {
    const porta = await portaLivre();
    const gigante = Date.now() + 9e9; // versao impossivel de superar: so' cede com regra de sempre-assumir
    const hub = await servidorFalso(porta, gigante, true); // hub falso que fecha a porta ao ceder
    t.after(() => hub.fechar());
    const f = subirUi(porta);
    t.after(() => { try {
        f.kill();
    }
    catch { } });
    let assumiu = false;
    for (let i = 0; i < 75 && !assumiu; i++) {
        await ms(200);
        try {
            const j = await fetch(`http://127.0.0.1:${porta}/versao`).then((r) => r.json());
            if (typeof j?.versao === "number" && j.versao < gigante)
                assumiu = true;
        }
        catch { }
    }
    assert.equal(hub.cedes, 1, "hub com versao maior recebeu POST /ceder mesmo assim");
    assert.ok(assumiu, "o filho --ui assumiu a porta apesar da versao do hub ser maior");
});
test("sessao stdio (sem --ui) NAO rouba a porta de um hub mais novo (CA-4)", async (t) => {
    t.after(() => ui.pararUI());
    const hub = await servidorFalso(PORTA, Date.now() + 9e9);
    t.after(() => hub.fechar());
    await ui.iniciarUI({}); // modo stdio: a regra de versao continua valendo pra ele
    await ms(800); // tempo de sobra pra um /ceder indevido aparecer
    assert.equal(hub.cedes, 0, "hub mais novo NAO recebeu /ceder de sessao stdio");
    const j = await fetch(`http://127.0.0.1:${PORTA}/versao`).then((r) => r.json());
    assert.ok(j.versao > Date.now(), "a porta continua com o hub (a sessao stdio nao assumiu)");
});
test("porta ocupada por processo ALHEIO: nada de POST e o alheio segue vivo (CA-3)", async (t) => {
    const porta = await portaLivre();
    const alheio = await servidorFalso(porta, 0); // sem /versao nem /ceder: nao e' o Hermes
    t.after(() => alheio.fechar());
    const f = subirUi(porta);
    t.after(() => { try {
        f.kill();
    }
    catch { } });
    await ms(4000); // tempo de sobra pro filho tentar (e desistir de) mexer no alheio
    assert.equal(alheio.posts, 0, "nenhum POST foi mandado ao processo alheio");
    assert.equal(alheio.cedes, 0, "o alheio nunca recebeu /ceder");
    const r = await fetch(`http://127.0.0.1:${porta}/versao`);
    assert.equal(r.status, 404, "o processo alheio segue na porta, intocado");
});
test("--ui por cima de --ui: o processo antigo MORRE e o novo serve a porta (CA-1/CA-6)", async (t) => {
    const porta = await portaLivre();
    const a = subirUi(porta);
    t.after(() => { try {
        a.kill();
    }
    catch { } });
    assert.ok(await esperarVersao(porta), "o primeiro --ui subiu o dashboard");
    const b = subirUi(porta); // mesmo dist: MESMA versao de UI
    t.after(() => { try {
        b.kill();
    }
    catch { } });
    assert.ok(await esperarMorte(a), "o --ui antigo morreu ao ceder a porta pro novo");
    assert.ok(await esperarVersao(porta), "o novo --ui responde /versao na porta (CA-6)");
});
test("tres --ui em sequencia: so' o ULTIMO fica vivo servindo (CA-5)", async (t) => {
    const porta = await portaLivre();
    const a = subirUi(porta);
    t.after(() => { try {
        a.kill();
    }
    catch { } });
    assert.ok(await esperarVersao(porta), "o 1o subiu");
    const b = subirUi(porta);
    t.after(() => { try {
        b.kill();
    }
    catch { } });
    assert.ok(await esperarMorte(a), "o 1o morreu pro 2o");
    const c = subirUi(porta);
    t.after(() => { try {
        c.kill();
    }
    catch { } });
    assert.ok(await esperarMorte(b), "o 2o morreu pro 3o");
    assert.ok(await esperarVersao(porta), "o 3o (ultimo) serve a porta");
});
test("sem onCeder (modo stdio): /ceder solta a porta e o processo SEGUE vivo (CA-2)", async (t) => {
    t.after(() => ui.pararUI());
    await ui.iniciarUI({}); // stdio: cede a porta mas NAO morre
    assert.ok(await versaoOK(PORTA), "o modulo subiu o servidor na porta");
    const resp = await fetch(`http://127.0.0.1:${PORTA}/ceder`, { method: "POST", headers: { "X-Hermes": "1" } });
    assert.equal(resp.status, 204);
    await ms(400); // ceder() e' agendado ~50ms depois do 204
    await assert.rejects(fetch(`http://127.0.0.1:${PORTA}/versao`), /fetch failed/, "a porta foi solta");
    await ui.iniciarUI({}); // o MESMO processo reassume a porta depois de ceder (nao morreu)
    assert.ok(await versaoOK(PORTA), "mesmo processo vivo: reassumiu a porta (CA-2)");
});
