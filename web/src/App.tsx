import { useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";
import { Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Sidebar } from "@/components/Sidebar";
import { EditorArea, PLANO } from "@/components/EditorArea";
import { BottomPanel } from "@/components/BottomPanel";
import { ChatPanel } from "@/components/ChatPanel";
import { StatusBar } from "@/components/StatusBar";
import { CommandPalette } from "@/components/CommandPalette";
import { CancelDialog } from "@/components/CancelDialog";
import { NovaFeatureDialog } from "@/components/NovaFeatureDialog";
import { useAgora, useLocal, useRuns } from "@/hooks/useRuns";
import { chatsDoProjeto, porProjeto, rodando } from "@/lib/estado";

export default function App() {
  const { estado, conectado } = useRuns();
  const agora = useAgora();
  const [runId, setRunId] = useLocal<string | null>("run", null);
  const [fechados, setFechados] = useLocal<string[]>("fechados", []);
  const [sliceSel, setSliceSel] = useState<number | null>(null);
  const [abasPorRun, setAbasPorRun] = useState<Record<string, { abas: string[]; ativa: string }>>({});
  const [chatSel, setChatSel] = useState<string | null>(null);
  const [paleta, setPaleta] = useState(false);
  const [cancelar, setCancelar] = useState(false);
  const [nova, setNova] = useState(false);
  const lateral = usePanelRef();
  const inferior = usePanelRef();
  const chatRef = usePanelRef();

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

  // Chats (planejadores) do projeto da run; um chatSel valido reduz a lista a ele, senao mostra todos.
  const chatsProjeto = useMemo(() => chatsDoProjeto(estado.planejadores, r?.cwd ?? ""), [estado.planejadores, r?.cwd]);
  const chats = useMemo(() => {
    if (!chatSel) return chatsProjeto;
    const c = chatsProjeto.find((x) => x.slug === chatSel);
    return c ? [c] : chatsProjeto;
  }, [chatSel, chatsProjeto]);

  // Trocar de run limpa a selecao de chat (os chats sao do projeto da run).
  useEffect(() => { setChatSel(null); }, [r?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Nova feature concluida: seleciona o chat dela (uma vez) assim que ele aparece na lista.
  const nfUrl = estado.novaFeature?.status === "ok" ? estado.novaFeature.url : undefined;
  const nfFeita = useRef<string | null>(null);
  useEffect(() => {
    if (!nfUrl || nfFeita.current === nfUrl) return;
    const p = estado.planejadores.find((x) => x.url === nfUrl);
    if (p) { nfFeita.current = nfUrl; setChatSel(p.slug); }
  }, [nfUrl, estado.planejadores]);

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
          {/* cria worktree + planejador pelo hub (POST /nova-feature); o chat abre no painel direito */}
          <Button
            size="sm" variant="outline" className="ml-auto h-6.5 gap-1.5 px-2.5 text-xs"
            title="Criar uma feature nova (worktree + planejador)" onClick={() => setNova(true)}
          >
            <Plus className="size-3.5" />Nova feature
          </Button>
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
            {chats.length > 0 && (
              <>
                <ResizableHandle />
                <ResizablePanel id="chat" panelRef={chatRef} defaultSize="34" minSize={240} collapsible collapsedSize={0}>
                  <ChatPanel chats={chats} ativo={chatSel ?? chats[0].slug} onAtivo={setChatSel} />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        </div>

        <StatusBar r={r} agora={agora} onCancelar={() => setCancelar(true)} onPaleta={() => setPaleta(true)} />
      </div>

      <CommandPalette
        aberto={paleta} onAberto={setPaleta} estado={estado} r={r} agora={agora}
        onRun={(id) => { setRunId(id); setSliceSel(null); }} onSlice={irSlice} onArquivo={abrirArquivo}
      />
      <CancelDialog r={r} aberto={cancelar} onAberto={setCancelar} />
      <NovaFeatureDialog estado={estado} aberto={nova} onAberto={setNova} />
    </TooltipProvider>
  );
}
