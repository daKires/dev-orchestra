// Spec da ligacao da retomada no MCP (CA-1, CA-2, CA-5): evento run com pid, rodar usa
// acharRunMorta/marcarInterrompida, status_orchestra espera 20s e a skill fala ~20s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const idx = readFileSync(new URL("../dist/index.js", import.meta.url), "utf8");
const skill = readFileSync(new URL("../setup/skills/orchestra/SKILL.md", import.meta.url), "utf8");

test("evento run grava o pid do processo (CA-1)", () => {
  assert.match(idx, /t: "run"[^\n]*pid: process\.pid/);
});

test("rodar procura a run morta e marca INTERROMPIDA (CA-1, CA-2)", () => {
  assert.match(idx, /acharRunMorta\(/);
  assert.match(idx, /marcarInterrompida\(/);
});

test("status_orchestra espera no maximo 20s (CA-5)", () => {
  assert.match(idx, /esperar\(runId, 20000\)/);
  assert.doesNotMatch(idx, /esperar\(runId, 45000\)/);
  assert.match(idx, /~20s/);
  assert.doesNotMatch(idx, /~45s/);
});

test("skill do orchestra fala ~20s por chamada (CA-5)", () => {
  assert.match(skill, /~20s/);
  assert.doesNotMatch(skill, /45s/);
});
