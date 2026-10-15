// Guarda de package.json "scripts" + tool apagar_arquivo (roda via dist: tsc && node --test dist/guarda-escrita.test.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { escritaProibida, execFerramenta, type CtxAgente } from "./hermes.js";

const ex = new Set<string>();
const pkg = (o: object) => JSON.stringify(o, null, 2);
const base0 = { name: "x", scripts: { test: "node --test" }, dependencies: { a: "1" } };

test("package.json: script novo pretest:x e' recusado, mesmo em arquivos_alvo", () => {
  const novo = pkg({ ...base0, scripts: { ...base0.scripts, "pretest:x": "node limpa.mjs" } });
  assert.match(escritaProibida("web/package.json", ["web/package.json"], false, ex, pkg(base0), novo) ?? "", /scripts/);
});

test("package.json: alterar ou remover script e' recusado; package.json novo com scripts tambem", () => {
  assert.ok(escritaProibida("package.json", [], false, ex, pkg(base0), pkg({ ...base0, scripts: { test: "node evil.js" } })));
  assert.ok(escritaProibida("package.json", [], false, ex, pkg(base0), pkg({ ...base0, scripts: {} })));
  assert.ok(escritaProibida("sub/package.json", [], false, ex, "", pkg({ scripts: { test: "x" } })));
  assert.ok(escritaProibida("package.json", [], false, ex, pkg(base0), "{ invalido"));
});

test(".npmrc (e .yarnrc/.pnpmfile) e' recusado em qualquer pasta, mesmo em arquivos_alvo", () => {
  for (const f of [".npmrc", "web/.npmrc", ".yarnrc.yml", ".pnpmfile.cjs"])
    assert.match(escritaProibida(f, [f], false, ex, "", "node-options=--require ./x.js") ?? "", /allowlist/, f);
  assert.equal(escritaProibida("docs/npmrc.md", [], false, ex), null);
});

test("package.json: mudar dependencies continua permitido", () => {
  const novo = pkg({ ...base0, dependencies: { a: "2", b: "1" } });
  assert.equal(escritaProibida("package.json", ["package.json"], false, ex, pkg(base0), novo), null);
  assert.equal(escritaProibida("package.json", [], false, ex, "", pkg({ name: "y" })), null);
});

async function ctxTmp(): Promise<CtxAgente> {
  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "guarda-")));
  execFileSync("git", ["init", "-q"], { cwd: base });
  await fs.writeFile(path.join(base, ".gitignore"), "gerado/\n");
  await fs.mkdir(path.join(base, "gerado"));
  await fs.mkdir(path.join(base, "node_modules/x"), { recursive: true });
  for (const f of ["velho.ts", "gerado/a.js", "node_modules/x/i.js", "foo.test.ts", ".npmrc"]) await fs.writeFile(path.join(base, f), "x\n");
  await fs.writeFile(path.join(base, "package.json"), pkg(base0));
  return {
    base, escritos: new Set(), comandos: [], cmds: [], emit: () => {}, sliceIdx: 1, alvos: [], exes: ex,
    falhasCmd: 0, falhasAmbiente: 0, tokensIn: 0, tokensOut: 0, tocouNoTeste: 0, ultimaVerificacaoOk: null,
  };
}

test("apagar_arquivo: apaga arquivo legitimo e registra em escritos", async () => {
  const c = await ctxTmp();
  assert.match(await execFerramenta(c, "apagar_arquivo", { caminho: "velho.ts" }), /^ok/);
  assert.equal(existsSync(path.join(c.base, "velho.ts")), false);
  assert.ok(c.escritos.has("velho.ts"));
});

test("apagar_arquivo: respeita as guardas de escrita", async () => {
  const c = await ctxTmp();
  const r = (caminho: string) => execFerramenta(c, "apagar_arquivo", { caminho });
  assert.match(await r("../fora.txt"), /fora do projeto/);
  assert.match(await r("."), /fora do projeto/);
  assert.match(await r("gerado/a.js"), /RECUSADO.*ignorado/);
  assert.match(await r("node_modules/x/i.js"), /RECUSADO.*node_modules/);
  assert.match(await r("foo.test.ts"), /RECUSADO \(teste imutavel\)/);
  assert.equal(c.tocouNoTeste, 1);
  assert.match(await r("package.json"), /RECUSADO.*scripts/);
  assert.match(await r(".npmrc"), /RECUSADO.*npmrc/);
  assert.match(await r("nao-existe.ts"), /nao existe/);
  for (const f of ["gerado/a.js", "node_modules/x/i.js", "foo.test.ts", "package.json", ".npmrc"]) assert.ok(existsSync(path.join(c.base, f)), f);
  assert.equal(c.escritos.size, 0);
});

test("escrever_arquivo em package.json: recusa pretest:x, aceita dependencies", async () => {
  const c = await ctxTmp();
  c.alvos = ["package.json"];
  const w = (o: object) => execFerramenta(c, "escrever_arquivo", { caminho: "package.json", conteudo: pkg(o) });
  assert.match(await w({ ...base0, scripts: { ...base0.scripts, "pretest:x": "node limpa.mjs" } }), /RECUSADO.*scripts/);
  assert.equal(await w({ ...base0, dependencies: { a: "2" } }), "ok");
});
