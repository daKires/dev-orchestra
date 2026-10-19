// Spec de runs ligadas a sessao (S1, src/sessao.ts): descobrir a sessao do planejador, titulo, como abrir (CA-1/2/3/6/8/9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, appendFileSync, mkdtempSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { fonte, modulo } from "./partir-ui-util.js";

const TMP = mkdtempSync(path.join(os.tmpdir(), "sessao-run-"));
const PROJ = path.join(TMP, "claude-projects");
const DB = path.join(TMP, "opencode.db");
process.env.DEV_ORCHESTRA_CLAUDE_PROJECTS = PROJ;
process.env.DEV_ORCHESTRA_OPENCODE_DB = DB;

const UUID = "5ed3bb76-3454-4379-82a1-9ee99f0a637a";
const PASTA = path.join(TMP, "Proj");
mkdirSync(PASTA, { recursive: true });

type Fn = (...a: any[]) => any;
async function s(): Promise<Record<string, Fn>> {
  const m = await modulo("dist/sessao.js");
  const nomes = ["sessaoAtual", "tituloSessao", "comoAbrirSessao", "runMaisRecenteDaSessao"];
  const falta = nomes.filter((n) => typeof m[n] !== "function");
  assert.deepEqual(falta, [], "dist/sessao.js deve exportar " + nomes.join(", "));
  return m as Record<string, Fn>;
}

function criarDb() {
  const db = new DatabaseSync(DB);
  db.exec("CREATE TABLE session (id text PRIMARY KEY, parent_id text, directory text NOT NULL, title text NOT NULL, time_updated integer NOT NULL)");
  const ins = db.prepare("INSERT INTO session (id, parent_id, directory, title, time_updated) VALUES (?, ?, ?, ?, ?)");
  const dir = PASTA.replace(/\\/g, "/").toUpperCase(); // barras/caixa diferentes da pasta da run
  ins.run("ses_velha1", null, dir, "Velha", 100);
  ins.run("ses_nova22", null, dir, "Nova OpenCode", 200);
  ins.run("ses_filha3", "ses_nova22", dir, "Subagente", 999); // subsessao: ignorada
  ins.run("ses_outra4", null, "C:/outra/pasta", "Outra", 5000);
  db.close();
}

test("sessaoAtual: Claude Code pelas envs; OpenCode pelo db; nada sem env (CA-1)", async () => {
  const m = await s();
  assert.deepEqual(
    m.sessaoAtual({ CLAUDE_CODE_SESSION_ID: UUID, CLAUDE_CODE_HOST_SESSION_ID: "local_022e7366-93df" }, PASTA),
    { planejador: "claude", id: UUID, host: "local_022e7366-93df" },
  );
  const soCli = m.sessaoAtual({ CLAUDE_CODE_SESSION_ID: UUID }, PASTA);
  assert.equal(soCli.planejador, "claude");
  assert.equal(soCli.id, UUID);
  assert.equal(soCli.host, undefined);

  criarDb();
  const oc = m.sessaoAtual({ OPENCODE: "1", DEV_ORCHESTRA_OPENCODE_DB: DB }, PASTA);
  assert.equal(oc?.planejador, "opencode");
  assert.equal(oc?.id, "ses_nova22", "sessao raiz mais recente da mesma pasta");
  assert.equal(m.sessaoAtual({ OPENCODE: "1", DEV_ORCHESTRA_OPENCODE_DB: DB }, path.join(TMP, "nada")), undefined);
  assert.equal(m.sessaoAtual({}, PASTA), undefined);
});

test("tituloSessao: ultimo custom-title do transcript; OpenCode pelo db; ausente = '' (CA-3)", async () => {
  const m = await s();
  const dir = path.join(PROJ, "D--Qualquer");
  mkdirSync(dir, { recursive: true });
  const arq = path.join(dir, UUID + ".jsonl");
  writeFileSync(arq,
    JSON.stringify({ type: "user", message: "oi" }) + "\n" +
    JSON.stringify({ type: "custom-title", customTitle: "Primeiro", sessionId: UUID }) + "\n");
  assert.equal(m.tituloSessao({ planejador: "claude", id: UUID }), "Primeiro");
  appendFileSync(arq, JSON.stringify({ type: "custom-title", customTitle: "Runs ligadas a sessao", sessionId: UUID }) + "\n");
  assert.equal(m.tituloSessao({ planejador: "claude", id: UUID }), "Runs ligadas a sessao", "pega o titulo novo");
  assert.equal(m.tituloSessao({ planejador: "claude", id: "00000000-0000-0000-0000-000000000000" }), "");
  assert.equal(m.tituloSessao({ planejador: "opencode", id: "ses_nova22" }), "Nova OpenCode");
  assert.equal(m.tituloSessao({ planejador: "opencode", id: "ses_naoexiste" }), "");
});

test("comoAbrirSessao: deep link do app Claude, terminal do OpenCode, recusa entrada invalida (CA-2/CA-9)", async () => {
  const m = await s();
  const desk = m.comoAbrirSessao({ planejador: "claude", id: UUID, host: "local_022e7366-93df" }, PASTA, "win32");
  assert.ok(desk, "sessao valida abre");
  assert.match(JSON.stringify(desk.args), /claude:\/\/code\/continue\?session=local_022e7366-93df/);
  assert.match(desk.copia, new RegExp("claude --resume " + UUID));

  const cli = m.comoAbrirSessao({ planejador: "claude", id: UUID }, PASTA, "win32");
  assert.match(JSON.stringify(cli.args), new RegExp("claude://resume\\?session=" + UUID));
  const mac = m.comoAbrirSessao({ planejador: "claude", id: UUID }, PASTA, "darwin");
  assert.equal(mac.comando, "open");

  const oc = m.comoAbrirSessao({ planejador: "opencode", id: "ses_nova22" }, PASTA, "win32");
  assert.ok(oc, "OpenCode abre terminal");
  const tudo = oc.comando + " " + JSON.stringify(oc.args);
  assert.match(tudo, /opencode/);
  assert.match(tudo, /-s/);
  assert.match(tudo, /ses_nova22/);
  assert.ok(tudo.includes(PASTA.replace(/\\/g, "\\\\")) || tudo.includes(PASTA), "abre na pasta da sessao");
  assert.match(oc.copia, /opencode -s ses_nova22/);

  assert.equal(m.comoAbrirSessao({ planejador: "claude", id: "nao-e-uuid" }, PASTA, "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "claude", id: UUID, host: "local_x&calc" }, PASTA, "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "opencode", id: "ses_a&calc" }, PASTA, "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "opencode", id: "ses_nova22" }, path.join(TMP, "nao-existe"), "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "opencode", id: "ses_nova22" }, PASTA + '" & calc', "win32"), null);
  assert.equal(m.comoAbrirSessao({ planejador: "outro", id: UUID }, PASTA, "win32"), null);
});

test("runMaisRecenteDaSessao: run mais recente daquela sessao, ou null (CA-8)", async () => {
  const m = await s();
  const runs = [
    { id: "a", ts: 10, sessao: { planejador: "claude", id: UUID } },
    { id: "b", ts: 30, sessao: { planejador: "claude", id: UUID } },
    { id: "c", ts: 99, sessao: { planejador: "claude", id: "outra" } },
    { id: "d", ts: 50 },
  ];
  assert.equal(m.runMaisRecenteDaSessao(runs, UUID), "b");
  assert.equal(m.runMaisRecenteDaSessao(runs, "ninguem"), null);
  assert.equal(m.runMaisRecenteDaSessao([], UUID), null);
});

test("index.ts: evento run com sessao+mcpRunId, link ?run= no painel final e tool abrir_run (CA-1/CA-6/CA-8)", () => {
  const src = fonte("src/index.ts");
  assert.match(src, /registerTool\(\s*["']abrir_run["']/, "tool abrir_run registrada");
  assert.match(src, /\?run=/, "painel final traz o link da run");
  assert.match(src, /sessaoAtual\(/, "rodar emite a sessao");
  assert.match(src, /mcpRunId/, "rodar emite o runId do MCP");
});
