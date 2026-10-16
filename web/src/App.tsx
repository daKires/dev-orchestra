// Casca da tela unica: topbar, sidebar, canvas (com o painel direito) e status bar.
import { useEffect, useMemo, useRef, useState } from "react";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { CancelDialog } from "@/components/CancelDialog";
import { ProjetoSeletor } from "@/components/ProjetoSeletor";
import { Canvas, type CanvasHandle } from "@/components/Canvas";
import { ModalArquivo } from "@/components/canvas/Explorador";
import { useAgora, useLocal, useRuns } from "@/hooks/useRuns";
import { useAgentes } from "@/hooks/useAgentes";
import { badgesArquivos, projetoInicial, runsNovas } from "@/lib/unido";
import { cn } from "@/lib/utils";

const caminhoChave = (arquivo: string): string => arquivo.replace(/\\/g, "/");

export default function App() {
  const { estado, conectado } = useRuns();
  const agora = useAgora();
  const [projeto, setProjeto] = useLocal<string | null>("projeto", null);
  const [runSelId, setRunSelId] = useState<string | null>(null);
  const [paleta, setPaleta] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [arquivo, setArquivo] = useState<string | null>(null); // previa (ModalArquivo) de um arquivo sem diff
  const canvasRef = useRef<CanvasHandle | null>(null);
  const lateral = usePanelRef();
  const layout = useDefaultLayout({ id: "hermes.layout.app", storage: localStorage });

  const runSel = runSelId ? estado.runs[runSelId] ?? null : null;

  const runs = useMemo(() => Object.values(estado.runs), [estado.runs]);
  const projetoPadrao = useMemo(() => projetoInicial(null, runs, agora), [runs, agora]);
  useEffect(() => {
    if (!projeto && projetoPadrao) setProjeto(projetoPadrao);
  }, [projeto, projetoPadrao]); // eslint-disable-line react-hooks/exhaustive-deps

  const { agentes } = useAgentes(projeto ?? "");

  // Runs ja' abertas: o resto brilha na sidebar como "nova". A 1a carga conta tudo como visto.
  // ponytail: lista cresce sem poda; podar pras runs existentes se pesar no localStorage.
  const [vistas, setVistas] = useLocal<string[] | null>("runsVistas", null);
  useEffect(() => {
    if (!runs.length) return;
    if (!vistas) setVistas(runs.map((r) => r.id));
    else if (runSelId && !vistas.includes(runSelId)) setVistas([...vistas, runSelId]);
  }, [runs, runSelId]); // eslint-disable-line react-hooks/exhaustive-deps
  const novas = useMemo(() => runsNovas(runs, vistas, runSelId), [runs, vistas, runSelId]);

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

  const abrirRun = (id: string) => { canvasRef.current?.abrirRun(id); };

  const focar = (noId: string) => {
    if (noId.startsWith("run:")) canvasRef.current?.abrirRun(noId.slice(5));
    else canvasRef.current?.focar(noId);
  };

  const abrirArquivo = (caminho: string) => {
    const tocados = badgesArquivos(runSel);
    if (runSel && tocados.has(caminhoChave(caminho))) canvasRef.current?.abrirDiff(runSel.id, caminho);
    else setArquivo(caminho);
  };

  const abrirDiff = (caminho: string) => {
    if (runSel) canvasRef.current?.abrirDiff(runSel.id, caminho);
  };

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* topbar da tela unida: projeto, branch da run mostrada e estado do hub */}
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
          </div>
        </header>

        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}>
            <ResizablePanel
              id="sidebar" panelRef={lateral} className="overflow-hidden"
              defaultSize={280} minSize={200} maxSize="45" collapsible collapsedSize={0}
            >
              <Sidebar
                projeto={projeto ?? ""} estado={estado} agora={agora} agentes={agentes} runSel={runSel} novas={novas}
                onRun={abrirRun} onFocar={focar} onArquivo={abrirArquivo}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="canvas" minSize={400}>
              {projeto ? (
                <Canvas
                  ref={canvasRef} projeto={projeto}
                  onRunSel={setRunSelId}
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
      <ModalArquivo aberto={arquivo !== null} projeto={projeto ?? ""} caminho={arquivo ?? ""} onFechar={() => setArquivo(null)} />
    </TooltipProvider>
  );
}
