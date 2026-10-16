// Spec do PR2/S4 (CA-10): os dados do hub saem do %TEMP% (que o Windows limpa) pra ~/.dev-orchestra/dados,
// migrando uma vez o que existia em <tmp>/hermes. HOME e TEMP apontam pra pastas temporarias do teste.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const base = mkdtempSync(path.join(os.tmpdir(), "inst-dados-"));
const home = path.join(base, "home");
const temp = path.join(base, "temp");
mkdirSync(home, { recursive: true });
mkdirSync(path.join(temp, "hermes", "canvas", "p1"), { recursive: true });
writeFileSync(path.join(temp, "hermes", "canvas", "p1", "canvas.json"), '{"nos":[],"arestas":[]}');
process.env.USERPROFILE = home;
process.env.HOME = home;
process.env.TEMP = temp;
process.env.TMP = temp;
process.env.TMPDIR = temp;
for (const k of ["HERMES_RUNS_DIR", "HERMES_PLANEJADORES_DIR", "HERMES_CANVAS_DIR", "HERMES_AGENTES_DIR"]) delete process.env[k];
const ui: any = await import("../dist/ui.js");
const DADOS = path.join(home, ".dev-orchestra", "dados");

test("pastas padrao ficam em ~/.dev-orchestra/dados (CA-10)", () => {
  assert.equal(ui.RUNS_DIR, path.join(DADOS, "runs"));
  assert.equal(ui.PLANEJADORES_DIR, path.join(DADOS, "planejadores"));
  assert.equal(ui.CANVAS_DIR, path.join(DADOS, "canvas"));
  assert.equal(ui.AGENTES_DIR, path.join(DADOS, "agentes"));
});

test("dados de <tmp>/hermes migram na primeira subida (CA-10)", () => {
  const p = path.join(DADOS, "canvas", "p1", "canvas.json");
  assert.ok(existsSync(p), "canvas antigo copiado pro destino novo");
  assert.equal(readFileSync(p, "utf8"), '{"nos":[],"arestas":[]}');
});

test("migrarDadosAntigos copia uma vez so' e nunca sobrescreve o destino (CA-10)", () => {
  assert.equal(typeof ui.migrarDadosAntigos, "function", "ui.ts exporta migrarDadosAntigos");
  const b = mkdtempSync(path.join(os.tmpdir(), "inst-mig-"));
  const antigo = path.join(b, "antigo");
  const novo = path.join(b, "novo");
  mkdirSync(path.join(antigo, "agentes"), { recursive: true });
  writeFileSync(path.join(antigo, "agentes", "a.json"), "1");
  assert.equal(ui.migrarDadosAntigos(antigo, novo), true);
  assert.equal(readFileSync(path.join(novo, "agentes", "a.json"), "utf8"), "1");
  writeFileSync(path.join(antigo, "agentes", "a.json"), "2");
  assert.equal(ui.migrarDadosAntigos(antigo, novo), false, "destino ja existe");
  assert.equal(readFileSync(path.join(novo, "agentes", "a.json"), "utf8"), "1");
  assert.equal(ui.migrarDadosAntigos(path.join(b, "nao-existe"), path.join(b, "outro")), false);
  assert.equal(existsSync(path.join(b, "outro")), false);
});
