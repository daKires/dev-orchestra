// Spec S2: titulo da slice sem repetir o prefixo S<idx> que o planejador as vezes poe na tarefa (CA-4).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as formato from "./formato.ts";

const tituloDaSlice = (formato as Record<string, unknown>).tituloDaSlice as ((idx: number, tarefa: string) => string) | undefined;

test("tituloDaSlice e' exportada de formato.ts", () => {
  assert.equal(typeof tituloDaSlice, "function");
});

test("tira o prefixo S<idx> repetido (espaco, ·, :, -)", () => {
  assert.equal(tituloDaSlice!(1, "S1 npm e node absolutos"), "npm e node absolutos");
  assert.equal(tituloDaSlice!(1, "S1 · npm"), "npm");
  assert.equal(tituloDaSlice!(2, "S2: PATH"), "PATH");
  assert.equal(tituloDaSlice!(3, "S3 - Codex"), "Codex");
  assert.equal(tituloDaSlice!(4, "s4 dados"), "dados");
});

test("nao mexe no que nao e' o prefixo da propria slice", () => {
  assert.equal(tituloDaSlice!(1, "S10 outra coisa"), "S10 outra coisa");
  assert.equal(tituloDaSlice!(2, "S1 npm"), "S1 npm");
  assert.equal(tituloDaSlice!(1, "Setup do npm"), "Setup do npm");
  assert.equal(tituloDaSlice!(1, "modelo"), "modelo");
  assert.equal(tituloDaSlice!(1, "S1"), "S1", "so' o prefixo: mantem pra nao ficar vazio");
  assert.equal(tituloDaSlice!(1, ""), "");
});
