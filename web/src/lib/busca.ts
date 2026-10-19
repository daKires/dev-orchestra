// Busca global de runs: pura, sem React, testada em busca.test.ts. A consulta pode ser um
// texto (feature, titulo do chat, branch ou id, sem acento/caixa, em TODOS os projetos) ou um
// { sessao } (runs daquela sessao do planejador, de qualquer projeto). Consulta vazia = so' as runs
// do projeto atual. O resultado sai no mesmo formato de porProjeto (grupos e runs mais novos primeiro).
import { projetoDe, raiz, runsDoProjeto, type Run } from "./estado.ts";

export type Grupo = { cwd: string; projeto: string; runs: Run[] };
// Consulta da busca: texto livre ou o filtro por sessao do planejador ({ titulo } so' alimenta o chip).
export type Consulta = string | { sessao: string; titulo?: string };

function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

// Chave canonica da RAIZ (mesma regra do porProjeto: worktree -> raiz, minusculo, '/' sem barra final).
function chave(cwd: string): string {
  return raiz(cwd || "(sem pasta)").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function agrupar(runs: Run[]): Grupo[] {
  const g = new Map<string, Run[]>();
  for (const r of runs) {
    const k = chave(r.cwd);
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(r);
  }
  return [...g.values()]
    .map((rs) => rs.sort((a, b) => b.inicioTs - a.inicioTs))
    .map((rs) => ({ cwd: rs[0].cwd, projeto: rs[0].projeto || projetoDe(rs[0].cwd), runs: rs }))
    .sort((a, b) => b.runs[0].inicioTs - a.runs[0].inicioTs);
}

export function filtrarRuns(runs: Run[], consulta: Consulta, titulos: Record<string, string>, projeto: string): Grupo[] {
  if (typeof consulta === "string" && consulta.trim() === "") return agrupar(runsDoProjeto(runs, projeto));
  if (typeof consulta !== "string") return agrupar(runs.filter((r) => r.sessao?.id === consulta.sessao));
  const q = normalizar(consulta.trim());
  return agrupar(runs.filter((r) =>
    normalizar(r.feature).includes(q) ||
    normalizar(titulos[r.id] ?? "").includes(q) ||
    normalizar(r.branch).includes(q) ||
    normalizar(r.id).includes(q)));
}
