// Modo assincrono das runs: dispara uma run em background e permite consulta-la.
// Uma run ativa por vez; o resultado de runs terminadas fica consultavel.
import { randomUUID } from "node:crypto";
const runs = new Map();
let ativa = null;
/**
 * Dispara `fn` em background e devolve o runId na hora.
 * Se ja houver uma run ativa (nao terminada), lanca erro e nao chama `fn`.
 */
export function iniciar(fn) {
    if (ativa !== null) {
        throw new Error(`ja existe run ${ativa} rodando`);
    }
    const runId = randomUUID();
    const run = { linhas: [], pendentes: [] };
    runs.set(runId, run);
    ativa = runId;
    const progresso = (linha) => {
        run.linhas.push(linha);
        if (run.linhas.length > 20)
            run.linhas.shift();
    };
    // Dispara sem await: a run roda em background e nao bloqueia o retorno.
    void fn(progresso).then((painel) => concluir(runId, { fim: painel }), (erro) => concluir(runId, {
        fim: `FAILED: ${erro instanceof Error ? erro.message : String(erro)}`,
    }));
    return runId;
}
/**
 * Aguarda a run terminar por ate `ms` milissegundos.
 * - id desconhecido: rejeita com erro contendo o id e "nao existe".
 * - termina antes de `ms`: resolve na hora com `{ fim }`.
 * - senao: apos `ms` resolve com `{ rodando }` (as 20 ultimas linhas).
 */
export function esperar(runId, ms) {
    const run = runs.get(runId);
    if (!run) {
        return Promise.reject(new Error(`run ${runId} nao existe`));
    }
    if (run.resultado) {
        return Promise.resolve(run.resultado);
    }
    return new Promise((resolve) => {
        let acabou = false;
        const finalizarEspera = (r) => {
            if (acabou)
                return;
            acabou = true;
            clearTimeout(timer);
            resolve(r);
        };
        const timer = setTimeout(() => {
            if (acabou)
                return;
            acabou = true;
            const i = run.pendentes.indexOf(finalizarEspera);
            if (i >= 0)
                run.pendentes.splice(i, 1);
            resolve({ rodando: run.linhas.slice(-20) });
        }, ms);
        run.pendentes.push(finalizarEspera);
    });
}
function concluir(runId, resultado) {
    const run = runs.get(runId);
    if (!run || run.resultado)
        return;
    run.resultado = resultado;
    if (ativa === runId)
        ativa = null;
    const pendentes = run.pendentes.splice(0);
    for (const resolver of pendentes)
        resolver(resultado);
}
