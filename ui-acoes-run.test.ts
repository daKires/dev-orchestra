// Spec da G1 (CA-G1b): rota POST /runs/acao?run=<id> {acao} do hub, sobre o acoes-run.ts.
// Pasta de runs isolada por HERMES_RUNS_DIR (o teste nunca toca o %TEMP%\hermes\runs de verdade).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
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
const TMP = mkdtempSync(path.join(os.tmpdir(), "hermes-acoes-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_RUNS_DIR = path.join(TMP, "runs");
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
const ui = await import("./ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
function repoWorktree() {
  const raiz = mkdtempSync(path.join(TMP, "repo-"));
  git(raiz, "init", "-q", "-b", "main");
  git(raiz, "config", "user.email", "t@t"); git(raiz, "config", "user.name", "t");
  writeFileSync(path.join(raiz, "a.txt"), "a\n"); git(raiz, "add", "."); git(raiz, "commit", "-qm", "base");
  const cwd = path.join(raiz, ".claude", "worktrees", "x");
  git(raiz, "worktree", "add", "-q", "-b", "orchestra/x", cwd, "main");
  writeFileSync(path.join(cwd, "b.txt"), "b\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "feat");
  return { raiz, cwd };
}
function gravarRun(id: string, cwd: string, status: string) {
  mkdirSync(process.env.HERMES_RUNS_DIR!, { recursive: true });
  const evs = [
    { t: "run", feature: "Exportar PDF", cwd, total: 1, ts: 1 },
    { t: "painel", status, branch: "orchestra/x", linhas: [], ts: 2 },
  ];
  writeFileSync(path.join(process.env.HERMES_RUNS_DIR!, id + ".jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
}
const acao = (run: string, corpo: unknown, hermes = true) => fetch(`${BASE}/runs/acao?run=${run}`, {
  method: "POST", headers: { "Content-Type": "application/json", ...(hermes ? { "X-Hermes": "1" } : {}) }, body: JSON.stringify(corpo),
});

test("POST /runs/acao: valida, acha a run pelo log e faz merge/descartar no repo dela (CA-G1b)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  const r = repoWorktree();
  gravarRun("run-merge-1", r.cwd, "COMPLETE");
  assert.equal((await acao("run-merge-1", { acao: "merge" }, false)).status, 400, "exige X-Hermes");
  assert.equal((await acao("run-nao-existe", { acao: "merge" })).status, 404);
  assert.equal((await acao("run-merge-1", { acao: "apagar-tudo" })).status, 400, "acao fora da lista");
  await new Promise((ok) => setTimeout(ok, 1200)); // da' tempo do rescan ler o log
  let res = await acao("run-merge-1", { acao: "merge" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, base: "main" });
  assert.ok(!existsSync(r.cwd), "worktree removido");

  const d = repoWorktree();
  gravarRun("run-desc-1", d.cwd, "NEEDS-REVIEW");
  await new Promise((ok) => setTimeout(ok, 1200));
  res = await acao("run-desc-1", { acao: "descartar" });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(git(d.raiz, "branch", "--list", "orchestra/x"), "");
});

test("merge so' para run COMPLETE; erro do git volta como 409 com a mensagem (CA-G1b)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} } as any);
  t.after(() => ui.pararUI());
  const r = repoWorktree();
  gravarRun("run-rev-1", r.cwd, "NEEDS-REVIEW");
  await new Promise((ok) => setTimeout(ok, 1200));
  let res = await acao("run-rev-1", { acao: "merge" });
  assert.equal(res.status, 409);
  assert.match(await res.text(), /COMPLETE/);
  const c = repoWorktree();
  writeFileSync(path.join(c.cwd, "a.txt"), "swarm\n"); git(c.cwd, "commit", "-qam", "a");
  writeFileSync(path.join(c.raiz, "a.txt"), "seu\n"); git(c.raiz, "commit", "-qam", "a2");
  gravarRun("run-conf-1", c.cwd, "COMPLETE");
  await new Promise((ok) => setTimeout(ok, 1200));
  res = await acao("run-conf-1", { acao: "merge" });
  assert.equal(res.status, 409);
  const j = await res.json() as { ok: boolean; conflitos: string[] };
  assert.deepEqual(j.conflitos, ["a.txt"]);
});
