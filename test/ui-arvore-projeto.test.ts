// Spec da tela unida (Run A, CA-5/6): GET /arvore e /arquivo aceitam ?projeto=<raiz> de um projeto
// conhecido (lista de /canvas/projetos). Pastas temporarias isoladas, nunca as reais da maquina.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}
const PORTA = await portaLivre();
const TMP = mkdtempSync(path.join(os.tmpdir(), "hermes-arvproj-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_RUNS_DIR = path.join(TMP, "runs");
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
const ui = await import("../dist/ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

test("/arvore e /arquivo com ?projeto= (CA-5, 6)", async (t) => {
  const raiz = mkdtempSync(path.join(TMP, "proj-"));
  execFileSync("git", ["init", "-q"], { cwd: raiz });
  mkdirSync(path.join(raiz, "src"));
  writeFileSync(path.join(raiz, "src", "a.ts"), "export const a = 1;\n");
  const fora = mkdtempSync(path.join(TMP, "fora-"));
  execFileSync("git", ["init", "-q"], { cwd: fora });
  writeFileSync(path.join(fora, "segredo.txt"), "x");

  await ui.iniciarUI();
  t.after(() => ui.pararUI());

  const cad = await fetch(BASE + "/canvas/projetos", {
    method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1" }, body: JSON.stringify({ raiz }),
  });
  assert.equal(cad.status, 204);

  const q = (p: string) => encodeURIComponent(p);
  const arv = await fetch(`${BASE}/arvore?projeto=${q(raiz)}`);
  assert.equal(arv.status, 200);
  assert.ok(((await arv.json()) as string[]).includes("src/a.ts"), "lista os arquivos da raiz do projeto");

  assert.equal((await fetch(`${BASE}/arvore?projeto=${q(fora)}`)).status, 404, "projeto desconhecido");
  assert.equal((await fetch(`${BASE}/arvore`)).status, 404, "sem agente nem projeto");

  const arq = await fetch(`${BASE}/arquivo?projeto=${q(raiz)}&caminho=${q("src/a.ts")}`);
  assert.equal(arq.status, 200);
  assert.equal(await arq.text(), "export const a = 1;\n");

  assert.equal((await fetch(`${BASE}/arquivo?projeto=${q(raiz)}&caminho=${q("../" + path.basename(fora) + "/segredo.txt")}`)).status, 400, "traversal");
  assert.equal((await fetch(`${BASE}/arquivo?projeto=${q(fora)}&caminho=segredo.txt`)).status, 404, "projeto desconhecido");
  assert.equal((await fetch(`${BASE}/arquivo?projeto=${q(raiz)}&caminho=src/nao.ts`)).status, 404, "arquivo inexistente");
});
