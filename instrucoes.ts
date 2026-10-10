// G3: caixa de instrucoes e pausa por slice, em arquivos no RUNS_DIR (mesmo padrao do <runId>.cancel).
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

export type ErroAcao = { status: number; erro: string };
export type OpcoesEspera = {
  pausada: () => boolean; tetoMs: number; agora?: () => number; dormir?: (ms: number) => Promise<void>; signal?: AbortSignal;
};

// Caminho do arquivo de instrucoes (jsonl) de uma run.
export function arquivoInstrucao(dir: string, id: string): string { return path.join(dir, id + ".instrucao.jsonl"); }
// Caminho do marcador de pausa de uma run.
export function arquivoPausa(dir: string, id: string): string { return path.join(dir, id + ".pausa"); }

// Acrescenta uma linha JSON com a instrucao endereçada a uma slice.
export function gravarInstrucao(dir: string, id: string, slice: number, texto: string): void {
  appendFileSync(arquivoInstrucao(dir, id), JSON.stringify({ slice, texto, ts: Date.now() }) + "\n");
}

// Toma (e consome) as instrucoes da slice, mantendo no arquivo as das outras.
export function tomarInstrucoes(dir: string, id: string, slice: number): string[] {
  const arq = arquivoInstrucao(dir, id);
  if (!existsSync(arq)) return [];
  const linhas = readFileSync(arq, "utf8").split("\n").filter((l) => l.trim() !== "");
  const minhas: string[] = [];
  const outras: string[] = [];
  for (const linha of linhas) {
    let obj: any;
    try { obj = JSON.parse(linha); } catch { continue; } // linha corrompida: descarta
    if (obj && obj.slice === slice) minhas.push(obj.texto);
    else outras.push(linha);
  }
  if (outras.length === 0) rmSync(arq, { force: true }); // nada sobrou: apaga o arquivo
  else writeFileSync(arq, outras.join("\n") + "\n");
  return minhas;
}

// Marca a slice como pausada.
export function pausarSlice(dir: string, id: string, slice: number): void {
  writeFileSync(arquivoPausa(dir, id), String(slice));
}

// Remove a pausa e, se houver texto, registra a instrucao de retomada.
export function retomarSlice(dir: string, id: string, slice: number, texto?: string): void {
  const arq = arquivoPausa(dir, id);
  if (existsSync(arq)) rmSync(arq, { force: true });
  if (texto?.trim()) gravarInstrucao(dir, id, slice, texto);
}

// Estah pausada somente se o marcador existe e aponta para a slice.
export function pausada(dir: string, id: string, slice: number): boolean {
  const arq = arquivoPausa(dir, id);
  if (!existsSync(arq)) return false;
  return Number(readFileSync(arq, "utf8")) === slice;
}

// Valida se uma acao (instruir/pausar/retomar) pode incidir sobre a slice.
export function validarAcaoSlice(evs: any[] | null, slice: number, cancelado: boolean): ErroAcao | null {
  if (!evs) return { status: 404, erro: "run desconhecida" };
  if (cancelado || evs.some((e) => e.t === "painel")) return { status: 409, erro: "a run já terminou" };
  const total = evs.find((e) => e.t === "run")?.total;
  if (slice < 1 || slice > total) {
    return { status: 409, erro: `slice S${slice} não está rodando (reparo do gate ou inexistente)` };
  }
  // Ultimo evento de slice com esse idx define o status atual (default: fila).
  let status = "fila";
  for (const e of evs) if (e.t === "slice" && e.idx === slice) status = e.status;
  if (status !== "rodando") return { status: 409, erro: `slice S${slice} não está rodando (${status})` };
  return null;
}

// Valida o texto de uma instrucao (obrigatorio no instruir, opcional no retomar).
export function validarTexto(texto: unknown, obrigatorio: boolean): string | null {
  if (texto === undefined || texto === null) return obrigatorio ? "instrução vazia" : null;
  if (typeof texto !== "string") return "instrução inválida";
  if (texto.trim() === "") return obrigatorio ? "instrução vazia" : null;
  if (texto.length > 4000) return "instrução acima de 4000 caracteres";
  return null;
}

// Espera a pausa sumir, respeitando teto de tempo e cancelamento.
export async function esperarRetomada(o: OpcoesEspera): Promise<"retomada" | "teto"> {
  const agora = o.agora ?? Date.now;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const inicio = agora();
  while (o.pausada()) {
    if (o.signal?.aborted) throw new Error("cancelado");
    if (agora() - inicio >= o.tetoMs) return "teto";
    await dormir(1000);
    if (o.signal?.aborted) throw new Error("cancelado"); // checa de novo apos dormir
  }
  return "retomada";
}

// O ultimo evento de pausa da run decide se ela esta pausada.
export function estaPausada(evs: any[]): boolean {
  let estado: string | undefined;
  for (const e of evs) if (e.t === "pausa") estado = e.estado;
  return estado === "pausada";
}
