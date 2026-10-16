// Spec do PR3/S2 (CA-15): a run grava a branch de origem e o merge/descartar usam ela (nao o chute
// main/master do reflog). Runs antigas sem `base` no painel continuam na regra de antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
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
const TMP = mkdtempSync(path.join(os.tmpdir(), "log-base-ui-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_RUNS_DIR = path.join(TMP, "runs");
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
const H: any = await import("../dist/hermes.js");
const A: any = await import("../dist/acoes-run.js");
const ui: any = await import("../dist/ui.js");

const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function repoDevelop(): string {
  const cwd = mkdtempSync(path.join(TMP, "repo-"));
  git(cwd, "init", "-q", "-b", "main");
  git(cwd, "config", "user.email", "t@t"); git(cwd, "config", "user.name", "t");
  writeFileSync(path.join(cwd, "a.txt"), "a\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  git(cwd, "checkout", "-q", "-b", "develop");
  writeFileSync(path.join(cwd, "d.txt"), "d\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "dev");
  return cwd;
}
const temArquivo = (cwd: string, branch: string, arq: string) => git(cwd, "ls-tree", "--name-only", branch).split(/\r?\n/).includes(arq);

test("baseline devolve a branch de origem em `base` (CA-15)", async () => {
  const cwd = repoDevelop();
  const r = await H.baseline(cwd, "f", () => {});
  assert.equal(r.base, "develop");
  assert.equal(r.branch, "orchestra/f");
});

test("mergeLocal com base explicita vai pra ela, nao pra main (CA-15)", async () => {
  const cwd = repoDevelop();
  await H.baseline(cwd, "f", () => {});
  writeFileSync(path.join(cwd, "f.txt"), "f\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "feat");
  const r = A.mergeLocal({ cwd, branch: "orchestra/f", base: "develop" });
  assert.deepEqual(r, { ok: true, base: "develop" });
  assert.ok(temArquivo(cwd, "develop", "f.txt"), "entrou na develop");
  assert.equal(temArquivo(cwd, "main", "f.txt"), false, "main intocada");
});

test("POST /runs/acao usa o painel.base da run (CA-15)", async (t) => {
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 1 }), matarProcesso: () => {} });
  t.after(() => ui.pararUI());
  const cwd = repoDevelop();
  await H.baseline(cwd, "g", () => {});
  writeFileSync(path.join(cwd, "g.txt"), "g\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "feat");
  git(cwd, "checkout", "-q", "main"); // o usuario saiu da branch: a base tem que vir do painel, nao do HEAD
  mkdirSync(process.env.HERMES_RUNS_DIR!, { recursive: true });
  const evs = [
    { t: "run", feature: "g", cwd, total: 1, ts: 1 },
    { t: "painel", status: "COMPLETE", branch: "orchestra/g", base: "develop", linhas: [], ts: 2 },
  ];
  writeFileSync(path.join(process.env.HERMES_RUNS_DIR!, "run-base-1.jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await new Promise((ok) => setTimeout(ok, 1200));
  const res = await fetch(`http://127.0.0.1:${PORTA}/runs/acao?run=run-base-1`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify({ acao: "merge" }),
  });
  assert.equal(res.status, 200, await res.clone().text());
  assert.equal(((await res.json()) as any).base, "develop");
  assert.ok(temArquivo(cwd, "develop", "g.txt"));
  assert.equal(temArquivo(cwd, "main", "g.txt"), false);
});
