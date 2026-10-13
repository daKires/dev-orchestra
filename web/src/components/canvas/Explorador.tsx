// Card "Explorador" (F3 S5): um nodeType do xyflow para o no' tipo 'explorador' (dados.agenteId).
// Mostra a arvore de arquivos do agente (GET /arvore?agente=) com pastas recolhiveis; com busca, uma
// lista plana filtrada (filtrarArvore). Clicar num arquivo abre a previa (GET /arquivo?agente=&caminho=)
// num Dialog; arrastar um arquivo (application/x-hermes-arquivo) solta no Canvas vira um card 'arquivo'.
import { useCallback, useContext, useEffect, useMemo, useState, type DragEvent } from "react";
import { type NodeProps } from "@xyflow/react";
import { ChevronRight, Ellipsis, FileText, Folder, FolderOpen, Pin, Search, X } from "lucide-react";
import { arvoreDeCaminhos, filtrarArvore, type NoArvore } from "@/lib/colab";
import { cn } from "@/lib/utils";
import { AgentesCtx } from "./Agente";
import { Alcas, CanvasCtx } from "./Nos";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { No } from "../../../../canvas.ts";

// Tokens (mesmo chrome dos outros cards do canvas)

const FUNDO = "#1c1c1c";
const BORDA = "#303030";
const CABECALHO = "#222";
const CINZA = "#858585";
const AZUL = "#74aaff";
const VERMELHO = "#e5534b";
const TITULO = "500 12px/1 ui-sans-serif, system-ui, sans-serif";
const FONTE = "400 12px/1.45 ui-sans-serif, system-ui, sans-serif";
const MONO = "400 12.5px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const MONO_PRE = "400 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** MIME do arrasto de arquivo do explorador para o canvas (lido no onDrop do Canvas). */
export const MIME_ARQUIVO = "application/x-hermes-arquivo";

const lerDados = (data: unknown): No => (data as { no: No }).no;

// Previa do arquivo (Dialog) — reusada pelo Explorador e pelo card de arquivo (Run.tsx)

/** Previa de um arquivo; com `projeto` le pela raiz do projeto, senao pelo agente. */
export function ModalArquivo({ aberto, agenteId, projeto, caminho, onFechar }: {
  aberto: boolean; agenteId?: string; projeto?: string; caminho: string; onFechar: () => void;
}) {
  const [texto, setTexto] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  useEffect(() => {
    if (!aberto || !caminho || (!projeto && !agenteId)) return;
    let vivo = true;
    setTexto(null);
    setErro(false);
    const url = projeto
      ? `/arquivo?projeto=${encodeURIComponent(projeto)}&caminho=${encodeURIComponent(caminho)}`
      : `/arquivo?agente=${encodeURIComponent(agenteId ?? "")}&caminho=${encodeURIComponent(caminho)}`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
      .then((t) => { if (vivo) setTexto(t); })
      .catch(() => { if (vivo) setErro(true); });
    return () => { vivo = false; };
  }, [aberto, agenteId, projeto, caminho]);
  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent
        className="flex h-[80vh] max-w-3xl flex-col gap-0 overflow-hidden p-0"
        style={{ background: FUNDO, border: `1px solid ${BORDA}` }}
      >
        <DialogTitle className="sr-only">{caminho}</DialogTitle>
        <DialogDescription className="sr-only">Prévia do arquivo {caminho}</DialogDescription>
        <div
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}
        >
          <FileText className="size-3.5 shrink-0" style={{ color: AZUL }} />
          <span className="truncate" title={caminho}>{caminho}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-3">
          {erro
            ? <p style={{ color: VERMELHO, font: FONTE }}>não foi possível abrir o arquivo.</p>
            : <pre className="whitespace-pre-wrap" style={{ font: MONO_PRE, color: "#dedee3" }}>{texto ?? "carregando…"}</pre>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Arvore (pasta recolhivel / arquivo arrastavel)

type RamoProps = {
  item: NoArvore;
  nivel: number;
  fechadas: Set<string>;
  onAlternar: (caminho: string) => void;
  onAbrir: (caminho: string) => void;
  onArrastar: (e: DragEvent<HTMLElement>, caminho: string) => void;
};

/** Um item da arvore: pasta (chevron + carpeta, recolhivel) ou arquivo (icone + arrastavel/abre previa). */
function Ramo({ item, nivel, fechadas, onAlternar, onAbrir, onArrastar }: RamoProps) {
  const pasta = Array.isArray(item.filhos);
  const aberta = !fechadas.has(item.caminho);
  return (
    <>
      <div
        className="nodrag flex cursor-pointer items-center gap-1 rounded px-1 py-px hover:bg-white/5"
        style={{ paddingLeft: 4 + nivel * 10 }}
        title={item.caminho}
        draggable={!pasta}
        onDragStart={pasta ? undefined : (e) => onArrastar(e, item.caminho)}
        onClick={() => (pasta ? onAlternar(item.caminho) : onAbrir(item.caminho))}
      >
        {pasta
          ? <ChevronRight className={cn("size-3 shrink-0 transition-transform", aberta && "rotate-90")} style={{ color: CINZA }} />
          : <span className="size-3 shrink-0" />}
        {pasta
          ? (aberta
            ? <FolderOpen className="size-3.5 shrink-0" style={{ color: AZUL }} />
            : <Folder className="size-3.5 shrink-0" style={{ color: AZUL }} />)
          : <FileText className="size-3.5 shrink-0" style={{ color: CINZA }} />}
        <span className="truncate" style={{ font: MONO }}>{item.nome}</span>
      </div>
      {pasta && aberta && item.filhos!.map((f) => (
        <Ramo key={f.caminho} item={f} nivel={nivel + 1} fechadas={fechadas} onAlternar={onAlternar} onAbrir={onAbrir} onArrastar={onArrastar} />
      ))}
    </>
  );
}

// nodeType

/** No' 'explorador': cabecalho 'Explorador · <agente>', busca e a arvore do agente. */
export function NoExplorador({ id, data, selected }: NodeProps) {
  const { agentes } = useContext(AgentesCtx);
  const acoes = useContext(CanvasCtx);
  const no = lerDados(data);
  const agenteId = typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
  const nome = agentes.find((a) => a.id === agenteId)?.nome ?? (agenteId || "agente");
  const fixado = no.dados.fixado === true;
  const [busca, setBusca] = useState("");
  const [caminhos, setCaminhos] = useState<string[]>([]);
  const [estado, setEstado] = useState<"carregando" | "ok" | "erro">("carregando");
  const [fechadas, setFechadas] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<string | null>(null);

  const carregar = useCallback(() => {
    if (!agenteId) { setCaminhos([]); setEstado("ok"); return; }
    setEstado("carregando");
    fetch(`/arvore?agente=${encodeURIComponent(agenteId)}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j) => {
        if (Array.isArray(j)) { setCaminhos(j.filter((x): x is string => typeof x === "string")); setEstado("ok"); }
        else setEstado("erro");
      })
      .catch(() => setEstado("erro"));
  }, [agenteId]);

  useEffect(() => { carregar(); }, [carregar]);

  const alternar = (caminho: string) => setFechadas((s) => {
    const n = new Set(s);
    if (n.has(caminho)) n.delete(caminho); else n.add(caminho);
    return n;
  });

  const arrastar = (e: DragEvent<HTMLElement>, caminho: string) => {
    e.dataTransfer.setData(MIME_ARQUIVO, JSON.stringify({ agenteId, caminho }));
    e.dataTransfer.effectAllowed = "copy";
  };

  const buscaLimpa = busca.trim();
  const lista = buscaLimpa ? filtrarArvore(caminhos, buscaLimpa) : [];
  const arvore = useMemo(() => arvoreDeCaminhos(caminhos), [caminhos]);

  return (
    <div className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", !!selected && "cv-sel")}>
      <header
        className="flex shrink-0 items-center gap-2 px-2.5"
        style={{ height: 32, background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}
      >
        <Folder className="size-3.5 shrink-0" style={{ color: AZUL }} />
        <span className="truncate" title={`Explorador · ${nome}`}>Explorador · {nome}</span>
        {fixado && <Pin className="size-3.5 shrink-0" style={{ color: "#74aaff" }} aria-label="Fixado" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Opções" className="nodrag ml-auto grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: CINZA }}>
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="cv-menu min-w-40">
            <DropdownMenuItem onSelect={() => carregar()}>Recarregar</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => acoes.fixar(id)}>
              <Pin className="size-3.5" style={{ color: "#74aaff" }} />
              {fixado ? "Desafixar" : "Fixar"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" title="Fechar" onClick={() => acoes.removerNo(id)} className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: CINZA }}>
          <X className="size-3.5" />
        </button>
      </header>

      <div className="shrink-0 px-2 pt-2">
        <div className="flex items-center gap-1.5 rounded px-1.5" style={{ background: "#141414", border: `1px solid ${BORDA}` }}>
          <Search className="size-3.5 shrink-0" style={{ color: CINZA }} />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar arquivo…"
            className="nodrag nowheel min-w-0 flex-1 bg-transparent py-1 outline-none placeholder:opacity-50"
            style={{ color: "#dedee3", font: FONTE }}
          />
        </div>
      </div>

      <div className="nowheel nodrag min-h-0 flex-1 overflow-auto p-1.5">
        {estado === "carregando" && <p style={{ color: CINZA, font: FONTE }}>carregando…</p>}
        {estado === "erro" && <p style={{ color: VERMELHO, font: FONTE }}>não foi possível ler a árvore.</p>}
        {estado === "ok" && (buscaLimpa
          ? (lista.length === 0
            ? <p style={{ color: CINZA, font: FONTE }}>nada encontrado.</p>
            : lista.map((c) => (
              <div
                key={c}
                className="nodrag flex cursor-pointer items-center gap-1 rounded px-1 py-px hover:bg-white/5"
                title={c}
                draggable
                onDragStart={(e) => arrastar(e, c)}
                onClick={() => setPreview(c)}
              >
                <span className="size-3 shrink-0" />
                <FileText className="size-3.5 shrink-0" style={{ color: CINZA }} />
                <span className="truncate" style={{ font: MONO }}>{c}</span>
              </div>
            )))
          : (arvore.length === 0
            ? <p style={{ color: CINZA, font: FONTE }}>sem arquivos.</p>
            : arvore.map((it) => (
              <Ramo key={it.caminho} item={it} nivel={0} fechadas={fechadas} onAlternar={alternar} onAbrir={setPreview} onArrastar={arrastar} />
            ))))}
      </div>

      <Alcas />
      <ModalArquivo aberto={preview !== null} agenteId={agenteId} caminho={preview ?? ""} onFechar={() => setPreview(null)} />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra `explorador: NoExplorador`). */
export const nodeTypes = { explorador: NoExplorador };

export default NoExplorador;
