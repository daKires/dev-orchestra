// Spec da S6 (CA-4/13/14): skill orchestra neutra (serve em qualquer ferramenta), plan-sdd sem coisa de
// outro projeto, instalador antigo apagado, pacote pronto pro `npm publish` e README do npx.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

test("skill orchestra neutra: frontmatter, tools do dev-orchestra, sem amarras ao Claude/PowerShell (CA-13)", () => {
  const rel = "setup/skills/orchestra/SKILL.md";
  assert.ok(existsSync(path.join(RAIZ, rel)), rel);
  const s = ler(rel);
  const fm = s.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fm, "frontmatter");
  assert.match(fm[1], /^name: orchestra$/m);
  assert.match(fm[1], /^description: .*use o orchestra/im);
  for (const proibido of ["Claude", "PowerShell", "HERMES_MODEL", "hermes-bridge", "orchestra-go", "$ARGUMENTS", "{{HOME}}", "career-copilot"])
    assert.equal(s.includes(proibido), false, proibido);
  for (const exigido of ["dev-orchestra", "executar_orchestra", "status_orchestra", "doctor_orchestra", "plan-sdd", "GATE-FAILED", "REVERTER"])
    assert.ok(s.includes(exigido), exigido);
  assert.match(s, /aprova/i, "o usuario aprova o plano antes da run");
  assert.match(s, /testes? existentes? (sao|são) imut/i);
});

test("plan-sdd publica sem coisas de outro projeto (CA-13)", () => {
  const s = ler("setup/skills/plan-sdd/SKILL.md");
  assert.match(s, /^---\r?\nname: plan-sdd/);
  for (const especifico of ["5433", "prisma", "infra:up", "@/ds", "ConfirmDialog", ".module.css"])
    assert.equal(s.includes(especifico), false, especifico);
  assert.match(s, /AskUserQuestion|pergunt/i);
});

test("instalador antigo e roteiros por ferramenta foram apagados (CA-4)", () => {
  for (const rel of ["install.ps1", "register.mjs", "orchestra-env.ps1", "setup/profile.ps1"])
    assert.equal(existsSync(path.join(RAIZ, rel)), false, rel);
  // pasta pode sobrar vazia (o swarm apaga arquivo, nao pasta); o que importa e' nao ter arquivo dentro
  for (const rel of ["setup/claude-commands", "setup/opencode-commands"]) {
    const dir = path.join(RAIZ, rel);
    assert.equal(existsSync(dir) ? readdirSync(dir, { recursive: true }).length : 0, 0, rel);
  }
});

test("package.json publicavel com bin e files (CA-14)", () => {
  const p = JSON.parse(ler("package.json"));
  assert.equal(p.name, "dev-orchestra");
  assert.equal("private" in p, false);
  assert.deepEqual(p.bin, { "dev-orchestra": "bin/dev-orchestra.mjs" });
  for (const f of ["bin", "dist", "setup"]) assert.ok(p.files?.includes(f), "files tem " + f);
  assert.match(p.engines?.node ?? "", />=\s*22/);
});

test("npm pack leva o que o npx precisa (CA-14)", () => {
  const [pack] = JSON.parse(execSync("npm pack --dry-run --json", { cwd: RAIZ, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
  const arquivos = new Set<string>(pack.files.map((f: any) => f.path.replace(/\\/g, "/")));
  for (const f of ["dist/index.js", "dist/setup.js", "dist/web/index.html", "setup/skills/orchestra/SKILL.md", "setup/skills/plan-sdd/SKILL.md", "README.md", "LICENSE"])
    assert.ok(arquivos.has(f), f);
  for (const f of arquivos) assert.doesNotMatch(f, /\.test\.(js|ts)$|^web\/src\//, f);
});

test("README ensina o npx e as ferramentas, sem install.ps1 (CA-14)", () => {
  const r = ler("README.md");
  assert.equal(r.includes("install.ps1"), false);
  assert.ok(r.includes("npx dev-orchestra"));
  for (const f of ["Claude Code", "OpenCode", "Codex", "Cursor", "Antigravity"]) assert.ok(r.includes(f), f);
  assert.match(r, /use o orchestra|use orchestra/i);
});
