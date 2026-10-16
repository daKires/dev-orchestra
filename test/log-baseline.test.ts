// Spec do PR3/S1 (CA-13, CA-14): a baseline nunca mistura WIP do usuario no commit da run nem commita
// em outra branch. Arvore suja fora da branch da run -> erro sem criar branch; na propria branch da run
// (run de correcao depois de um GATE-FAILED) segue. Checkout que falha -> erro, nunca segue na atual.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const H: any = await import("../dist/swarm.js");
const nada = () => {};
const git = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();
function repo(): string {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "log-base-"));
  git(cwd, "init", "-q", "-b", "master");
  git(cwd, "config", "user.email", "t@t"); git(cwd, "config", "user.name", "t");
  writeFileSync(path.join(cwd, ".gitignore"), "*.log\n");
  writeFileSync(path.join(cwd, "a.txt"), "a\n");
  git(cwd, "add", "."); git(cwd, "commit", "-qm", "base");
  return cwd;
}
const atual = (cwd: string) => git(cwd, "branch", "--show-current");
const branches = (cwd: string) => git(cwd, "branch", "--format=%(refname:short)").split(/\r?\n/).sort();

test("arvore suja (modificado ou untracked) fora da branch da run -> erro, sem branch nova (CA-13)", async () => {
  for (const sujar of [(c: string) => writeFileSync(path.join(c, "a.txt"), "mudou\n"), (c: string) => writeFileSync(path.join(c, "novo.txt"), "x\n")]) {
    const cwd = repo();
    sujar(cwd);
    await assert.rejects(H.baseline(cwd, "Minha Feature", nada), /commit ou stash/);
    assert.equal(atual(cwd), "master");
    assert.deepEqual(branches(cwd), ["master"], "nao criou orchestra/minha-feature");
  }
});

test("arquivo ignorado nao conta como sujeira (CA-13)", async () => {
  const cwd = repo();
  writeFileSync(path.join(cwd, "debug.log"), "x\n");
  const r = await H.baseline(cwd, "f", nada);
  assert.equal(r.branch, "orchestra/f");
  assert.equal(atual(cwd), "orchestra/f");
});

test("na propria branch da run, com WIP da run anterior, segue (run de correcao) (CA-13, CA-14)", async () => {
  const cwd = repo();
  git(cwd, "checkout", "-q", "-b", "orchestra/f");
  writeFileSync(path.join(cwd, "a.txt"), "codigo da run anterior\n");
  const r = await H.baseline(cwd, "f", nada);
  assert.equal(r.branch, "orchestra/f");
  assert.equal(atual(cwd), "orchestra/f");
});

test("branch da run ja existe e esta limpa: faz checkout nela (CA-14)", async () => {
  const cwd = repo();
  git(cwd, "branch", "orchestra/f");
  await H.baseline(cwd, "f", nada);
  assert.equal(atual(cwd), "orchestra/f");
});

test("checkout da branch existente falha -> erro, continua na branch original (CA-14)", async () => {
  const cwd = repo();
  git(cwd, "branch", "orchestra/f");
  git(cwd, "worktree", "add", "-q", path.join(mkdtempSync(path.join(os.tmpdir(), "log-wt-")), "wt"), "orchestra/f"); // ja' em uso por outro worktree
  await assert.rejects(H.baseline(cwd, "f", nada));
  assert.equal(atual(cwd), "master", "nunca segue (nem commita) na branch errada");
});
