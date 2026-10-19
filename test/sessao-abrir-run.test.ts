// Correcao de runs ligadas a sessao: abrir_run SEMPRE abre o navegador com ?run= (mesmo com o app desktop
// instalado, que abriria sem a URL e perderia a run). Sobe o MCP de verdade por stdio (CA-8).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

test("abrir_run abre o navegador com ?run=<id>, mesmo com o app Dev Orchestra instalado (CA-8)", async (t) => {
  const TMP = mkdtempSync(path.join(os.tmpdir(), "abrir-run-"));
  const LOG = path.join(TMP, "abrir.log");
  // app desktop "instalado": o abrir do dashboard geral preferiria ele (sem URL)
  const app = path.join(TMP, "localappdata", "Programs", "Dev Orchestra");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "Dev Orchestra.exe"), "");
  const porta = await portaLivre();
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("CLAUDE_CODE_") && k !== "OPENCODE") env[k] = v;
  Object.assign(env, {
    LOCALAPPDATA: path.join(TMP, "localappdata"),
    DEV_ORCHESTRA_ABRIR_LOG: LOG,
    DEV_ORCHESTRA_UI_PORT: String(porta),
    DEV_ORCHESTRA_RUNS_DIR: path.join(TMP, "runs"),
    DEV_ORCHESTRA_AGENTES_DIR: path.join(TMP, "agentes"),
    DEV_ORCHESTRA_CANVAS_DIR: path.join(TMP, "canvas"),
    DEV_ORCHESTRA_PLANEJADORES_DIR: path.join(TMP, "plan"),
  });
  const cliente = new Client({ name: "teste", version: "1.0.0" });
  await cliente.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(RAIZ, "dist", "index.js")], env, cwd: TMP }));
  t.after(() => cliente.close());

  const r = await cliente.callTool({ name: "abrir_run", arguments: { runId: "mcp-123" } });
  assert.match(JSON.stringify(r.content), /\?run=mcp-123/);
  assert.ok(existsSync(LOG), "abrir_run registrou a abertura");
  const linhas = readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { comando: string; args: string[] });
  const ultima = linhas[linhas.length - 1];
  assert.doesNotMatch(ultima.comando, /Dev Orchestra\.exe/i, "nao abre o app desktop (ele ignora a URL)");
  assert.ok(ultima.args.some((a) => a.includes(`127.0.0.1:${porta}/?run=mcp-123`)), "navegador recebe a URL da run: " + JSON.stringify(ultima));

  const geral = await cliente.callTool({ name: "abrir_run", arguments: {} });
  assert.match(JSON.stringify(geral.content), /nenhuma run nesta sessao/, "sem sessao: dashboard geral");
});
