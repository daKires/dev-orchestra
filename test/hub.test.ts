// Spec da S1: flag --ui (CA-1/CA-2) + leitura/limpeza dos registros de planejadores (CA-3, CA-9..12).
// SEM import estatico de ui.js: ui.ts le HERMES_UI_PORT/HERMES_PLANEJADORES_DIR no carregamento do
// modulo — a env e' ajustada ANTES do import dinamico pra nunca tocar na porta 4123 real nem nos
// registros reais de %TEMP%\hermes\planejadores.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Planejador } from "../dist/ui.js";

const AQUI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => ok(p));
    });
  });
}

const PORTA = await portaLivre();
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-plan-"));
process.env.HERMES_AGENTES_DIR ??= await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-iso-")); // nunca os agentes reais da maquina
const ui = await import("../dist/ui.js");

const REG = (over: Partial<Planejador> = {}): Planejador => ({
  slug: "x", projeto: "p", raiz: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x",
  feature: "f", url: "http://127.0.0.1:1/a/session/s", base: "http://127.0.0.1:1", pid: 1234, ts: 1,
  ...over,
});

test("lerPlanejadores: le JSONs validos, ignora corrompidos/incompletos e pasta inexistente (CA-3)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-lp-"));
  await fs.writeFile(path.join(dir, "a.json"), JSON.stringify(REG({ slug: "a" })));
  await fs.writeFile(path.join(dir, "b.json"), JSON.stringify(REG({ slug: "b" })));
  await fs.writeFile(path.join(dir, "ruim.json"), "{quebrado");
  await fs.writeFile(path.join(dir, "vazio.json"), "{}"); // JSON valido mas sem os campos obrigatorios
  await fs.writeFile(path.join(dir, "nota.txt"), "nao e json");
  const lidos = ui.lerPlanejadores(dir);
  assert.equal(lidos.length, 2);
  assert.deepEqual(lidos.map((p) => p.slug).sort(), ["a", "b"]);
  assert.ok(lidos[0].url.startsWith("http://127.0.0.1:"));
  assert.deepEqual(ui.lerPlanejadores(path.join(dir, "nao-existe")), []);
});

test("limparPlanejadores: worktree sumiu mata so' se for opencode; pid morto so' remove (CA-9/10/11/12)", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-lz-"));
  for (const [nome, p] of Object.entries({
    "vivo.json": REG({ slug: "vivo", pid: 1 }),      // cwd existe + pid vivo -> mantem (CA-12)
    "morto.json": REG({ slug: "morto", pid: 2 }),    // pid morto -> remove, sem matar (CA-10)
    "orfao.json": REG({ slug: "orfao", pid: 3 }),    // cwd sumiu + opencode vivo -> mata + remove (CA-9)
    "reusado.json": REG({ slug: "reusado", pid: 4 }), // cwd sumiu + pid reutilizado -> NAO mata, remove (CA-11)
  })) await fs.writeFile(path.join(dir, nome), JSON.stringify(p));

  const mortos: number[] = [];
  const removidos: string[] = [];
  const opencodeConsultado: number[] = [];
  await ui.limparPlanejadores(dir, {
    existeCwd: (cwd) => !cwd.includes("orfao") && !cwd.includes("reusado"),
    vivo: (pid) => pid !== 2,
    ehOpencode: async (pid) => { opencodeConsultado.push(pid); return pid === 3; },
    matar: (pid) => { mortos.push(pid); },
    remover: (arq) => { removidos.push(path.basename(arq)); },
  });
  assert.deepEqual(mortos, [3], "so' o opencode orfao morre");
  assert.deepEqual(removidos.sort(), ["morto.json", "orfao.json", "reusado.json"]);
  assert.deepEqual(opencodeConsultado, [3, 4], "ehOpencode so' e' consultado com worktree sumido e pid vivo");
});

test("ceder a porta chama onCeder (modo --ui) e fecha o servidor (CA-2)", async (t) => {
  t.after(() => ui.pararUI());
  let cedeu = 0;
  await ui.iniciarUI({ onCeder: () => { cedeu++; } });
  const v: any = await fetch(`http://127.0.0.1:${PORTA}/versao`).then((r) => r.json());
  assert.equal(typeof v.versao, "number");
  const resp = await fetch(`http://127.0.0.1:${PORTA}/ceder`, { method: "POST", headers: { "X-Hermes": "1" } });
  assert.equal(resp.status, 204);
  await new Promise((r) => setTimeout(r, 400)); // ceder() e' agendado ~50ms depois do 204
  assert.equal(cedeu, 1, "onCeder chamado uma vez");
  await assert.rejects(fetch(`http://127.0.0.1:${PORTA}/versao`), /fetch failed/);
});

test("--ui: sobe so' o dashboard (sem MCP stdio) e o processo MORRE ao ceder a porta (CA-1/CA-2)", async (t) => {
  const porta2 = await portaLivre();
  const plan2 = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-plan2-"));
  const filho = spawn(process.execPath, [path.join(AQUI, "index.js"), "--ui"], {
    env: { ...process.env, HERMES_UI_PORT: String(porta2), HERMES_PLANEJADORES_DIR: plan2 },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { try { filho.kill(); } catch {} });
  let err = "";
  filho.stderr!.on("data", (d) => { err += d; });
  let ok = false;
  for (let i = 0; i < 75 && !ok; i++) {
    await new Promise((r) => setTimeout(r, 200));
    ok = await fetch(`http://127.0.0.1:${porta2}/versao`).then((r) => r.ok).catch(() => false);
  }
  assert.equal(ok, true, "dashboard --ui respondeu /versao");
  assert.equal(filho.exitCode, null, "processo --ui continua vivo servindo a UI");
  assert.ok(!err.includes("listening (stdio)"), "sem MCP stdio no modo --ui");
  const resp = await fetch(`http://127.0.0.1:${porta2}/ceder`, { method: "POST", headers: { "X-Hermes": "1" } });
  assert.equal(resp.status, 204);
  const codigo = await new Promise((ok2) => {
    filho.once("exit", (c) => ok2(c));
    setTimeout(() => ok2("timeout"), 8000);
  });
  assert.notEqual(codigo, "timeout", "processo --ui morreu apos ceder a porta");
});
