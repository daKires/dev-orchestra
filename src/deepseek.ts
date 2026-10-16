// Cliente do modelo via API Anthropic-compatible: DeepSeek nativa (apiKey/x-api-key) OU, sem chave
// nativa, OpenRouter (authToken/Bearer) como alternativa -- ambas suportadas direto pelo SDK, sem
// client wrapper. Streaming + timer ocioso + retry do mesmo turno (comTentativas) -> resposta longa
// nao estoura timeout e conexao que cai nao derruba a slice.
// OpenCode Go (assinatura) tem prioridade sobre as duas: la' o DeepSeek so' fala o formato OpenAI,
// entao esse provedor usa fetch + conversao de openai.ts em vez do SDK.
import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import { paraOpenAI, novoEstado, consumirSSE, finalizar } from "./openai.js";

// Provedor de fato usado: alimenta o custo (go = assinatura, custo por token 0).
export type ProvedorId = "go" | "deepseek" | "openrouter";

// Pura: decide o provedor a partir de quais chaves existem. Ordem: OpenCode Go > DeepSeek nativa >
// OpenRouter. Extraida assim (em vez de inline em obter()) pra dar pra testar no --selftest sem
// precisar mexer em env var em runtime. O `id` acompanha a escolha (custo por provedor).
export function escolherProvedor(deepseekKey?: string, openrouterKey?: string, goKey?: string): {
  id: ProvedorId; kind: "openai" | "anthropic"; baseURL: string; model: string; useAuthToken: boolean;
} {
  if (goKey) return { id: "go", kind: "openai", baseURL: "https://opencode.ai/zen/go/v1", model: "deepseek-v4.1-flash", useAuthToken: true };
  const viaOpenRouter = !deepseekKey && !!openrouterKey;
  return {
    id: viaOpenRouter ? "openrouter" : "deepseek",
    kind: "anthropic",
    baseURL: viaOpenRouter ? "https://openrouter.ai/api" : "https://api.deepseek.com/anthropic",
    model: viaOpenRouter ? "deepseek/deepseek-v4.1-flash" : "deepseek-flash",
    useAuthToken: viaOpenRouter,
  };
}

const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const GO_KEY = process.env.OPENCODE_GO_API_KEY?.trim() || undefined;
const PROVEDOR = escolherProvedor(DEEPSEEK_KEY, OPENROUTER_KEY, GO_KEY);

export const PROVEDOR_ID: ProvedorId = PROVEDOR.id;

export const MODEL = process.env.HERMES_MODEL || PROVEDOR.model;
const BASE_URL = process.env.HERMES_BASE_URL || PROVEDOR.baseURL;
const MAX_TOKENS = Number(process.env.HERMES_MAX_TOKENS || "32000");
// Teto TOTAL do SDK bem alto: quem detecta travamento e' o timer ocioso (sem bytes por OCIOSO_MS),
// assim geracao longa mas ativa nunca e' cortada (a causa do travamento da run E1).
const TIMEOUT = Number(process.env.HERMES_TIMEOUT_MS || String(30 * 60 * 1000));
const OCIOSO_MS = Number(process.env.HERMES_OCIOSO_MS || "60000");
const TENTATIVAS = Number(process.env.HERMES_TENTATIVAS || "3");

export type Ferramenta = { name: string; description: string; input_schema: Record<string, unknown> };
export type Msg = { role: "user" | "assistant"; content: unknown };
// blocos sao os content blocks do SDK ({type:"text",text} | {type:"tool_use",id,name,input});
// devolvidos crus pra poderem ser relidos E reecoados como content de mensagem assistant.
export type Resposta = { blocos: any[]; stop: string; usage?: { in: number; out: number } };
export type OpcoesMsg = {
  signal?: AbortSignal;                              // cancelamento da run (chat ou UI)
  onProgresso?: (tokens: number) => void;            // ~tokens gerados ate agora (throttled)
  onTentativa?: (n: number, motivo: string) => void; // antes de re-tentar o turno
};
export type MensagemFn = (system: string, messages: Msg[], tools: Ferramenta[], opts?: OpcoesMsg) => Promise<Resposta>;

// Cancelamento pedido pelo usuario: nunca re-tenta, sobe ate rodar() virar CANCELED.
export class CanceladoError extends Error {
  constructor() { super("cancelado"); this.name = "CanceladoError"; }
}

// Erro transitorio (rede caiu, 429, 5xx) vale re-tentar; erro de request (400/401...) nao.
export function retentavel(e: any): boolean {
  if (e?.naoRetentar) return false; // teto de uso do OpenCode Go: re-tentar so' gasta tempo
  const st = Number(e?.status);
  if (st === 429 || st >= 500) return true;
  if (e instanceof Anthropic.APIConnectionError) return true;
  return /terminated|ECONNRESET|ETIMEDOUT|socket|fetch failed|network/i.test(String(e?.message ?? e));
}

function esperar(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, falha) => {
    if (signal?.aborted) return falha(new CanceladoError());
    const t = setTimeout(() => { signal?.removeEventListener("abort", fim); ok(); }, ms);
    const fim = () => { clearTimeout(t); falha(new CanceladoError()); };
    signal?.addEventListener("abort", fim, { once: true });
  });
}

// Roda fazer() com timer OCIOSO (vivo() rearma; estourou -> aborta a tentativa) e re-tenta o MESMO
// turno em ocioso/erro transitorio, com backoff. Generica pra dar pra testar offline no selftest.
export async function comTentativas<T>(
  fazer: (sinal: AbortSignal, vivo: () => void) => Promise<T>,
  o: { signal?: AbortSignal; ociosoMs?: number; tentativas?: number; esperas?: number[]; onTentativa?: (n: number, motivo: string) => void } = {},
): Promise<T> {
  const tentativas = o.tentativas ?? TENTATIVAS;
  const esperas = o.esperas ?? [2000, 5000];
  for (let n = 1; ; n++) {
    if (o.signal?.aborted) throw new CanceladoError();
    const ctrl = new AbortController();
    let ocioso = false;
    let timer: NodeJS.Timeout | undefined;
    const vivo = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { ocioso = true; ctrl.abort(); }, o.ociosoMs ?? OCIOSO_MS);
    };
    const cancelar = () => ctrl.abort();
    o.signal?.addEventListener("abort", cancelar, { once: true });
    vivo();
    try {
      return await fazer(ctrl.signal, vivo);
    } catch (e: any) {
      if (o.signal?.aborted) throw new CanceladoError();
      const motivo = ocioso ? `sem resposta por ${Math.round((o.ociosoMs ?? OCIOSO_MS) / 1000)}s` : String(e?.message ?? e).slice(0, 120);
      if (n >= tentativas || !(ocioso || retentavel(e))) throw new Error(motivo + (n > 1 ? ` (apos ${n} tentativas)` : ""));
      o.onTentativa?.(n + 1, motivo);
      await esperar(esperas[Math.min(n - 1, esperas.length - 1)], o.signal);
    } finally {
      clearTimeout(timer);
      o.signal?.removeEventListener("abort", cancelar);
    }
  }
}

let cliente: Anthropic | null = null;
function obter(): Anthropic {
  if (cliente) return cliente;
  if (PROVEDOR.useAuthToken) {
    cliente = new Anthropic({ authToken: OPENROUTER_KEY, baseURL: BASE_URL, timeout: TIMEOUT, maxRetries: 0 });
  } else {
    if (!DEEPSEEK_KEY || !DEEPSEEK_KEY.trim()) throw new Error("DEEPSEEK_API_KEY nem OPENROUTER_API_KEY definidas (rode via orchestra)");
    cliente = new Anthropic({ apiKey: DEEPSEEK_KEY, baseURL: BASE_URL, timeout: TIMEOUT, maxRetries: 0 });
  }
  return cliente;
}

// Uma chamada Messages API por STREAMING (retry fica com comTentativas, por isso maxRetries: 0).
// Cada evento do stream prova que a conexao esta viva; onProgresso reporta ~tokens a cada 2s.
export const mensagem: MensagemFn = async (system, messages, tools, opts = {}) => {
  if (PROVEDOR.kind === "openai") return mensagemOpenAI(system, messages, tools, opts);
  const resp = await comTentativas(async (sinal, vivo) => {
    let chars = 0;
    let ultimo = 0;
    const s = obter().messages.stream(
      { model: MODEL, max_tokens: MAX_TOKENS, system, messages: messages as any, tools: tools as any },
      { signal: sinal },
    );
    s.on("streamEvent", (ev: any) => {
      vivo();
      if (ev?.type !== "content_block_delta") return;
      const d = ev.delta ?? {};
      chars += String(d.text ?? d.partial_json ?? d.thinking ?? "").length;
      const agora = Date.now();
      if (opts.onProgresso && agora - ultimo >= 2000) { ultimo = agora; opts.onProgresso(Math.round(chars / 4)); }
    });
    return await s.finalMessage();
  }, { signal: opts.signal, onTentativa: opts.onTentativa });
  const usage = {
    in: Number(resp.usage?.input_tokens ?? 0),
    out: Number(resp.usage?.output_tokens ?? 0),
  };
  return { blocos: resp.content as any[], stop: String(resp.stop_reason ?? ""), usage };
};

// Erro HTTP do Go: 402, ou 429 falando de uso/cota/assinatura = teto de 5h/semana/mes -> nao re-tenta.
// 429 comum (rate limit) e 5xx seguem re-tentaveis via status.
export function erroHttp(status: number, corpo: string): Error & { status: number; naoRetentar?: boolean } {
  const teto = status === 402 || (status === 429 && /usage|quota|subscription|monthly|weekly|5.?h/i.test(corpo));
  const msg = teto ? `OpenCode Go: limite de uso atingido (5h/semana/mes): ${corpo.slice(0, 160)}` : `HTTP ${status}: ${corpo.slice(0, 200)}`;
  return Object.assign(new Error(msg), { status, naoRetentar: teto || undefined });
}

// x-opencode-session estavel por conversa: o agente reusa o MESMO array messages em todos os turnos.
const sessoes = new WeakMap<object, string>();

// Provedor OpenAI-compatible (OpenCode Go): mesmo contrato de mensagem(), streaming SSE via fetch.
async function mensagemOpenAI(system: string, messages: Msg[], tools: Ferramenta[], opts: OpcoesMsg): Promise<Resposta> {
  if (!sessoes.has(messages)) sessoes.set(messages, randomUUID());
  const corpo = paraOpenAI(system, messages, tools);
  return comTentativas(async (sinal, vivo) => {
    const resp = await fetch(BASE_URL + "/chat/completions", {
      method: "POST",
      signal: sinal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${GO_KEY}`,
        "user-agent": "dev-orchestra/3.0",
        "x-opencode-session": sessoes.get(messages)!,
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: MAX_TOKENS, stream: true, stream_options: { include_usage: true },
        messages: corpo.messages, ...(corpo.tools.length ? { tools: corpo.tools } : {}),
      }),
    });
    if (!resp.ok || !resp.body) throw erroHttp(resp.status, await resp.text().catch(() => ""));
    const est = novoEstado();
    const dec = new TextDecoder();
    let buf = "";
    let chars = 0;
    let ultimo = 0;
    for await (const pedaco of resp.body as any) {
      vivo();
      buf = consumirSSE(buf + dec.decode(pedaco, { stream: true }), est, (n) => { chars += n; });
      const agora = Date.now();
      if (opts.onProgresso && agora - ultimo >= 2000) { ultimo = agora; opts.onProgresso(Math.round(chars / 4)); }
    }
    consumirSSE(buf + "\n", est);
    return finalizar(est);
  }, { signal: opts.signal, onTentativa: opts.onTentativa });
}