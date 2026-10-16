// Spec da S2 (CA-3): "+ Feature", canvas run e orchestra-go.ps1 sairam. Quem dispara o orchestra agora e'
// a ferramenta do usuario ("use o orchestra"). O resto do canvas segue coberto pelos testes de sempre.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const ler = (rel: string) => readFileSync(path.join(RAIZ, rel), "utf8");

test("arquivos do disparo por planejador nao existem mais", () => {
  for (const rel of ["orchestra-go.ps1", "web/src/components/NovaFeatureDialog.tsx"])
    assert.equal(existsSync(path.join(RAIZ, rel)), false, rel);
});

test("hub nao tem mais /nova-feature, /cli/run nem o executor do orchestra-go", () => {
  const ui = ler("src/ui.ts");
  for (const trecho of ['"/nova-feature"', 'cmd === "run"', "executarNovaFeature", "orchestra-go.ps1", "validarNovaFeature", "validarPlanejador", "pedidos.json", "ANEXOS_DIR", "limiteBodyNovaFeature"])
    assert.equal(ui.includes(trecho), false, trecho);
});

test("hub sobe sem as opcoes de nova feature", async () => {
  const ui: Record<string, unknown> = await import("../dist/ui.js");
  for (const nome of ["validarNovaFeature", "validarPlanejador", "ANEXOS_DIR"]) assert.equal(nome in ui, false, nome);
});

test("CLI canvas nao tem mais o subcomando run", () => {
  const cli = ler("bin/canvas.mjs");
  assert.doesNotMatch(cli, /case "run"/);
  assert.doesNotMatch(cli, /^\s*run "<feature>"/m);
  let saida = "", codigo = 0;
  try {
    execFileSync(process.execPath, [path.join(RAIZ, "bin/canvas.mjs"), "run", "x", "--claude", "opus", "--eu", "a:b"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, DEV_ORCHESTRA_UI_PORT: "1" },
    });
  } catch (e: any) { saida = String(e.stdout ?? "") + String(e.stderr ?? ""); codigo = e.status; }
  assert.equal(codigo, 1, "run desconhecido cai no uso (exit 1), nao tenta falar com o hub");
  assert.match(saida, /^uso: canvas/m);
  assert.doesNotMatch(saida, /feature/i);
});

test("dashboard nao tem mais botao + Feature, atalho Shift+N nem o dialog", () => {
  const app = ler("web/src/App.tsx");
  const canvas = ler("web/src/components/Canvas.tsx");
  for (const [arq, src] of [["App.tsx", app], ["Canvas.tsx", canvas]] as const) {
    assert.doesNotMatch(src, /NovaFeature|onNovaFeature/, arq);
    assert.doesNotMatch(src, /\+ Feature|>Feature</, arq);
  }
  assert.doesNotMatch(canvas, /k === "n"/, "atalho Shift+N");
});

test("estado do front nao carrega mais o formulario de nova feature", () => {
  const estado = ler("web/src/lib/estado.ts");
  for (const nome of ["novaFeature", "corpoNovaFeature", "podeCriar", "problemaAnexo", "ANEXO_MAX", "PlanejadorEscolha"])
    assert.equal(estado.includes(nome), false, nome);
});
