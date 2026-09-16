import fs from "node:fs";

const cfg = "C:/Users/eriks/.claude.json";
const raw = fs.readFileSync(cfg, "utf8");
fs.writeFileSync(cfg + ".bak-hermes", raw); // backup antes de mutar

const c = JSON.parse(raw);
c.mcpServers = c.mcpServers ?? {};
c.mcpServers["hermes-bridge"] = {
  type: "stdio",
  command: "node",
  args: ["D:\\Claude\\Dev Orchestra\\mcp-hermes-bridge\\dist\\index.js"],
};
fs.writeFileSync(cfg, JSON.stringify(c, null, 2) + "\n");

const check = JSON.parse(fs.readFileSync(cfg, "utf8"));
console.log("registrado:", JSON.stringify(check.mcpServers["hermes-bridge"]));
console.log("projects preservados:", Object.keys(check.projects ?? {}).length);
