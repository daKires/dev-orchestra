// Vista Canvas (S4): o grafo do projeto renderizado com @xyflow/react. O modelo do hub (No/Aresta)
// vira nodes/edges, e as edicoes (mover, redimensionar, editar, conectar, apagar, imagem) voltam como
// operacoes pro hub (useCanvas). UI em PT-BR, so' tema escuro.
import { useContext, useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, MarkerType, Panel, ReactFlow, ViewportPortal,
  applyEdgeChanges, applyNodeChanges,
  useReactFlow, useViewport,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type NodeProps, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WifiOff } from "lucide-react";
import {
  alternarFixado, checarImagem, duplicarNos, ferramentaDoAtalho, limitarZoom, mesclarNosRf, noNovo,
  ordemZ, organizarPorTipo, paiDoNo, pontaDaAresta, retanguloDeArrasto, TAMANHO_PADRAO,
  type Ferramenta, type NomeForma,
} from "@/lib/canvas";
import { layoutAgentes, layoutRuns } from "@/lib/layout";
import { runsDoProjeto } from "@/lib/estado";
import { arestasEmConversa, type EmConversa } from "@/lib/colab";
import { cn } from "@/lib/utils";
import { useAgentes } from "@/hooks/useAgentes";
import { useAgora, useRuns } from "@/hooks/useRuns";
import { useCanvas } from "@/hooks/useCanvas";
import type { Aresta, No, Op, Snapshot, TipoNo } from "../../../canvas.ts";
import { Barra } from "./canvas/Barra";
import { Inspetor } from "./canvas/Inspetor";
import { NovoAgente } from "./canvas/NovoAgente";
import { NovoNavegador } from "./canvas/NovoNavegador";
import { MenuContexto, type MenuAcoes, type MenuAlvo } from "./canvas/MenuContexto";
import { CanvasCtx, edgeTypes, nodeTypes as nosNodeTypes } from "./canvas/Nos";
import { AgentesCtx, NoAgente } from "./canvas/Agente";
import { NoClaude } from "./canvas/Claude";
import { RunsCtx, ModalDiff, nodeTypes as runNodeTypes, type Vista } from "./canvas/Run";
import { MIME_ARQUIVO, nodeTypes as exploradorNodeTypes } from "./canvas/Explorador";
import { ProjetoCtx, nodeTypes as navegadorNodeTypes } from "./canvas/Navegador";
import { nodeTypes as painelNodeTypes } from "./canvas/Painel";
import { idProjetoFront } from "@/lib/desktop";
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
// (S5c) + o explorador de arquivos (F3 S5) + o navegador (F4 S6) + o painel de runs (G1 S4).
const nodeTypes = {
  ...nosNodeTypes,
  agente: NoAgenteTipo,
  ...runNodeTypes,
  ...exploradorNodeTypes,
  ...navegadorNodeTypes,
  ...painelNodeTypes,
};

// Modelo (No/Aresta) <-> react-flow (nodes/edges)

// Tipos que tem render proprio; os demais caem no card de nota como fallback.
const TEM_CARD = new Set<TipoNo>(["nota", "imagem", "forma", "grupo", "texto", "agente", "run", "worker", "arquivo", "explorador", "navegador", "painel"]);
const tipoVisual = (t: TipoNo): string => (TEM_CARD.has(t) ? t : "nota");

// Ferramentas que criam um no' por clique/arrasto no pane (as demais so' mudam o modo do canvas).
const FERRAMENTAS_CRIACAO = new Set<Ferramenta>(["nota", "forma", "regiao", "texto"]);

/** Tamanho padrao de uma ferramenta de criacao (so' usado no clique, sem arrasto). */
const padraoDe = (f: Ferramenta): { w: number; h: number } =>
  f === "forma" ? TAMANHO_PADRAO.forma : f === "regiao" ? TAMANHO_PADRAO.regiao : f === "texto" ? TAMANHO_PADRAO.texto : TAMANHO_PADRAO.nota;

/** O alvo do evento e' o fundo do pane (nao um no', alca, aresta ou painel flutuante)? */
const ehPane = (alvo: EventTarget | null): boolean => {
  const el = alvo as HTMLElement | null;
  if (!el || typeof el.closest !== "function") return false;
  if (!el.closest(".react-flow__pane")) return false;
  return !el.closest(".react-flow__node") && !el.closest(".react-flow__handle") &&
    !el.closest(".react-flow__edge") && !el.closest(".react-flow__panel") && !el.closest("button");
};

/** Foco em campo de texto (input/textarea/contenteditable): atalhos de ferramenta nao valem. */
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
function arestaParaRf(a: Aresta, porId: Map<string, No>, emConversa: Record<string, EmConversa>): Edge {
  const comSeta = pontaDaAresta(porId.get(a.de)?.tipo, porId.get(a.para)?.tipo);
  // Agente <-> agente/navegador: ligacao de mao dupla (os dois conversam/controlam), seta nas duas pontas.
  const ehAtor = (t?: string) => t === "agente" || t === "navegador";
  const maoDupla = !comSeta && ehAtor(porId.get(a.de)?.tipo) && ehAtor(porId.get(a.para)?.tipo);
  const seta = { type: MarkerType.ArrowClosed, color: "#606060", width: 16, height: 16 };
  const conv = emConversa[a.id];
  return {
    id: a.id,
    source: a.de,
    target: a.para,
    type: "rotulo",
    data: { rotulo: a.rotulo ?? "", conversa: conv },
    animated: !!conv,
    className: conv?.sentido === "reverso" ? "cv-anim-reversa" : undefined,
    markerStart: maoDupla ? seta : undefined,
    markerEnd: comSeta || maoDupla ? seta : undefined,
  };
}

const novoId = (prefixo: string) => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** Slug de um nome (minusculas, sem acento, separador '-'): mesmo slugNome do hub, sem node:path. */
const slugDe = (nome: string): string =>
  nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// dataURL -> so' a parte base64 (o hub espera dadosB64 puro).
function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result ?? ""); ok(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = () => falha(new Error("falha ao ler o arquivo"));
    fr.readAsDataURL(arquivo);
  });
}

// Controle de zoom proprio (canto inferior direito): −  N%  +

function ControleZoom() {
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
    </Panel>
  );
}

// Canvas

export function Canvas({ projeto }: { projeto: string }) {
  const { estado, conectado, enviar, desfazer, refazer } = useCanvas(projeto);
  const [nos, setNos] = useState<Node[]>([]);
  const [arestas, setArestas] = useState<Edge[]>([]);
  const [arestaEditando, setArestaEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [formaPendente, setFormaPendente] = useState<NomeForma>("retangulo");
  const [espaco, setEspaco] = useState(false);
  const [arrasto, setArrasto] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [origemSeta, setOrigemSeta] = useState<string | null>(null);
  const [alvoMenu, setAlvoMenu] = useState<MenuAlvo | null>(null);
  const bloqueado = !conectado; // sem SSE vivo: so' leitura ("reconectando…")
  const container = useRef<HTMLDivElement | null>(null);
  const instancia = useRef<ReactFlowInstance | null>(null);
  const ajusteFeito = useRef(false);
  // Clipboard em memoria do Ctrl+C/Ctrl+V (nos selecionados + quantas colagens ja' sairam).
  const clipboard = useRef<{ ids: string[]; colagens: number } | null>(null);
  // `bloqueado` lido pelo handler de atalhos (o listener e' montado uma vez, deps []).
  const bloqueadoRef = useRef(bloqueado);
  bloqueadoRef.current = bloqueado;
  // Handler de atalhos reassinado a cada render (le estado/selecao atuais sem reassinar o listener).
  const atalhos = useRef<(e: KeyboardEvent) => boolean>(() => false);

  // --- F2 S5d: runs do projeto, agentes e relogio (o layout automatico entra no `modelo` abaixo) ---
  const { agentes, linhasPorId, conversas, carregarHistorico, mensagem, abortar, encerrar, reiniciar, trocarModelo, modelos, assinarPty } = useAgentes(projeto);
  const { estado: runsEstado } = useRuns();
  const agora = useAgora();
  const [fecharAgente, setFecharAgente] = useState<{ noId: string; agenteId: string } | null>(null);
  const [novoAgenteAberto, setNovoAgenteAberto] = useState(false);
  const [novoNavegadorAberto, setNovoNavegadorAberto] = useState(false);
  const [diff, setDiff] = useState<{ runId: string; arquivo: string } | null>(null);
  // Agentes de planejador JA' persistidos uma vez (nao re-upsertamos a cada render).
  const agentesUpsertados = useRef<Set<string>>(new Set());

  // Runs deste canvas: mesma raiz do projeto (worktree conta como o projeto).
  const runsProjeto = useMemo(
    () => runsDoProjeto(Object.values(runsEstado.runs), projeto),
    [runsEstado, projeto],
  );

  // Modelo exibido = snapshot (MENOS os nos ocultos) + layout das runs + layout dos agentes.
  // O id que ja' esta' no snapshot SEMPRE vence (nada de duplicar). As arestas do layout entram so' se
  // forem novas (as do snapshot ganham).
  const modelo = useMemo<Snapshot>(() => {
    const ocultos = new Set(estado.nos.filter((n) => n.dados?.oculto === true).map((n) => n.id));
    const visiveis = estado.nos.filter((n) => !ocultos.has(n.id));
    const lr = layoutRuns(runsProjeto, estado);
    const la = layoutAgentes(agentes, estado);
    const jaTem = new Set(estado.nos.map((n) => n.id));
    const extras: No[] = [];
    for (const n of [...lr.nos, ...la]) {
      if (jaTem.has(n.id)) continue;
      jaTem.add(n.id);
      extras.push(n);
    }
    const nos = [...visiveis, ...extras];
    const idsNos = new Set(nos.map((n) => n.id));
    const idsArestas = new Set(estado.arestas.map((a) => a.id));
    const arestasExtras: Aresta[] = lr.arestas
      .filter((a) => !idsArestas.has(a.id))
      .map((a) => ({ id: a.id, de: a.de, para: a.para, rev: 0 }));
    // Arestas do snapshot + as do layout, descartando as que ficaram orfas (ponta oculta/inexistente).
    const arestas = [...estado.arestas, ...arestasExtras].filter((a) => idsNos.has(a.de) && idsNos.has(a.para));
    return { nos, arestas };
  }, [estado, agentes, runsProjeto]);

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

  // Ferramenta efetiva: segurar Espaco vira "mao" temporariamente (como no Castor).
  const efetiva: Ferramenta = espaco ? "mao" : ferramenta;
  const criando = FERRAMENTAS_CRIACAO.has(efetiva);
  const selecionando = efetiva === "selecionar";

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
  // xyflow preenche via onNodesChange) e a selecao sao herdados do no' antigo (mesclarNosRf) — sem
  // medida o xyflow nao posiciona as alcas e nenhuma aresta e' desenhada.
  useEffect(() => {
    const porId = new Map(modelo.nos.map((n) => [n.id, n]));
    const ordenados = [...modelo.nos].sort((a, b) => (a.tipo === "grupo" ? 0 : 1) - (b.tipo === "grupo" ? 0 : 1));
    setNos((antigos) => mesclarNosRf(ordenados.map((n) => noParaRf(n, porId)), antigos));
    setArestas((antigas) => {
      const sel = new Set(antigas.filter((a) => a.selected).map((a) => a.id));
      return modelo.arestas.map((a) => {
        const rf = arestaParaRf(a, porId, emConversa);
        if (sel.has(a.id)) rf.selected = true;
        return rf;
      });
    });
  }, [modelo, emConversa]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4200);
    return () => clearTimeout(t);
  }, [aviso]);

  // Atalhos das ferramentas (V/H/N/R/C/T). Espaco = mao temporaria; Esc cancela e volta a selecionar.
  // Ignorados com foco em input/textarea (o title/corpo dos cards continuam digitaveis).
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (emCampo(e.target)) return;
      if (atalhos.current(e)) return; // Delete/Backspace, Ctrl+D/A/C/V/0, Shift+1
      if (e.key === " " || e.code === "Space") { setEspaco(true); return; }
      if (e.key === "Escape") {
        setArrasto(null); setOrigemSeta(null); setFerramenta("selecionar");
        setNos((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
        setArestas((es) => es.map((a) => (a.selected ? { ...a, selected: false } : a)));
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === "a") { if (!bloqueadoRef.current) setNovoAgenteAberto(true); return; }
      if (e.key.toLowerCase() === "b") { if (!bloqueadoRef.current) setNovoNavegadorAberto(true); return; }
      const f = ferramentaDoAtalho(e.key);
      if (f) { setOrigemSeta(null); setFerramenta(f); }
    };
    const aoSoltarTecla = (e: KeyboardEvent) => {
      if (e.key === " " || e.code === "Space") setEspaco(false);
    };
    window.addEventListener("keydown", aoTeclar);
    window.addEventListener("keyup", aoSoltarTecla);
    return () => {
      window.removeEventListener("keydown", aoTeclar);
      window.removeEventListener("keyup", aoSoltarTecla);
    };
  }, []);

  const buscarNo = (id: string): No | undefined => modelo.nos.find((n) => n.id === id);

  // --- mudancas locais vindas do react-flow (mover/redimensionar/selecionar/apagar) ---
  const aoMudarNos = (mudancas: NodeChange<Node>[]) => {
    setNos((ns) => applyNodeChanges(mudancas, ns));
    const ops: Op[] = [];
    for (const c of mudancas) if (c.type === "remove") ops.push({ op: "remove", tipo: "no", item: { id: c.id, rev: Date.now() } });
    if (ops.length && !bloqueado) enviar(ops);
  };

  const aoMudarArestas = (mudancas: EdgeChange<Edge>[]) => {
    setArestas((es) => applyEdgeChanges(mudancas, es));
    const ops: Op[] = [];
    for (const c of mudancas) if (c.type === "remove") ops.push({ op: "remove", tipo: "aresta", item: { id: c.id, rev: Date.now() } });
    if (ops.length && !bloqueado) enviar(ops);
  };

  // --- conexoes: arrastar de uma alca a outra cria a aresta ---
  const aoConectar = (c: Connection) => {
    if (bloqueado) return;
    enviar([{ op: "upsert", tipo: "aresta", item: { id: novoId("e"), de: c.source, para: c.target, rev: Date.now() } }]);
  };

  // --- soltar um no': define/limpa o pai (paiDoNo) e persiste as posicoes ABSOLUTAS ---
  const aoSoltarNo = (_e: unknown, node: Node, arrastados: Node[]) => {
    if (bloqueado) return;
    const porId = new Map(modelo.nos.map((n) => [n.id, n]));
    const agora = Date.now();
    const lista = arrastados?.length ? arrastados : [node];

    // 1) posicao ABSOLUTA de cada no' solto (relativa + posicao absoluta do pai no modelo).
    const novas = new Map<string, { x: number; y: number }>();
    for (const rfNo of lista) {
      if (novas.has(rfNo.id)) continue;
      const atual = porId.get(rfNo.id);
      if (!atual) continue;
      const paiRf = rfNo.parentId ? porId.get(rfNo.parentId) : undefined;
      novas.set(rfNo.id, { x: rfNo.position.x + (paiRf?.x ?? 0), y: rfNo.position.y + (paiRf?.y ?? 0) });
    }

    // 2) grupos ja' na posicao nova (senao um filho de grupo arrastado pareceria ter saido do pai).
    const grupos: No[] = modelo.nos
      .filter((n) => n.tipo === "grupo")
      .map((g) => (novas.has(g.id) ? { ...g, ...novas.get(g.id)! } : g));

    const ops: Op[] = [];
    for (const [id, pos] of novas) {
      const atual = porId.get(id);
      if (!atual) continue;
      const candidato: No = { ...atual, x: pos.x, y: pos.y };
      const pai = paiDoNo(candidato, grupos);
      ops.push({ op: "upsert", tipo: "no", item: { ...candidato, pai, rev: agora } });
    }

    // 3) arrastar um grupo leva os filhos junto: reescreve a posicao absoluta deles pelo delta.
    for (const [id, pos] of novas) {
      const atual = porId.get(id);
      if (!atual || atual.tipo !== "grupo") continue;
      const dx = pos.x - atual.x;
      const dy = pos.y - atual.y;
      if (!dx && !dy) continue;
      for (const filho of modelo.nos) {
        if (filho.pai !== id || novas.has(filho.id)) continue;
        ops.push({ op: "upsert", tipo: "no", item: { ...filho, x: filho.x + dx, y: filho.y + dy, rev: agora } });
      }
    }

    if (ops.length) enviar(ops);
  };

  // --- edicoes pontuais ---
  const aoRedimensionar = (id: string, largura: number, altura: number) => {
    if (bloqueado) return;
    const atual = buscarNo(id);
    if (!atual) return;
    enviar([{ op: "upsert", tipo: "no", item: { ...atual, w: Math.max(40, Math.round(largura)), h: Math.max(30, Math.round(altura)), rev: Date.now() } }]);
  };

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

  const aoRotular = (id: string, rotulo: string) => {
    if (bloqueado) return;
    const atual = modelo.arestas.find((a) => a.id === id);
    if (!atual) return;
    const limpo = rotulo.trim();
    enviar([{ op: "upsert", tipo: "aresta", item: { ...atual, rotulo: limpo || undefined, rev: Date.now() } }]);
  };

  // --- selecao / inspetor (S3) ---
  /** Desmarca tudo: fecha o inspetor (Esc, ✕ ou depois de agrupar/apagar). */
  const deselecionar = () => {
    setNos((ns) => ns.map((n) => (n.selected ? { ...n, selected: false } : n)));
    setArestas((es) => es.map((a) => (a.selected ? { ...a, selected: false } : a)));
  };

  /** Remove em lote (painel "N itens" ou Delete). */
  const apagarSelecao = (alvos: { nos: string[]; arestas: string[] }) => {
    if (bloqueado) return;
    const rev = Date.now();
    const ops: Op[] = [
      ...alvos.nos.map((id): Op => ({ op: "remove", tipo: "no", item: { id, rev } })),
      ...alvos.arestas.map((id): Op => ({ op: "remove", tipo: "aresta", item: { id, rev } })),
    ];
    if (ops.length) enviar(ops);
    deselecionar();
  };

  /** Cria uma regiao ao redor dos nos escolhidos e os torna filhos dela. */
  const agruparSelecao = (ids: string[]) => {
    if (bloqueado || ids.length === 0) return;
    const escolhidos = modelo.nos.filter((n) => ids.includes(n.id));
    if (escolhidos.length === 0) return;
    const pad = 24;
    const minX = Math.min(...escolhidos.map((n) => n.x)) - pad;
    const maxX = Math.max(...escolhidos.map((n) => n.x + n.w)) + pad;
    const minY = Math.min(...escolhidos.map((n) => n.y)) - pad - 22; // espaco pro titulo da regiao
    const maxY = Math.max(...escolhidos.map((n) => n.y + n.h)) + pad;
    const id = novoId("g");
    const rev = Date.now();
    const grupo: No = { id, tipo: "grupo", x: minX, y: minY, w: maxX - minX, h: maxY - minY, dados: { titulo: "Região", cor: "lilas" }, rev };
    const ops: Op[] = [{ op: "upsert", tipo: "no", item: grupo }];
    for (const n of escolhidos) ops.push({ op: "upsert", tipo: "no", item: { ...n, pai: id, rev } });
    enviar(ops);
    deselecionar();
  };

  // --- duplicar / copiar-colar / ordem z (S3b) ---
  /** Ids dos nos selecionados no momento (a partir da selecao do react-flow). */
  const idsSelecionados = () => nos.filter((n) => n.selected).map((n) => n.id);

  /** Duplica os nos de `ids` (+ filhos de grupos e arestas internas) com `desloc` px; upsert. */
  const duplicarCom = (ids: string[], desloc: number): boolean => {
    if (bloqueado || ids.length === 0) return false;
    const copia = duplicarNos({ nos: modelo.nos, arestas: modelo.arestas }, ids, () => novoId("d"), desloc);
    if (copia.nos.length === 0 && copia.arestas.length === 0) return false;
    const rev = Date.now();
    const ops: Op[] = [
      ...copia.nos.map((n): Op => ({ op: "upsert", tipo: "no", item: { ...n, rev } })),
      ...copia.arestas.map((a): Op => ({ op: "upsert", tipo: "aresta", item: { ...a, rev } })),
    ];
    enviar(ops);
    return true;
  };

  /** Ctrl+A: marca todos os nos e arestas. */
  const selecionarTudo = () => {
    setNos((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true })));
    setArestas((es) => es.map((a) => (a.selected ? a : { ...a, selected: true })));
  };

  /** Ctrl+C: guarda os nos selecionados no clipboard em memoria. */
  const copiarSelecao = () => {
    const ids = idsSelecionados();
    if (ids.length) clipboard.current = { ids, colagens: 0 };
  };

  /** Ctrl+V / menu Colar: cola o clipboard deslocando +24 a cada colagem. */
  const colarClipboard = (): boolean => {
    const cb = clipboard.current;
    if (!cb) return false;
    if (!duplicarCom(cb.ids, 24 * (cb.colagens + 1))) return false;
    clipboard.current = { ids: cb.ids, colagens: cb.colagens + 1 };
    return true;
  };

  /** Traz/envia um no' pra frente/tras (ordemZ -> upsert com dados.z). */
  const mudarOrdem = (id: string, onde: "frente" | "tras") => {
    if (bloqueado) return;
    const alterados = ordemZ(modelo.nos, [id], onde);
    if (alterados.length) enviar(alterados.map((n): Op => ({ op: "upsert", tipo: "no", item: n })));
  };

  /**
   * Auto-organiza o canvas em faixas por tipo (organizarPorTipo), respeitando os cards fixados.
   * `enviar` registra UMA acao no historico (Ctrl+Z desfaz tudo de uma vez); depois o enquadramento
   * ajusta a vista pro novo arranjo. Nada mudou -> nenhuma op e nada de fitView.
   */
  const organizar = () => {
    const ops = organizarPorTipo(modelo.nos, Date.now());
    if (ops.length) {
      enviar(ops);
      setTimeout(() => instancia.current?.fitView({ maxZoom: 1, padding: 0.2 }), 50);
    } else if (modelo.nos.length) setAviso("Nada para organizar.");
  };

  /** Alterna dados.fixado dos nos escolhidos (fixados ficam de fora do auto-organizar). */
  const alternarFixados = (ids: string[]) => {
    if (bloqueado || ids.length === 0) return;
    enviar(alternarFixado(modelo.nos, ids, Date.now()));
  };

  /** Nova nota na posicao (plano do canvas) do clique direito no vazio. */
  const novaNotaEm = (x: number, y: number) => {
    if (bloqueado) return;
    const no = noNovo("nota", { x, y, w: TAMANHO_PADRAO.nota.w, h: TAMANHO_PADRAO.nota.h }, novoId("n"));
    if (no) enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  // Atalhos de edicao do canvas (o listener chama este handler reassinado a cada render).
  atalhos.current = (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    // Delete/Backspace apaga a selecao (nos + arestas).
    if (e.key === "Delete" || e.key === "Backspace") {
      const alvos = { nos: idsSelecionados(), arestas: arestas.filter((a) => a.selected).map((a) => a.id) };
      if (alvos.nos.length === 0 && alvos.arestas.length === 0) return false;
      e.preventDefault();
      apagarSelecao(alvos);
      return true;
    }
    if (ctrl && !e.altKey) {
      const k = e.key.toLowerCase();
      // Desfazer/refazer locais: Ctrl+Z desfaz; Ctrl+Shift+Z e Ctrl+Y refazem.
      if (k === "z") {
        if (bloqueado) return false;
        e.preventDefault();
        if (e.shiftKey) refazer(); else desfazer();
        return true;
      }
      if (k === "y") {
        if (bloqueado) return false;
        e.preventDefault();
        refazer();
        return true;
      }
      if (k === "d") { if (duplicarCom(idsSelecionados(), 24)) { e.preventDefault(); return true; } return false; }
      if (k === "a") { e.preventDefault(); selecionarTudo(); return true; }
      if (k === "c") { copiarSelecao(); return true; }
      if (k === "v") { if (colarClipboard()) { e.preventDefault(); return true; } return false; }
      if (k === "0") { e.preventDefault(); void instancia.current?.zoomTo(1); return true; }
    }
    if (!ctrl && e.shiftKey) {
      const k = e.key.toLowerCase();
      // Shift+O: auto-organiza em faixas por tipo (respeitando os fixados). Shift+F: fixa/desafixa.
      if (k === "o") { e.preventDefault(); organizar(); return true; }
      if (k === "f") {
        const ids = idsSelecionados();
        if (ids.length === 0) return false;
        if (bloqueado) return false;
        e.preventDefault();
        alternarFixados(ids);
        return true;
      }
      if (e.key === "!" || e.key === "1") {
        e.preventDefault();
        void instancia.current?.fitView({ maxZoom: 1, padding: 0.25 });
        return true;
      }
    }
    return false;
  };

  // --- criacao de nos por clique/arrasto no pane (S2) ---
  const centro = (cliente?: { x: number; y: number }) => {
    const inst = instancia.current;
    if (cliente && inst) return inst.screenToFlowPosition(cliente);
    const caixa = container.current?.getBoundingClientRect();
    if (inst && caixa) return inst.screenToFlowPosition({ x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2 });
    return { x: 0, y: 0 };
  };

  /** Cria o no' da ferramenta no retangulo do clique/arrasto e volta pra "selecionar". */
  const criarPelaFerramenta = (f: Ferramenta, a: { x: number; y: number }, b: { x: number; y: number }) => {
    if (bloqueado) return;
    const ret = retanguloDeArrasto(a, b, padraoDe(f));
    const no = noNovo(f, ret, novoId("n"), { forma: formaPendente });
    if (!no) return;
    const ops: Op[] = [{ op: "upsert", tipo: "no", item: no }];
    // Regiao: os nos inteiramente dentro dela viram filhos (o menor grupo que contem vence).
    if (f === "regiao") {
      const agora = Date.now();
      const grupos = [...modelo.nos.filter((n) => n.tipo === "grupo"), no];
      for (const n of modelo.nos) {
        if (n.tipo === "grupo" || n.pai === no.id) continue;
        if (paiDoNo(n, grupos) === no.id) ops.push({ op: "upsert", tipo: "no", item: { ...n, pai: no.id, rev: agora } });
      }
    }
    enviar(ops);
    setFerramenta("selecionar");
  };

  const aoApontarPane = (e: ReactPointerEvent) => {
    if (e.button !== 0 || !criando) return;
    if (!ehPane(e.target)) return;
    const inst = instancia.current;
    if (!inst) return;
    const p = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setArrasto({ a: p, b: p });
  };

  const aoMoverPane = (e: ReactPointerEvent) => {
    if (!arrasto) return;
    const inst = instancia.current;
    if (!inst) return;
    const b = inst.screenToFlowPosition({ x: e.clientX, y: e.clientY });
    setArrasto((atual) => (atual ? { a: atual.a, b } : atual));
  };

  const aoSoltarPane = (e: ReactPointerEvent) => {
    if (!arrasto) return;
    const a = arrasto.a;
    setArrasto(null);
    if (e.button !== 0 || !criando) return;
    const inst = instancia.current;
    if (!inst) return;
    criarPelaFerramenta(efetiva, a, inst.screenToFlowPosition({ x: e.clientX, y: e.clientY }));
  };

  /** Ferramenta "seta": 1o clique escolhe a origem, 2o cria a aresta origem->destino. */
  const aoClicarNo = (_e: unknown, node: Node) => {
    if (ferramenta !== "seta" || bloqueado) return;
    if (!origemSeta) { setOrigemSeta(node.id); return; }
    if (origemSeta === node.id) { setOrigemSeta(null); return; }
    enviar([{ op: "upsert", tipo: "aresta", item: { id: novoId("e"), de: origemSeta, para: node.id, rev: Date.now() } }]);
    setOrigemSeta(null);
  };

  const retArrasto = arrasto ? retanguloDeArrasto(arrasto.a, arrasto.b, padraoDe(ferramenta)) : null;

  // --- imagem por drop de arquivo ou Ctrl+V ---
  const criarImagem = async (arquivo: File, cliente?: { x: number; y: number }) => {
    if (bloqueado) return;
    const problema = checarImagem(arquivo.name, arquivo.size);
    if (problema) { setAviso(problema); return; }
    let dadosB64: string;
    try { dadosB64 = await lerBase64(arquivo); } catch { setAviso("Não foi possível ler o arquivo de imagem."); return; }
    let url = "";
    try {
      const r = await fetch("/canvas/asset", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify({ projeto, nome: arquivo.name, dadosB64 }),
      });
      if (!r.ok) { setAviso("O hub recusou a imagem (confira o formato e o tamanho máximo)."); return; }
      const j = (await r.json()) as { url?: string };
      url = j.url ?? "";
    } catch { setAviso("Falha de rede ao enviar a imagem."); return; }
    if (!url) { setAviso("O hub não devolveu a URL da imagem enviada."); return; }
    const p = centro(cliente);
    const w = 220;
    const h = 160;
    const agora = Date.now();
    const no: No = { id: novoId("n"), tipo: "imagem", x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, dados: { url, nome: arquivo.name }, rev: agora };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  /** Card 'arquivo' solto no canvas a partir do Explorador: guarda o agente + caminho (previa no clique). */
  const criarArquivoNo = (agenteId: string, caminho: string, cliente?: { x: number; y: number }) => {
    if (bloqueado) return;
    const p = centro(cliente);
    const w = 240;
    const h = 56;
    const no: No = {
      id: novoId("arq"), tipo: "arquivo",
      x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h,
      dados: { agenteId, caminho, status: "referência" }, rev: Date.now(),
    };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  const aoSoltarArquivo = (e: DragEvent) => {
    e.preventDefault();
    // Arrasto de um arquivo do Explorador: vira um no' 'arquivo' com dados {agenteId, caminho, status}.
    const bruto = e.dataTransfer?.getData(MIME_ARQUIVO);
    if (bruto) {
      try {
        const j = JSON.parse(bruto) as { agenteId?: unknown; caminho?: unknown };
        if (typeof j.agenteId === "string" && j.agenteId && typeof j.caminho === "string" && j.caminho) {
          criarArquivoNo(j.agenteId, j.caminho, { x: e.clientX, y: e.clientY });
          return;
        }
      } catch {}
    }
    const arquivo = e.dataTransfer?.files?.[0];
    if (arquivo) void criarImagem(arquivo, { x: e.clientX, y: e.clientY });
  };

  // Ctrl+V: le a imagem do clipboard (via ref pra nao reassinar o listener a cada render).
  const colar = useRef<(e: ClipboardEvent) => void>(() => {});
  colar.current = (e: ClipboardEvent) => {
    if (bloqueado) return;
    const itens = e.clipboardData?.items;
    if (!itens) return;
    for (let i = 0; i < itens.length; i++) {
      const item = itens[i];
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const arquivo = item.getAsFile();
        if (arquivo) { e.preventDefault(); void criarImagem(arquivo); return; }
      }
    }
  };
  useEffect(() => {
    const h = (e: ClipboardEvent) => colar.current(e);
    window.addEventListener("paste", h);
    return () => window.removeEventListener("paste", h);
  }, []);

  const ctx = {
    nos: modelo.nos,
    bloquear: bloqueado,
    editar: aoEditar,
    removerNo: aoRemoverNo,
    redimensionar: aoRedimensionar,
    rotular: aoRotular,
    fixar: (id: string) => { alternarFixados([id]); },
    arestaEditando,
    editarAresta: setArestaEditando,
  };

  // Menu de contexto: no' do alvo (tipo/paleta) e as acoes que ele chama de volta.
  const noDoMenu = alvoMenu?.tipo === "no" ? modelo.nos.find((n) => n.id === alvoMenu.id) : undefined;
  const acoesMenu: MenuAcoes = {
    duplicar: (id) => { duplicarCom([id], 24); },
    mudarCor: (id, cor) => aoEditar(id, { cor }),
    paraFrente: (id) => mudarOrdem(id, "frente"),
    paraTras: (id) => mudarOrdem(id, "tras"),
    apagar: aoRemoverNo,
    novaNota: novaNotaEm,
    colar: () => { colarClipboard(); },
  };

  // Itens selecionados (modelo): o inspetor decide o painel a partir daqui.
  const idsNos = new Set(nos.filter((n) => n.selected).map((n) => n.id));
  const idsArestas = new Set(arestas.filter((a) => a.selected).map((a) => a.id));
  const nosSelecionados = modelo.nos.filter((n) => idsNos.has(n.id));
  const arestasSelecionadas = modelo.arestas.filter((a) => idsArestas.has(a.id));

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

  /** Arvore|Fluxo do card de run (G1/S3): grava `dados.vista` do no' run:<id> (mesmo upsert do expandir). */
  const trocarVista = (runId: string, vista: Vista) => {
    const no = buscarNo(`run:${runId}`);
    if (no) upsertNo(no, { vista });
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
    const no = buscarNo(`run:${runId}`);
    if (no && no.dados.expandida !== true) upsertNo(no, { expandida: true });
    setTimeout(() => void instancia.current?.fitView({ nodes: [{ id: `run:${runId}` }], maxZoom: 1, padding: 0.4 }), 60);
  };

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

  /** Cria o no' `ag:<id>` (620x420) do agente recem-criado no hub, no centro visivel do canvas. */
  const criarAgenteNo = (agenteId: string) => {
    if (bloqueado) return;
    const p = centro();
    const w = 620;
    const h = 420;
    const no: No = {
      id: `ag:${agenteId}`, tipo: "agente",
      x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h,
      dados: { agenteId }, rev: Date.now(),
    };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  /** "+ Navegador" (atalho B): no' `nav:<slug>` (900x620) no centro visivel, com a url do dialog. */
  const criarNavegadorNo = (nome: string, url: string) => {
    if (bloqueado) return;
    const p = centro();
    const w = 900;
    const h = 620;
    const base = "nav:" + slugDe(nome);
    let id = base;
    let k = 1;
    while (modelo.nos.some((n) => n.id === id)) { k++; id = base + "-" + k; }
    const no: No = {
      id, tipo: "navegador",
      x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h,
      dados: { nome, url }, rev: Date.now(),
    };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  /**
   * Botao "Runs" da barra (G1/S4): cria o no' `painel:<id do projeto>` (820x520) no centro visivel do
   * canvas. Se o painel deste projeto ja' existir, apenas centraliza nele (fitView), sem duplicar.
   * O id do projeto e' o mesmo sha1 do hub (idProjetoFront), entao o painel nao se mistura entre projetos.
   */
  const abrirPainel = async () => {
    if (bloqueado) return;
    const id = `painel:${await idProjetoFront(projeto)}`;
    if (modelo.nos.some((n) => n.id === id)) {
      void instancia.current?.fitView({ nodes: [{ id }], maxZoom: 1, padding: 0.4 });
      return;
    }
    const p = centro();
    const w = 820;
    const h = 520;
    const no: No = {
      id, tipo: "painel",
      x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h,
      dados: { projeto }, rev: Date.now(),
    };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

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
    vista: trocarVista,
    alternarSlice,
    abrirDiff: (runId: string, arquivo: string) => setDiff({ runId, arquivo }),
    abrirRun,
  };

  // Diff aberto pelo card de arquivo (ModalDiff controlado por estado local).
  const runDoDiff = diff ? runsEstado.runs[diff.runId] : undefined;
  const patchDiff = diff && runDoDiff ? runDoDiff.diffs[diff.arquivo] ?? "" : "";

  return (
    <MenuContexto alvo={alvoMenu} no={noDoMenu} acoes={acoesMenu} onFechar={() => setAlvoMenu(null)}>
    <div
      ref={container}
      className={cn("cv relative h-full w-full", criando && "cv-pane-criacao", efetiva === "mao" && "cv-pane-mao")}
    >
      <CanvasCtx.Provider value={ctx}>
      <ProjetoCtx.Provider value={projeto}>
      <AgentesCtx.Provider value={agentesValor}>
      <RunsCtx.Provider value={runsValor}>
        <ReactFlow
          nodes={nos}
          edges={arestas}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          onNodesChange={aoMudarNos}
          onEdgesChange={aoMudarArestas}
          onConnect={aoConectar}
          onNodeDragStop={aoSoltarNo}
          onNodeClick={aoClicarNo}
          onEdgeDoubleClick={(_e, a) => setArestaEditando(a.id)}
          onPaneClick={() => { setArestaEditando(null); if (ferramenta === "seta") setOrigemSeta(null); }}
          onNodeContextMenu={(e, node) => {
            e.preventDefault();
            setAlvoMenu({ tipo: "no", id: node.id, x: e.clientX, y: e.clientY });
          }}
          onPaneContextMenu={(e) => {
            e.preventDefault();
            const p = instancia.current?.screenToFlowPosition({ x: e.clientX, y: e.clientY }) ?? { x: 0, y: 0 };
            setAlvoMenu({ tipo: "pane", x: e.clientX, y: e.clientY, fx: p.x, fy: p.y });
          }}
          onInit={(i) => { instancia.current = i; }}
          onPointerDown={aoApontarPane}
          onPointerMove={aoMoverPane}
          onPointerUp={aoSoltarPane}
          onDrop={aoSoltarArquivo}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; }}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={{ type: "rotulo" }}
          minZoom={0.1}
          maxZoom={2}
          zoomOnScroll
          zoomOnDoubleClick={false}
          panOnDrag={efetiva === "mao" ? true : selecionando ? [1] : false}
          selectionOnDrag={selecionando}
          panOnScroll={false}
          deleteKeyCode={null}
          nodesDraggable={!bloqueado}
          nodesConnectable={!bloqueado && !criando && ferramenta !== "seta"}
          elementsSelectable={!bloqueado}
          nodesFocusable={!bloqueado}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          attributionPosition="bottom-left"
          className="h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="#303030" />
          <ControleZoom />
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
          {retArrasto && (
            <ViewportPortal>
              <div
                className="pointer-events-none absolute"
                style={{
                  transform: `translate(${retArrasto.x}px, ${retArrasto.y}px)`,
                  width: retArrasto.w,
                  height: retArrasto.h,
                  border: "1.5px dashed var(--cv-selecao)",
                  background: "color-mix(in oklab, var(--cv-selecao) 12%, transparent)",
                  borderRadius: 4,
                }}
              />
            </ViewportPortal>
          )}
        </ReactFlow>
      </RunsCtx.Provider>
      </AgentesCtx.Provider>
      </ProjetoCtx.Provider>
      </CanvasCtx.Provider>

      <Barra
        bloquear={bloqueado}
        ferramenta={ferramenta}
        onOrganizar={organizar}
        onFerramenta={(f) => { setOrigemSeta(null); setFerramenta(f); }}
        onForma={(forma) => { setFormaPendente(forma); setOrigemSeta(null); setFerramenta("forma"); }}
        onImagem={(arquivo) => void criarImagem(arquivo)}
        onAgente={() => setNovoAgenteAberto(true)}
        onNavegador={() => setNovoNavegadorAberto(true)}
        onPainel={() => void abrirPainel()}
      />

      <NovoAgente
        aberto={novoAgenteAberto}
        onAberto={setNovoAgenteAberto}
        projeto={projeto}
        agentes={agentes}
        modelos={modelos}
        onCriar={criarAgenteNo}
      />

      <NovoNavegador
        aberto={novoNavegadorAberto}
        onAberto={setNovoNavegadorAberto}
        onCriar={criarNavegadorNo}
      />

      <Inspetor
        nos={nosSelecionados}
        arestas={arestasSelecionadas}
        bloquear={bloqueado}
        editar={aoEditar}
        rotular={aoRotular}
        apagar={apagarSelecao}
        agrupar={agruparSelecao}
        fechar={deselecionar}
      />

      {bloqueado && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-center p-2">
          <div className="flex items-center gap-2 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs text-warn">
            <WifiOff className="size-3.5" />reconectando…
          </div>
        </div>
      )}

      {aviso && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-30 flex justify-center">
          <div className="rounded-md border border-destructive/40 bg-destructive/15 px-3 py-1.5 text-xs text-destructive">{aviso}</div>
        </div>
      )}

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

      {/* Diff do arquivo aberto pelo card de arquivo (controlado por estado local). */}
      <ModalDiff aberto={!!diff} patch={patchDiff} arquivo={diff?.arquivo ?? ""} onFechar={() => setDiff(null)} />
    </div>
    </MenuContexto>
  );
}

export default Canvas;
