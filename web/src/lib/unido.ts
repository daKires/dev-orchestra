// Funcoes puras da tela unida (sidebar, painel e 1a abertura).
import { raiz, rodando, type Run } from "./estado.ts";

export type Badge = "A" | "M";
export type ItemPool = { id: string; nome: string; modelo: string; executando: boolean; foco: string };
export type AgentePool = { id: string; nome: string; modelo: string; ocupado: boolean; status: string };

// Caminho canonico da sidebar/diff: barras '/'.
function caminhoChave(arquivo: string): string {
  return arquivo.replace(/\\/g, "/");
}

/** Badge de cada arquivo tocado pela run: 'A' (novo) ou 'M' (modificado), por caminho com '/'. */
export function badgesArquivos(run: Run | null): Map<string, Badge> {
  const m = new Map<string, Badge>();
  if (!run) return m;
  for (const arquivo of run.ordemDiffs) {
    const patch = run.diffs[arquivo] ?? "";
    // 'new file mode' no cabecalho ou '--- /dev/null' marcam arquivo recem-criado.
    const novo = /^new file mode\b/m.test(patch) || /^--- \/dev\/null$/m.test(patch);
    m.set(caminhoChave(arquivo), novo ? "A" : "M");
  }
  return m;
}

/** A run rodando mais recente; se nenhuma roda, a mais recente; lista vazia = null. */
export function runAtiva(runs: Run[], agora: number): Run | null {
  const maisNova = (lista: Run[]): Run | null =>
    lista.length ? lista.reduce((a, b) => (b.inicioTs > a.inicioTs ? b : a)) : null;
  return maisNova(runs.filter((r) => rodando(r, agora))) ?? maisNova(runs);
}

/** Run em foco no canvas: a escolhida (se ainda existe), senao a ativa (runAtiva). */
export function runEmFoco(runs: Run[], selId: string | null, agora: number): Run | null {
  return runs.find((r) => r.id === selId) ?? runAtiva(runs, agora);
}

/** Runs que brilham na sidebar: nunca vistas e fora do foco. `vistas` null = ainda sem base (nenhuma). */
export function runsNovas(runs: Run[], vistas: string[] | null, focoId: string | null): Set<string> {
  if (!vistas) return new Set();
  const v = new Set(vistas);
  return new Set(runs.filter((r) => !v.has(r.id) && r.id !== focoId).map((r) => r.id));
}

/** Projeto da 1a abertura: o salvo (se nao vazio) ou a raiz do cwd da run ativa; sem run = null. */
export function projetoInicial(salvo: string | null, runs: Run[], agora: number): string | null {
  if (typeof salvo === "string" && salvo !== "") return salvo;
  const r = runAtiva(runs, agora);
  if (!r) return null;
  return raiz(r.cwd) || null;
}

// Prefixos de id de no' que carregam a run logo depois do primeiro ':'.
const PREFIXOS_RUN = ["run", "fase1", "fase2", "fase3", "gate", "pedido", "diff"];

/** Run da selecao do canvas: so' com exatamente 1 no'; dados.runId vence, senao o prefixo do id. */
export function runDaSelecao(nos: { id: string; dados?: Record<string, unknown> }[]): string | null {
  if (nos.length !== 1) return null;
  const no = nos[0];
  const runId = no.dados?.runId;
  if (typeof runId === "string" && runId !== "") return runId;
  const i = no.id.indexOf(":");
  if (i > 0 && PREFIXOS_RUN.includes(no.id.slice(0, i))) return no.id.slice(i + 1);
  return null;
}

/** Pool de agentes: os agentes do canvas (sem encerrados) + o Swarm quando ha run rodando. */
export function agentesDoPool(agentes: AgentePool[], runs: Run[], agora: number): ItemPool[] {
  const pool: ItemPool[] = agentes
    .filter((a) => a.status !== "encerrado")
    .map((a) => ({ id: a.id, nome: a.nome, modelo: a.modelo, executando: a.ocupado, foco: "ag:" + a.id }));
  const ativa = runAtiva(runs, agora);
  if (ativa && rodando(ativa, agora)) {
    pool.push({ id: "swarm", nome: "Swarm", modelo: "", executando: true, foco: "run:" + ativa.id });
  }
  return pool;
}
