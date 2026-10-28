// Spec: script de servidor (dev/preview/...) nao trava o preflight, e timeout/cancelamento matam a arvore
// inteira (npm -> node -> neto), sem orfao ouvindo porta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolverComandos, preflight, ehServidor } from "../dist/swarm.js";
import { iniciar, esperar } from "../dist/runs.js";

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const vivo = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// Alvo: "dev" sobe um filho que sobe um neto ouvindo porta (como npm -> vite) e nunca termina.
function alvo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "pf-servidor-"));
  writeFileSync(path.join(cwd, "neto.js"), `require("net").createServer().listen(0, () => require("fs").writeFileSync("neto.pid", String(process.pid)));`);
  writeFileSync(path.join(cwd, "pai.js"), `require("child_process").spawn(process.execPath, ["neto.js"], { stdio: "inherit" }); setInterval(() => {}, 1000);`);
  writeFileSync(path.join(cwd, "package.json"), JSON.stringify({
    scripts: { dev: "node pai.js", preview: "node pai.js", "test:watch": "node pai.js", build: "node -e 0" },
  }));
  return cwd;
}

async function netoMorre(cwd: string): Promise<void> {
  const arq = path.join(cwd, "neto.pid");
  assert.ok(existsSync(arq), "neto chegou a subir");
  const pid = Number(readFileSync(arq, "utf8"));
  for (let i = 0; i < 50 && vivo(pid); i++) await dormir(100);
  assert.equal(vivo(pid), false, "neto (o 'vite') morreu junto");
}

test("ehServidor: dev/start/serve/preview/watch e variantes", () => {
  for (const n of ["dev", "dev:web", "start", "start:prod", "serve", "preview", "watch", "test:watch"]) assert.ok(ehServidor(n), n);
  for (const n of ["build", "test", "typecheck", "lint", "test:e2e", "develop", "server"]) assert.equal(ehServidor(n), false, n);
});

test("doctor: alvo com 'dev' que nunca termina passa rapido (pula servidores)", async () => {
  const cwd = alvo();
  const { cmds, gate, scripts } = await resolverComandos(cwd);
  assert.deepEqual(cmds, ["npm run build"]);
  const t0 = Date.now();
  const pf = await preflight(cwd, cmds, gate, scripts);
  assert.equal(pf.ok, true);
  assert.ok(Date.now() - t0 < 30_000, "sem esperar o timeout de 120s");
});

test("override inclui 'dev': timeout mata a arvore inteira", async () => {
  const cwd = alvo();
  const { cmds, gate, scripts } = await resolverComandos(cwd, { cmds: ["npm run dev"] });
  assert.deepEqual(cmds, ["npm run dev"]);
  const pf = await preflight(cwd, cmds, gate, scripts, undefined, 5000);
  assert.equal(pf.itens[0].classe, "ambiente");
  await netoMorre(cwd);
});

test("cancelamento no meio do preflight mata a arvore inteira", async () => {
  const cwd = alvo();
  const ctrl = new AbortController();
  setTimeout(() => ctrl.abort(), 4000);
  await assert.rejects(preflight(cwd, ["npm run dev"], [], {}, ctrl.signal, 60_000));
  await netoMorre(cwd);
});

test("status: esperar aceita o prefixo de 8 chars do runId", async () => {
  const id = iniciar(async () => "PAINEL");
  assert.deepEqual(await esperar(id.slice(0, 8), 1000), { fim: "PAINEL" });
  await assert.rejects(esperar(id.slice(0, 7), 10), /nao existe/);
});

test("abrir_run e /cancel: resolverIdRun aceita id, mcpRunId e prefixo unico", async () => {
  const { resolverIdRun } = await import("../dist/hub.js");
  const dir = mkdtempSync(path.join(os.tmpdir(), "pf-runs-"));
  const run = (id: string, mcp: string) => writeFileSync(path.join(dir, id + ".jsonl"), JSON.stringify({ t: "run", ts: 1, mcpRunId: mcp }) + "\n");
  run("e46823c3-aaa-1", "268e3a30-083c-4952-a1b9-0551cb130d1b");
  run("e46823c3-bbb-2", "c2fe97b2-0874-4897-9ecb-8e69bcf65b6b");
  assert.equal(resolverIdRun("e46823c3-bbb-2", dir), "e46823c3-bbb-2", "id completo");
  assert.equal(resolverIdRun("268e3a30-083c-4952-a1b9-0551cb130d1b", dir), "e46823c3-aaa-1", "mcpRunId completo");
  assert.equal(resolverIdRun("c2fe97b2", dir), "e46823c3-bbb-2", "prefixo do mcpRunId");
  assert.equal(resolverIdRun("e46823c3", dir), null, "prefixo ambiguo (mesmo processo)");
  assert.equal(resolverIdRun("c2fe97b", dir), null, "prefixo curto demais");
});
