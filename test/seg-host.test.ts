// Spec do PR1/S1 (CA-1, CA-2): hub e tela de setup recusam Host que nao seja 127.0.0.1:P / localhost:P.
// Barra DNS rebinding: a pagina maliciosa vira "mesma origem" e manda X-Hermes, mas o Host dela e' o dominio dela.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { promises as fs, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

// fetch nao deixa trocar o Host: http.request cru. Devolve so' o status (corta SSE/corpo).
function pedir(porta: number, host: string, rota: string, metodo = "GET", corpo = "", extra: Record<string, string> = {}): Promise<number> {
  return new Promise((ok, falha) => {
    const req = http.request({ host: "127.0.0.1", port: porta, path: rota, method: metodo,
      headers: { Host: host, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(corpo), ...extra } }, (res) => {
      ok(res.statusCode ?? 0);
      res.destroy();
    });
    req.on("error", falha);
    req.end(corpo);
  });
}

const PORTA = await portaLivre();
process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_RUNS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-runs-"));
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-plan-"));
process.env.DEV_ORCHESTRA_CANVAS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-canvas-"));
process.env.DEV_ORCHESTRA_AGENTES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-ag-"));
const ui = await import("../dist/ui.js");

test("hub: Host alheio -> 403 em GET, POST e /events; Host local segue normal (CA-1)", async (t) => {
  await ui.iniciarUI();
  t.after(() => ui.pararUI());
  const mau = `evil.com:${PORTA}`;
  assert.equal(await pedir(PORTA, mau, "/versao"), 403, "GET /versao");
  assert.equal(await pedir(PORTA, mau, "/events"), 403, "SSE");
  assert.equal(await pedir(PORTA, mau, "/canvas?projeto=x"), 403, "GET de dados");
  assert.equal(await pedir(PORTA, mau, "/agentes/ag-x/teclas", "POST", JSON.stringify({ dados: "dir\r" }), { "X-Dev-Orchestra": "1" }), 403, "POST com X-Hermes");
  assert.equal(await pedir(PORTA, mau, "/ceder", "POST", "", { "X-Dev-Orchestra": "1" }), 403, "ceder nao derruba o hub");
  assert.equal(await pedir(PORTA, `127.0.0.1.evil.com:${PORTA}`, "/versao"), 403, "prefixo enganoso");
  assert.equal(await pedir(PORTA, "127.0.0.1:1", "/versao"), 403, "porta errada");
  assert.equal(await pedir(PORTA, `127.0.0.1:${PORTA}`, "/versao"), 200, "127.0.0.1");
  assert.equal(await pedir(PORTA, `localhost:${PORTA}`, "/versao"), 200, "localhost");
  assert.equal(await pedir(PORTA, `LOCALHOST:${PORTA}`, "/versao"), 200, "host e' case-insensitive");
});

test("tela de setup: Host alheio -> 403; Host local segue normal (CA-2)", { timeout: 30000 }, async () => {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "dev-orchestra.mjs");
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "seg-home-"));
  mkdirSync(path.join(home, ".claude"));
  const proc = spawn(process.execPath, [bin], { env: { ...process.env, USERPROFILE: home, HOME: home, DEV_ORCHESTRA_NAO_ABRIR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    let saida = "";
    const porta = await new Promise<number>((ok, falha) => {
      const tm = setTimeout(() => falha(new Error("nao subiu: " + saida)), 15000);
      proc.stdout!.on("data", (d) => { saida += d; const m = saida.match(/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(tm); ok(Number(m[1])); } });
    });
    const mau = `evil.com:${porta}`;
    assert.equal(await pedir(porta, mau, "/"), 403, "GET da tela");
    assert.equal(await pedir(porta, mau, "/estado"), 403, "GET /estado");
    assert.equal(await pedir(porta, mau, "/salvar", "POST", "{}", { "X-Dev-Orchestra": "1" }), 403, "POST /salvar");
    assert.equal(await pedir(porta, `127.0.0.1:${porta}`, "/estado"), 200);
    assert.equal(await pedir(porta, `localhost:${porta}`, "/estado"), 200);
  } finally { proc.kill(); }
});
