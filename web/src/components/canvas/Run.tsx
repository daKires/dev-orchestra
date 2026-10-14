// Cards de run/worker/arquivo no canvas (F2 - S5c; G1 - S3): tres nodeTypes do xyflow que leem os
// dados do no' (dados.runId/idx/arquivo) e o estado das runs de um contexto (RunsCtx) proprio, exportado
// daqui pra nao mexer no CanvasCtx dos outros cards. Na vista Arvore (G1) a slice vira um card ao vivo
// com o feedDaSlice e o card da run ganha o seletor Arvore|Fluxo (as acoes da run foram pro PainelRun).
// Tambem exporta ModalDiff, que abre o DiffView existente num dialog. UI em PT-BR, so' tema escuro.
import { createContext, useContext, useEffect, useRef, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { FileCode } from "lucide-react";
import { kpis, progresso, statusVisivel, type Run } from "@/lib/estado";
import { fmtDur, fmtHora, fmtUSD, tomStatus } from "@/lib/formato";
import { feedDaSlice, linhasDoWorker, type LinhaFeed } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/DiffView";
import { StatusIcon } from "@/components/StatusIcon";
import { Alcas } from "./Nos";
import { ModalArquivo } from "./Explorador";
import type { No } from "../../../../canvas.ts";

// Vista da arvore: 'arvore' (padrao, cards de slice) ou 'fluxo' (fluxograma historico).
export type Vista = "arvore" | "fluxo";

// Contexto (S5c/G1): runs por id + relogio + acoes do canvas (expansao, vista, slice aberta e diff)

export const RunsCtx = createContext<{
  runs: Record<string, Run>;
  agora: number;
  alternar: (runId: string) => void;
  vista: (runId: string, vista: Vista) => void;
  alternarSlice: (runId: string, idx: number) => void;
  abrirDiff: (runId: string, arquivo: string) => void;
  /** Abre a run no canvas: grava expandida=true no card run:<id> e centraliza nele (painel Runs). */
  abrirRun: (runId: string) => void;
}>({
  runs: {}, agora: Date.now(),
  alternar: () => {}, vista: () => {}, alternarSlice: () => {}, abrirDiff: () => {}, abrirRun: () => {},
});

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
const MONO = "400 12px/1.5 'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const TITULO = "500 12px/1 ui-sans-serif, system-ui, sans-serif";
const BOTAO = "500 11px/1 ui-sans-serif, system-ui, sans-serif";

/** Card #1c1c1c, borda #2c2c2c, raio 12 (mesmo chrome dos outros nos do canvas). */
const moldura = { background: FUNDO, border: `1px solid ${BORDA}`, borderRadius: 12 } as const;

const lerDados = (data: unknown): No => (data as { no: No }).no;
const texto = (v: unknown): string => (typeof v === "string" ? v : "");

/** Cor da slice pelo status (mesma regra do fluxo): rodando azul, ok verde, ruim vermelho, fila cinza. */
function corDaSlice(status: string): string {
  if (status === "rodando") return AZUL;
  if (status === "pausada") return AMARELO;
  if (status === "ok") return VERDE;
  if (status === "incompleta" || status === "pulada") return VERMELHO;
  return CINZA;
}

/** Cor da ferramenta no feed: log cinza, marco de slice verde, ferramenta (tool) azul. */
const corFerramenta = (ferramenta: string): string =>
  ferramenta === "log" ? CINZA : ferramenta === "slice" ? VERDE : AZUL;

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

// nodeTypes

function NoRun({ data, selected }: NodeProps) {
  const { runs, agora, alternar, vista } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const run = runs[runId];
  const [flash, setFlash] = useState(false);
  const gateAnt = useRef<string | undefined>(undefined);

  // Quando o ultimo gate vira 'ok', flash verde curto no card (cv-gate-ok). O primeiro render so'
  // registra o estado atual (sem flash em runs ja' terminadas no replay).
  const ultimoGate = run && run.gate.length ? run.gate[run.gate.length - 1] : undefined;
  const gateStatus = ultimoGate?.status;
  useEffect(() => {
    if (gateAnt.current === undefined) { gateAnt.current = gateStatus; return; }
    if (gateStatus === "ok" && gateAnt.current !== "ok") {
      gateAnt.current = gateStatus;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 900);
      return () => clearTimeout(t);
    }
    gateAnt.current = gateStatus;
  }, [gateStatus]);

  const expandida = no.dados.expandida === true;
  const vistaAtual: Vista = no.dados.vista === "fluxo" ? "fluxo" : "arvore";

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
    <>
      <div
        className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel", flash && "cv-gate-ok")}
        style={moldura}
      >
        <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
          style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
          <StatusIcon status={st} />
          <span className="min-w-0 flex-1 truncate" title={run.feature}>{run.feature}</span>
          <button type="button" className="nodrag shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10"
            style={{ color: "#b8b8b8", font: BOTAO }}
            onClick={() => alternar(runId)}>
            {expandida ? "Recolher" : "Expandir"}
          </button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1 px-2.5 py-1.5" style={{ font: FONTE, color: "#dedee3" }}>
          <Campo rotulo="Slices" valor={`${p.feitas}/${p.total}`} />
          <Campo rotulo="Custo" valor={k.n ? fmtUSD(k.custo) : "—"} />
          <Campo rotulo="Duração" valor={dur || "—"} />
          <div className="flex items-center gap-1.5">
            <StatusIcon status={st} />
            <span className="truncate">{tomStatus(st).rotulo}</span>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1 px-2 py-1" style={{ borderTop: `1px solid ${BORDA}` }}>
          <div className="flex items-center gap-0.5">
            {(["arvore", "fluxo"] as const).map((v) => (
              <button key={v} type="button" className="nodrag rounded px-1.5 py-0.5 hover:bg-white/10"
                style={{ color: vistaAtual === v ? "#fff" : "#b8b8b8", background: vistaAtual === v ? "#333" : "transparent", font: BOTAO }}
                onClick={() => vista(runId, v)}>
                {v === "arvore" ? "Árvore" : "Fluxo"}
              </button>
            ))}
          </div>
        </div>
        <Alcas />
      </div>
    </>
  );
}

/** Worker: na vista Arvore vira card compacto/ao vivo da slice; na vista Fluxo, o mini-terminal. */
function NoWorker({ data, selected }: NodeProps) {
  const { runs, alternarSlice } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const idx = typeof no.dados.idx === "number" ? no.dados.idx : 0;
  const run = runs[runId];
  // A presenca de `dados.aberta` marca a vista Arvore (o layout so' a escreve nessa vista).
  const emArvore = typeof no.dados.aberta === "boolean";
  const [aberto, setAberto] = useState(false);
  const [campo, setCampo] = useState("");
  const [pausando, setPausando] = useState(false);
  const [pendentes, setPendentes] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const corpo = useRef<HTMLDivElement | null>(null);
  const noFim = useRef(true);
  const slice = run?.slices.find((s) => s.idx === idx);
  const status = slice?.status ?? "fila";
  const tarefa = slice?.tarefa ?? run?.plano[idx - 1]?.tarefa ?? "";
  const cor = corDaSlice(status);
  const linhas = run ? feedDaSlice(run, idx) : [];
  // Arvore: aberta segue dados.aberta (default do layout). Fluxo: recolhe sozinha quando ok.
  const aberta = emArvore ? no.dados.aberta === true : !(status === "ok" && !aberto);

  // Auto-scroll do feed: desce pro fim quando chega linha nova, mas PARA se o usuario rolou pra cima.
  useEffect(() => {
    const el = corpo.current;
    if (el && noFim.current) el.scrollTop = el.scrollHeight;
  }, [linhas.length, aberta, emArvore]);

  const aoRolar = () => {
    const el = corpo.current;
    if (!el) return;
    noFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
  };

  // Pausa pedida pelo card: o botao volta ao normal ("Retomar") assim que o evento de pausa chega.
  useEffect(() => { if (slice?.pausada) setPausando(false); }, [slice?.pausada]);

  // Instrucoes na fila: somem quando o feed da slice recebe a linha 'instrução' com o mesmo texto.
  useEffect(() => {
    if (!pendentes.length) return;
    const entradas = linhas.filter((l) => l.ferramenta === "instrução").map((l) => l.texto);
    const restam = pendentes.filter((t) => !entradas.some((x) => x === t || x.endsWith("· " + t)));
    if (restam.length !== pendentes.length) setPendentes(restam);
  }, [linhas, pendentes]);

  /** Envia a instrucao pra slice viva (POST /runs/instrucao); 204 limpa o campo e entra na fila de pendentes. */
  const instruir = async () => {
    if (!campo.trim()) return;
    setErro("");
    try {
      const r = await fetch(`/runs/instrucao?run=${encodeURIComponent(runId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify({ slice: idx, texto: campo }),
      });
      if (r.ok || r.status === 204) {
        setPendentes((p) => [...p, campo.trim()]);
        setCampo("");
      } else setErro((await r.text().catch(() => "")) || `O hub recusou a instrução (HTTP ${r.status}).`);
    } catch (e) {
      setErro("Falha de rede ao instruir a slice: " + String((e as Error).message));
    }
  };

  /** Pausa ou retoma a slice (POST /runs/pausa); 'retomar' leva o texto do campo (pode ir vazio). */
  const pausar = async () => {
    const retomar = slice?.pausada === true;
    setErro("");
    if (!retomar) setPausando(true);
    try {
      const r = await fetch(`/runs/pausa?run=${encodeURIComponent(runId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify(retomar ? { slice: idx, acao: "retomar", texto: campo } : { slice: idx, acao: "pausar" }),
      });
      if (r.ok || r.status === 204) {
        if (retomar) setCampo("");
      } else {
        if (!retomar) setPausando(false);
        setErro((await r.text().catch(() => "")) || `O hub recusou a pausa (HTTP ${r.status}).`);
      }
    } catch (e) {
      if (!retomar) setPausando(false);
      setErro("Falha de rede ao pausar a slice: " + String((e as Error).message));
    }
  };

  if (emArvore && !aberta) {
    // Compacto: 'S<idx> · <tarefa>' + status colorido + ultima linha do feed. Clique alterna aberta.
    const ultima = linhas.length ? linhas[linhas.length - 1] : undefined;
    return (
      <div
        className={cn("flex h-full w-full flex-col overflow-hidden", selected && "cv-sel", status === "rodando" && "cv-pulso", slice?.pausada && "cv-pausada")}
        style={{ ...moldura, opacity: status === "fila" ? 0.6 : 1 }}
      >
        <header className="flex shrink-0 cursor-pointer items-center gap-1.5 px-2 py-1.5"
          style={{ background: CABECALHO, color: "#eee", font: TITULO }}
          onClick={() => alternarSlice(runId, idx)}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: cor }} />
          <span className="min-w-0 flex-1 truncate">S{idx}{tarefa ? ` · ${tarefa}` : ""}</span>
          <span className="shrink-0" style={{ color: slice?.pausada ? AMARELO : cor }}>{slice?.pausada ? "pausada" : tomStatus(status).rotulo}</span>
        </header>
        <div className="min-h-0 flex-1 truncate px-2 py-1" style={{ font: MONO, color: ultima?.erro ? VERMELHO : CINZA }}>
          {ultima ? ultima.texto : "aguardando…"}
        </div>
        <Alcas />
      </div>
    );
  }

  if (emArvore) {
    // Aberto: card ao vivo com feedDaSlice (hora, ferramenta colorida, texto; erro em vermelho).
    const m = slice?.metrica;
    return (
      <div
        className={cn("flex h-full w-full flex-col overflow-hidden", selected && "cv-sel", status === "rodando" && "cv-pulso", slice?.pausada && "cv-pausada")}
        style={{ ...moldura, opacity: status === "fila" ? 0.6 : 1 }}
      >
        <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
          style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: cor }} />
          <span className="min-w-0 flex-1 truncate">S{idx}{tarefa ? ` · ${tarefa}` : ""}</span>
          {slice?.pausada ? <span className="shrink-0" style={{ color: AMARELO }}>pausada</span> : null}
          {m ? <span className="shrink-0 font-mono tabular-nums" style={{ color: CINZA }}>{fmtUSD(m.custoUSD)} · {m.iteracoes} it.</span> : null}
          <button type="button" className="nodrag shrink-0 rounded px-1.5 py-0.5 hover:bg-white/10"
            style={{ color: "#b8b8b8", font: BOTAO }}
            onClick={() => alternarSlice(runId, idx)}>
            Recolher
          </button>
        </header>
        <div ref={corpo} onScroll={aoRolar}
          className="nodrag nowheel min-h-0 flex-1 overflow-auto px-2 py-1.5" style={{ font: MONO }}>
          {linhas.length === 0 ? (
            <p style={{ color: CINZA }}>aguardando…</p>
          ) : linhas.map((l: LinhaFeed, i) => (
            <div key={i} className="grid items-start gap-x-2" style={{ gridTemplateColumns: "auto auto 1fr" }}>
              <span className="tabular-nums" style={{ color: CINZA }}>{fmtHora(l.ts)}</span>
              <span className="truncate" style={{ color: corFerramenta(l.ferramenta) }}>{l.ferramenta}</span>
              <span className="whitespace-pre-wrap" style={{ color: l.erro ? VERMELHO : "#dedee3" }}>{l.texto}</span>
            </div>
          ))}
          {pendentes.map((t, i) => (
            <div key={`pend-${i}`} className="truncate" style={{ color: CINZA }}>instrução na fila · {t}</div>
          ))}
        </div>
        {status === "rodando" && (
          <div className="nodrag nowheel flex shrink-0 flex-col gap-1 px-2 py-1.5" style={{ borderTop: `1px solid ${BORDA}` }}>
            <textarea rows={2} maxLength={4000} value={campo}
              className="cv-campo w-full resize-none rounded-md px-2 py-1 outline-none"
              style={{ background: "#191919", border: `1px solid ${BORDA}`, color: "#dedee3", font: MONO }}
              placeholder="Instrua o agente desta slice…"
              onChange={(e) => setCampo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void instruir(); } }} />
            {erro ? <div className="truncate" title={erro} style={{ color: VERMELHO, font: FONTE }}>{erro}</div> : null}
            <div className="flex items-center gap-1">
              <button type="button" className="nodrag rounded px-2 py-0.5 hover:bg-white/10"
                style={{ color: AZUL, font: BOTAO }} onClick={() => void instruir()}>
                Instruir agora
              </button>
              <button type="button" disabled={pausando}
                className="nodrag ml-auto rounded px-2 py-0.5 hover:bg-white/10 disabled:opacity-50"
                style={{ color: slice?.pausada ? VERDE : AMARELO, font: BOTAO }} onClick={() => void pausar()}>
                {slice?.pausada ? "Retomar" : pausando ? "pausando…" : "Pausar"}
              </button>
            </div>
          </div>
        )}
        <Alcas />
      </div>
    );
  }

  // Vista Fluxo (historico): mini-terminal por slice. Slice ok comeca recolhida; clique expande.
  const linhasFluxo = run ? linhasDoWorker(run, idx) : [];
  const recolhida = !aberta;
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
        <div ref={corpo} onScroll={aoRolar} className="nodrag nowheel min-h-0 flex-1 overflow-auto p-2" style={{ font: MONO, color: "#dedee3" }}>
          {linhasFluxo.length === 0
            ? <p style={{ color: CINZA }}>aguardando…</p>
            : linhasFluxo.map((l, i) => <p key={i} className="whitespace-pre-wrap" style={{ color: l.erro ? VERMELHO : undefined }}>{l.texto}</p>)}
        </div>
      )}
      <Alcas />
    </div>
  );
}

/**
 * Arquivo: card compacto (icone FileCode + nome + legenda) com entrada animada (cv-entra). Quando o no'
 * e' de uma run, o clique abre o diff. Quando o no' veio de um agente (dados.agenteId + dados.caminho,
 * ex.: publicados por `canvas file` ou arrastados do Explorador), o clique abre a MESMA previa do Explorador.
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
      <div className={cn("cv-entra flex h-full w-full cursor-pointer items-center gap-2 overflow-hidden px-2.5", selected && "cv-sel")}
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

// Modal de diff (abre o DiffView existente num dialog)

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
