// Spec da S1 (CA-4): abas do painel de chat podem ser FECHADAS — esconder, NAO encerrar o
// planejador (o chat segue rodando no fundo). A lista de fechados e' lembrada no navegador
// (localStorage, no App via useLocal) e um menu no topo do painel reabre os escondidos.
// Toda a derivacao mora em estado.ts (pura e testavel), NAO no componente. Regras:
//   - fechar tira o chat dos visiveis e o coloca nos escondidos;
//   - escondido NAO volta nem sendo o selecionado (nem como "extra na frente" do chatsVisiveis);
//   - planejador novo (slug que nunca foi fechado) sempre aparece;
//   - fechar a aba ativa passa a selecao pro ultimo visivel restante; fechar outra mantem;
//   - sem visiveis mas com escondidos, o painel fica em modo "so-menu" (da' pra reabrir);
//     sem nenhum dos dois, o painel some.
// Import por namespace: antes da implementacao o modulo nao tem essas funcoes e o teste falha
// por ASSERT (nao por erro de link), deixando claro que a falta e' de implementacao.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as estado from "./estado.ts";
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

test("as funcoes da S1 existem em estado.ts", () => {
  assert.equal(typeof estado.filtrarFechados, "function", "filtrarFechados");
  assert.equal(typeof estado.chatsEscondidos, "function", "chatsEscondidos");
  assert.equal(typeof estado.selecaoAposFechar, "function", "selecaoAposFechar");
  assert.equal(typeof estado.modoPainelChat, "function", "modoPainelChat");
});

test("filtrarFechados: fechar esconde da lista, preservando a ordem dos que ficam (CA-4)", () => {
  assert.deepEqual(estado.filtrarFechados(DO_PROJETO, []), DO_PROJETO);
  assert.deepEqual(estado.filtrarFechados(DO_PROJETO, ["a"]), [B]);
  assert.deepEqual(estado.filtrarFechados(DO_PROJETO, ["a", "b"]), []);
  // slug fechado que nao esta na lista nao muda nada
  assert.deepEqual(estado.filtrarFechados(DO_PROJETO, ["zzz"]), DO_PROJETO);
});

test("chat fechado NAO volta nem sendo o selecionado — nem como extra na frente (CA-4)", () => {
  // selecionado de fora do projeto entra na frente (regra do chatsVisiveis); fechado, some mesmo assim
  const comExtra = estado.chatsVisiveis(TODOS, DO_PROJETO, "z");
  assert.deepEqual(comExtra, [OUTRO, ...DO_PROJETO], "pre-condicao: o extra entra na frente");
  assert.deepEqual(estado.filtrarFechados(comExtra, ["z"]), DO_PROJETO);
  // selecionado do projeto, fechado: some da lista visivel
  assert.deepEqual(estado.filtrarFechados(estado.chatsVisiveis(TODOS, DO_PROJETO, "a"), ["a"]), [B]);
});

test("planejador novo (nunca fechado) sempre aparece (CA-4)", () => {
  const NOVO = REG({ slug: "n", cwd: "D:\\p\\.claude\\worktrees\\n", ts: 3 });
  const lista = [NOVO, ...DO_PROJETO];
  assert.deepEqual(estado.filtrarFechados(lista, ["a", "b"]), [NOVO]);
});

test("chatsEscondidos: so' os fechados da lista, na ordem dela — e' o conteudo do menu reabrir (CA-4)", () => {
  assert.deepEqual(estado.chatsEscondidos(DO_PROJETO, []), []);
  assert.deepEqual(estado.chatsEscondidos(DO_PROJETO, ["a"]), [A]);
  assert.deepEqual(estado.chatsEscondidos(DO_PROJETO, ["a", "b"]), [B, A], "ordem da lista, nao do fechamento");
  // fechado de OUTRO projeto nao entra no menu deste projeto
  assert.deepEqual(estado.chatsEscondidos(DO_PROJETO, ["a", "z"]), [A]);
});

test("selecaoAposFechar: fechar a ativa passa pro ultimo restante; fechar outra mantem (CA-4)", () => {
  const restantes = estado.filtrarFechados(DO_PROJETO, ["b"]); // [A]
  assert.equal(estado.selecaoAposFechar(restantes, "b", "b"), "a", "ativa fechada -> ultimo restante");
  assert.equal(estado.selecaoAposFechar(restantes, "b", "a"), "a", "fechou outra -> selecao mantida");
  assert.equal(estado.selecaoAposFechar([], "a", "a"), null, "sem restante -> null");
  assert.equal(estado.selecaoAposFechar(DO_PROJETO, "zzz", "b"), "b", "fechado fora da lista -> mantem");
});

test("modoPainelChat: normal / so-menu / oculto (CA-4)", () => {
  assert.equal(estado.modoPainelChat(2, 0), "normal");
  assert.equal(estado.modoPainelChat(1, 3), "normal", "tem visivel -> painel normal (menu continua acessivel)");
  assert.equal(estado.modoPainelChat(0, 2), "so-menu", "todos fechados -> so' a barra com o menu de reabrir");
  assert.equal(estado.modoPainelChat(0, 0), "oculto", "nenhum chat -> painel some");
});
