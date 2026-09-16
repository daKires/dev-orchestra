// Prova que a tool alimenta o HERMES_LOG (a janela monitor faz tail nele). Offline: plano vazio, sem key.
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-cwd-"));
await fs.writeFile(path.join(cwd, "ola.txt"), "oi\n"); // baseline precisa de algo pra commitar
const logf = path.join(os.tmpdir(), "hermes-livelog-" + process.pid + ".log");
const env = { ...process.env, HERMES_LOG: logf };
delete env.OPENROUTER_API_KEY;

const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"], env });
let out = "";
const responses = new Map();
child.stdout.on("data", (c) => {
  out += c.toString();
  let i;
  while ((i = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, i).trim(); out = out.slice(i + 1);
    if (line) { const m = JSON.parse(line); if (m.id) responses.set(m.id, m); }
  }
});
const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const wait = (id) => new Promise((res, rej) => {
  const t = setInterval(() => { if (responses.has(id)) { clearInterval(t); res(responses.get(id)); } }, 30);
  setTimeout(() => { clearInterval(t); rej(new Error("timeout " + id)); }, 15000);
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
await wait(1);
send({ jsonrpc: "2.0", method: "notifications/initialized" });
send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "executar_orchestra", arguments: { cwd, feature: "teste vazio", plano: [] } } });
const r = await wait(2);
child.kill();

const painel = r.result?.content?.[0]?.text ?? "";
const logConteudo = await fs.readFile(logf, "utf8").catch(() => "");
if (!painel.includes("HERMES")) throw new Error("painel ausente no resultado");
if (!logConteudo.includes("HERMES SWARM") || !logConteudo.includes("PLANO recebido: 0")) throw new Error("HERMES_LOG nao foi alimentado");
console.log("LIVELOG OK -> a janela monitor recebe o painel ao vivo via " + logf);
await fs.rm(cwd, { recursive: true, force: true });
await fs.rm(logf, { force: true });
process.exit(0);
