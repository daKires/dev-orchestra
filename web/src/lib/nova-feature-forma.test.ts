// Extra da S4: alem do dedupe (coberto em nova-feature.test.ts), a lista do formulario precisa
// PRESERVAR a forma do caminho como veio (case e separador do primeiro registro) e ordenar
// case-insensitive — senao o caminho colado no dialog aparece "gritado" em minusculas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, projetosConhecidos, podeCriar, type Msg } from "./estado.ts";
import type { Planejador } from "../../../ui.ts";

const REG = (over: Partial<Planejador> = {}): Planejador => ({
  slug: "x", projeto: "p", raiz: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x",
  feature: "f", url: "http://127.0.0.1:1/a/session/s", base: "http://127.0.0.1:1", pid: 1, ts: 1,
  ...over,
});

test("projetosConhecidos: preserva a primeira forma e ordena case-insensitive (CA-6)", () => {
  const run = (cwd: string): Msg => ({ swarm: cwd, ev: { t: "run", feature: "f", cwd, total: 1 } });
  // b vem antes de A no alfabeto; D:\p1 repete com outra forma (nao pode virar item novo)
  const e = aplicar(vazio, [run("D:\\p1"), run("D:\\p1\\.claude\\worktrees\\wt"), run("d:/p3")]);
  const plan = [REG({ raiz: "D:\\beta" }), REG({ slug: "a", raiz: "c:/Alpha" })];
  assert.deepEqual(projetosConhecidos(e, plan), ["c:/Alpha", "D:\\beta", "D:\\p1", "d:/p3"]);
  assert.deepEqual(projetosConhecidos(vazio, [REG({ raiz: "D:\\unico" })]), ["D:\\unico"]);
});

test("podeCriar: so' o trim decide, o resto da string passa igual (CA-8)", () => {
  assert.equal(podeCriar("d:/p", "a b"), true);
  assert.equal(podeCriar("\tD:\\p\n", "f"), true);
  assert.equal(podeCriar("D:\\p", "\t "), false);
});