// Spec da S7: o GATE tem timeout proprio (HERMES_GATE_TIMEOUT_MS, padrao 15 min), separado do timeout
// dos comandos dos agentes (HERMES_CMD_TIMEOUT_MS, 120s). Suite que leva mais de 2 min nao pode virar
// GATE-FAILED por timeout. Cada caso roda num processo filho pra env valer no carregamento do modulo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const HERMES = pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), "hermes.js")).href;
function rodarGate(env, cmd) {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "s7-"));
    const script = `
    const h = await import(${JSON.stringify(HERMES)});
    const t0 = Date.now();
    const g = await h.gate(${JSON.stringify(cwd)}, () => {}, [${JSON.stringify(cmd)}], 0);
    console.log(JSON.stringify({ ok: g.ok, ms: Date.now() - t0, gateTimeout: h.GATE_TIMEOUT }));`;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        encoding: "utf8", env: { ...process.env, HERMES_GATE_TIMEOUT_MS: "", HERMES_CMD_TIMEOUT_MS: "", ...env },
    });
    return JSON.parse(out.trim().split("\n").pop());
}
const DORME_3S = `node -e "setTimeout(()=>{},3000)"`;
test("padrao do gate e' 15 minutos (S7)", () => {
    assert.equal(rodarGate({}, `node -e "0"`).gateTimeout, 15 * 60 * 1000);
});
test("gate ignora o timeout curto dos agentes (S7)", () => {
    const r = rodarGate({ HERMES_CMD_TIMEOUT_MS: "1000" }, DORME_3S);
    assert.equal(r.ok, true, "comando de 3s passa no gate mesmo com HERMES_CMD_TIMEOUT_MS=1000");
});
test("HERMES_GATE_TIMEOUT_MS controla o gate (S7)", () => {
    const r = rodarGate({ HERMES_GATE_TIMEOUT_MS: "1000" }, DORME_3S);
    assert.equal(r.ok, false);
    assert.ok(r.ms < 2900, "matou pelo timeout do gate, nao esperou o comando terminar: " + r.ms + "ms");
});
