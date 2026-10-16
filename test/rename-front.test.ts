// Spec do PR4 (CA-22, CA-24..26), parte desktop/web: sem "hermes" no app Electron nem no front.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { RAIZ, varrerHermes } from "./varrer-hermes.js";

test("nenhum 'hermes' em desktop/ e web/ (CA-22, CA-25)", () => {
  const achados = varrerHermes(["desktop", path.join("web", "src")], [path.join("web", "package.json"), path.join("web", "index.html")]);
  assert.deepEqual(achados, [], "sobrou hermes:\n" + achados.join("\n"));
});

test("desktop vira Dev Orchestra (instalador e caminho do exe) (CA-26)", () => {
  const yml = readFileSync(path.join(RAIZ, "desktop", "electron-builder.yml"), "utf8");
  assert.match(yml, /^productName: Dev Orchestra$/m);
  assert.match(yml, /^appId: dev\.orchestra\.desktop$/m);
  const idx = readFileSync(path.join(RAIZ, "src", "index.ts"), "utf8");
  assert.match(idx, /"Programs", "Dev Orchestra", "Dev Orchestra\.exe"/);
});
