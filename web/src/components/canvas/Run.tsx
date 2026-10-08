// Cards de run/worker/arquivo no canvas (F2 - S5c): tres nodeTypes do xyflow que leem os dados do
// no' (dados.runId/idx/arquivo) e o estado das runs de um contexto (RunsCtx) proprio, exportado daqui
// pra nao mexer no CanvasCtx dos outros cards. Tambem exporta ModalDiff, que abre o DiffView existente
// num dialog. UI em PT-BR, so' tema escuro, reaproveitando lucide-react + components/ui.
import { createContext, useContext, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { FileCode } from "lucide-react";
import { kpis, progresso, statusVisivel, type Run } from "@/lib/estado";
import { fmtDur, fmtUSD, tomStatus } from "@/lib/formato";
import { linhasDoWorker } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/DiffView";
import { StatusIcon } from "@/components/StatusIcon";
import { Alcas } from "./Nos";
import { ModalArquivo } from "./Explorador";
import type { No } from "../../../../canvas.ts";

// ---------------------------------------------------------------------------
// Contexto (S5c): runs por id + relogio + acoes do canvas (expansao e diff)
// ---------------------------------------------------------------------------

export const RunsCtx = createContext<{
  runs: Record<string, Run>;
  agora: number;
  alternar: (runId: string) => void;
  abrirDiff: (runId: string, arquivo: string) => void;
}>({ runs: {}, agora: Date.now(), alternar: () => {}, abrirDiff: () => {} });

// ---------------------------------------------------------------------------
// Pecas comuns (tokens do Castor, como os outros cards)
// ---------------------------------------------------------------------------

const FUNDO = "#1c1c1c";
const BORDA = "#303030";
const CABECALHO = "#222";
const CINZA = "#858585";
const AZUL = "#74aaff";
const VERDE = "#46d3a0";
const VERMELHO = "#e5534b";
const FONTE = "400 12px/1.45 ui-sans-serif, system-ui, sans-serif";
const MONO = "400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TITULO = "500 12px/1 ui-sans-serif, system-ui, sans-serif";

/** Card #1c1c1c, borda #303030, raio 12 (mesmo chrome dos outros nos do canvas). */
const moldura = { background: FUNDO, border: `1px solid ${BORDA}`, borderRadius: 12 } as const;

const lerDados = (data: unknown): No => (data as { no: No }).no;
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Cor da slice pelo status (mesma regra do fluxo): rodando azul, ok verde, ruim vermelho, fila cinza. */
function corDaSlice(status: string): string {
  if (status === "rodando") return AZUL;
  if (status === "ok") return VERDE;
  if (status === "incompleta" || status === "pulada") return VERMELHO;
  return CINZA;
}

/** So' o nome base do arquivo (sem pastas). */
const nomeDoArquivo = (caminho: string): string => caminho.split(/[\\/]+/).filter(Boolean).pop() ?? caminho;

/** Linha "rotulo .......... valor" do corpo do card de run. */
function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex-1 truncate" style={{ color: CINZA }}>{rotulo}</span>
      <span className="font-mono tabular-nums">{valor}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// nodeTypes
// ---------------------------------------------------------------------------

/** Run: card com cabecalho (status + feature + Expandir/Recolher) e progresso/custo/duracao/status. */
function NoRun({ data, selected }: NodeProps) {
  const { runs, agora, alternar } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const run = runs[runId];
  const expandida = no.dados.expandida === true;
  if (!run) {
    return (
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
        <header className="shrink-0 px-2 py-1.5" style={{ background: CABECALHO, color: "#eee", font: TITULO }}>run</header>
        <div className="p-2.5" style={{ color: CINZA, font: FONTE }}>run {runId || "?"} indisponível</div>
        <Alcas />
      </div>
    );
  }
  const st = statusVisivel(run, agora);
  const p = progresso(run);
  const k = kpis(run);
  const fim = st === "rodando" ? agora : run.ultimoEventoTs;
  const dur = run.inicioTs ? fmtDur(Math.max(0, fim - run.inicioTs)) : "";
  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <StatusIcon status={st} />
        <span className="min-w-0 flex-1 truncate" title={run.feature}>{run.feature}</span>
        <button type="button" className="nodrag shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10"
          style={{ color: "#b8b8b8", font: "500 11px/1 ui-sans-serif, system-ui, sans-serif" }}
          onClick={() => alternar(runId)}>
          {expandida ? "Recolher" : "Expandir"}
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 px-2.5 py-2" style={{ font: FONTE, color: "#dedee3" }}>
        <Campo rotulo="Slices" valor={`${p.feitas}/${p.total}`} />
        <Campo rotulo="Custo" valor={k.n ? fmtUSD(k.custo) : "—"} />
        <Campo rotulo="Duração" valor={dur || "—"} />
        <div className="flex items-center gap-1.5">
          <StatusIcon status={st} />
          <span className="truncate">{tomStatus(st).rotulo}</span>
        </div>
      </div>
      <Alcas />
    </div>
  );
}

/** Worker: mini-terminal por slice. Slice ok comeca recolhida; clique no cabecalho expande. */
function NoWorker({ data, selected }: NodeProps) {
  const { runs } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const idx = typeof no.dados.idx === "number" ? no.dados.idx : 0;
  const run = runs[runId];
  const [aberto, setAberto] = useState(false);
  const slice = run?.slices.find((s) => s.idx === idx);
  const status = slice?.status ?? "fila";
  const tarefa = slice?.tarefa ?? run?.plano[idx - 1]?.tarefa ?? "";
  const linhas = run ? linhasDoWorker(run, idx) : [];
  const recolhida = status === "ok" && !aberto;
  const cor = corDaSlice(status);
  return (
    <div className={cn("flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")}
      style={{ ...moldura, opacity: status === "fila" ? 0.5 : 1 }}>
      <header className="flex shrink-0 cursor-pointer items-center gap-1.5 px-2 py-1.5"
        style={{ background: CABECALHO, color: cor, font: TITULO, borderBottom: recolhida ? "1px solid transparent" : `1px solid ${BORDA}` }}
        onClick={() => setAberto((a) => !a)}>
        <span className="size-2 shrink-0 rounded-full" style={{ background: cor }} />
        <span className="min-w-0 flex-1 truncate">Slice {idx}{tarefa ? ` · ${tarefa}` : ""}</span>
        {slice?.metrica ? <span className="shrink-0 font-mono" style={{ color: "#b8b8b8" }}>{fmtUSD(slice.metrica.custoUSD)}</span> : null}
      </header>
      {!recolhida && (
        <div className="nowheel min-h-0 flex-1 overflow-auto p-2" style={{ font: MONO, color: "#dedee3" }}>
          {linhas.length === 0
            ? <p style={{ color: CINZA }}>aguardando…</p>
            : linhas.map((l, i) => <p key={i} className="whitespace-pre-wrap" style={{ color: l.erro ? VERMELHO : undefined }}>{l.texto}</p>)}
        </div>
      )}
      <Alcas />
    </div>
  );
}

/**
 * Arquivo: card compacto (icone FileCode + nome + legenda). Quando o no' e' de uma run, o clique abre
 * o diff. Quando o no' veio de um agente (dados.agenteId + dados.caminho, ex.: publicados por `canvas
 * file` ou arrastados do Explorador), o clique abre a MESMA previa do Explorador.
 */
function NoArquivo({ data, selected }: NodeProps) {
  const { abrirDiff } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const arquivo = texto(no.dados.arquivo);
  const agenteId = texto(no.dados.agenteId);
  const caminho = texto(no.dados.caminho);
  const status = texto(no.dados.status);
  const doAgente = !!agenteId && !!caminho;
  const nome = nomeDoArquivo(doAgente ? caminho : arquivo);
  const [preview, setPreview] = useState(false);
  const abrir = () => { if (doAgente) setPreview(true); else abrirDiff(runId, arquivo); };
  return (
    <>
      <div className={cn("flex h-full w-full cursor-pointer items-center gap-2 overflow-hidden px-2.5", selected && "cv-sel")}
        style={moldura} title={doAgente ? caminho : arquivo} onClick={abrir}>
        <FileCode className="size-4 shrink-0" style={{ color: AZUL }} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-bold" style={{ color: "#eee", fontSize: 15 }}>{nome}</div>
          <div style={{ color: VERDE, fontSize: 12 }}>{doAgente ? (status || "referência") : "alterado"}</div>
        </div>
        <Alcas />
      </div>
      {doAgente && (
        <ModalArquivo aberto={preview} agenteId={agenteId} caminho={caminho} onFechar={() => setPreview(false)} />
      )}
    </>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra run/worker/arquivo apontando pra estes cards). */
export const nodeTypes = { run: NoRun, worker: NoWorker, arquivo: NoArquivo };

// ---------------------------------------------------------------------------
// Modal de diff (abre o DiffView existente num dialog)
// ---------------------------------------------------------------------------

export function ModalDiff({ aberto, patch, arquivo, onFechar }: {
  aberto: boolean; patch: string; arquivo: string; onFechar: () => void;
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="flex h-[80vh] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        style={{ background: FUNDO, border: `1px solid ${BORDA}` }}>
        <DialogTitle className="sr-only">{arquivo}</DialogTitle>
        <DialogDescription className="sr-only">Diff do arquivo {arquivo}</DialogDescription>
        <div className="min-h-0 flex-1 overflow-hidden">
          <DiffView arquivo={arquivo} patch={patch} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
