// Spec da S3 (CA-5, backend): POST /nova-feature passa a aceitar `descricao` (opcional, trim) e
// `anexos` de IMAGEM/DOCUMENTO (ate 10, 25MB cada decodificado, b64 valido). O hub saneia o nome
// (basename — traversal vira nome seguro), salva os arquivos em HERMES_ANEXOS_DIR\<pedido> e passa
// { descricao, anexosDir } ao executor do orchestra-go.ps1 (injetado: o pwsh real NUNCA roda no
// teste). O corpo dessa rota ganha teto proprio, maior que os 64KB atuais (anexos em base64
// inflam ~33%) — no teste o teto e' injetado pequeno pra da' pra exercitar sem trafego gigante.
// Compatibilidade: sem os campos novos, a validacao devolve EXATAMENTE { projeto, feature }
// (deepEqual estrito — o teste antigo ancora isso) e o executor nao recebe extras.
// Mesmo esquema do hub.test.ts: env ajustada ANTES do import dinamico (porta/pastas de mentira).
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
const ANEXOS = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-anexos-"));
process.env.HERMES_ANEXOS_DIR = ANEXOS;
process.env.HERMES_AGENTES_DIR ??= await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-iso-")); // nunca os agentes reais da maquina
const ui = await import("./ui.js");
const B64 = Buffer.from("ola anexo").toString("base64");
const anexo = (nome = "img1.png", dadosB64 = B64, tipo = "image/png") => ({ nome, tipo, dadosB64 });
test("validarNovaFeature: sem os campos novos devolve EXATAMENTE { projeto, feature } (compat)", () => {
    assert.deepEqual(ui.validarNovaFeature({ projeto: " D:\\p ", feature: " f " }), { projeto: "D:\\p", feature: "f" });
    assert.deepEqual(ui.validarNovaFeature({ projeto: "p", feature: "f", descricao: "   " }), { projeto: "p", feature: "f" }, "descricao em branco some");
    assert.deepEqual(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [] }), { projeto: "p", feature: "f" }, "lista vazia de anexos some");
});
test("validarNovaFeature: descricao faz trim e anexos validos passam com nome saneado (CA-5)", () => {
    const v = ui.validarNovaFeature({ projeto: "p", feature: "f", descricao: "  texto\nlongo  " });
    assert.deepEqual(v, { projeto: "p", feature: "f", descricao: "texto\nlongo" });
    const dois = ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo(), anexo("doc.pdf", B64, "application/pdf")] });
    assert.equal(dois?.anexos?.length, 2, "imagem + documento aceitos");
    const saneado = ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("..\\..\\x.png")] });
    assert.equal(saneado?.anexos?.[0]?.nome, "x.png", "traversal vira basename");
});
test("validarNovaFeature: rejeita extensao proibida, b64 invalido, >25MB, >10 anexos e tipos errados (CA-5)", () => {
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("x.exe")] }), null, "exe");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("x.mp4")] }), null, "video fora");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("x.mp3")] }), null, "audio fora");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("x.png", "!!!")] }), null, "b64 invalido");
    const grande = Buffer.alloc(25 * 1024 * 1024 + 1).toString("base64");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("x.png", grande)] }), null, ">25MB decodificado");
    const muitos = Array.from({ length: 11 }, (_, i) => anexo(`a${i}.png`));
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: muitos }), null, ">10 anexos");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", descricao: 42 }), null, "descricao nao-string");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: "nope" }), null, "anexos nao-array");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [{ nome: "x.png" }] }), null, "anexo sem dadosB64");
    assert.equal(ui.validarNovaFeature({ projeto: "p", feature: "f", anexos: [anexo("..\\..")] }), null, "nome some na sanacao");
});
test("rota /nova-feature: salva anexos em disco e repassa { descricao, anexosDir } ao executor (CA-5)", async (t) => {
    const chamadas = [];
    await ui.iniciarUI({
        executarNovaFeature: (projeto, feature, extras) => {
            chamadas.push({ projeto, feature, extras });
            return Promise.resolve({ url: "http://127.0.0.1:9/abc/session/s1" });
        },
        limiteBodyNovaFeature: 1024 * 1024, // 1MB no teste: exercita o teto sem 400MB de trafego
    });
    t.after(() => ui.pararUI());
    const post = (body, hermes = true) => fetch(`http://127.0.0.1:${PORTA}/nova-feature`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(hermes ? { "X-Hermes": "1" } : {}) },
        body: JSON.stringify(body),
    });
    // protecao e validacao seguem valendo com os campos novos
    assert.equal((await post({ projeto: "p", feature: "f", anexos: [anexo()] }, false)).status, 400, "sem X-Hermes");
    assert.equal((await post({ projeto: "p", feature: "f", anexos: [anexo("x.exe")] })).status, 400, "extensao proibida");
    assert.equal((await post({ projeto: "p", feature: "f", descricao: "x".repeat(2 * 1024 * 1024) })).status, 400, "corpo acima do teto injetado");
    // fluxo completo: descricao + 2 anexos chegam ao executor e ao disco
    assert.equal((await post({ projeto: "D:\\p", feature: "f", descricao: " detalhes ", anexos: [anexo(), anexo("doc.pdf", B64, "application/pdf")] })).status, 202, "aceito dispara em background");
    assert.equal(chamadas.length, 1, "executor chamado uma vez");
    const c0 = chamadas[0];
    assert.equal(c0.projeto, "D:\\p");
    assert.equal(c0.feature, "f");
    assert.equal(c0.extras?.descricao, "detalhes", "descricao com trim");
    assert.ok(c0.extras?.anexosDir, "executor recebeu a pasta dos anexos");
    assert.ok(c0.extras.anexosDir.startsWith(ANEXOS), "pasta dentro de HERMES_ANEXOS_DIR");
    assert.equal(await fs.readFile(path.join(c0.extras.anexosDir, "img1.png"), "utf8"), "ola anexo");
    assert.equal(await fs.readFile(path.join(c0.extras.anexosDir, "doc.pdf"), "utf8"), "ola anexo");
    // compat: sem os campos novos o executor nao recebe descricao nem anexosDir
    assert.equal((await post({ projeto: "D:\\p", feature: "g" })).status, 202);
    assert.equal(chamadas.length, 2);
    assert.ok(!chamadas[1].extras?.descricao && !chamadas[1].extras?.anexosDir, "sem extras quando nao enviados");
});
