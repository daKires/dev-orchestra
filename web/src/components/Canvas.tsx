// Vista Canvas (S4): o grafo do projeto renderizado com @xyflow/react. O modelo do hub (No/Aresta)
// vira nodes/edges, e as edicoes (mover, redimensionar, editar, conectar, apagar, imagem) voltam como
// operacoes pro hub (useCanvas). UI em PT-BR, so' tema escuro.
import { useEffect, useRef, useState, type DragEvent } from "react";
import {
  Background, BackgroundVariant, ConnectionMode, MarkerType, Panel, ReactFlow,
  applyEdgeChanges, applyNodeChanges,
  useReactFlow, useViewport,
  type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { WifiOff } from "lucide-react";
import { checarImagem, limitarZoom, paiDoNo } from "@/lib/canvas";
import { useCanvas } from "@/hooks/useCanvas";
import type { Aresta, No, Op, TipoNo } from "../../../canvas.ts";
import { Barra, type NomeForma } from "./canvas/Barra";
import { CanvasCtx, edgeTypes, nodeTypes } from "./canvas/Nos";

// ---------------------------------------------------------------------------
// Modelo (No/Aresta) <-> react-flow (nodes/edges)
// ---------------------------------------------------------------------------

// Tipos que tem card proprio; os demais (agente, worker, run…) caem no card de nota como fallback.
const TEM_CARD = new Set<TipoNo>(["nota", "imagem", "forma", "grupo"]);
const tipoVisual = (t: TipoNo): string => (TEM_CARD.has(t) ? t : "nota");

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

function arestaParaRf(a: Aresta): Edge {
  return { id: a.id, source: a.de, target: a.para, type: "rotulo", data: { rotulo: a.rotulo ?? "" } };
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
    <Panel position="bottom-right" className="flex items-center gap-0.5 rounded-lg border border-border bg-card/95 px-1 py-0.5 shadow-lg backdrop-blur">
      <button type="button" title="Diminuir zoom" onClick={() => passo(-0.2)} className="grid size-6 place-items-center rounded text-sm hover:bg-muted">−</button>
      <span className="w-10 text-center font-mono text-[11px] tabular-nums">{pct}%</span>
      <button type="button" title="Aumentar zoom" onClick={() => passo(0.2)} className="grid size-6 place-items-center rounded text-sm hover:bg-muted">+</button>
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
  const bloqueado = !conectado; // sem SSE vivo: so' leitura ("reconectando…")
  const container = useRef<HTMLDivElement | null>(null);
  const instancia = useRef<ReactFlowInstance | null>(null);
  const ajusteFeito = useRef(false);

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
    setArestas(estado.arestas.map(arestaParaRf));
  }, [estado]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4200);
    return () => clearTimeout(t);
  }, [aviso]);

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

  // --- criacao de nos ---
  const centro = (cliente?: { x: number; y: number }) => {
    const inst = instancia.current;
    if (cliente && inst) return inst.screenToFlowPosition(cliente);
    const caixa = container.current?.getBoundingClientRect();
    if (inst && caixa) return inst.screenToFlowPosition({ x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2 });
    return { x: 0, y: 0 };
  };

  const criarNo = (tipo: TipoNo, dados: Record<string, unknown>, w: number, h: number) => {
    if (bloqueado) return;
    const p = centro();
    const agora = Date.now();
    const no: No = { id: novoId("n"), tipo, x: Math.round(p.x - w / 2), y: Math.round(p.y - h / 2), w, h, dados, rev: agora };
    enviar([{ op: "upsert", tipo: "no", item: no }]);
  };

  // Agrupar: cria um no' grupo envolvendo os selecionados e define o pai deles.
  const aoAgrupar = () => {
    if (bloqueado) return;
    const selecionados = nos.filter((n) => n.selected && n.type !== "grupo");
    const modelos = selecionados.map((n) => buscarNo(n.id)).filter((n): n is No => !!n);
    if (!modelos.length) { setAviso("Selecione um ou mais nós para agrupar."); return; }
    const minX = Math.min(...modelos.map((n) => n.x));
    const minY = Math.min(...modelos.map((n) => n.y));
    const maxX = Math.max(...modelos.map((n) => n.x + n.w));
    const maxY = Math.max(...modelos.map((n) => n.y + n.h));
    const pad = 28;
    const agora = Date.now();
    const gid = novoId("g");
    const ops: Op[] = [{
      op: "upsert", tipo: "no",
      item: { id: gid, tipo: "grupo", x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2, dados: { titulo: "Grupo", cor: "lilas" }, rev: agora },
    }];
    for (const m of modelos) ops.push({ op: "upsert", tipo: "no", item: { ...m, pai: gid, rev: agora } });
    enviar(ops);
  };

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
    <div ref={container} className="relative h-full w-full bg-background">
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
          onEdgeDoubleClick={(_e, a) => setArestaEditando(a.id)}
          onPaneClick={() => setArestaEditando(null)}
          onInit={(i) => { instancia.current = i; }}
          onDrop={aoSoltarArquivo}
          onDragOver={(e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = "copy"; }}
          connectionMode={ConnectionMode.Loose}
          defaultEdgeOptions={{ type: "rotulo", markerEnd: { type: MarkerType.ArrowClosed, color: "#94a3b8", width: 16, height: 16 } }}
          minZoom={0.1}
          maxZoom={2}
          zoomOnScroll
          zoomOnDoubleClick={false}
          panOnDrag
          panOnScroll={false}
          deleteKeyCode={bloqueado ? null : ["Delete", "Backspace"]}
          nodesDraggable={!bloqueado}
          nodesConnectable={!bloqueado}
          elementsSelectable={!bloqueado}
          nodesFocusable={!bloqueado}
          fitView
          fitViewOptions={{ maxZoom: 1 }}
          attributionPosition="bottom-left"
          className="h-full w-full"
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.5} />
          <ControleZoom />
        </ReactFlow>
      </CanvasCtx.Provider>

      <Barra
        bloquear={bloqueado}
        onNota={() => criarNo("nota", { titulo: "Nota", corpo: "", cor: "amarelo" }, 240, 170)}
        onForma={(forma: NomeForma) => criarNo("forma", { forma, texto: "", cor: "cinza" }, 170, 130)}
        onAgrupar={aoAgrupar}
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
