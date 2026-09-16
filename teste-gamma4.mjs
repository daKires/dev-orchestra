// Teste real e2e do swarm agentico (DeepSeek V4.1 Flash de verdade, via API nativa).
// Cria um repo scratch, chama a tool MCP com um plano de slices, e confere commit/arquivo/branch.
// Precisa de DEEPSEEK_API_KEY no ambiente (rode via `orchestra` ou `setx`).
import { spawn, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const key = process.env.DEEPSEEK_API_KEY;
if (!key) { console.error("sem DEEPSEEK_API_KEY no ambiente (setx DEEPSEEK_API_KEY \"sk-...\" e reabra o terminal)"); process.exit(1); }

// repo scratch com um npm test que passa (pro agente ter um comando de verificacao permitido)
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-e2e-"));
await fs.writeFile(path.join(scratch, "package.json"), JSON.stringify({ name: "e2e", version: "1.0.0", type: "module", scripts: { test: "node soma.test.js" } }, null, 2));
await fs.writeFile(path.join(scratch, "soma.test.js"), "import { soma } from './soma.js';\nif (soma(2,3)!==5) { console.error('FALHOU'); process.exit(1); }\nconsole.log('ok');\n");

// HERMES_GATE = mesmo comando: prova que o gate (typecheck/testes) roda de verdade antes do commit.
const env = { ...process.env, HERMES_LOG: path.join(scratch, "hermes-run.log"), HERMES_CMDS: "npm test", HERMES_GATE: "npm test" };
const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"], env });
let out = "";
const resp = new Map();
child.stdout.on("data", (c) => {
  out += c.toString();
  let i;
  while ((i = out.indexOf("\n")) >= 0) { const l = out.slice(0, i).trim(); out = out.slice(i + 1); if (l) { const m = JSON.parse(l); if (m.id) resp.set(m.id, m); } }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const wait = (id, ms) => new Promise((res, rej) => {
  const t = setInterval(() => { if (resp.has(id)) { clearInterval(t); res(resp.get(id)); } }, 50);
  setTimeout(() => { clearInterval(t); rej(new Error("timeout " + id)); }, ms);
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "teste", version: "1" } } });
await wait(1, 10000);
send({ jsonrpc: "2.0", method: "notifications/initialized" });

const plano = [{
  tarefa: "criar modulo soma",
  arquivos_alvo: ["soma.js"],
  descricao: "Crie soma.js exportando `export function soma(a, b) { return a + b; }`. " +
    "Depois rode `npm test` (comando permitido) e garanta que passa ('ok').",
}];
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "executar_orchestra", arguments: { cwd: scratch, feature: "modulo de soma com teste", plano } } });

console.log(">> chamando o swarm agentico (pode levar ~1-2 min)...\n");
const r = await wait(2, 300000);
child.kill();
console.log("\n===== PAINEL RETORNADO =====");
console.log(r.result?.content?.[0]?.text ?? JSON.stringify(r));

// checagens
const gitOut = (args) => execFileSync("git", ["-C", scratch, ...args], { encoding: "utf8" }).trim();
let falhas = 0;
const ok = async (nome, cond) => { const v = await cond; console.log((v ? "PASS " : "FAIL ") + nome); if (!v) falhas++; };
const painel = r.result?.content?.[0]?.text ?? "";
await ok("soma.js escrito", fs.stat(path.join(scratch, "soma.js")).then(() => true, () => false));
await ok("branch orchestra/*", Promise.resolve(gitOut(["rev-parse", "--abbrev-ref", "HEAD"]).startsWith("orchestra/")));
await ok("GATE rodou e passou", Promise.resolve(painel.includes("GATE: OK")));
await ok("commit feat: presente (so acontece com gate ok)", Promise.resolve(/feat:/.test(gitOut(["log", "--oneline", "-1"]))));
console.log(`\nscratch: ${scratch}`);
process.exit(falhas ? 1 : 0);
