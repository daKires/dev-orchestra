// Spec do PR3/S3 (CA-16..19): pequenos bugs do hub e da tela de setup.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
const PORTA = await portaLivre();
const TMP = mkdtempSync(path.join(os.tmpdir(), "log-hub-"));
process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_RUNS_DIR = path.join(TMP, "runs");
process.env.DEV_ORCHESTRA_AGENTES_DIR = path.join(TMP, "agentes");
process.env.DEV_ORCHESTRA_CANVAS_DIR = path.join(TMP, "canvas");
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = path.join(TMP, "plan");
const ui: any = await import("../dist/ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

test("lerRuns ignora <id>.instrucao.jsonl (nao vira run fantasma) (CA-16)", () => {
  const dir = mkdtempSync(path.join(TMP, "runs-"));
  writeFileSync(path.join(dir, "r1.jsonl"), JSON.stringify({ t: "run", feature: "f", cwd: "c", total: 1 }) + "\n");
  writeFileSync(path.join(dir, "r1.instrucao.jsonl"), JSON.stringify({ slice: 1, texto: "x", ts: 1 }) + "\n");
  assert.deepEqual([...ui.lerRuns(dir).keys()], ["r1"]);
});

test("hub: corpo com acento partido entre chunks chega integro; /runs/acao com id invalido -> 400 (CA-17, CA-18)", async (t) => {
  await ui.iniciarUI();
  t.after(() => ui.pararUI());
  const raiz = mkdtempSync(path.join(TMP, "acentos-")); // pasta real: /canvas/projetos esconde raiz inexistente
  const corpo = Buffer.from(JSON.stringify({ raiz, nome: "Ação" }), "utf8");
  const corte = corpo.indexOf(Buffer.from("ç", "utf8")) + 1; // no meio dos 2 bytes do 'ç'
  const status = await new Promise<number>((ok, falha) => {
    const req = http.request({ host: "127.0.0.1", port: PORTA, path: "/canvas/projetos", method: "POST",
      headers: { "Content-Type": "application/json", "X-Dev-Orchestra": "1", "Content-Length": corpo.length } }, (res) => { res.resume(); ok(res.statusCode ?? 0); });
    req.on("error", falha);
    req.write(corpo.subarray(0, corte));
    setTimeout(() => req.end(corpo.subarray(corte)), 50);
  });
  assert.equal(status, 204);
  const projetos: Array<{ raiz: string; nome: string }> = (await (await fetch(BASE + "/canvas/projetos")).json()) as any;
  assert.equal(projetos.find((p) => p.raiz === raiz)?.nome, "Ação");

  for (const id of ["../x", "A..B", "run%2F..%2Fx"]) {
    const r = await fetch(`${BASE}/runs/acao?run=${id}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Dev-Orchestra": "1" }, body: JSON.stringify({ acao: "merge" }) });
    assert.equal(r.status, 400, id);
  }
});

test("tela de setup: /salvar com provedor/modelo invalido -> 400 sem instalar nada (CA-19)", { timeout: 30000 }, async () => {
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "dev-orchestra.mjs");
  const home = mkdtempSync(path.join(TMP, "home-"));
  mkdirSync(path.join(home, ".claude"));
  const proc = spawn(process.execPath, [bin], { env: { ...process.env, USERPROFILE: home, HOME: home, DEV_ORCHESTRA_NAO_ABRIR: "1" }, stdio: ["ignore", "pipe", "pipe"] });
  try {
    let saida = "";
    const url = await new Promise<string>((ok, falha) => {
      const tm = setTimeout(() => falha(new Error("nao subiu: " + saida)), 15000);
      proc.stdout!.on("data", (d) => { saida += d; const m = saida.match(/http:\/\/127\.0\.0\.1:\d+/); if (m) { clearTimeout(tm); ok(m[0]); } });
    });
    const salvar = (c: object) => fetch(url + "/salvar", { method: "POST", headers: { "Content-Type": "application/json", "X-Dev-Orchestra": "1" }, body: JSON.stringify(c) });
    assert.equal((await salvar({ provedor: "xx", modelo: "glm-5.2", chave: "k", ferramentas: ["claude"] })).status, 400, "provedor invalido");
    assert.equal((await salvar({ provedor: "go", modelo: "nao-existe", chave: "k", ferramentas: ["claude"] })).status, 400, "modelo invalido");
    assert.equal(existsSync(path.join(home, ".dev-orchestra", "app")), false, "nao copiou o app nem rodou npm install");
  } finally { proc.kill(); }
});
