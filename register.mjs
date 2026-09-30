import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cfg = path.join(os.homedir(), ".claude.json");
const raw = fs.existsSync(cfg) ? fs.readFileSync(cfg, "utf8") : "{}";
fs.writeFileSync(cfg + ".bak-hermes", raw); // backup antes de mutar

const c = JSON.parse(raw);
c.mcpServers = c.mcpServers ?? {};
c.mcpServers["hermes-bridge"] = {
  type: "stdio",
  command: "node",
  args: [path.join(path.dirname(fileURLToPath(import.meta.url)), "dist", "index.js")],
};
fs.writeFileSync(cfg, JSON.stringify(c, null, 2) + "\n");
console.log("registrado:", JSON.stringify(c.mcpServers["hermes-bridge"]));
