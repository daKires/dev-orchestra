// Hub de teste do E2E: recria a fixture numa pasta temporaria fixa e sobe o dashboard na 4199.
// Nunca usa a 4123 nem ~/.dev-orchestra/dados (todas as pastas do hub vem do env abaixo).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { BASE, REPO, RUNS, PORTA, RUN_A, RUN_B, RUN_C } from "./dirs.mjs";

fs.rmSync(BASE, { recursive: true, force: true });
for (const d of ["runs", "canvas", "agentes", "planejadores"]) fs.mkdirSync(path.join(BASE, d), { recursive: true });

// Repo git descartavel: master + orchestra/b (merge) + orchestra/c (descartar).
const git = (...args) => execFileSync("git", args, { cwd: REPO, stdio: "ignore" });
fs.mkdirSync(path.join(REPO, "src"), { recursive: true });
fs.writeFileSync(path.join(REPO, "README.md"), "# repo e2e\n");
fs.writeFileSync(path.join(REPO, "src", "setup.ts"), "export const x = 1;\n");
git("init", "-q", "-b", "master");
git("config", "user.email", "e2e@local");
git("config", "user.name", "e2e");
git("add", "-A");
git("commit", "-q", "-m", "inicial");
for (const b of ["b", "c"]) {
  git("checkout", "-q", "-b", `orchestra/${b}`);
  fs.writeFileSync(path.join(REPO, `${b}.txt`), b + "\n");
  git("add", "-A");
  git("commit", "-q", "-m", `run ${b}`);
  git("checkout", "-q", "master");
}

const agora = Date.now();
const plano = (tarefas) => tarefas.map((tarefa) => ({ tarefa, arquivos_alvo: ["src/setup.ts"], descricao: tarefa }));
const tools = (slice, n, ts) => Array.from({ length: n }, (_, i) => ({
  t: "tool", slice, nome: i % 3 ? "ler_arquivo" : "rodar_comando", alvo: `src/arq${i}.ts`,
  ok: i !== 2, resumo: i === 2 ? "npm test — exit 1" : `src/arq${i}.ts`, ts: ts + i,
}));
const gravar = (id, evs) => fs.writeFileSync(path.join(RUNS, id + ".jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");

// Run A: ativa, 4 slices (ok, ok, rodando, fila), titulos com o prefixo "S<n>" como nos prints.
const tarefasA = ["S1 npm e node absolutos no setup", "S2 PATH dos processos filhos", "S3 Codex e Antigravity na config", "S4 dados fora do TEMP"];
const tA = agora - 60_000;
gravar(RUN_A, [
  { t: "run", feature: "instalador sem path", cwd: REPO, total: 4, plano: plano(tarefasA), cmds: ["npm test"], gate: ["npm test"], ts: tA },
  ...[1, 2].flatMap((k) => [
    { t: "slice", idx: k, total: 4, tarefa: tarefasA[k - 1], status: "rodando", ts: tA + k * 1000 },
    ...tools(k, 12, tA + k * 1000 + 1),
    { t: "slice", idx: k, total: 4, tarefa: tarefasA[k - 1], status: "ok", escritos: ["src/setup.ts"], ts: tA + k * 1000 + 500 },
  ]),
  { t: "slice", idx: 3, total: 4, tarefa: tarefasA[2], status: "rodando", ts: tA + 4000 },
  ...tools(3, 15, tA + 4001),
]);

// Runs B e C: terminadas (COMPLETE), gate com 1 falha + 1 ok, diff de 2 arquivos.
const terminada = (id, b, ts) => [
  { t: "run", feature: `feature ${b}`, cwd: REPO, total: 2, plano: plano(["modelo", "tela"]), ts },
  { t: "slice", idx: 1, total: 2, tarefa: "modelo", status: "ok", ts: ts + 1 },
  { t: "slice", idx: 2, total: 2, tarefa: "tela", status: "ok", ts: ts + 2 },
  { t: "gate", cmd: "npm run typecheck", status: "ok", tentativa: 1, saida: "ok", ts: ts + 3 },
  { t: "gate", cmd: "npm test", status: "falha", tentativa: 1, saida: "1 falhou: CA-3", ts: ts + 4 },
  { t: "gate", cmd: "npm test", status: "ok", tentativa: 2, saida: "tudo ok", ts: ts + 5 },
  { t: "diff", arquivo: `${b}.txt`, patch: `--- /dev/null\n+++ b/${b}.txt\n@@ -0,0 +1 @@\n+${b}\n`, ts: ts + 6 },
  { t: "diff", arquivo: "src/setup.ts", patch: "--- a/src/setup.ts\n+++ b/src/setup.ts\n@@ -1 +1 @@\n-export const x = 1;\n+export const x = 2;\n", ts: ts + 7 },
  { t: "metrica", slice: 1, iteracoes: 2, passouDePrimeira: false, tocouNoTeste: 0, tokensIn: 1000, tokensOut: 200, custoUSD: 0.012, ts: ts + 8 },
  { t: "painel", status: "COMPLETE", branch: `orchestra/${b}`, base: "master", linhas: [`STATUS: COMPLETE`, `branch orchestra/${b}`], ts: ts + 9 },
];
gravar(RUN_B, terminada(RUN_B, "b", agora - 3_600_000));
gravar(RUN_C, terminada(RUN_C, "c", agora - 7_200_000));

process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_RUNS_DIR = RUNS;
process.env.DEV_ORCHESTRA_CANVAS_DIR = path.join(BASE, "canvas");
process.env.DEV_ORCHESTRA_AGENTES_DIR = path.join(BASE, "agentes");
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = path.join(BASE, "planejadores");
const ui = await import(pathToFileURL(path.join(import.meta.dirname, "..", "..", "dist", "ui.js")).href);
await ui.iniciarUI();
