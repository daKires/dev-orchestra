// Acoes da run no card (G1): merge local, abrir PR e descartar. Stub: a implementacao vem na S2.
export type ResultadoAcao = { ok: true; base?: string; url?: string } | { ok: false; erro: string; conflitos?: string[] };

export function ehWorktree(_cwd: string): boolean { throw new Error("nao implementado"); }
export function baseDaBranch(_cwd: string, _branch: string): string { throw new Error("nao implementado"); }
export function mergeLocal(_ctx: { cwd: string; branch: string }): ResultadoAcao { throw new Error("nao implementado"); }
export function descartarRun(_ctx: { cwd: string; branch: string }): ResultadoAcao { throw new Error("nao implementado"); }
export function abrirPr(
  _ctx: { cwd: string; branch: string; feature: string; corpo: string },
  _rodar?: (cmd: string, args: string[]) => string,
): ResultadoAcao { throw new Error("nao implementado"); }
