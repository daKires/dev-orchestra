// Vista Canvas (S4): o grafo do projeto renderizado com @xyflow/react. O modelo do hub (No/Aresta)
// vira nodes/edges, e as edicoes (mover, redimensionar, editar, conectar, apagar, imagem) voltam como
// operacoes pro hub (useCanvas). UI em PT-BR, so' tema escuro.
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, MarkerType, Panel, ReactFlow, ViewportPortal,
  applyEdgeChanges, applyNodeChanges,
  useReactFlow, useViewport,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WifiOff } from "lucide-react";
import {
  checarImagem, ferramentaDoAtalho, limitarZoom, noNovo, paiDoNo, pontaDaAresta, retanguloDeArrasto,
  TAMANHO_PADRAO, type Ferramenta, type NomeForma,
} from "@/lib/canvas";
import { cn } from "@/lib/utils";
import { useCanvas } from "@/hooks/useCanvas";
import type { Aresta, No, Op, TipoNo } from "../../../canvas.ts";
import { Barra } from "./canvas/Barra";
import { CanvasCtx, edgeTypes, nodeTypes } from "./canvas/Nos";

// ---------------------------------------------------------------------------
// Modelo (No/Aresta) <-> react-flow (nodes/edges)
// ---------------------------------------------------------------------------

// Tipos que tem render proprio; os demais (agente, worker, run…) caem no card de nota como fallback.
const TEM_CARD = new Set<TipoNo>(["nota", "imagem", "forma", "grupo", "texto"]);
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
    zIndex: no.tipo === "grupo" ? 0 : 1, // grupo atras dos filhos
  };
}

// A seta (markerEnd ArrowClosed) so' aparece quando as duas pontas sao formas (pontaDaAresta).
function arestaParaRf(a: Aresta, porId: Map<string, No>): Edge {
  const comSeta = pontaDaAresta(porId.get(a.de)?.tipo, porId.get(a.para)?.tipo);
  return {
    id: a.id,
    source: a.de,
    target: a.para,
    type: "rotulo",
    data: { rotulo: a.rotulo ?? "" },
    markerEnd: comSeta ? { type: MarkerType.ArrowClosed, color: "#606060", width: 16, height: 16 } : undefined,
  };
}

const novoId = (prefixo: string) => prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// dataURL -> so' a parte base64 (o hub espera dadosB64 puro).
function lerBase64(arquivo: Blob): Promise<string> {
  return new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onload = () => { const s = String(fr.result ?? ""); ok(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = () => falha(new Error("falha ao ler o arquivo"));
    fr.readAsDataURL(arquivo);
  });
}

// ---------------------------------------------------------------------------
// Controle de zoom proprio (canto inferior direito): −  N%  +
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------

export function Canvas({ projeto }: { projeto: string }) {
  const { estado, conectado, enviar } = useCanvas(projeto);
  const [nos, setNos] = useState<Node[]>([]);
  const [arestas, setArestas] = useState<Edge[]>([]);
  const [arestaEditando, setArestaEditando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ferramenta, setFerramenta] = useState<Ferramenta>("selecionar");
  const [formaPendente, setFormaPendente] = useState<NomeForma>("retangulo");
  const [espaco, setEspaco] = useState(false);
  const [arrasto, setArrasto] = useState<{ a: { x: number; y: number }; b: { x: number; y: number } } | null>(null);
  const [origemSeta, setOrigemSeta] = useState<string | null>(null);
  const bloqueado = !conectado; // sem SSE vivo: so' leitura ("reconectando…")
  const container = useRef<HTMLDivElement | null>(null);
  const instancia = useRef<ReactFlowInstance | null>(null);
  const ajusteFeito = useRef(false);

  // Ferramenta efetiva: segurar Espaco vira "mao" temporariamente (como no Castor).
  const efetiva: Ferramenta = espaco ? "mao" : ferramenta;
  const criando = FERRAMENTAS_CRIACAO.has(efetiva);
  const selecionando = efetiva === "selecionar";

  // Ao trocar de projeto, o proximo grafo carregado merece um enquadramento novo.
  useEffect(() => { ajusteFeito.current = false; }, [projeto]);

  // Primeiro grafo do projeto: enquadra tudo (o `fitView` do componente roda com a lista ainda vazia).
  useEffect(() => {
    if (ajusteFeito.current || estado.nos.length === 0) return;
    ajusteFeito.current = true;
    const id = window.setTimeout(() => { void instancia.current?.fitView({ maxZoom: 1, padding: 0.25 }); }, 150);
    return () => window.clearTimeout(id);
  }, [estado]);

  // modelo -> react-flow; grupos primeiro (ficam atras) e selecao preservada entre atualizacoes.
  useEffect(() => {
    const porId = new Map(estado.nos.map((n) => [n.id, n]));
    const ordenados = [...estado.nos].sort((a, b) => (a.tipo === "grupo" ? 0 : 1) - (b.tipo === "grupo" ? 0 : 1));
    setNos((antigos) => {
      const sel = new Set(antigos.filter((n) => n.selected).map((n) => n.id));
      return ordenados.map((n) => {
        const rf = noParaRf(n, porId);
        if (sel.has(n.id)) rf.selected = true;
        return rf;
      });
    });
    setArestas(estado.arestas.map((a) => arestaParaRf(a, porId)));
  }, [estado]);

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
      if (e.key === " " || e.code === "Space") { setEspaco(true); return; }
      if (e.key === "Escape") { setArrasto(null); setOrigemSeta(null); setFerramenta("selecionar"); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
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

  const buscarNo = (id: string): No | undefined => estado.nos.find((n) => n.id === id);

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
    const porId = new Map(estado.nos.map((n) => [n.id, n]));
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
    const grupos: No[] = estado.nos
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
      for (const filho of estado.nos) {
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
    const atual = estado.arestas.find((a) => a.id === id);
    if (!atual) return;
    const limpo = rotulo.trim();
    enviar([{ op: "upsert", tipo: "aresta", item: { ...atual, rotulo: limpo || undefined, rev: Date.now() } }]);
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
      const grupos = [...estado.nos.filter((n) => n.tipo === "grupo"), no];
      for (const n of estado.nos) {
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

  const aoSoltarArquivo = (e: DragEvent) => {
    e.preventDefault();
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
    nos: estado.nos,
    bloquear: bloqueado,
    editar: aoEditar,
    removerNo: aoRemoverNo,
    redimensionar: aoRedimensionar,
    rotular: aoRotular,
    arestaEditando,
    editarAresta: setArestaEditando,
  };

  return (
    <div
      ref={container}
      className={cn("cv relative h-full w-full", criando && "cv-pane-criacao", efetiva === "mao" && "cv-pane-mao")}
    >
      <CanvasCtx.Provider value={ctx}>
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
          deleteKeyCode={bloqueado ? null : ["Delete", "Backspace"]}
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
      </CanvasCtx.Provider>

      <Barra
        bloquear={bloqueado}
        ferramenta={ferramenta}
        onFerramenta={(f) => { setOrigemSeta(null); setFerramenta(f); }}
        onForma={(forma) => { setFormaPendente(forma); setOrigemSeta(null); setFerramenta("forma"); }}
        onImagem={(arquivo) => void criarImagem(arquivo)}
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
    </div>
  );
}

export default Canvas;
