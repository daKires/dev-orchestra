// Spec do F2.1: texto do OpenCode 1.18 chega em message.part.delta (CA-4a).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizarEvento } from "../dist/agentes.js";

const upd = (part: Record<string, unknown>) => ({ type: "message.part.updated", properties: { sessionID: "s", part: { sessionID: "s", ...part } } });
const delta = (partID: string, d: string, field = "text") => ({ type: "message.part.delta", properties: { sessionID: "s", messageID: "m2", partID, field, delta: d } });

test("message.part.delta acumula o texto da parte e vira linha 'texto' (CA-4a)", () => {
  const papeis = new Map<string, string>();
  const partes = new Map();
  normalizarEvento({ type: "message.updated", properties: { sessionID: "s", info: { id: "m2", role: "assistant", sessionID: "s" } } }, papeis, partes);
  assert.equal(normalizarEvento(upd({ id: "p1", messageID: "m2", type: "text", text: "" }), papeis, partes), null, "parte de texto vazia ainda nao vira linha");
  assert.deepEqual(normalizarEvento(delta("p1", "Olá"), papeis, partes), { sessao: "s", linha: { id: "p1", msg: "m2", tipo: "texto", texto: "Olá" } });
  assert.deepEqual(normalizarEvento(delta("p1", " mundo"), papeis, partes), { sessao: "s", linha: { id: "p1", msg: "m2", tipo: "texto", texto: "Olá mundo" } });
  // o part.updated final (texto completo) continua valendo e substitui o acumulado
  assert.deepEqual(normalizarEvento(upd({ id: "p1", messageID: "m2", type: "text", text: "Olá mundo!" }), papeis, partes)!.linha!.texto, "Olá mundo!");
});

test("reasoning e partes desconhecidas sao ignoradas, inclusive nos deltas (CA-4a)", () => {
  const papeis = new Map<string, string>();
  const partes = new Map();
  assert.equal(normalizarEvento(upd({ id: "r1", messageID: "m2", type: "reasoning", text: "" }), papeis, partes), null);
  assert.equal(normalizarEvento(delta("r1", "pensando..."), papeis, partes), null);
  assert.equal(normalizarEvento(delta("desconhecida", "x"), papeis, partes), null, "delta sem part.updated anterior");
  assert.equal(normalizarEvento({ type: "server.heartbeat", properties: {} }, papeis, partes), null);
  assert.equal(normalizarEvento({ type: "session.diff", properties: { sessionID: "s", diff: [] } }, papeis, partes), null);
});

test("sem o 3o argumento continua funcionando como antes (compat)", () => {
  const papeis = new Map<string, string>();
  assert.deepEqual(
    normalizarEvento(upd({ id: "p9", messageID: "m9", type: "text", text: "oi" }), papeis),
    { sessao: "s", linha: { id: "p9", msg: "m9", tipo: "texto", texto: "oi" } },
  );
  assert.equal(normalizarEvento(delta("p9", "x"), papeis), null, "sem mapa de partes, delta e' ignorado");
});
