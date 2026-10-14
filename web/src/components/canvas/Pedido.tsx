// Card do pedido da feature (Run B): o nodeType 'pedido' da fase 1 (planejamento). Le' a run do
// RunsCtx por dados.runId e mostra a feature, o planejador (do AgentesCtx, casando o cwd da run) com o
// modelo, o estado do plano ("Plano aprovado · n slices" ou "Planejando…"), a branch e a hora de inicio.
// Mesmo chrome dos cards existentes (#1c1c1c, borda #2c2c2c, raio 12, cabecalho #222, <Alcas/>).
import { useContext, type ReactNode } from "react";
import { type NodeProps } from "@xyflow/react";
import { fmtHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Alcas } from "./Nos";
import { AgentesCtx } from "./Agente";
import { BORDA, CABECALHO, CINZA, FONTE, RunsCtx, TITULO, cwdChave, lerDados, moldura, texto } from "./Run";

/** Linha "rotulo .......... valor" do corpo do card. */
function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0" style={{ color: CINZA }}>{rotulo}</span>
      <span className="min-w-0 flex-1 truncate text-right">{children}</span>
    </div>
  );
}

/** Card 'pedido': o pedido original da feature, o planejador/modelo e o estado do plano. */
function NoPedido({ data, selected }: NodeProps) {
  const { runs } = useContext(RunsCtx);
  const { agentes } = useContext(AgentesCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const run = runs[runId];

  if (!run) {
    return (
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
        <header className="shrink-0 px-2 py-1.5" style={{ background: CABECALHO, color: "#eee", font: TITULO }}>
          Pedido da feature
        </header>
        <div className="p-2.5" style={{ color: CINZA, font: FONTE }}>run {runId || "?"} indisponível</div>
        <Alcas />
      </div>
    );
  }

  // Planejador do MESMO cwd da run (mesma normalizacao do layout); sem ele, "—".
  const planejador = agentes.find((a) => a.origem === "planejador" && cwdChave(a.cwd) === cwdChave(run.cwd));
  const n = run.plano.length;

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <span className="min-w-0 flex-1 truncate">Pedido da feature</span>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-1 px-2.5 py-1.5" style={{ font: FONTE, color: "#dedee3" }}>
        <p className="line-clamp-2 shrink-0" title={run.feature}>{run.feature}</p>
        <div className="mt-auto flex min-h-0 flex-col gap-0.5" style={{ color: "#b8b8b8" }}>
          <Linha rotulo="Planejador">
            <span title={planejador?.cwd}>
              {planejador ? (planejador.nome || planejador.papel) : "—"} · {planejador?.modelo || "—"}
            </span>
          </Linha>
          <Linha rotulo="Plano">{n > 0 ? `Plano aprovado · ${n} ${n === 1 ? "slice" : "slices"}` : "Planejando…"}</Linha>
          <Linha rotulo="Branch">
            <span className="font-mono" title={run.branch}>{run.branch || "—"}</span>
          </Linha>
          <Linha rotulo="Início">
            <span className="font-mono tabular-nums">{run.inicioTs ? fmtHora(run.inicioTs) : "—"}</span>
          </Linha>
        </div>
      </div>
      <Alcas />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra 'pedido' apontando pra este card). */
export const nodeTypes = { pedido: NoPedido };
