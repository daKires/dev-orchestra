// Cliente do modelo via API Anthropic-compatible: DeepSeek nativa (apiKey/x-api-key) OU, sem chave
// nativa, OpenRouter (authToken/Bearer) como alternativa -- ambas suportadas direto pelo SDK, sem
// client wrapper. Timeout + retry vem do proprio SDK -> uma falha transitoria nao derruba a run.
import Anthropic from "@anthropic-ai/sdk";
// Pura: decide o provedor a partir de quais chaves existem. DeepSeek nativa tem prioridade
// (default de menor-surpresa quando as duas estao definidas). Extraida assim (em vez de inline em
// obter()) pra dar pra testar no --selftest sem precisar mexer em env var em runtime.
export function escolherProvedor(deepseekKey, openrouterKey) {
    const viaOpenRouter = !deepseekKey && !!openrouterKey;
    return {
        baseURL: viaOpenRouter ? "https://openrouter.ai/api" : "https://api.deepseek.com/anthropic",
        model: viaOpenRouter ? "deepseek/deepseek-v4.1-flash" : "deepseek-flash",
        useAuthToken: viaOpenRouter,
    };
}
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY;
const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY;
const PROVEDOR = escolherProvedor(DEEPSEEK_KEY, OPENROUTER_KEY);
export const MODEL = process.env.HERMES_MODEL || PROVEDOR.model;
const BASE_URL = process.env.HERMES_BASE_URL || PROVEDOR.baseURL;
const MAX_TOKENS = Number(process.env.HERMES_MAX_TOKENS || "32000");
const TIMEOUT = Number(process.env.HERMES_TIMEOUT_MS || "120000");
const MAX_RETRIES = Number(process.env.HERMES_MAX_RETRIES || "2");
let cliente = null;
function obter() {
    if (cliente)
        return cliente;
    if (PROVEDOR.useAuthToken) {
        cliente = new Anthropic({ authToken: OPENROUTER_KEY, baseURL: BASE_URL, timeout: TIMEOUT, maxRetries: MAX_RETRIES });
    }
    else {
        if (!DEEPSEEK_KEY || !DEEPSEEK_KEY.trim())
            throw new Error("DEEPSEEK_API_KEY nem OPENROUTER_API_KEY definidas (rode via orchestra)");
        cliente = new Anthropic({ apiKey: DEEPSEEK_KEY, baseURL: BASE_URL, timeout: TIMEOUT, maxRetries: MAX_RETRIES });
    }
    return cliente;
}
// Uma chamada Messages API. Devolve os blocos de conteudo e o stop_reason.
export const mensagem = async (system, messages, tools) => {
    const resp = await obter().messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        system,
        messages: messages,
        tools: tools,
    });
    const usage = {
        in: Number(resp.usage?.input_tokens ?? 0),
        out: Number(resp.usage?.output_tokens ?? 0),
    };
    return { blocos: resp.content, stop: String(resp.stop_reason ?? ""), usage };
};
// Chamada simples sem ferramentas: devolve o texto concatenado (usado pelo revisor).
export async function texto(system, user) {
    const { blocos } = await mensagem(system, [{ role: "user", content: user }], []);
    return blocos.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
}
