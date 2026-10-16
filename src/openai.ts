// Conversao Anthropic Messages <-> OpenAI chat/completions (usado pelo provedor OpenCode Go, onde o
// DeepSeek so' existe no formato OpenAI). Tudo puro -- sem rede -- pra dar pra testar no --selftest;
// o fetch/streaming fica em deepseek.ts. O swarm continua vendo so' blocos Anthropic.
import type { Ferramenta, Msg, Resposta } from "./deepseek.js";

// Ida: system + historico Anthropic (content string OU blocos text/tool_use/thinking/tool_result)
// -> messages/tools da OpenAI. thinking vira reasoning_content: o DeepSeek exige o raciocinio de
// volta nos turnos com tool call.
export function paraOpenAI(system: string, messages: Msg[], tools: Ferramenta[]) {
  const out: any[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (typeof m.content === "string") { out.push({ role: m.role, content: m.content }); continue; }
    const blocos = (m.content as any[]) ?? [];
    if (m.role === "assistant") {
      const msg: any = { role: "assistant", content: blocos.filter((b) => b.type === "text").map((b) => b.text).join("") || null };
      const raciocinio = blocos.filter((b) => b.type === "thinking").map((b) => b.thinking).join("");
      if (raciocinio) msg.reasoning_content = raciocinio;
      const calls = blocos.filter((b) => b.type === "tool_use").map((b) => ({
        id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      if (calls.length) msg.tool_calls = calls;
      out.push(msg);
      continue;
    }
    for (const b of blocos) {
      if (b.type === "tool_result") {
        out.push({ role: "tool", tool_call_id: b.tool_use_id, content: typeof b.content === "string" ? b.content : JSON.stringify(b.content) });
      } else if (b.type === "text") out.push({ role: "user", content: b.text });
    }
  }
  const ferramentas = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } }));
  return { messages: out, tools: ferramentas };
}

// Volta: acumula os chunks do stream (tool_calls chegam fatiados por index) e fecha em blocos Anthropic.
export type EstadoStream = {
  texto: string; raciocinio: string; calls: { id: string; name: string; args: string }[];
  fim: string; usage?: { in: number; out: number };
};
export const novoEstado = (): EstadoStream => ({ texto: "", raciocinio: "", calls: [], fim: "" });

// Soma um chunk ao estado; devolve quantos caracteres chegaram (pro progresso ~tokens).
export function acumular(e: EstadoStream, chunk: any): number {
  if (chunk?.error) throw new Error(String(chunk.error.message ?? JSON.stringify(chunk.error)));
  if (chunk?.usage) e.usage = { in: Number(chunk.usage.prompt_tokens ?? 0), out: Number(chunk.usage.completion_tokens ?? 0) };
  let n = 0;
  for (const c of chunk?.choices ?? []) {
    const d = c.delta ?? {};
    if (d.content) { e.texto += d.content; n += d.content.length; }
    if (d.reasoning_content) { e.raciocinio += d.reasoning_content; n += d.reasoning_content.length; }
    for (const tc of d.tool_calls ?? []) {
      const i = Number(tc.index ?? e.calls.length);
      const call = (e.calls[i] ??= { id: "", name: "", args: "" });
      if (tc.id) call.id = tc.id;
      if (tc.function?.name) call.name += tc.function.name;
      if (tc.function?.arguments) { call.args += tc.function.arguments; n += tc.function.arguments.length; }
    }
    if (c.finish_reason) e.fim = c.finish_reason;
  }
  return n;
}

// Consome as linhas completas "data: {...}" do buffer SSE e devolve o resto (linha incompleta).
export function consumirSSE(buf: string, e: EstadoStream, onChars: (n: number) => void = () => {}): string {
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const linha = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!linha.startsWith("data:")) continue;
    const dado = linha.slice(5).trim();
    if (dado && dado !== "[DONE]") onChars(acumular(e, JSON.parse(dado)));
  }
  return buf;
}

const FIM: Record<string, string> = { tool_calls: "tool_use", stop: "end_turn", length: "max_tokens" };

export function finalizar(e: EstadoStream): Resposta {
  const blocos: any[] = [];
  if (e.raciocinio) blocos.push({ type: "thinking", thinking: e.raciocinio });
  if (e.texto) blocos.push({ type: "text", text: e.texto });
  for (const [k, c] of e.calls.entries()) {
    if (!c) continue;
    let input: unknown = {};
    try { input = c.args.trim() ? JSON.parse(c.args) : {}; } catch { input = {}; } // JSON quebrado -> a ferramenta reclama
    blocos.push({ type: "tool_use", id: c.id || `call_${k}`, name: c.name, input });
  }
  const temCall = blocos.some((b) => b.type === "tool_use");
  const stop = temCall ? "tool_use" : (FIM[e.fim] ?? e.fim);
  return { blocos, stop, usage: e.usage ?? { in: 0, out: 0 } };
}
