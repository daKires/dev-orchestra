// Tela unida (Run A): UMA tela so' — topbar (seletor de projeto, branch da run, hub, "+ Feature"),
// sidebar (Explorador do projeto, Runs, Pool de agentes), canvas com painel direito e status bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { CancelDialog } from "@/components/CancelDialog";
import { NovaFeatureDialog } from "@/components/NovaFeatureDialog";
import { ProjetoSeletor } from "@/components/ProjetoSeletor";
import { Canvas, type CanvasHandle } from "@/components/Canvas";
import { ModalArquivo } from "@/components/canvas/Explorador";
import { useAgora, useLocal, useRuns } from "@/hooks/useRuns";
import { useAgentes } from "@/hooks/useAgentes";
import { badgesArquivos, projetoInicial } from "@/lib/unido";
import { cn } from "@/lib/utils";

/** Chave canonica de um caminho (barras '/'), como badgesArquivos usa na sidebar. */
const caminhoChave = (arquivo: string): string => arquivo.replace(/\\/g, "/");

export default function App() {
  const { estado, conectado } = useRuns();
  const agora = useAgora();
  // Projeto da tela: o salvo (localStorage) ou, na 1a abertura, a raiz da run ativa.
  const [projeto, setProjeto] = useLocal<string | null>("projeto", null);
  const [runSelId, setRunSelId] = useState<string | null>(null);
  const [paleta, setPaleta] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [nova, setNova] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null); // previa (ModalArquivo) de um arquivo sem diff
  const canvasRef = useRef<CanvasHandle | null>(null);
  const lateral = usePanelRef();

  // Run mostrada no painel direito do canvas (onRunSel): alimenta o chip de branch e a StatusBar.
  const runSel = runSelId ? estado.runs[runSelId] ?? null : null;

  // Sem projeto salvo: usa projetoInicial(null, runs, agora) do @/lib/unido assim que houver runs.
  const runs = useMemo(() => Object.values(estado.runs), [estado.runs]);
  const projetoPadrao = useMemo(() => projetoInicial(null, runs, agora), [runs, agora]);
  useEffect(() => {
    if (!projeto && projetoPadrao) setProjeto(projetoPadrao);
  }, [projeto, projetoPadrao]); // eslint-disable-line react-hooks/exhaustive-deps

  // Agentes do pool da sidebar: os do projeto escolhido (GET /agentes?projeto=).
  const { agentes } = useAgentes(projeto ?? "");

  // Atalhos: Ctrl+K/Ctrl+P paleta; Ctrl+B alterna a sidebar (colapsavel).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      if (k === "k" || k === "p") { e.preventDefault(); setPaleta((v) => !v); }
      else if (k === "b") {
        e.preventDefault();
        const h = lateral.current;
        if (h) (h.isCollapsed() ? h.expand() : h.collapse());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lateral]);

  /** Abre a run no canvas (expande o card e centraliza) — usado pela sidebar e pela paleta. */
  const abrirRun = (id: string) => { canvasRef.current?.abrirRun(id); };

  /** Foco do pool de agentes: 'run:<id>' abre a run; o resto enquadra o no' (focar). */
  const focar = (noId: string) => {
    if (noId.startsWith("run:")) canvasRef.current?.abrirRun(noId.slice(5));
    else canvasRef.current?.focar(noId);
  };

  /** Arquivo da sidebar: se a run mostrada tocou o arquivo, abre o Diff dela; senao, a previa. */
  const abrirArquivo = (caminho: string) => {
    const tocados = badgesArquivos(runSel);
    if (runSel && tocados.has(caminhoChave(caminho))) canvasRef.current?.abrirDiff(runSel.id, caminho);
    else setArquivo(caminho);
  };

  /** Arquivo escolhido na paleta: o diff dele na run mostrada. */
  const abrirDiff = (caminho: string) => {
    if (runSel) canvasRef.current?.abrirDiff(runSel.id, caminho);
  };

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* topbar da tela unida: projeto, branch da run mostrada, estado do hub e "+ Feature" */}
        <header className="flex h-10 shrink-0 items-center gap-3 border-b bg-sidebar px-3">
          <span className="flex shrink-0 items-center gap-2 text-[13px] font-semibold tracking-tight">
            <span className="grid size-5 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">H</span>
            Hermes <span className="font-normal text-muted-foreground">Orchestra</span>
          </span>
          <ProjetoSeletor projeto={projeto ?? ""} onProjeto={setProjeto} />
          {runSel?.branch && (
            <span
              className="shrink-0 truncate rounded border bg-background/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
              title={runSel.branch}
            >
              {runSel.branch}
            </span>
          )}
          <div className="ml-auto flex shrink-0 items-center gap-3">
            {/* indicador do hub: ponto verde enquanto o SSE esta' vivo; amarelo reconectando */}
            <span
              className={cn("flex items-center gap-1.5 text-xs", conectado ? "text-muted-foreground" : "text-warn")}
              title={conectado ? "hub conectado" : "reconectando…"}
            >
              <span className={cn("size-1.5 rounded-full", conectado ? "bg-ok" : "bg-warn")} />
              {conectado ? "hub conectado" : "reconectando…"}
            </span>
            {/* cria worktree + planejador pelo hub (POST /nova-feature) com o projeto atual */}
            <Button
              size="sm" variant="outline" className="h-6.5 gap-1.5 px-2.5 text-xs"
              title="Criar uma feature nova (worktree + planejador)" onClick={() => setNova(true)}
            >
              <Plus className="size-3.5" />Feature
            </Button>
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel
              id="sidebar" panelRef={lateral}
              defaultSize={280} minSize={200} maxSize="45" collapsible collapsedSize={0}
            >
              <Sidebar
                projeto={projeto ?? ""} estado={estado} agora={agora} agentes={agentes} runSel={runSel}
                onRun={abrirRun} onFocar={focar} onArquivo={abrirArquivo}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="canvas" minSize={400}>
              {projeto ? (
                <Canvas
                  ref={canvasRef} projeto={projeto}
                  onRunSel={setRunSelId} onNovaFeature={() => setNova(true)}
                />
              ) : (
                <div className="grid h-full place-items-center">
                  <p className="text-sm text-muted-foreground">Escolha um projeto no seletor acima</p>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StatusBar r={runSel} agora={agora} onCancelar={() => setCancelar(true)} onPaleta={() => setPaleta(true)} />
      </div>

      <CommandPalette
        aberto={paleta} onAberto={setPaleta} estado={estado} r={runSel} agora={agora}
        onRun={abrirRun} onSlice={() => { if (runSel) abrirRun(runSel.id); }} onArquivo={abrirDiff}
      />
      <CancelDialog r={runSel} aberto={cancelar} onAberto={setCancelar} />
      <NovaFeatureDialog estado={estado} aberto={nova} onAberto={setNova} projetoInicial={projeto ?? ""} />
      <ModalArquivo aberto={arquivo !== null} projeto={projeto ?? ""} caminho={arquivo ?? ""} onFechar={() => setArquivo(null)} />
    </TooltipProvider>
  );
}
