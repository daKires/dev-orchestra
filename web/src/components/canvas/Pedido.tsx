// Card Pedido da fase 1: feature, planejador e modelo, estado do plano, branch e hora de inicio.
// run ligada a sessao do planejador mostra 'Claude Code · <titulo>' — o titulo abre o chat
// (POST /runs/sessao + toast do App) e o funil filtra a sidebar pelas runs daquela sessao.
import { useContext, type ReactNode } from "react";
import { type NodeProps } from "@xyflow/react";
import { ExternalLink, Filter } from "lucide-react";
import { fmtHora } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Alcas } from "./Nos";
import { AgentesCtx } from "./Agente";
import { AZUL, BORDA, BOTAO, CABECALHO, CINZA, FONTE, RunsCtx, TITULO, cwdChave, lerDados, moldura, texto } from "./Run";

function Linha({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0" style={{ color: CINZA }}>{rotulo}</span>
      <span className="min-w-0 flex-1 truncate text-right">{children}</span>
    </div>
  );
}

function NoPedido({ data, selected }: NodeProps) {
  const { runs, titulos, abrirSessao, filtrarSessao } = useContext(RunsCtx);
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

  const planejador = agentes.find((a) => a.origem === "planejador" && cwdChave(a.cwd) === cwdChave(run.cwd));
  const n = run.plano.length;

  // sessao do planejador ligada a esta run (ausente nas runs antigas) + o titulo do chat.
  const sessao = run.sessao;
  const ferramenta = sessao
    ? (sessao.planejador === "claude" ? "Claude Code" : sessao.planejador === "antigravity" ? "Antigravity" : "OpenCode")
    : "";
  const titulo = sessao ? titulos[run.id] ?? "" : "";

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
            {sessao ? (
              <span className="inline-flex min-w-0 items-center justify-end gap-1">
                <span className="shrink-0" title={ferramenta}>{ferramenta}</span>
                {titulo ? (
                  <>
                    <span className="shrink-0" style={{ color: CINZA }}>·</span>
                    <button
                      type="button" title={`Abrir no ${ferramenta}`}
                      className="nodrag nopan inline-flex min-w-0 items-center gap-0.5 rounded px-0.5 hover:bg-white/10"
                      style={{ color: AZUL, font: BOTAO }}
                      onClick={(e) => { e.stopPropagation(); abrirSessao(run.id); }}
                    >
                      <span className="truncate">{titulo}</span>
                      <ExternalLink className="size-3 shrink-0" />
                    </button>
                  </>
                ) : null}
                <button
                  type="button" aria-label="Ver runs desta sessão" title="Ver runs desta sessão"
                  className="nodrag nopan shrink-0 rounded p-0.5 hover:bg-white/10"
                  style={{ color: CINZA }}
                  onClick={(e) => { e.stopPropagation(); filtrarSessao(run.id); }}
                >
                  <Filter className="size-3" />
                </button>
              </span>
            ) : (
              <span title={planejador?.cwd}>
                {planejador ? (planejador.nome || planejador.papel) : "—"} · {planejador?.modelo || "—"}
              </span>
            )}
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

export const nodeTypes = { pedido: NoPedido };
