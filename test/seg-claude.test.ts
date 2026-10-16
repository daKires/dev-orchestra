// Spec do PR1/S3 (CA-4): o agente Claude no Windows nunca passa por cmd.exe (que reinterpreta & | > ^ % ").
// resolverClaude(saidaDoWhere, existe, execPath) e' pura: acha o claude.exe ou, no shim do npm, o cli.js
// rodado pelo node em execucao; sem nenhum -> null (o hub mostra "claude não encontrado no PATH").
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MOD = "../dist/claude-pty.js";
const C: any = await import(MOD).catch(() => ({}));
const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE = "C:\\Program Files\\nodejs\\node.exe";

test("resolverClaude: exe nativo vence o shim do npm, mesmo listado depois (CA-4)", () => {
  assert.equal(typeof C.resolverClaude, "function", "claude-pty.ts exporta resolverClaude");
  const exe = "C:\\Users\\a\\.local\\bin\\claude.exe";
  const saida = "C:\\Users\\a\\AppData\\Roaming\\npm\\claude\r\nC:\\Users\\a\\AppData\\Roaming\\npm\\claude.cmd\r\n" + exe + "\r\n";
  assert.deepEqual(C.resolverClaude(saida, () => true, NODE), { comando: exe, args: [] });
});

test("resolverClaude: shim .cmd do npm vira node + cli.js do pacote (CA-4)", () => {
  const npm = "C:\\Users\\a\\AppData\\Roaming\\npm";
  const cli = path.join(npm, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
  const saida = `${npm}\\claude\r\n${npm}\\claude.cmd\r\n`;
  assert.deepEqual(C.resolverClaude(saida, (p: string) => p === cli, NODE), { comando: NODE, args: [cli] });
});

test("resolverClaude: nada achado (ou shim sem cli.js) -> null (CA-4)", () => {
  assert.equal(C.resolverClaude("", () => true, NODE), null);
  assert.equal(C.resolverClaude("C:\\x\\npm\\claude.cmd\r\n", () => false, NODE), null, "shim sem o pacote");
});

test("driver de PTY do desktop nao embrulha o comando em cmd.exe (CA-4)", () => {
  const src = readFileSync(path.join(RAIZ, "desktop", "pty.ts"), "utf8");
  assert.equal(/cmd\.exe/i.test(src), false, "desktop/pty.ts sem cmd.exe");
  assert.match(src, /resolverClaude/, "usa resolverClaude");
});
