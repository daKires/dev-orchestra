// Acoes da run no card (G1): merge local, abrir PR e descartar.
// Modulo PURO (so' imports `node:`); o hub chama via ui.ts e ele e' rodado com strip-types.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type ResultadoAcao = { ok: true; base?: string; url?: string } | { ok: false; erro: string; conflitos?: string[] };

// Roda git SEM shell (sem injecao de comando) e devolve o stdout cru; exit != 0 lanca.
function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
}

function erroDe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Um caminho dentro de `<raiz>/.claude/worktrees/<slug>` (barras / ou \)?
export function ehWorktree(cwd: string): boolean {
  return cwd.replace(/\\/g, "/").includes(".claude/worktrees/");
}

// Pasta pai do `.git` comum: `--git-common-dir` pode vir relativo (worktree principal) ou absoluto
// (worktree ligado); resolvemos relativo ao cwd antes de tirar o pai.
export function raizRepo(cwd: string): string {
  const comum = git(cwd, ["rev-parse", "--git-common-dir"]).trim();
  const abs = path.isAbsolute(comum) ? comum : path.resolve(cwd, comum);
  return path.dirname(abs);
}

// Garante `.claude/` no `info/exclude` do `.git` comum: a pasta dos worktrees e' untracked na pasta
// principal e nao pode contar como "mudanca nao commitada" no status da raiz.
function garantirExcludeClaude(raiz: string): void {
  try {
    const comum = git(raiz, ["rev-parse", "--git-common-dir"]).trim();
    const abs = path.isAbsolute(comum) ? comum : path.resolve(raiz, comum);
    const info = path.join(abs, "info");
    const arq = path.join(info, "exclude");
    let atual = "";
    try { atual = fs.readFileSync(arq, "utf8"); } catch {}
    if (atual.split(/\r?\n/).includes(".claude/")) return;
    fs.mkdirSync(info, { recursive: true });
    fs.appendFileSync(arq, (atual && !atual.endsWith("\n") ? "\n" : "") + ".claude/\n");
  } catch {}
}

// A branch existe no repo? (usado no fallback main/master)
function existeBranch(cwd: string, branch: string): boolean {
  try { git(cwd, ["rev-parse", "--verify", "--quiet", "refs/heads/" + branch]); return true; }
  catch { return false; }
}

// De qual branch a branch nasceu: ultima linha 'branch: Created from <X>' do reflog. X pode ser
// 'main', 'refs/heads/main' ou 'HEAD'; em HEAD (ou nada achado), usa main se existir, senao master.
export function baseDaBranch(cwdOuRaiz: string, branch: string): string {
  let criadaDe = "";
  try {
    const saida = git(cwdOuRaiz, ["reflog", "show", "--format=%gs", branch]);
    for (const linha of saida.split(/\r?\n/)) {
      const m = /^branch: Created from (.+)$/.exec(linha.trim());
      if (m) criadaDe = m[1].trim();
    }
  } catch {}
  if (criadaDe.startsWith("refs/heads/")) criadaDe = criadaDe.slice("refs/heads/".length);
  if (criadaDe && criadaDe !== "HEAD") return criadaDe;
  return existeBranch(cwdOuRaiz, "main") ? "main" : "master";
}

// Merge local da branch da run na sua base (na pasta principal). Recusa com a pasta suja, aborta em
// conflito (listando os arquivos) e, no sucesso, remove o worktree e apaga a branch.
export function mergeLocal(ctx: { cwd: string; branch: string }): ResultadoAcao {
  const { cwd, branch } = ctx;
  try {
    const raiz = raizRepo(cwd);
    const base = baseDaBranch(raiz, branch);
    garantirExcludeClaude(raiz); // .claude/ (worktrees) nao pode sujar o status da pasta principal
    if (git(raiz, ["status", "--porcelain"]).trim()) return { ok: false, erro: "a pasta principal tem mudanças não commitadas" };
    const atual = git(raiz, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (atual !== base) git(raiz, ["checkout", base]);
    try {
      git(raiz, ["merge", "--no-ff", branch, "-m", "Merge " + branch]);
    } catch {
      let conflitos: string[] = [];
      try { conflitos = git(raiz, ["diff", "--name-only", "--diff-filter=U"]).split(/\r?\n/).map((s) => s.trim()).filter(Boolean); } catch {}
      try { git(raiz, ["merge", "--abort"]); } catch {}
      return { ok: false, erro: "conflito no merge", conflitos };
    }
    if (ehWorktree(cwd)) { try { git(raiz, ["worktree", "remove", "--force", cwd]); } catch {} }
    git(raiz, ["branch", "-D", branch]);
    return { ok: true, base };
  } catch (e) {
    return { ok: false, erro: erroDe(e) };
  }
}

// Descarta a run: worktree some com a branch; na pasta principal, exige arvore limpa, volta pra base
// e apaga a branch.
export function descartarRun(ctx: { cwd: string; branch: string }): ResultadoAcao {
  const { cwd, branch } = ctx;
  try {
    const raiz = raizRepo(cwd);
    if (ehWorktree(cwd)) {
      git(raiz, ["worktree", "remove", "--force", cwd]);
      try { git(raiz, ["branch", "-D", branch]); } catch {}
      return { ok: true };
    }
    garantirExcludeClaude(raiz);
    if (git(raiz, ["status", "--porcelain"]).trim()) return { ok: false, erro: "a pasta tem mudanças não commitadas" };
    const base = baseDaBranch(raiz, branch);
    const atual = git(raiz, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
    if (atual !== base) git(raiz, ["checkout", base]);
    git(raiz, ["branch", "-D", branch]);
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: erroDe(e) };
  }
}

// Abre o PR: push da branch + `gh pr create` (titulo = feature cortada em 70; corpo + selo). Devolve a
// url que o gh imprimir. `rodar` e' injetavel pra testar sem sair da maquina.
export function abrirPr(
  ctx: { cwd: string; branch: string; feature: string; corpo: string },
  rodar: (cmd: string, args: string[]) => string = (cmd, args) => execFileSync(cmd, args, { cwd: ctx.cwd, encoding: "utf8", windowsHide: true }),
): ResultadoAcao {
  const { cwd, branch, feature, corpo } = ctx;
  const titulo = feature.slice(0, 70);
  const body = corpo + "\n\n🤖 Generated with [Claude Code](https://claude.com/claude-code)";
  try {
    const base = baseDaBranch(raizRepo(cwd), branch);
    rodar("git", ["push", "-u", "origin", branch]);
    const saida = rodar("gh", ["pr", "create", "--base", base, "--head", branch, "--title", titulo, "--body", body]);
    const linhas = saida.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { ok: true, url: linhas.length ? linhas[linhas.length - 1] : "" };
  } catch (e) {
    return { ok: false, erro: erroDe(e) };
  }
}
