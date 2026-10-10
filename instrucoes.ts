// G3: caixa de instrucoes e pausa por slice, em arquivos no RUNS_DIR (mesmo padrao do <runId>.cancel).
// Stub da spec (instrucoes.test.ts): a implementacao entra na S1.
export type ErroAcao = { status: number; erro: string };
export type OpcoesEspera = {
  pausada: () => boolean; tetoMs: number; agora?: () => number; dormir?: (ms: number) => Promise<void>; signal?: AbortSignal;
};

export function arquivoInstrucao(dir: string, id: string): string { return ""; }
export function arquivoPausa(dir: string, id: string): string { return ""; }
export function gravarInstrucao(dir: string, id: string, slice: number, texto: string): void {}
export function tomarInstrucoes(dir: string, id: string, slice: number): string[] { return []; }
export function pausarSlice(dir: string, id: string, slice: number): void {}
export function retomarSlice(dir: string, id: string, slice: number, texto?: string): void {}
export function pausada(dir: string, id: string, slice: number): boolean { return false; }
export function validarAcaoSlice(evs: any[] | null, slice: number, cancelado: boolean): ErroAcao | null { return null; }
export function validarTexto(texto: unknown, obrigatorio: boolean): string | null { return null; }
export async function esperarRetomada(o: OpcoesEspera): Promise<"retomada" | "teto"> { return "retomada"; }
export function estaPausada(evs: any[]): boolean { return false; }
