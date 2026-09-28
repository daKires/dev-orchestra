// Spec da S3: o dashboard entende os registros de planejadores (CA-3/4/5) — reducer com as novas
// mensagens SSE + match de chat por projeto (raiz), que alimenta o painel split da direita.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, chatsDoProjeto, type Msg } from "./estado.ts";
import type { Planejador } from "../../../ui.ts";

const REG = (over: Partial<Planejador> = {}): Planejador => ({
  slug: "x", projeto: "p", raiz: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x",
  feature: "f", url: "http://127.0.0.1:1/a/session/s", base: "http://127.0.0.1:1", pid: 1, ts: 1,
  ...over,
});

test("reducer guarda a lista de planejadores e o andamento da nova feature (CA-3/CA-7)", () => {
  let e = aplicar(vazio, [{ planejadores: [REG()] }]);
  assert.equal(e.planejadores.length, 1);
  assert.equal(e.planejadores[0].slug, "x");
  e = aplicar(e, [{ novaFeature: { status: "rodando", projeto: "p", feature: "f" } }]);
  assert.equal(e.novaFeature?.status, "rodando");
  e = aplicar(e, [{ novaFeature: { status: "ok", projeto: "p", feature: "f", url: "http://u" } }]);
  assert.equal(e.novaFeature?.url, "http://u");
  // mensagens de run continuam funcionando junto e nao apagam a lista
  e = aplicar(e, [{ swarm: "r", ev: { t: "run", feature: "f", cwd: "D:\\p", total: 1 } }]);
  assert.equal(e.runs.r.feature, "f");
  assert.equal(e.planejadores.length, 1, "lista sobrevive a eventos de run");
});

test("chatsDoProjeto: match pela RAIZ — run na raiz ou em qualquer worktree do projeto ve o chat (CA-5)", () => {
  const plan = [
    REG({ slug: "a", ts: 1 }),
    REG({ slug: "b", cwd: "D:\\p\\.claude\\worktrees\\y", ts: 2 }),
  ];
  // run na raiz do projeto: os dois chats, mais recente primeiro (ordem das abas)
  assert.deepEqual(chatsDoProjeto(plan, "D:\\p").map((p) => p.slug), ["b", "a"]);
  // run no worktree x (o do proprio chat a): mesmo projeto, os dois aparecem
  assert.equal(chatsDoProjeto(plan, "D:\\p\\.claude\\worktrees\\x").length, 2);
  // run em OUTRO worktree do mesmo projeto: continua o mesmo projeto
  assert.equal(chatsDoProjeto(plan, "D:\\p\\.claude\\worktrees\\z").length, 2);
  // case e separadores nao importam
  assert.equal(chatsDoProjeto(plan, "d:/p").length, 2);
  // outro projeto: nada; e prefixo de pasta ("D:\p2") nao e' match
  assert.deepEqual(chatsDoProjeto(plan, "D:\\outro"), []);
  assert.deepEqual(chatsDoProjeto(plan, "D:\\p2"), []);
});
