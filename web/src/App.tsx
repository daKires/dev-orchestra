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
import { chaveProjeto } from "@/hooks/useCanvas";
import { raiz } from "@/lib/estado";
import type { Consulta } from "@/lib/busca";
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
  // busca global da sidebar (texto livre ou filtro por sessao) e o titulo do chat por run (/sessoes).
  const [busca, setBusca] = useState<Consulta>("");
  const [titulos, setTitulos] = useState<Record<string, string>>({});
  // toast do canto (abrir a sessao de uma run) com o comando de copia devolvido pela rota.
  const [toast, setToast] = useState<{ texto: string; comandoCopia: string } | null>(null);
  // ?run=<id ou mcpRunId>: abre o dashboard focado naquela run (resolvida quando o estado carrega).
  const runDaUrl = useMemo(() => new URLSearchParams(window.location.search).get("run"), []);
  const [runPendente, setRunPendente] = useState<string | null>(runDaUrl);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const lateral = usePanelRef();
  const layout = useDefaultLayout({ id: "dev-orchestra.layout.app", storage: localStorage });

  const runSel = runSelId ? estado.runs[runSelId] ?? null : null;

  const runs = useMemo(() => Object.values(estado.runs), [estado.runs]);
  // Projetos com pasta existente (do seletor); null = lista ainda nao carregou. Run de pasta apagada
  // nao vira projeto padrao, e projeto salvo cuja pasta sumiu volta pro da run ativa.
  const [validos, setValidos] = useState<string[] | null>(null);
  const existe = (p: string) => !validos || validos.some((v) => chaveProjeto(v) === chaveProjeto(p));
  const projetoPadrao = useMemo(
    () => projetoInicial(null, runs.filter((r) => existe(raiz(r.cwd))), agora),
    [runs, agora, validos], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => {
    if (!projeto && projetoPadrao) setProjeto(projetoPadrao);
    else if (projeto && validos?.length && !existe(projeto)) setProjeto(projetoPadrao);
  }, [projeto, projetoPadrao, validos]); // eslint-disable-line react-hooks/exhaustive-deps

  // ?run= na URL: ignora o projeto salvo e deixa o padrao decidir (a run pedida troca depois, se achar).
  useEffect(() => { if (runDaUrl) setProjeto(null); }, [runDaUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // titulo do chat por run (GET /sessoes); erro ignora e recarrega a cada 30s pra pegar renomeacoes.
  useEffect(() => {
    let vivo = true;
    const puxar = () => {
      fetch("/sessoes")
        .then((r) => (r.ok ? r.json() : {}))
        .then((j) => { if (vivo && j && typeof j === "object") setTitulos(j as Record<string, string>); })
        .catch(() => {});
    };
    puxar();
    const t = window.setInterval(puxar, 30_000);
    return () => { vivo = false; window.clearInterval(t); };
  }, []);

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

  // toast do canto (abrir a sessao de uma run) some sozinho em ~6s: estado local, sem lib nova.
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 6000);
    return () => window.clearTimeout(t);
  }, [toast]);

  /**
   * Reabre o chat da sessao salva na run (POST /runs/sessao com o header de acao) e mostra o toast
   * "Abrindo no Claude…" com o comando de copia devolvido pela rota.
   */
  const abrirSessao = async (id: string) => {
    const r = estado.runs[id];
    const ferramenta =
      r?.sessao?.planejador === "claude" ? "Claude" : r?.sessao?.planejador === "antigravity" ? "Antigravity" : "OpenCode";
    try {
      const res = await fetch(`/runs/sessao?run=${encodeURIComponent(id)}`, {
        method: "POST",
        headers: { "X-Dev-Orchestra": "1" },
      });
      const j = res.ok ? await res.json().catch(() => null) : null;
      const comandoCopia = j && typeof j.comandoCopia === "string" ? j.comandoCopia : "";
      setToast({ texto: `Abrindo no ${ferramenta}…`, comandoCopia });
    } catch {
      setToast({ texto: `Falha ao abrir no ${ferramenta}`, comandoCopia: "" });
    }
  };

  const filtrarSessao = (id: string) => {
    const sessao = estado.runs[id]?.sessao;
    if (!sessao) return;
    setBusca({ sessao: sessao.id, titulo: titulos[id] ?? "" });
  };

  // 'abrir run pendente' — quem pede (Sidebar/paleta/atalho/URL) so' passa o id; o efeito abaixo
  // troca o projeto (raiz do cwd) se preciso e so' abre depois do render com o projeto batendo.
  const abrirRun = (id: string) => setRunPendente(id);

  // Resolve a run pendente por id ou mcpRunId assim que o estado carrega; desconhecida = ignora.
  useEffect(() => {
    if (!runPendente) return;
    const r = runs.find((x) => x.id === runPendente || x.mcpRunId === runPendente);
    if (!r) return;
    const alvo = raiz(r.cwd);
    if (alvo && chaveProjeto(alvo) !== chaveProjeto(projeto ?? "")) { setProjeto(alvo); return; }
    setRunPendente(null);
    canvasRef.current?.abrirRun(r.id);
  }, [runPendente, runs, projeto]); // eslint-disable-line react-hooks/exhaustive-deps

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
            <span className="grid size-5 place-items-center rounded bg-primary text-[11px] font-bold text-primary-foreground">D</span>
            Dev <span className="font-normal text-muted-foreground">Orchestra</span>
          </span>
          <ProjetoSeletor projeto={projeto ?? ""} onProjeto={setProjeto} onLista={setValidos} />
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
                titulos={titulos} busca={busca} onBusca={setBusca}
                onRun={abrirRun} onFocar={focar} onArquivo={abrirArquivo}
              />
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="canvas" minSize={400}>
              {projeto ? (
                <Canvas
                  ref={canvasRef} projeto={projeto} runsEstado={estado}
                  onRunSel={setRunSelId} titulos={titulos}
                  onAbrirSessao={(id) => void abrirSessao(id)} onFiltrarSessao={filtrarSessao}
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
        aberto={paleta} onAberto={setPaleta} estado={estado} r={runSel} agora={agora} titulos={titulos}
        onRun={abrirRun} onSlice={() => { if (runSel) abrirRun(runSel.id); }} onArquivo={abrirDiff}
      />
      <CancelDialog r={runSel} aberto={cancelar} onAberto={setCancelar} />
      <ModalArquivo aberto={arquivo !== null} projeto={projeto ?? ""} caminho={arquivo ?? ""} onFechar={() => setArquivo(null)} />

      {toast && (
        <div
          role="status"
          className="fixed right-4 bottom-4 z-50 flex items-center gap-3 rounded-md border bg-sidebar px-3 py-2 text-xs shadow-lg"
        >
          <span className="truncate">{toast.texto}</span>
          {toast.comandoCopia && (
            <button
              type="button"
              className="shrink-0 rounded border border-input px-2 py-1 font-medium hover:bg-sidebar-accent"
              onClick={() => { void navigator.clipboard?.writeText(toast.comandoCopia).catch(() => {}); }}
            >
              Copiar comando
            </button>
          )}
        </div>
      )}
    </TooltipProvider>
  );
}
