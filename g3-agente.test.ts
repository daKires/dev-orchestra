// Spec da G3 (agente): a caixa da slice entrega instrucoes no proximo turno, pausa entre turnos e
// descarta o que chegou depois do ultimo turno (CA-1, 2, 4, 5, 6, 9).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fsp } from "node:fs";
import os from "node:os";
import path from "node:path";
import { agente } from "./hermes.js";

const usarListar = { blocos: [{ type: "tool_use", id: "u1", name: "listar", input: { caminho: "." } }], stop: "tool_use" };
const fim = { blocos: [{ type: "text", text: "fim" }], stop: "end_turn" };
const tarefa = { tarefa: "t", arquivos_alvo: [], descricao: "d" };

// msgFn falso: guarda um retrato das mensagens de cada chamada e segue o roteiro de respostas.
function modelo(roteiro: any[]) {
  const chamadas: any[][] = [];
  const fn = async (_sys: string, messages: any[]) => {
    chamadas.push(JSON.parse(JSON.stringify(messages)));
    return roteiro[Math.min(chamadas.length - 1, roteiro.length - 1)];
  };
  return { fn, chamadas };
}

// Caixa falsa: cada chamada de tomar() devolve o proximo item do roteiro ([] quando acabar).
function caixa(tomadas: string[][], pausas: boolean[] = [], esperar: "retomada" | "teto" = "retomada") {
  let t = 0, p = 0, esperas = 0;
  return {
    c: {
      tomar: () => tomadas[t++] ?? [],
      pausada: () => pausas[p++] ?? false,
      esperar: async () => { esperas++; return esperar; },
    },
    esperas: () => esperas,
  };
}

const textoDe = (msg: any): string =>
  typeof msg.content === "string" ? msg.content : msg.content.map((b: any) => b.text ?? "").join("\n");

test("instrucoes tomadas no inicio do turno entram juntas, em ordem, na ultima mensagem do usuario (CA-1, 2)", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-g3a-"));
  const eventos: any[] = [];
  const m = modelo([usarListar, fim]);
  const cx = caixa([[], ["use fetch", "e logue"]]);
  await agente(base, "f", tarefa, (e: any) => eventos.push(e), 2, [], m.fn as any, undefined, cx.c as any);
  assert.equal(m.chamadas.length, 2);
  const ultima = m.chamadas[1].at(-1);
  assert.equal(ultima.role, "user");
  assert.ok(ultima.content.some((b: any) => b.type === "tool_result"), "tool_result continua la'");
  assert.match(textoDe(ultima), /INSTRUCAO DO USUARIO:[\s\S]*use fetch[\s\S]*e logue/);
  assert.ok(!/INSTRUCAO/.test(textoDe(m.chamadas[0][0])), "turno 0 sem instrucao");
  const ev = eventos.filter((e) => e.t === "instrucao");
  assert.deepEqual(ev.map((e) => [e.slice, e.texto, !!e.descartada]), [[2, "use fetch", false], [2, "e logue", false]]);
});

test("instrucao ja' no turno 0 vai junto do pedido inicial (CA-1)", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-g3b-"));
  const m = modelo([fim]);
  await agente(base, "f", tarefa, () => {}, 1, [], m.fn as any, undefined, caixa([["comece pelo README"]]).c as any);
  assert.match(textoDe(m.chamadas[0][0]), /Tarefa: t[\s\S]*INSTRUCAO DO USUARIO:[\s\S]*comece pelo README/);
});

test("pausada: espera antes de chamar o modelo e emite pausada/retomada; teto vira motivo (CA-4, 5, 6)", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-g3c-"));
  const eventos: any[] = [];
  const m = modelo([usarListar, fim]);
  const cx = caixa([], [false, true], "teto");
  await agente(base, "f", tarefa, (e: any) => eventos.push(e), 2, [], m.fn as any, undefined, cx.c as any);
  assert.equal(cx.esperas(), 1);
  const p = eventos.filter((e) => e.t === "pausa");
  assert.deepEqual(p.map((e) => [e.slice, e.estado]), [[2, "pausada"], [2, "retomada"]]);
  assert.match(p[1].motivo ?? "", /teto/);
  assert.equal(m.chamadas.length, 2, "seguiu depois de retomar");
});

test("instrucao que chega depois do ultimo turno vira descartada (CA-9)", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-g3d-"));
  const eventos: any[] = [];
  const m = modelo([fim]);
  await agente(base, "f", tarefa, (e: any) => eventos.push(e), 2, [], m.fn as any, undefined, caixa([[], ["tarde demais"]]).c as any);
  const d = eventos.filter((e) => e.t === "instrucao");
  assert.deepEqual(d.map((e) => [e.texto, e.descartada]), [["tarde demais", true]]);
});

test("sem caixa o agente segue igual (selftest/reparo)", async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), "hermes-g3e-"));
  const m = modelo([fim]);
  await agente(base, "f", tarefa, () => {}, 1, [], m.fn as any);
  assert.equal(m.chamadas.length, 1);
});
