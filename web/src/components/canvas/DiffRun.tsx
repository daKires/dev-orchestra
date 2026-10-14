// Card do diff da run (Run B): o nodeType 'diff' da fase 3. Le' a run do RunsCtx por dados.runId e
// mostra uma aba por arquivo de run.ordemDiffs (nome base), com o <DiffView arquivo patch> do arquivo
// ativo dentro de uma area com rolagem (nodrag nowheel). O ↗ do cabecalho chama o abrirDiff do RunsCtx,
// que abre o mesmo arquivo na aba Diff do painel direito. Sem arquivos: "Nenhum arquivo alterado".
// Mesmo chrome dos cards existentes (#1c1c1c, borda #2c2c2c, raio 12, cabecalho #222, <Alcas/>).
import { useContext, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { DiffView } from "@/components/DiffView";
import { cn } from "@/lib/utils";
import { Alcas } from "./Nos";
import { AZUL, BORDA, BOTAO, CABECALHO, CINZA, FONTE, RunsCtx, TITULO, lerDados, moldura, nomeDoArquivo, texto } from "./Run";

/** Card 'diff': abas pelos arquivos alterados da run e o diff do arquivo ativo. */
function NoDiff({ data, selected }: NodeProps) {
  const { runs, abrirDiff } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const run = runs[runId];
  const [ativo, setAtivo] = useState<string | null>(null);

  const arquivos = run?.ordemDiffs ?? [];
  // Aba ativa: a escolhida, se ainda existir; senao a primeira (ou nenhuma).
  const escolhido = ativo && arquivos.includes(ativo) ? ativo : arquivos[0] ?? null;
  const patch = escolhido ? run?.diffs[escolhido] ?? "" : "";

  if (!run) {
    return (
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
        <header className="shrink-0 px-2 py-1.5" style={{ background: CABECALHO, color: "#eee", font: TITULO }}>Diff</header>
        <div className="p-2.5" style={{ color: CINZA, font: FONTE }}>run {runId || "?"} indisponível</div>
        <Alcas />
      </div>
    );
  }

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <span className="min-w-0 flex-1 truncate">Diff</span>
        <button
          type="button"
          title="Abrir no painel"
          aria-label="Abrir no painel"
          disabled={!escolhido}
          onClick={() => { if (escolhido) abrirDiff(runId, escolhido); }}
          className="nodrag shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          style={{ color: AZUL, font: BOTAO }}
        >
          ↗
        </button>
      </header>

      {arquivos.length > 0 && (
        <div className="nodrag nowheel flex shrink-0 items-stretch gap-0 overflow-x-auto" style={{ borderBottom: `1px solid ${BORDA}` }}>
          {arquivos.map((a) => (
            <button
              key={a} type="button" title={a}
              className={cn("shrink-0 truncate px-2 py-1 text-left hover:bg-white/5", a === escolhido && "bg-white/10")}
              style={{ color: a === escolhido ? "#eee" : "#b8b8b8", font: BOTAO, borderRight: `1px solid ${BORDA}` }}
              onClick={() => setAtivo(a)}
            >
              {nomeDoArquivo(a)}
            </button>
          ))}
        </div>
      )}

      <div className="nodrag nowheel min-h-0 flex-1 overflow-hidden">
        {escolhido
          ? <DiffView arquivo={escolhido} patch={patch} />
          : <p className="p-4" style={{ color: CINZA, font: FONTE }}>Nenhum arquivo alterado</p>}
      </div>
      <Alcas />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra 'diff' apontando pra este card). */
export const nodeTypes = { diff: NoDiff };
