// Spec da S1 (CA-1/CA-2): o swarm nao revisa nem repara sozinho. Gate falhou -> GATE-FAILED com a saida,
// sem agente de reparo, e o orquestrador decide. Gate passou -> commit sem revisor interno.
// Roda o bridge de verdade por stdio com plano vazio (sem chamada de API).
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const RAIZ = path.join(DIST, "..");

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

async function repoAlvo(): Promise<string> {
  const cwd = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "s1-alvo-")));
  const git = (...a: string[]) => execFileSync("git", a, { cwd });
  git("init", "-q");
  git("config", "user.email", "t@t"); git("config", "user.name", "t");
  await fs.writeFile(path.join(cwd, "app.txt"), "oi\n");
  git("add", "."); git("commit", "-qm", "base");
  return cwd;
}

async function bridge() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "s1-hub-"));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, {
    HERMES_UI_PORT: String(await portaLivre()),
    HERMES_RUNS_DIR: path.join(tmp, "runs"),
    HERMES_AGENTES_DIR: path.join(tmp, "agentes"),
    HERMES_CANVAS_DIR: path.join(tmp, "canvas"),
    HERMES_PLANEJADORES_DIR: path.join(tmp, "plan"),
    HERMES_ABRIR_LOG: path.join(tmp, "abrir.log"),
    OPENCODE_GO_API_KEY: "", DEEPSEEK_API_KEY: "", OPENROUTER_API_KEY: "",
  });
  delete env.HERMES_REPAIR_TRIES;
  const client = new Client({ name: "s1", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(DIST, "index.js")], env, stderr: "ignore" }));
  return { client, runsDir: env.HERMES_RUNS_DIR };
}

const texto = (r: any) => (r.content as any[]).map((c) => c.text).join("\n");

async function rodarAteFim(client: Client, cwd: string, gate: string[]): Promise<string> {
  const ini = texto(await client.callTool({ name: "executar_orchestra", arguments: { cwd, feature: "s1 teste", plano: [], override: { cmds: [], gate } } }));
  const runId = ini.match(/RUN INICIADA: (\S+)/)?.[1];
  assert.ok(runId, "executar_orchestra deveria iniciar a run: " + ini);
  for (let i = 0; i < 20; i++) {
    const s = texto(await client.callTool({ name: "status_orchestra", arguments: { runId } }, undefined, { timeout: 120000 }));
    if (/STATUS: (COMPLETE|COMMIT-SKIP|GATE-FAILED|NEEDS-REVIEW|ENV-FAILED|FAILED|CANCELED)/.test(s)) return s;
  }
  throw new Error("run nao terminou");
}

async function logDasRuns(dir: string): Promise<string> {
  let out = "";
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) if (f.endsWith(".jsonl")) out += await fs.readFile(path.join(dir, f), "utf8");
  return out;
}

test("gate falhou: GATE-FAILED com a saida do comando e nenhum agente de reparo (CA-1)", { timeout: 180000 }, async () => {
  const { client, runsDir } = await bridge();
  try {
    const cwd = await repoAlvo();
    const final = await rodarAteFim(client, cwd, [`node -e "console.log('not ok 1 - falhou de proposito');process.exit(1)"`]);
    assert.match(final, /STATUS: GATE-FAILED/);
    assert.match(final, /falhou de proposito/, "a saida do gate tem que voltar pro orquestrador");
    assert.doesNotMatch(final, /REVISOR/);
    const log = await logDasRuns(runsDir);
    assert.doesNotMatch(log, /reparo/i, "nenhum agente/tentativa de reparo pode rodar");
    assert.equal(execFileSync("git", ["log", "--oneline"], { cwd, encoding: "utf8" }).trim().split("\n").length <= 2, true, "nada commitado alem da baseline");
  } finally { await client.close(); }
});

test("gate passou: termina sem linha REVISOR e sem fase revisor (CA-2)", { timeout: 180000 }, async () => {
  const { client, runsDir } = await bridge();
  try {
    const cwd = await repoAlvo();
    const final = await rodarAteFim(client, cwd, [`node -e "process.exit(0)"`]);
    assert.match(final, /STATUS: (COMPLETE|COMMIT-SKIP)/);
    assert.doesNotMatch(final, /REVISOR/);
    assert.doesNotMatch(await logDasRuns(runsDir), /"nome":"revisor"/);
  } finally { await client.close(); }
});

test("descricao da tool nao promete revisor (CA-2)", { timeout: 60000 }, async () => {
  const { client } = await bridge();
  try {
    const { tools } = await client.listTools();
    const exec = tools.find((t) => t.name === "executar_orchestra");
    assert.ok(exec);
    assert.doesNotMatch(exec.description ?? "", /revisor/i);
  } finally { await client.close(); }
});

test("revisor e reparo sairam do codigo (CA-2)", async () => {
  const hermes: Record<string, unknown> = await import("../dist/hermes.js");
  for (const nome of ["revisar", "podeReparar", "REPAIR_TRIES", "diffStaged"]) assert.equal(nome in hermes, false, nome);
  for (const arq of ["src/index.ts", "src/hermes.ts"]) {
    const src = await fs.readFile(path.join(RAIZ, arq), "utf8");
    assert.doesNotMatch(src, /HERMES_REPAIR_TRIES|podeReparar|revisar\(/, arq);
  }
});
