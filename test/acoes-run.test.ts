// Spec da G1 (CA-G1b): acoes da run no card - merge local, abrir PR e descartar. Git de verdade em pasta
// temporaria; o `gh`/push do PR e' injetado (nada sai da maquina).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { baseDaBranch, mergeLocal, descartarRun, abrirPr, ehWorktree } from "../dist/acoes-run.js";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

// Repo com main + branch orchestra/x (1 commit) criada a partir da main. Com wt=true, a branch vive num worktree.
function repo(wt = false) {
  const raiz = mkdtempSync(path.join(tmpdir(), "acoes-"));
  git(raiz, "init", "-q", "-b", "main");
  git(raiz, "config", "user.email", "t@t"); git(raiz, "config", "user.name", "t");
  writeFileSync(path.join(raiz, "a.txt"), "a\n"); git(raiz, "add", "."); git(raiz, "commit", "-qm", "base");
  let cwd = raiz;
  if (wt) {
    cwd = path.join(raiz, ".claude", "worktrees", "x");
    git(raiz, "worktree", "add", "-q", "-b", "orchestra/x", cwd, "main");
  } else {
    git(raiz, "checkout", "-q", "-b", "orchestra/x");
  }
  writeFileSync(path.join(cwd, "b.txt"), "b\n"); git(cwd, "add", "."); git(cwd, "commit", "-qm", "feat");
  return { raiz, cwd, branch: "orchestra/x" };
}

test("ehWorktree e baseDaBranch (reflog 'Created from'; senao main/master)", () => {
  const r = repo(true);
  assert.equal(ehWorktree(r.cwd), true);
  assert.equal(ehWorktree(r.raiz), false);
  assert.equal(baseDaBranch(r.raiz, r.branch), "main");
  const s = repo(false);
  assert.equal(baseDaBranch(s.raiz, s.branch), "main");
});

test("merge local (worktree): --no-ff na base, apaga branch e worktree (CA-G1b)", () => {
  const r = repo(true);
  const res = mergeLocal({ cwd: r.cwd, branch: r.branch });
  assert.deepEqual(res, { ok: true, base: "main" });
  assert.match(git(r.raiz, "log", "-1", "--pretty=%s"), /orchestra\/x/, "commit de merge (no-ff)");
  assert.equal(git(r.raiz, "rev-list", "--parents", "-n1", "HEAD").split(" ").length, 3, "merge com 2 pais");
  assert.ok(existsSync(path.join(r.raiz, "b.txt")));
  assert.equal(git(r.raiz, "branch", "--list", r.branch), "", "branch apagada");
  assert.ok(!existsSync(r.cwd), "worktree removido");
});

test("merge local (na pasta): troca pra base, faz o merge e apaga a branch (CA-G1b)", () => {
  const r = repo(false);
  assert.deepEqual(mergeLocal({ cwd: r.cwd, branch: r.branch }), { ok: true, base: "main" });
  assert.equal(git(r.raiz, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(git(r.raiz, "branch", "--list", r.branch), "");
});

test("merge com conflito: aborta, lista os arquivos e nao apaga nada (CA-G1b)", () => {
  const r = repo(true);
  writeFileSync(path.join(r.cwd, "a.txt"), "do swarm\n"); git(r.cwd, "commit", "-qam", "muda a");
  writeFileSync(path.join(r.raiz, "a.txt"), "seu\n"); git(r.raiz, "commit", "-qam", "muda a tambem");
  const res = mergeLocal({ cwd: r.cwd, branch: r.branch });
  assert.equal(res.ok, false);
  assert.deepEqual((res as { conflitos: string[] }).conflitos, ["a.txt"]);
  assert.equal(git(r.raiz, "status", "--porcelain"), "", "merge abortado, base limpa");
  assert.notEqual(git(r.raiz, "branch", "--list", r.branch), "", "branch preservada");
  assert.ok(existsSync(r.cwd), "worktree preservado");
});

test("merge recusa se a pasta principal estiver em outra branch com mudanca (CA-G1b)", () => {
  const r = repo(true);
  writeFileSync(path.join(r.raiz, "sujo.txt"), "x"); git(r.raiz, "add", "sujo.txt");
  const res = mergeLocal({ cwd: r.cwd, branch: r.branch });
  assert.equal(res.ok, false);
  assert.match((res as { erro: string }).erro, /mudan[cç]as? n[aã]o commitad/i);
});

test("descartar: worktree some com a branch; na pasta volta pra base e apaga a branch; sujo recusa (CA-G1b)", () => {
  const w = repo(true);
  assert.deepEqual(descartarRun({ cwd: w.cwd, branch: w.branch }), { ok: true });
  assert.ok(!existsSync(w.cwd));
  assert.equal(git(w.raiz, "branch", "--list", w.branch), "");
  const p = repo(false);
  assert.deepEqual(descartarRun({ cwd: p.cwd, branch: p.branch }), { ok: true });
  assert.equal(git(p.raiz, "rev-parse", "--abbrev-ref", "HEAD"), "main");
  assert.equal(git(p.raiz, "branch", "--list", p.branch), "");
  const s = repo(false);
  writeFileSync(path.join(s.raiz, "fora.txt"), "x");
  const res = descartarRun({ cwd: s.cwd, branch: s.branch });
  assert.equal(res.ok, false);
  assert.match((res as { erro: string }).erro, /mudan[cç]as? n[aã]o commitad/i);
});

test("abrir PR: push da branch + gh pr create com titulo/corpo PT-BR e base; devolve o link (CA-G1b)", () => {
  const r = repo(true);
  const chamadas: string[][] = [];
  const rodar = (cmd: string, args: string[]) => { chamadas.push([cmd, ...args]); return cmd === "gh" ? "https://github.com/o/r/pull/42\n" : ""; };
  const res = abrirPr({ cwd: r.cwd, branch: r.branch, feature: "Exportar relatório em PDF", corpo: "## Resumo\n- S1 ok" }, rodar);
  assert.deepEqual(res, { ok: true, url: "https://github.com/o/r/pull/42" });
  assert.deepEqual(chamadas[0], ["git", "push", "-u", "origin", "orchestra/x"]);
  const gh = chamadas[1];
  assert.equal(gh[0], "gh");
  const arg = (k: string) => gh[gh.indexOf(k) + 1];
  assert.equal(arg("--base"), "main");
  assert.equal(arg("--head"), "orchestra/x");
  assert.equal(arg("--title"), "Exportar relatório em PDF");
  assert.match(arg("--body"), /## Resumo[\s\S]*Generated with \[Claude Code\]/);
  const longo = abrirPr({ cwd: r.cwd, branch: r.branch, feature: "x".repeat(120), corpo: "" }, rodar);
  assert.ok(longo.ok);
  const g2 = chamadas[3];
  assert.ok(g2[g2.indexOf("--title") + 1].length <= 70, "titulo ate 70");
  const falha = abrirPr({ cwd: r.cwd, branch: r.branch, feature: "f", corpo: "" }, (cmd) => { if (cmd === "gh") throw new Error("gh: command not found"); return ""; });
  assert.equal(falha.ok, false);
  assert.match((falha as { erro: string }).erro, /gh/);
});
