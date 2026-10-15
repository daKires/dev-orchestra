// Vista Canvas (S4): o grafo do projeto renderizado com @xyflow/react, so' visualizacao (pan + zoom).
// O canvas nao cria/move/apaga nos; os cards seguem interativos por dentro e as acoes deles voltam
// como operacoes pro hub (useCanvas). UI em PT-BR, so' tema escuro.
import {
  forwardRef, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState,
} from "react";
import {
  Background, BackgroundVariant, MarkerType, Panel, ReactFlow,
  applyNodeChanges,
  useReactFlow, useViewport,
  type Edge, type Node, type NodeChange, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ChevronLeft, ChevronRight, WifiOff } from "lucide-react";
import { alternarFixado, limitarZoom, mesclarNosRf, pontaDaAresta } from "@/lib/canvas";
import { arestasPlanejadorRun, layoutAgentes, layoutRuns, mesclarComLayout, pedidoAtivo } from "@/lib/layout";
import { runsDoProjeto } from "@/lib/estado";
import { arestasEmConversa, type EmConversa } from "@/lib/colab";
import { runAtiva, runDaSelecao } from "@/lib/unido";
import { useAgentes } from "@/hooks/useAgentes";
import { useAgora, useRuns } from "@/hooks/useRuns";
import { useCanvas } from "@/hooks/useCanvas";
import type { Aresta, No, Op, Snapshot, TipoNo } from "../../../canvas.ts";
import { PainelRun } from "./canvas/PainelRun";
import { CanvasCtx, edgeTypes, nodeTypes as nosNodeTypes } from "./canvas/Nos";
import { AgentesCtx, NoAgente } from "./canvas/Agente";
import { NoClaude } from "./canvas/Claude";
import { RunsCtx, nodeTypes as runNodeTypes } from "./canvas/Run";
import { nodeTypes as pedidoNodeTypes } from "./canvas/Pedido";
import { nodeTypes as gateNodeTypes } from "./canvas/Gate";
import { nodeTypes as diffNodeTypes } from "./canvas/DiffRun";
import { nodeTypes as exploradorNodeTypes } from "./canvas/Explorador";
import { ProjetoCtx, nodeTypes as navegadorNodeTypes } from "./canvas/Navegador";
import { nodeTypes as painelNodeTypes } from "./canvas/Painel";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * No' 'agente' (F4 S6): despacha pro card do Claude Code quando o agente e' tipo 'claude' e pro card
 * do OpenCode no resto. O tipo vem do resumo do hub (useAgentes) pelo AgentesCtx.
 */
function NoAgenteTipo(props: NodeProps) {
  const { agentes } = useContext(AgentesCtx);
  const no = (props.data as { no?: No }).no;
  const agenteId = no && typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
  const agente = agentes.find((a) => a.id === agenteId);
  return agente?.tipo === "claude" ? <NoClaude {...props} /> : <NoAgente {...props} />;
}

// nodeTypes registrados no xyflow: os cards base (Nos) + o agente (F2 S5b, F4 S6) + run/worker/arquivo
const nodeTypes = {
  ...nosNodeTypes,
  agente: NoAgenteTipo,
  ...runNodeTypes,
  ...pedidoNodeTypes,
  ...gateNodeTypes,
  ...diffNodeTypes,
  ...exploradorNodeTypes,
  ...navegadorNodeTypes,
  ...painelNodeTypes,
};

// Modelo (No/Aresta) <-> react-flow (nodes/edges)

// Tipos que tem render proprio; os demais caem no card de nota como fallback.
const TEM_CARD = new Set<TipoNo>(["nota", "imagem", "forma", "grupo", "texto", "agente", "run", "worker", "arquivo", "pedido", "gate", "diff", "explorador", "navegador", "painel"]);
const tipoVisual = (t: TipoNo): string => (TEM_CARD.has(t) ? t : "nota");

/** Foco em campo de texto (input/textarea/contenteditable): atalhos de vista nao valem. */
const emCampo = (alvo: EventTarget | null): boolean => {
  const el = alvo as HTMLElement | null;
  if (!el) return false;
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;
};

// zIndex de um no' no react-flow: `dados.z` do modelo (ordemZ). Grupo fica sempre atras dos filhos.
function zIndexDoNo(no: No): number {
  if (no.tipo === "grupo") return 0;
  const z = no.dados?.z;
  return typeof z === "number" && Number.isFinite(z) ? z : 1;
}

// No modelo, x/y sao ABSOLUTOS (mesma base do paiDoNo). Filho de grupo vira posicao RELATIVA ao pai.
function noParaRf(no: No, porId: Map<string, No>): Node {
  const pai = no.pai ? porId.get(no.pai) : undefined;
  return {
    id: no.id,
    type: tipoVisual(no.tipo),
    position: pai ? { x: no.x - pai.x, y: no.y - pai.y } : { x: no.x, y: no.y },
    data: { no },
    width: no.w,
    height: no.h,
    parentId: pai?.id,
    zIndex: zIndexDoNo(no),
  };
}

// A seta (markerEnd ArrowClosed) so' aparece quando as duas pontas sao formas (pontaDaAresta).
// Aresta em conversa (F3 S4): tracejado azul animado (#74aaff) com o balao como rotulo; sentido
// reverso inverte a animacao pela classe CSS `cv-anim-reversa` (sem trocar source/target).
function arestaParaRf(
  a: Aresta, porId: Map<string, No>, emConversa: Record<string, EmConversa>,
  pedidoEmAndamento: (a: Aresta) => boolean,
): Edge {
  const comSeta = pontaDaAresta(porId.get(a.de)?.tipo, porId.get(a.para)?.tipo);
  // Agente <-> agente/navegador: ligacao de mao dupla (os dois conversam/controlam), seta nas duas pontas.
  const ehAtor = (t?: string) => t === "agente" || t === "navegador";
  const maoDupla = !comSeta && ehAtor(porId.get(a.de)?.tipo) && ehAtor(porId.get(a.para)?.tipo);
  const seta = { type: MarkerType.ArrowClosed, color: "#606060", width: 16, height: 16 };
  const conv = emConversa[a.id];
  // Aresta "pedido" (G2/S4b): o hub marca dados.pedido na aresta ag:<pedinte> -> ag:<planejador>.
  // Enquanto o pedido esta' em andamento (pedidoAtivo do cwd do planejador-alvo) ela fica tracejada e
  // animada como a aresta em conversa (classe cv-pedido pinta de azul no index.css); para quando a run
  // daquele cwd recebe o painel final.
  const pedido = (a as Aresta & { dados?: { pedido?: boolean } }).dados?.pedido === true;
  const pedidoAtivoAqui = pedido && pedidoEmAndamento(a);
  const classe = [
    conv?.sentido === "reverso" ? "cv-anim-reversa" : "",
    pedidoAtivoAqui ? "cv-pedido" : "",
  ].filter(Boolean).join(" ");
  return {
    id: a.id,
    source: a.de,
    target: a.para,
    type: "rotulo",
    data: { rotulo: a.rotulo ?? "", conversa: conv },
    animated: !!conv || pedidoAtivoAqui,
    className: classe || undefined,
    markerStart: maoDupla ? seta : undefined,
    markerEnd: comSeta || maoDupla ? seta : undefined,
  };
}

function ControleZoom({ temNos, onAjustar }: { temNos: boolean; onAjustar: () => void }) {
  const { zoom } = useViewport();
  const { zoomTo } = useReactFlow();
  const pct = Math.round(limitarZoom(zoom) * 100);
  const passo = (delta: number) => void zoomTo(limitarZoom(zoom + delta));
  return (
    <Panel
      position="bottom-right"
      className="flex items-center gap-0.5 px-1 py-0.5"
      style={{ background: "#222", border: "1px solid #303030", borderRadius: 8 }}
    >
      <button type="button" title="Diminuir zoom" onClick={() => passo(-0.2)} className="grid size-6 place-items-center rounded text-sm hover:bg-white/10" style={{ color: "#b8b8b8" }}>−</button>
      <span className="w-10 text-center tabular-nums" style={{ fontSize: 12, color: "#b8b8b8" }}>{pct}%</span>
      <button type="button" title="Aumentar zoom" onClick={() => passo(0.2)} className="grid size-6 place-items-center rounded text-sm hover:bg-white/10" style={{ color: "#b8b8b8" }}>+</button>
      <button
        type="button"
        title="Ajustar (enquadrar tudo)"
        aria-label="Ajustar"
        disabled={!temNos}
        onClick={onAjustar}
        className="rounded px-1.5 py-1 text-xs hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        style={{ color: "#b8b8b8" }}
      >
        Ajustar
      </button>
    </Panel>
  );
}


// Canvas

export type CanvasProps = {
  projeto: string;
  onRunSel?: (runId: string | null) => void;
};

export type CanvasHandle = {
  focar(noId: string): void;
  abrirRun(runId: string): void;
  abrirDiff(runId: string, arquivo: string): void;
};

export const Canvas = forwardRef<CanvasHandle, CanvasProps>(function Canvas(
  { projeto, onRunSel }, ref,
) {
  const { estado, conectado, enviar } = useCanvas(projeto);
  const [nos, setNos] = useState<Node[]>([]);
  const [arestas, setArestas] = useState<Edge[]>([]);
  const bloqueado = !conectado; // sem SSE vivo: os cards nao mandam ops ("reconectando…")
  const container = useRef<HTMLDivElement | null>(null);
  const instancia = useRef<ReactFlowInstance | null>(null);
  const ajusteFeito = useRef(false);

  // --- F2 S5d: runs do projeto, agentes e relogio (o layout automatico entra no `modelo` abaixo) ---
  const { agentes, linhasPorId, conversas, carregarHistorico, mensagem, abortar, encerrar, reiniciar, trocarModelo, modelos, assinarPty } = useAgentes(projeto);
  const { estado: runsEstado } = useRuns();
  const agora = useAgora();
  const [fecharAgente, setFecharAgente] = useState<{ noId: string; agenteId: string } | null>(null);
  // Painel direito: largura/recolhido vivem no layout persistido (hermes.layout.canvas); `painel` espelha.
  const painelRef = usePanelRef();
  const layout = useDefaultLayout({ id: "hermes.layout.canvas", storage: localStorage });
  const [painel, setPainel] = useState(true);
  const [runSelId, setRunSelId] = useState<string | null>(null);
  const [abaPedida, setAbaPedida] = useState<{ runId: string; aba: string } | null>(null);
  const [arquivoPedido, setArquivoPedido] = useState<{ runId: string; arquivo: string } | null>(null);
  // Agentes de planejador JA' persistidos uma vez (nao re-upsertamos a cada render).
  const agentesUpsertados = useRef<Set<string>>(new Set());

  // Runs deste canvas: mesma raiz do projeto (worktree conta como o projeto).
  const runsProjeto = useMemo(
    () => runsDoProjeto(Object.values(runsEstado.runs), projeto),
    [runsEstado, projeto],
  );

  const runAtivaProjeto = useMemo(() => runAtiva(runsProjeto, agora), [runsProjeto, agora]);

  // Modelo exibido = snapshot mesclado com o layout das runs + o layout dos agentes (mesclarComLayout):
  // os nos ocultos ficam de fora, o automatico salvo usa a versao do layout e o conteudo do usuario
  // segue o salvo (nada de duplicar). As arestas do layout entram so' se forem novas (as do snapshot ganham).
  const modelo = useMemo<Snapshot>(() => {
    // Arestas planejador -> run (G2/S4b): o planejador roda no worktree e dispara a run naquele cwd.
    const plans = agentes.filter((a) => a.origem === "planejador").map((a) => ({ agId: `ag:${a.id}`, cwd: a.cwd }));
    const lr = layoutRuns(runsProjeto, estado, Date.now(), plans);
    const la = layoutAgentes(agentes, estado);
    const ap = arestasPlanejadorRun(plans, runsProjeto);
    const posAgentes = new Map(lr.agentes.map((a) => [a.id, a]));
    const nos = mesclarComLayout(estado.nos, [...lr.nos, ...la]).map((n) => {
      const a = posAgentes.get(n.id);
      return a ? { ...n, x: a.x, y: a.y, pai: a.pai } : n;
    });
    const idsNos = new Set(nos.map((n) => n.id));
    const idsArestas = new Set(estado.arestas.map((a) => a.id));
    const arestasExtras: Aresta[] = [...lr.arestas, ...ap]
      .filter((a) => !idsArestas.has(a.id))
      .map((a) => ({ id: a.id, de: a.de, para: a.para, rev: 0 }));
    // Arestas do snapshot + as do layout, descartando as que ficaram orfas (ponta oculta/inexistente).
    const arestas = [...estado.arestas, ...arestasExtras].filter((a) => idsNos.has(a.de) && idsNos.has(a.para));
    return { nos, arestas };
  }, [estado, agentes, runsProjeto]);

  // cwd por agente (G2/S4b): e' o worktree do planejador, usado pra decidir se um pedido ainda esta' ativo.
  const cwdDeAgente = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agentes) m.set(a.id, a.cwd);
    return m;
  }, [agentes]);

  // Arestas em conversa (F3 S4): mapa edgeId -> {sentido, balao} a partir de {conversas} do SSE.
  const emConversa = useMemo(
    () => arestasEmConversa(conversas, modelo.arestas),
    [conversas, modelo.arestas],
  );

  // Agente de planejador novo: persistido UMA vez, quando aparece no canvas (id novo no `ag:<id>`).
  useEffect(() => {
    if (bloqueado) return;
    const jaTem = new Set(estado.nos.map((n) => n.id));
    const novos = modelo.nos.filter(
      (n) => n.tipo === "agente" && typeof n.dados.agenteId === "string"
        && !jaTem.has(n.id) && !agentesUpsertados.current.has(n.id),
    );
    if (novos.length === 0) return;
    const rev = Date.now();
    const ops: Op[] = novos.map((n) => {
      agentesUpsertados.current.add(n.id);
      return { op: "upsert", tipo: "no", item: { ...n, rev } };
    });
    enviar(ops);
  }, [modelo, estado, bloqueado, enviar]);

  // Ao trocar de projeto, o proximo grafo carregado merece um enquadramento novo.
  useEffect(() => { ajusteFeito.current = false; }, [projeto]);

  // Primeiro grafo do projeto: enquadra tudo (o `fitView` do componente roda com a lista ainda vazia).
  useEffect(() => {
    if (ajusteFeito.current || modelo.nos.length === 0) return;
    ajusteFeito.current = true;
    const id = window.setTimeout(() => { void instancia.current?.fitView({ maxZoom: 1, padding: 0.25 }); }, 150);
    return () => window.clearTimeout(id);
  }, [modelo]);

  // modelo -> react-flow; grupos primeiro (ficam atras) e, em cada reconstrucao, `measured` (que o
  // xyflow preenche via onNodesChange) e herdado do no' antigo (mesclarNosRf) — sem
  // medida o xyflow nao posiciona as alcas e nenhuma aresta e' desenhada.
  useEffect(() => {
    const porId = new Map(modelo.nos.map((n) => [n.id, n]));
    // Pedido em andamento de uma aresta "pedido" (ag:<pedinte> -> ag:<planejador>): olha o cwd do
    // planejador-alvo e anima enquanto nenhuma run daquele cwd recebeu o painel final (pedidoAtivo).
    const pedidoEmAndamento = (a: Aresta): boolean => {
      const alvo = porId.get(a.para);
      const agId = alvo && alvo.tipo === "agente" && typeof alvo.dados.agenteId === "string" ? alvo.dados.agenteId : "";
      const cwd = agId ? cwdDeAgente.get(agId) ?? "" : "";
      return !!cwd && pedidoAtivo(cwd, runsProjeto);
    };
    const ordenados = [...modelo.nos].sort((a, b) => (a.tipo === "grupo" ? 0 : 1) - (b.tipo === "grupo" ? 0 : 1));
    setNos((antigos) => mesclarNosRf(ordenados.map((n) => noParaRf(n, porId)), antigos));
    setArestas(modelo.arestas.map((a) => arestaParaRf(a, porId, emConversa, pedidoEmAndamento)));
  }, [modelo, emConversa, cwdDeAgente, runsProjeto]);

  // Atalhos de vista: Shift+1 enquadra tudo, Ctrl+0 volta a 100%. Ignorados com foco em campo de texto.
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (emCampo(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.altKey && e.key === "0") { e.preventDefault(); void instancia.current?.zoomTo(1); return; }
      if (!ctrl && e.shiftKey && (e.key === "!" || e.key === "1")) {
        e.preventDefault();
        void instancia.current?.fitView({ maxZoom: 1, padding: 0.25 });
      }
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const buscarNo = (id: string): No | undefined => modelo.nos.find((n) => n.id === id);

  // --- mudancas locais vindas do react-flow: so' medidas (sem mover/selecionar/apagar) ---
  const aoMudarNos = (mudancas: NodeChange<Node>[]) => {
    setNos((ns) => applyNodeChanges(mudancas, ns));
  };

  // --- acoes dos cards (CanvasCtx) ---
  const aoEditar = (id: string, dados: Record<string, unknown>) => {
    if (bloqueado) return;
    const atual = buscarNo(id);
    if (!atual) return;
    enviar([{ op: "upsert", tipo: "no", item: { ...atual, dados: { ...atual.dados, ...dados }, rev: Date.now() } }]);
  };

  const aoRemoverNo = (id: string) => {
    if (bloqueado) return;
    enviar([{ op: "remove", tipo: "no", item: { id, rev: Date.now() } }]);
  };

  /** Alterna dados.fixado do no' (pino do cabecalho do card de agente). */
  const alternarFixados = (ids: string[]) => {
    if (bloqueado || ids.length === 0) return;
    enviar(alternarFixado(modelo.nos, ids, Date.now()));
  };

  // ponytail: canvas so' leitura, entao redimensionar/rotular/editar aresta viram no-op no ctx
  const ctx = {
    nos: modelo.nos,
    bloquear: bloqueado,
    editar: aoEditar,
    removerNo: aoRemoverNo,
    redimensionar: () => {},
    rotular: () => {},
    fixar: (id: string) => { alternarFixados([id]); },
    arestaEditando: null,
    editarAresta: () => {},
  };

  /** Clique num card de run/worker: o painel direito passa a mostrar aquela run (sem selecao). */
  const aoClicarNo = (_e: unknown, node: Node) => {
    const no = buscarNo(node.id);
    const runId = no ? runDaSelecao([no]) : null;
    if (runId) setRunSelId(runId);
  };

  const runPedida = runSelId ? runsProjeto.find((r) => r.id === runSelId) ?? null : null;
  const runMostrada = runPedida ?? runAtivaProjeto;
  const abaPainel = runMostrada && abaPedida?.runId === runMostrada.id ? abaPedida.aba : "feed";
  const arquivoDiff = runMostrada && arquivoPedido?.runId === runMostrada.id ? arquivoPedido.arquivo : null;
  const onRunSelRef = useRef(onRunSel);
  onRunSelRef.current = onRunSel;

  // Avisa o dono da tela quando a run mostrada no painel muda (o relogio nao redispara: o id e' estavel).
  useEffect(() => { onRunSelRef.current?.(runMostrada?.id ?? null); }, [runMostrada?.id]);

  const alternarPainel = () => {
    const h = painelRef.current;
    if (h) (h.isCollapsed() ? h.expand() : h.collapse());
  };

  const ajustarVista = () => {
    void instancia.current?.fitView({ maxZoom: 1, padding: 0.2 });
  };

  // --- F2 S5d: controles do agente (ocultar/encerrar/reabrir), expandir run e diff ---

  /** Upsert de um no' com dados extras (usado pelos controles das runs e dos agentes). */
  const upsertNo = (no: No, dados: Record<string, unknown>) => {
    if (bloqueado) return;
    enviar([{ op: "upsert", tipo: "no", item: { ...no, dados: { ...no.dados, ...dados }, rev: Date.now() } }]);
  };

  /** Expandir/Recolher do card de run: alterna `dados.expandida` do no' run:<id> (upsert). */
  const alternarRun = (runId: string) => {
    const no = buscarNo(`run:${runId}`);
    if (no) upsertNo(no, { expandida: no.dados.expandida !== true });
  };

  /** Clique na slice (G1/S3): alterna `dados.aberta` do no' worker:<id>:<idx> (card ao vivo x compacto). */
  const alternarSlice = (runId: string, idx: number) => {
    const no = buscarNo(`worker:${runId}:${idx}`);
    if (no) upsertNo(no, { aberta: no.dados.aberta !== true });
  };

  /**
   * Abre uma run pelo painel Runs (G1/S4): grava `dados.expandida = true` no card run:<id> e centraliza
   * a vista nele (fitView no proprio card, com folga). O atraso curto deixa o modelo/layout assentar.
   */
  const abrirRun = (runId: string) => {
    setRunSelId(runId);
    const no = buscarNo(`run:${runId}`);
    if (no && no.dados.expandida !== true) upsertNo(no, { expandida: true });
    setTimeout(() => void instancia.current?.fitView({ nodes: [{ id: `run:${runId}` }], maxZoom: 1, padding: 0.4 }), 60);
  };

  /**
   * abrirDiff do card de arquivo (RunsCtx): o painel direito passa a mostrar a run daquele arquivo com
   * a aba Diff aberta nele (no lugar do antigo ModalDiff).
   */
  const abrirDiff = (runId: string, arquivo: string) => {
    setRunSelId(runId);
    setAbaPedida({ runId, aba: "diff" });
    setArquivoPedido({ runId, arquivo });
    // Painel recolhido: abre pra que a aba Diff fique visivel.
    painelRef.current?.expand();
  };

  /**
   * abrirDetalhes (RunsCtx): o painel direito passa a mostrar a run pedida com a aba Detalhes aberta
   * (usada pelo no' Commit da pipeline do card da run).
   */
  const abrirDetalhes = (runId: string) => {
    setRunSelId(runId);
    setAbaPedida({ runId, aba: "detalhes" });
    painelRef.current?.expand();
  };

  const focar = (noId: string) => {
    void instancia.current?.fitView({ nodes: [{ id: noId }], maxZoom: 1, padding: 0.4 });
  };

  useImperativeHandle(ref, () => ({ focar, abrirRun, abrirDiff }), [abrirRun, abrirDiff]);

  /** ✕ do card do agente: abre o dialog de ocultar/encerrar. */
  const pedirFecharAgente = (noId: string, agenteId: string) => setFecharAgente({ noId, agenteId });

  /** Ocultar: o no' sai do canvas (dados.oculto) e pode ser reaberto depois pelo menu. */
  const ocultarAgente = () => {
    const alvo = fecharAgente;
    setFecharAgente(null);
    const no = alvo ? buscarNo(alvo.noId) : undefined;
    if (no) upsertNo(no, { oculto: true });
  };

  /** Encerrar: fala com o hub (useAgentes.encerrar) e some com o no' de vez. */
  const encerrarAgente = () => {
    const alvo = fecharAgente;
    setFecharAgente(null);
    if (!alvo || bloqueado) return;
    encerrar(alvo.agenteId);
    enviar([{ op: "remove", tipo: "no", item: { id: alvo.noId, rev: Date.now() } }]);
  };

  /** Reabrir pelo menu do canto superior direito: tira `dados.oculto` do no'. */
  const reabrirAgente = (no: No) => upsertNo(no, { oculto: false });

  /** "+ Explorador" do menu do agente: cria o no' `exp:<agenteId>` (320x460) a esquerda do agente, ligado a ele. */
  const abrirExplorador = (agenteId: string) => {
    if (bloqueado) return;
    const agNo = buscarNo(`ag:${agenteId}`);
    const w = 320;
    const h = 460;
    const x = agNo ? Math.round(agNo.x - w - 40) : 0;
    const y = agNo ? Math.round(agNo.y) : 0;
    const idExp = `exp:${agenteId}`;
    const rev = Date.now();
    const no: No = { id: idExp, tipo: "explorador", x, y, w, h, dados: { agenteId }, rev };
    const aresta: Aresta = { id: `${idExp}->ag:${agenteId}`, de: idExp, para: `ag:${agenteId}`, rev };
    enviar([
      { op: "upsert", tipo: "no", item: no },
      { op: "upsert", tipo: "aresta", item: aresta },
    ]);
  };

  // Nos 'agente' escondidos (dados.oculto) deste projeto: conteudo do menu "Reabrir agente".
  const agentesOcultos = estado.nos.filter((n) => n.tipo === "agente" && n.dados.oculto === true);
  const nomeAgente = (no: No): string => {
    const id = typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
    return agentes.find((a) => a.id === id)?.nome ?? (id || "agente");
  };

  // Contextos dos cards de agente (S5b) e de run/worker/arquivo (S5c).
  const agentesValor = {
    agentes,
    linhasPorId,
    acoes: { carregarHistorico, mensagem, abortar, reiniciar, trocarModelo, modelos, explorador: abrirExplorador },
    onFechar: pedirFecharAgente,
    assinarPty,
  };
  const runsValor = {
    runs: runsEstado.runs,
    agora,
    alternar: alternarRun,
    alternarSlice,
    abrirDiff,
    abrirRun,
    focar,
    abrirDetalhes,
  };

  return (
    <>
    <ResizablePanelGroup
      orientation="horizontal" className="cv"
      defaultLayout={layout.defaultLayout} onLayoutChanged={layout.onLayoutChanged}
    >
    <ResizablePanel id="grafo" minSize={300}>
    <div ref={container} className="relative h-full w-full overflow-hidden">
      <CanvasCtx.Provider value={ctx}>
      <ProjetoCtx.Provider value={projeto}>
      <AgentesCtx.Provider value={agentesValor}>
      <RunsCtx.Provider value={runsValor}>
        {/* So' visualizacao: arrastar o fundo faz pan, scroll faz zoom; nada de selecionar/mover/conectar. */}
        <ReactFlow
          nodes={nos}
          edges={arestas}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={aoMudarNos}
          onNodeClick={aoClicarNo}
          onInit={(i) => { instancia.current = i; }}
          defaultEdgeOptions={{ type: "rotulo" }}
          minZoom={0.1}
          maxZoom={2}
          zoomOnScroll
          zoomOnDoubleClick={false}
          panOnDrag
          selectionOnDrag={false}
          panOnScroll={false}
          deleteKeyCode={null}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          nodesFocusable={false}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          attributionPosition="bottom-left"
          className="h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#303030" />
          <ControleZoom temNos={modelo.nos.length > 0} onAjustar={ajustarVista} />
          {agentesOcultos.length > 0 && (
            <Panel position="top-right">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button" title="Reabrir agente"
                    className="nodrag nopan rounded-md px-2 py-1 text-xs hover:bg-white/10"
                    style={{ background: "#222", border: "1px solid #303030", color: "#b8b8b8" }}
                  >
                    Reabrir agente
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="cv-menu min-w-40">
                  <DropdownMenuLabel>Reabrir agente</DropdownMenuLabel>
                  {agentesOcultos.map((n) => (
                    <DropdownMenuItem key={n.id} onSelect={() => reabrirAgente(n)}>
                      {nomeAgente(n)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </Panel>
          )}
        </ReactFlow>
      </RunsCtx.Provider>
      </AgentesCtx.Provider>
      </ProjetoCtx.Provider>
      </CanvasCtx.Provider>

      {bloqueado && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-2">
          <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs text-warn">
            <WifiOff className="size-3.5" />reconectando…
          </div>
        </div>
      )}
    </div>
    </ResizablePanel>
    <ResizableHandle />

    {/* Painel direito (tela unida): o PainelRun da run mostrada. Redimensionavel e recolhivel (faixa de 34px). */}
    <ResizablePanel
      id="painel" panelRef={painelRef}
      defaultSize={380} minSize={280} maxSize="60" collapsible collapsedSize={34}
      onResize={() => setPainel(!painelRef.current?.isCollapsed())}
    >
    <aside
      className="flex h-full w-full flex-col overflow-hidden"
      aria-label="Painel"
      style={{ background: "#1c1c1c" }}
    >
      <header
        className="flex h-9 shrink-0 items-center gap-2 px-2"
        style={{ borderBottom: painel ? "1px solid #2c2c2c" : "none" }}
      >
        <button
          type="button"
          title={painel ? "Recolher painel" : "Expandir painel"}
          aria-label={painel ? "Recolher painel" : "Expandir painel"}
          aria-expanded={painel}
          onClick={alternarPainel}
          className="grid size-6 shrink-0 place-items-center rounded hover:bg-white/10"
          style={{ color: "#b8b8b8" }}
        >
          {painel ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
        </button>
        {painel && (
          <span
            className="min-w-0 flex-1 truncate text-xs"
            style={{ color: "#858585" }}
            title={runMostrada?.feature ?? ""}
          >
            {runMostrada?.feature ?? "Painel"}
          </span>
        )}
      </header>

      {painel && (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {runMostrada ? (
            <PainelRun
              run={runMostrada}
              agora={agora}
              arquivoDiff={arquivoDiff}
              onArquivoDiff={(arquivo) => setArquivoPedido({ runId: runMostrada.id, arquivo })}
              aba={abaPainel}
              onAba={(aba) => setAbaPedida({ runId: runMostrada.id, aba })}
            />
          ) : (
            <p className="grid flex-1 place-items-center px-4 text-center text-xs" style={{ color: "#858585" }}>
              Nenhuma run neste projeto
            </p>
          )}
        </div>
      )}
    </aside>
    </ResizablePanel>
    </ResizablePanelGroup>

      {/* ✕ do agente: ocultar (some do canvas) ou encerrar (fala com o hub e remove o no'). */}
      <AlertDialog open={!!fecharAgente} onOpenChange={(o) => { if (!o) setFecharAgente(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ocultar ou encerrar este agente?</AlertDialogTitle>
            <AlertDialogDescription>
              Ocultar tira o agente do canvas (dá para reabrir depois). Encerrar interrompe a sessão do OpenCode e remove o card.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={ocultarAgente}>Ocultar</AlertDialogAction>
            <AlertDialogAction variant="destructive" onClick={encerrarAgente}>Encerrar</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

export default Canvas;
