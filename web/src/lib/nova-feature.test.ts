// Spec da S4: dialog "Nova feature" (CA-6/7/8) — lista de projetos conhecidos (uniao dos registros
// de planejadores com os projetos das runs) + validacao do formulario no cliente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, projetosConhecidos, podeCriar, type Msg } from "./estado.ts";
import type { Planejador } from "../../../ui.ts";

const REG = (over: Partial<Planejador> = {}): Planejador => ({
  slug: "x", projeto: "p", raiz: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x",
  feature: "f", url: "http://127.0.0.1:1/a/session/s", base: "http://127.0.0.1:1", pid: 1, ts: 1,
  ...over,
});

const norm = (lista: string[]) => lista.map((l) => l.toLowerCase().replace(/\\/g, "/"));

test("projetosConhecidos: uniao das raizes dos registros com os projetos das runs, dedupe e ordenado (CA-6)", () => {
  const run = (id: string, cwd: string): Msg => ({ swarm: id, ev: { t: "run", feature: "f", cwd, total: 1 } });
  const e = aplicar(vazio, [run("r1", "D:\\p1\\.claude\\worktrees\\x"), run("r2", "D:\\p2")]);
  const plan = [REG({ raiz: "D:\\p1" }), REG({ slug: "b", raiz: "d:/P3" })];
  assert.deepEqual(norm(projetosConhecidos(e, plan)), ["d:/p1", "d:/p2", "d:/p3"],
    "raiz do registro + raiz das runs (worktree conta como o projeto), sem duplicar p1");
  assert.deepEqual(projetosConhecidos(vazio, []), []);
});

test("podeCriar: projeto e feature obrigatorios, espacos nao contam (CA-6/8)", () => {
  assert.equal(podeCriar("D:\\p", "f"), true);
  assert.equal(podeCriar("  ", "f"), false);
  assert.equal(podeCriar("D:\\p", "   "), false);
  assert.equal(podeCriar("", ""), false);
});
