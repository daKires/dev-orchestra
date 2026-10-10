// Regressao (runs c92289f8 / ca1e9588): o revisor recebia "Diff vazio" mesmo com arquivos alterados e commitados.
// O diff do revisor tem que ser baseline..indice: arquivo novo, commit no meio da run e diff > 1MB entram.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { baseline, diffStaged } from "./hermes.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function repo() {
  const cwd = mkdtempSync(path.join(tmpdir(), "revisor-"));
  git(cwd, "init", "-q");
  git(cwd, "config", "user.email", "t@t"); git(cwd, "config", "user.name", "t");
  writeFileSync(path.join(cwd, "app.txt"), "ORIGINAL\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  const { baselineRef } = await baseline(cwd, "feature x", () => {});
  return { cwd, baselineRef };
}

test("diff do revisor inclui arquivo alterado e arquivo novo (nao rastreado)", async () => {
  const { cwd, baselineRef } = await repo();
  writeFileSync(path.join(cwd, "app.txt"), "MUDOU\n");
  writeFileSync(path.join(cwd, "novo.ts"), "export const x = 1;\n");
  const diff = await diffStaged(cwd, baselineRef);
  assert.match(diff, /app\.txt/);
  assert.match(diff, /novo\.ts/);
});

test("diff do revisor nao fica vazio quando uma slice ja commitou no meio da run", async () => {
  const { cwd, baselineRef } = await repo();
  writeFileSync(path.join(cwd, "app.txt"), "MUDOU\n");
  writeFileSync(path.join(cwd, "novo.ts"), "export const x = 1;\n");
  git(cwd, "add", "-A"); git(cwd, "commit", "-qm", "slice commitou sozinha");
  const diff = await diffStaged(cwd, baselineRef);
  assert.notEqual(diff.trim(), "", "diff vazio");
  assert.match(diff, /\+MUDOU/);
  assert.match(diff, /novo\.ts/);
});

test("diff maior que 1MB nao vira string vazia (maxBuffer)", async () => {
  const { cwd, baselineRef } = await repo();
  writeFileSync(path.join(cwd, "grande.txt"), "linha\n".repeat(300_000));
  const diff = await diffStaged(cwd, baselineRef);
  assert.ok(diff.length > 1024 * 1024, `diff com ${diff.length} chars`);
});
