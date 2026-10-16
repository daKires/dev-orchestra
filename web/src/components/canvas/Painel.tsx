// Card Runs (G1 - S4): painel de runs do projeto no canvas. Um nodeType 'painel' que le os runs do
// projeto atual (dados.projeto) do RunsCtx, agrega os ultimos 7 dias (resumoPainel) e mostra 4 KPIs +
// a tabela de runs. Clicar numa linha abre/expande aquela run (RunsCtx.abrirRun) e centraliza nela.
// UI em PT-BR, so' tema escuro, mesmo chrome dos outros cards do canvas.
import { useContext } from "react";
import { type NodeProps } from "@xyflow/react";
import { ChartColumn, X } from "lucide-react";
import { resumoPainel } from "@/lib/layout";
import { runsDoProjeto } from "@/lib/estado";
import { fmtPct, tomStatus } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Alcas, CanvasCtx } from "./Nos";
import { RunsCtx } from "./Run";
import type { No } from "../../../../src/canvas.ts";

// Pecas comuns (tokens do Castor, como os outros cards)

const FUNDO = "#1c1c1c";
const BORDA = "#2c2c2c";
const CABECALHO = "#222";
const CINZA = "#858585";
const AZUL = "#74aaff";
const VERDE = "#5fd29a";
const AMARELO = "#d9b45a";
const VERMELHO = "#ff7b72";
const FONTE = "400 12px/1.45 ui-sans-serif, system-ui, sans-serif";
const TITULO = "500 12px/1 ui-sans-serif, system-ui, sans-serif";

/** Card #1c1c1c, borda #2c2c2c, raio 12 (mesmo chrome dos outros nos do canvas). */
const moldura = { background: FUNDO, border: `1px solid ${BORDA}`, borderRadius: 12 } as const;

const lerDados = (data: unknown): No => (data as { no: No }).no;
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Cor do status da run na tabela (mesma familia de cores dos cards de run/slice). */
function corStatus(status: string): string {
  switch (status) {
    case "rodando": return AZUL;
    case "pausada": return AMARELO;
    case "COMPLETE": case "ok": return VERDE;
    case "NEEDS-REVIEW": case "incompleta": case "COMMIT-SKIP": return AMARELO;
    case "GATE-FAILED": case "ENV-FAILED": case "FAILED": case "INTERROMPIDA": return VERMELHO;
    default: return CINZA; // CANCELED, pulada, fila, aguardando
  }
}

/** Custo em dolares no padrao PT-BR ("$0,00"). */
const fmtCusto = (v: number): string => "$" + v.toFixed(2).replace(".", ",");

/** Tempo m:ss (arredonda os segundos; nunca negativo). */
function fmtTempo(ms: number): string {
  const s = Math.max(0, Math.round((Number.isFinite(ms) ? ms : 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Caixinha de KPI do topo do painel. */
function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md px-2 py-1.5" style={{ background: "#191919", border: `1px solid ${BORDA}` }}>
      <span className="truncate" style={{ color: CINZA, font: FONTE }} title={rotulo}>{rotulo}</span>
      <span className="truncate font-mono tabular-nums" style={{ color: "#eee", fontSize: 16, fontWeight: 500 }}>{valor}</span>
    </div>
  );
}

/** Cabecalho de coluna da tabela. */
function Coluna({ children, direita }: { children: string; direita?: boolean }) {
  return (
    <th className={cn("px-2 py-1.5 font-medium", direita ? "text-right" : "text-left")} style={{ color: CINZA, font: FONTE }}>
      {children}
    </th>
  );
}

// nodeTypes

/** Painel Runs: card com KPIs dos ultimos 7 dias e a tabela clicavel das runs do projeto. */
function NoPainel({ data, selected }: NodeProps) {
  const { runs, agora, abrirRun } = useContext(RunsCtx);
  const acoes = useContext(CanvasCtx);
  const no = lerDados(data);
  const projeto = texto(no.dados.projeto);
  const resumo = resumoPainel(runsDoProjeto(Object.values(runs), projeto), agora);
  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
      <header className="flex shrink-0 items-center gap-1.5 px-2.5 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <ChartColumn className="size-3.5 shrink-0" style={{ color: AZUL }} />
        <span className="min-w-0 flex-1 truncate">Runs do projeto · últimos 7 dias</span>
        <button type="button" title="Fechar painel" aria-label="Fechar painel"
          className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10"
          style={{ color: "#b8b8b8" }} onClick={() => acoes.removerNo(no.id)}>
          <X className="size-3.5" />
        </button>
      </header>
      <div className="nodrag nowheel flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2.5">
        <div className="grid shrink-0 grid-cols-4 gap-2">
          <Kpi rotulo="Runs" valor={String(resumo.total)} />
          <Kpi rotulo="1ª tentativa" valor={fmtPct(resumo.primeiraTentativa)} />
          <Kpi rotulo="Custo total" valor={fmtCusto(resumo.custo)} />
          <Kpi rotulo="Falhas de ambiente" valor={String(resumo.falhasAmbiente)} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md" style={{ border: `1px solid ${BORDA}` }}>
          <table className="w-full border-collapse" style={{ font: FONTE, color: "#dedee3" }}>
            <thead>
              <tr style={{ background: "#191919" }}>
                <Coluna>Feature</Coluna>
                <Coluna>Status</Coluna>
                <Coluna direita>Slices</Coluna>
                <Coluna direita>Custo</Coluna>
                <Coluna direita>Tempo</Coluna>
              </tr>
            </thead>
            <tbody>
              {resumo.linhas.map((l) => (
                <tr key={l.id} className="cursor-pointer hover:bg-white/5" style={{ borderTop: `1px solid ${BORDA}` }}
                  onClick={() => abrirRun(l.id)}>
                  <td className="max-w-0 truncate px-2 py-1.5" title={l.feature}>{l.feature}</td>
                  <td className="px-2 py-1.5 whitespace-nowrap" style={{ color: corStatus(l.status) }}>{tomStatus(l.status).rotulo}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{l.slicesOk}/{l.slicesTotal}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{fmtCusto(l.custo)}</td>
                  <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{fmtTempo(l.ms)}</td>
                </tr>
              ))}
              {resumo.linhas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-2 py-3 text-center" style={{ color: CINZA }}>
                    Nenhuma run nos últimos 7 dias.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      <Alcas />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra 'painel' apontando pra este card). */
export const nodeTypes = { painel: NoPainel };
