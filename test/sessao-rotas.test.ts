// Spec de runs ligadas a sessao (S2): rotas GET /sessoes e POST /runs/sessao do hub (CA-2/CA-3/CA-9).
// Pastas isoladas por env; abrir nunca spawna de verdade (DEV_ORCHESTRA_ABRIR_LOG grava {comando,args}).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}
const PORTA = await portaLivre();
const TMP = mkdtempSync(path.join(os.tmpdir(), "sessao-rotas-"));
const LOG = path.join(TMP, "abrir.log");
process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_RUNS_DIR = path.join(TMP, "runs");
process.env.DEV_ORCHESTRA_AGENTES_DIR = path.join(TMP, "agentes");
process.env.DEV_ORCHESTRA_CANVAS_DIR = path.join(TMP, "canvas");
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = path.join(TMP, "plan");
process.env.DEV_ORCHESTRA_CLAUDE_PROJECTS = path.join(TMP, "claude-projects");
process.env.DEV_ORCHESTRA_OPENCODE_DB = path.join(TMP, "opencode.db");
process.env.DEV_ORCHESTRA_ABRIR_LOG = LOG;
const ui = await import("../dist/ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

const UUID = "5ed3bb76-3454-4379-82a1-9ee99f0a637a";
const CWD = path.join(TMP, "proj");
mkdirSync(CWD, { recursive: true });
mkdirSync(process.env.DEV_ORCHESTRA_RUNS_DIR!, { recursive: true });
const TRANSCRIPT = path.join(process.env.DEV_ORCHESTRA_CLAUDE_PROJECTS!, "D--proj", UUID + ".jsonl");
mkdirSync(path.dirname(TRANSCRIPT), { recursive: true });
writeFileSync(TRANSCRIPT, JSON.stringify({ type: "custom-title", customTitle: "Chat original", sessionId: UUID }) + "\n");

function gravarRun(id: string, sessao?: unknown) {
  const evs = [{ t: "run", feature: "Busca de runs", cwd: CWD, total: 1, ts: 1, ...(sessao ? { sessao, mcpRunId: "mcp-" + id } : {}) }];
  writeFileSync(path.join(process.env.DEV_ORCHESTRA_RUNS_DIR!, id + ".jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
const abrir = (run: string, cab = true) => fetch(`${BASE}/runs/sessao?run=${encodeURIComponent(run)}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(cab ? { "X-Dev-Orchestra": "1" } : {}) }, body: "{}",
});
async function sessoes(): Promise<Record<string, string>> {
  const r = await fetch(`${BASE}/sessoes`);
  assert.match(r.headers.get("content-type") ?? "", /json/, "GET /sessoes responde JSON");
  return await r.json() as Record<string, string>;
}
const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

test("GET /sessoes devolve o titulo atual do chat de cada run com sessao (CA-3)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  gravarRun("run-com-sessao", { planejador: "claude", id: UUID, host: "local_abc-123" });
  gravarRun("run-sem-sessao");
  await esperar(1200); // rescan le os logs
  let j = await sessoes();
  assert.equal(j["run-com-sessao"], "Chat original");
  assert.ok(!("run-sem-sessao" in j), "run sem sessao fica de fora");
  await esperar(30); // mtime muda
  appendFileSync(TRANSCRIPT, JSON.stringify({ type: "custom-title", customTitle: "Chat renomeado", sessionId: UUID }) + "\n");
  j = await sessoes();
  assert.equal(j["run-com-sessao"], "Chat renomeado", "titulo sempre atual");
});

test("POST /runs/sessao: valida, abre pelo evento salvo e devolve o comando de copia (CA-2/CA-9)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  gravarRun("run-abrir-1", { planejador: "claude", id: UUID, host: "local_abc-123" });
  gravarRun("run-sem-2");
  gravarRun("run-ruim-3", { planejador: "claude", id: UUID, host: "local_x&calc" });
  await esperar(1200);
  const s400 = (await abrir("run-abrir-1", false)).status;
  assert.ok(s400 === 400 || s400 === 403, "exige X-Dev-Orchestra");
  assert.equal((await abrir("../etc&x")).status, 400, "id fora de [a-z0-9-]");
  assert.equal((await abrir("run-nao-existe")).status, 404);
  assert.equal((await abrir("run-sem-2")).status, 404, "run sem sessao");
  assert.equal((await abrir("run-ruim-3")).status, 400, "sessao salva invalida nao executa nada");
  assert.ok(!existsSync(LOG), "nada foi aberto ate aqui");

  const res = await abrir("run-abrir-1");
  assert.equal(res.status, 200);
  const j = await res.json() as { comandoCopia: string };
  assert.match(j.comandoCopia, new RegExp("claude --resume " + UUID));
  assert.match(readFileSync(LOG, "utf8"), /claude:\/\/code\/continue\?session=local_abc-123/);
});
