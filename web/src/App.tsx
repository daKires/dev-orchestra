import { useEffect, useMemo, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Search } from "lucide-react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { EditorArea, PLANO } from "@/components/EditorArea";
import { BottomPanel } from "@/components/BottomPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { CancelDialog } from "@/components/CancelDialog";
import { useAgora, useLocal, useRuns } from "@/hooks/useRuns";
import { porProjeto, rodando } from "@/lib/estado";

export default function App() {
  const { estado, conectado } = useRuns();
  const agora = useAgora();
  const [runId, setRunId] = useLocal<string | null>("run", null);
  const [fechados, setFechados] = useLocal<string[]>("fechados", []);
  const [sliceSel, setSliceSel] = useState<number | null>(null);
  const [abasPorRun, setAbasPorRun] = useState<Record<string, { abas: string[]; ativa: string }>>({});
  const [paleta, setPaleta] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const lateral = usePanelRef();
  const inferior = usePanelRef();

  // Sem run escolhida (ou a escolhida sumiu na poda): abre a que esta rodando, senao a mais recente.
  const r = runId ? estado.runs[runId] ?? null : null;
  const padrao = useMemo(() => {
    const todas = porProjeto(estado).flatMap((g) => g.runs).sort((a, b) => b.inicioTs - a.inicioTs);
    return (todas.find((x) => rodando(x, Date.now())) ?? todas[0])?.id ?? null;
  }, [estado]);
  useEffect(() => { if (!r && padrao) setRunId(padrao); }, [r, padrao]); // eslint-disable-line react-hooks/exhaustive-deps

  const abas = (r && abasPorRun[r.id]) || { abas: [], ativa: PLANO };
  const setAbas = (v: { abas: string[]; ativa: string }) => r && setAbasPorRun((x) => ({ ...x, [r.id]: v }));
  const abrirArquivo = (f: string) => setAbas({ abas: abas.abas.includes(f) ? abas.abas : [...abas.abas, f], ativa: f });
  const fecharAba = (a: string) => {
    const resto = abas.abas.filter((x) => x !== a);
    setAbas({ abas: resto, ativa: abas.ativa === a ? resto[resto.length - 1] ?? PLANO : abas.ativa });
  };
  const irSlice = (i: number | null) => { setSliceSel(i); if (i != null) setAbas({ ...abas, ativa: PLANO }); };

  // Atalhos de editor: Ctrl+K/Ctrl+P paleta, Ctrl+B barra lateral, Ctrl+J painel inferior.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const k = e.key.toLowerCase();
      const alternar = (p: typeof lateral) => { const h = p.current; if (h) (h.isCollapsed() ? h.expand() : h.collapse()); };
      if (k === "k" || k === "p") { e.preventDefault(); setPaleta((v) => !v); }
      else if (k === "b") { e.preventDefault(); alternar(lateral); }
      else if (k === "j") { e.preventDefault(); alternar(inferior); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lateral, inferior]);

  useEffect(() => { document.title = r ? `${r.feature} · Hermes` : "Hermes Orchestra"; }, [r?.feature]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* barra de titulo com o "command center" */}
        <header className="relative flex h-10 shrink-0 items-center border-b bg-sidebar px-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-tight">
            <span className="grid size-5 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">H</span>
            Hermes <span className="font-normal text-muted-foreground">Orchestra</span>
          </span>
          <button
            onClick={() => setPaleta(true)}
            className="absolute left-1/2 flex h-6.5 w-[min(34rem,46vw)] -translate-x-1/2 items-center gap-2 rounded-md border bg-background/60 px-2.5 text-xs text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
          >
            <Search className="size-3.5" />
            <span className="truncate">{r ? `${r.projeto} › ${r.feature}` : "Ir para run, slice ou arquivo"}</span>
            <kbd className="ml-auto rounded border px-1 font-mono text-[10px]">Ctrl K</kbd>
          </button>
        </header>

        <div className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="lateral" panelRef={lateral} defaultSize={300} minSize={200} maxSize="45" collapsible collapsedSize={0}>
              <Sidebar
                estado={estado} agora={agora} conectado={conectado}
                runId={r?.id ?? null} onRun={(id) => { setRunId(id); setSliceSel(null); }}
                sliceSel={sliceSel} onSlice={irSlice} fechados={fechados} onFechados={setFechados}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="principal" minSize={400}>
              {r ? (
                <ResizablePanelGroup orientation="vertical">
                  <ResizablePanel id="editor" minSize={160}>
                    <EditorArea
                      r={r} agora={agora} abas={abas.abas} ativa={abas.ativa}
                      onAtiva={(a) => setAbas({ ...abas, ativa: a })} onFechar={fecharAba} onArquivo={abrirArquivo}
                      sliceSel={sliceSel} onSlice={irSlice}
                    />
                  </ResizablePanel>
                  <ResizableHandle />
                  <ResizablePanel id="inferior" panelRef={inferior} defaultSize="32" minSize={110} collapsible collapsedSize={0}>
                    <BottomPanel r={r} sliceSel={sliceSel} onSlice={irSlice} />
                  </ResizablePanel>
                </ResizablePanelGroup>
              ) : (
                <div className="grid h-full place-items-center">
                  <div className="text-center">
                    <p className="text-sm text-muted-foreground">{conectado ? "Nenhuma run nos últimos 7 dias." : "Conectando ao hub…"}</p>
                    <p className="mt-2 text-xs text-muted-foreground/70">Rode <code className="font-mono">/orchestra "feature"</code> numa sessão do Claude.</p>
                  </div>
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StatusBar r={r} agora={agora} onCancelar={() => setCancelar(true)} onPaleta={() => setPaleta(true)} />
      </div>

      <CommandPalette
        aberto={paleta} onAberto={setPaleta} estado={estado} r={r} agora={agora}
        onRun={(id) => { setRunId(id); setSliceSel(null); }} onSlice={irSlice} onArquivo={abrirArquivo}
      />
      <CancelDialog r={r} aberto={cancelar} onAberto={setCancelar} />
    </TooltipProvider>
  );
}
