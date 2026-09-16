import { spawn } from "node:child_process";

const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "inherit"] });
let out = "";
const responses = new Map();
child.stdout.on("data", (c) => {
  out += c.toString();
  let i;
  while ((i = out.indexOf("\n")) >= 0) {
    const line = out.slice(0, i).trim();
    out = out.slice(i + 1);
    if (!line) continue;
    const msg = JSON.parse(line); // falha o teste se stdout vazar texto nao-JSON
    if (msg.id) responses.set(msg.id, msg);
  }
});

const send = (o) => child.stdin.write(JSON.stringify(o) + "\n");
const wait = (id) => new Promise((res, rej) => {
  const t = setInterval(() => { if (responses.has(id)) { clearInterval(t); res(responses.get(id)); } }, 30);
  setTimeout(() => { clearInterval(t); rej(new Error("timeout id=" + id)); }, 10000);
});

send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "1.0.0" } } });
await wait(1);
send({ jsonrpc: "2.0", method: "notifications/initialized" });

send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
const list = await wait(2);
const tool = (list.result?.tools ?? []).find((t) => t.name === "executar_orchestra");
if (!tool) throw new Error("tool executar_orchestra ausente");
const props = tool.inputSchema?.properties ?? {};
for (const k of ["cwd", "feature", "plano"]) if (!props[k]) throw new Error("inputSchema sem " + k);

child.kill();
console.log("SMOKE OK -> executar_orchestra exposta com cwd/feature/plano; stdout 100% JSON.");
process.exit(0);
