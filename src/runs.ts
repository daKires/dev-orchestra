// Modo assincrono das runs: dispara uma run em background e permite consulta-la.
// Uma run ativa por vez; o resultado de runs terminadas fica consultavel.
import { randomUUID } from "node:crypto";

interface Run {
  /** Preenchido quando a run termina (sucesso ou falha). */
  resultado?: { fim: string };
  /** Ultimas linhas de progresso emitidas pela funcao. */
  linhas: string[];
  /** Resolvers das chamadas a `esperar` que ainda aguardam. */
  pendentes: Array<(r: { fim: string }) => void>;
}

const runs = new Map<string, Run>();
let ativa: string | null = null;

/**
 * Dispara `fn` em background e devolve o runId na hora.
 * `fn` recebe o runId gerado (para carimbar os eventos da propria run) como 2o argumento.
 * Se ja houver uma run ativa (nao terminada), lanca erro e nao chama `fn`.
 */
export function iniciar(
  fn: (progresso: (linha: string) => void, runId: string) => Promise<string>,
): string {
  if (ativa !== null) {
    throw new Error(`ja existe run ${ativa} rodando`);
  }

  const runId = randomUUID();
  const run: Run = { linhas: [], pendentes: [] };
  runs.set(runId, run);
  ativa = runId;

  const progresso = (linha: string): void => {
    run.linhas.push(linha);
    if (run.linhas.length > 20) run.linhas.shift();
  };

  // Dispara sem await: a run roda em background e nao bloqueia o retorno.
  void fn(progresso, runId).then(
    (painel) => concluir(runId, { fim: painel }),
    (erro: unknown) =>
      concluir(runId, {
        fim: `FAILED: ${erro instanceof Error ? erro.message : String(erro)}`,
      }),
  );

  return runId;
}

/**
 * Aguarda a run terminar por ate `ms` milissegundos.
 * - id desconhecido: rejeita com erro contendo o id e "nao existe".
 * - termina antes de `ms`: resolve na hora com `{ fim }`.
 * - senao: apos `ms` resolve com `{ rodando }` (as 20 ultimas linhas).
 */
export function esperar(
  runId: string,
  ms: number,
): Promise<{ fim: string } | { rodando: string[] }> {
  // Aceita o prefixo curto (>= 8 chars) do id, se ele for unico.
  const ids = runId.length >= 8 ? [...runs.keys()].filter((k) => k.startsWith(runId)) : [];
  const run = runs.get(runId) ?? (ids.length === 1 ? runs.get(ids[0]) : undefined);
  if (!run) {
    return Promise.reject(new Error(`run ${runId} nao existe`));
  }
  if (run.resultado) {
    return Promise.resolve(run.resultado);
  }

  return new Promise<{ fim: string } | { rodando: string[] }>((resolve) => {
    let acabou = false;

    const finalizarEspera = (r: { fim: string }): void => {
      if (acabou) return;
      acabou = true;
      clearTimeout(timer);
      resolve(r);
    };

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      if (acabou) return;
      acabou = true;
      const i = run.pendentes.indexOf(finalizarEspera);
      if (i >= 0) run.pendentes.splice(i, 1);
      resolve({ rodando: run.linhas.slice(-20) });
    }, ms);

    run.pendentes.push(finalizarEspera);
  });
}

function concluir(runId: string, resultado: { fim: string }): void {
  const run = runs.get(runId);
  if (!run || run.resultado) return;

  run.resultado = resultado;
  if (ativa === runId) ativa = null;

  const pendentes = run.pendentes.splice(0);
  for (const resolver of pendentes) resolver(resultado);
}
