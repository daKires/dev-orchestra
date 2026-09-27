// Spec da correcao (CA-4/CA-7): a derivacao de chats visiveis do painel da direita mora em estado.ts
// (testavel), NAO no componente. Regras: a lista NUNCA filtra pelo selecionado (clicar numa aba nao
// pode sumir com as outras); um chat selecionado de FORA do projeto da run (nova feature recem-criada)
// entra como extra na frente; selecionado invalido e' ignorado.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chatsVisiveis } from "./estado.ts";
import type { Planejador } from "../../../ui.ts";

const REG = (over: Partial<Planejador> = {}): Planejador => ({
  slug: "x", projeto: "p", raiz: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x",
  feature: "f", url: "http://127.0.0.1:1/a/session/s", base: "http://127.0.0.1:1", pid: 1, ts: 1,
  ...over,
});

const A = REG({ slug: "a" });
const B = REG({ slug: "b", cwd: "D:\\p\\.claude\\worktrees\\y", ts: 2 });
const OUTRO = REG({ slug: "z", projeto: "q", raiz: "D:\\q", cwd: "D:\\q\\.claude\\worktrees\\z" });
const TODOS = [A, B, OUTRO];
const DO_PROJETO = [B, A]; // ordem de chatsDoProjeto (ts desc)

test("sem selecao: a lista do projeto aparece inteira (CA-4)", () => {
  assert.deepEqual(chatsVisiveis(TODOS, DO_PROJETO, null), DO_PROJETO);
});

test("selecionado do projeto: a lista CONTINUA inteira — clicar numa aba nao esconde as outras (CA-4)", () => {
  assert.deepEqual(chatsVisiveis(TODOS, DO_PROJETO, "a"), DO_PROJETO);
  assert.deepEqual(chatsVisiveis(TODOS, DO_PROJETO, "b"), DO_PROJETO);
});

test("selecionado de FORA do projeto (nova feature recem-criada): entra como extra na frente (CA-7)", () => {
  assert.deepEqual(chatsVisiveis(TODOS, DO_PROJETO, "z"), [OUTRO, ...DO_PROJETO]);
  // projeto sem nenhum chat proprio (ex.: sem run selecionada): so' o extra
  assert.deepEqual(chatsVisiveis(TODOS, [], "z"), [OUTRO]);
});

test("selecionado invalido (sumiu da lista global): ignorado, so' a lista do projeto", () => {
  assert.deepEqual(chatsVisiveis(TODOS, DO_PROJETO, "nao-existe"), DO_PROJETO);
  assert.deepEqual(chatsVisiveis(TODOS, [], "nao-existe"), []);
});
