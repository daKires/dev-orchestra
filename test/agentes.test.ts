// Spec da S1 (F2): modelo de agentes e normalizacao dos eventos do OpenCode (CA-4a, CA-5, CA-5b).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PAPEIS, validarAgente, agenteDePlanejador, normalizarEvento, historicoParaLinhas, aplicarLinhas, separarModelo,
  type Linha,
} from "../dist/agentes.js";

const base = {
  id: "ag-1", projeto: "D:\\p", cwd: "D:\\p\\.claude\\worktrees\\x", base: "http://127.0.0.1:9", sessao: "ses_1",
  nome: "Designer", papel: "designer", modelo: "opencode-go/glm-5.2", instrucao: "x", tipo: "opencode", origem: "canvas",
};

test("PAPEIS: 4 prontos + livre, com instrucao PT-BR que manda ler o contexto (CA-5)", () => {
  assert.deepEqual(Object.keys(PAPEIS).sort(), ["designer", "dev", "lider", "livre", "revisor"]);
  assert.equal(PAPEIS.lider.nome, "Líder");
  assert.equal(PAPEIS.designer.nome, "Designer");
  assert.equal(PAPEIS.revisor.nome, "Revisor");
  for (const k of ["lider", "designer", "dev", "revisor"] as const) assert.ok(PAPEIS[k].instrucao.length > 20, k);
  assert.equal(PAPEIS.livre.instrucao, "");
});

test("validarAgente: aceita o registro completo e rejeita o resto (CA-5)", () => {
  assert.deepEqual(validarAgente(base), base);
  assert.equal(validarAgente({ ...base, id: "" }), null);
  assert.equal(validarAgente({ ...base, id: "../x" }), null, "id com caracteres de caminho");
  assert.equal(validarAgente({ ...base, papel: "pirata" }), null);
  assert.equal(validarAgente({ ...base, origem: "x" }), null);
  assert.equal(validarAgente({ ...base, sessao: 3 }), null);
  assert.equal(validarAgente(null), null);
});

test("agenteDePlanejador: planejador do orchestra-go vira agente plan-<slug> (CA-5b)", () => {
  const a = agenteDePlanejador({
    slug: "tela-login", projeto: "App", raiz: "D:\\App", cwd: "D:\\App\\.claude\\worktrees\\tela-login", feature: "Tela de login",
    url: "http://127.0.0.1:51234/RDpcQXBw/session/ses_abc", base: "http://127.0.0.1:51234", pid: 1, ts: 1,
  });
  assert.equal(a.id, "plan-tela-login");
  assert.equal(a.projeto, "D:\\App");
  assert.equal(a.cwd, "D:\\App\\.claude\\worktrees\\tela-login");
  assert.equal(a.base, "http://127.0.0.1:51234");
  assert.equal(a.sessao, "ses_abc");
  assert.equal(a.nome, "Tela de login");
  assert.equal(a.origem, "planejador");
  assert.equal(a.modelo, "opencode-go/glm-5.2");
  assert.ok(validarAgente(a), "o derivado passa na validacao");
});

test("separarModelo: provider/model -> {providerID, modelID} (CA-5)", () => {
  assert.deepEqual(separarModelo("opencode-go/glm-5.2"), { providerID: "opencode-go", modelID: "glm-5.2" });
  assert.deepEqual(separarModelo("openrouter/anthropic/claude-x"), { providerID: "openrouter", modelID: "anthropic/claude-x" });
  assert.equal(separarModelo("semBarra"), null);
  assert.equal(separarModelo(""), null);
});

test("normalizarEvento: partes de texto e tool viram linhas; papel vem do message.updated (CA-4a)", () => {
  const papeis = new Map<string, string>();
  assert.deepEqual(
    normalizarEvento({ type: "message.updated", properties: { info: { id: "m1", sessionID: "s", role: "user" } } }, papeis),
    { sessao: "s" },
  );
  assert.equal(papeis.get("m1"), "user");
  const u = normalizarEvento({ type: "message.part.updated", properties: { part: { id: "p1", sessionID: "s", messageID: "m1", type: "text", text: "oi" } } }, papeis);
  assert.deepEqual(u, { sessao: "s", linha: { id: "p1", msg: "m1", tipo: "usuario", texto: "oi" } });
  const t = normalizarEvento({ type: "message.part.updated", properties: { part: { id: "p2", sessionID: "s", messageID: "m2", type: "text", text: "Olá!" } } }, papeis);
  assert.deepEqual(t, { sessao: "s", linha: { id: "p2", msg: "m2", tipo: "texto", texto: "Olá!" } });

  const tool = (status: string, extra: Record<string, unknown> = {}) => normalizarEvento({
    type: "message.part.updated",
    properties: { part: { id: "p3", sessionID: "s", messageID: "m2", type: "tool", tool: "read", state: { status, input: { filePath: "src/a.ts" }, ...extra } } },
  }, papeis);
  assert.deepEqual(tool("pending")!.linha, { id: "p3", msg: "m2", tipo: "tool", estado: "pendente", texto: "read src/a.ts" });
  assert.equal(tool("running")!.linha!.estado, "rodando");
  assert.equal(tool("completed")!.linha!.estado, "ok");
  assert.equal(tool("error", { error: "boom" })!.linha!.estado, "erro");
  const bash = normalizarEvento({ type: "message.part.updated", properties: { part: { id: "p4", sessionID: "s", messageID: "m2", type: "tool", tool: "bash", state: { status: "running", input: { command: "npm test" } } } } }, papeis);
  assert.equal(bash!.linha!.texto, "bash npm test");
  const titulo = normalizarEvento({ type: "message.part.updated", properties: { part: { id: "p5", sessionID: "s", messageID: "m2", type: "tool", tool: "grep", state: { status: "completed", title: "TODO em 3 arquivos", input: {} } } } }, papeis);
  assert.equal(titulo!.linha!.texto, "grep TODO em 3 arquivos");
});

test("normalizarEvento: status de sessao e eventos ignorados (CA-4a)", () => {
  const p = new Map<string, string>();
  assert.deepEqual(normalizarEvento({ type: "session.status", properties: { sessionID: "s", status: { type: "busy" } } }, p), { sessao: "s", status: "ocupado" });
  assert.deepEqual(normalizarEvento({ type: "session.status", properties: { sessionID: "s", status: { type: "idle" } } }, p), { sessao: "s", status: "ocioso" });
  assert.deepEqual(normalizarEvento({ type: "session.idle", properties: { sessionID: "s" } }, p), { sessao: "s", status: "ocioso" });
  assert.equal(normalizarEvento({ type: "server.connected", properties: {} }, p), null);
  assert.equal(normalizarEvento({ type: "message.part.updated", properties: { part: { id: "x", sessionID: "s", messageID: "m", type: "step-start" } } }, p), null);
  assert.equal(normalizarEvento("lixo", p), null);
});

test("historicoParaLinhas: /session/:id/message em linhas, na ordem (CA-4a)", () => {
  const l = historicoParaLinhas([
    { info: { id: "m1", role: "user", sessionID: "s" }, parts: [{ id: "a", type: "text", text: "faz X" }] },
    { info: { id: "m2", role: "assistant", sessionID: "s" }, parts: [
      { id: "b", type: "tool", tool: "edit", state: { status: "completed", input: { filePath: "x.ts" } } },
      { id: "c", type: "text", text: "feito" },
      { id: "d", type: "step-finish" },
    ] },
  ]);
  assert.deepEqual(l.map((x) => [x.id, x.tipo, x.texto]), [["a", "usuario", "faz X"], ["b", "tool", "edit x.ts"], ["c", "texto", "feito"]]);
});

test("aplicarLinhas: upsert por id, ordem estavel e limite das ultimas N mensagens (CA-4a)", () => {
  const L = (id: string, msg: string, texto = id): Linha => ({ id, msg, tipo: "texto", texto });
  let ls = aplicarLinhas([], [L("a", "m1"), L("b", "m1")]);
  ls = aplicarLinhas(ls, [L("a", "m1", "a2"), L("c", "m2")]);
  assert.deepEqual(ls.map((x) => [x.id, x.texto]), [["a", "a2"], ["b", "b"], ["c", "c"]]);
  const muitas: Linha[] = [];
  for (let i = 0; i < 60; i++) muitas.push(L("p" + i, "m" + i));
  const cortado = aplicarLinhas([], muitas, 50);
  assert.equal(new Set(cortado.map((x) => x.msg)).size, 50);
  assert.equal(cortado[0].msg, "m10", "descarta as mensagens mais antigas");
});
