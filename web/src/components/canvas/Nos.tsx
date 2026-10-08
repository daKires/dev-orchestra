// Nos (cards) do canvas estilo Castor: um JanelaCard comum pra nota/imagem/forma/grupo, o render de
// markdown por blocos (SEM dangerouslySetInnerHTML) e a aresta com rotulo editavel. Toda a UI fica em
// PT-BR, so' tema escuro, reaproveitando tailwind + components/ui + lucide-react.
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import {
  BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, Position, getSmoothStepPath,
  type EdgeProps, type NodeProps,
} from "@xyflow/react";
import { Check, Ellipsis, X } from "lucide-react";
import {
  CORES_FORMA, CORES_NOTA, mdBlocos, type Trecho,
} from "@/lib/canvas";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { No } from "../../../../canvas.ts";

// ---------------------------------------------------------------------------
// Contexto: acoes que os cards/arestas chamam de volta pro Canvas
// ---------------------------------------------------------------------------

export type CanvasAcoes = {
  nos: No[];
  /** !conectado: edicao bloqueada (os handlers ignoram quando true). */
  bloquear: boolean;
  editar: (id: string, dados: Record<string, unknown>) => void;
  removerNo: (id: string) => void;
  redimensionar: (id: string, largura: number, altura: number) => void;
  rotular: (id: string, rotulo: string) => void;
  arestaEditando: string | null;
  editarAresta: (id: string | null) => void;
};

export const CanvasCtx = createContext<CanvasAcoes>({
  nos: [], bloquear: true,
  editar: () => {}, removerNo: () => {}, redimensionar: () => {}, rotular: () => {},
  arestaEditando: null, editarAresta: () => {},
});

// ---------------------------------------------------------------------------
// Pecas comuns
// ---------------------------------------------------------------------------

type Dados = { no: No };

const lerDados = (data: unknown): Dados => data as Dados;

/** Cor de paleta guardada em dados.cor; cai no padrao quando ausente/desconhecida. */
function corDa<T extends Record<string, string>>(paleta: T, valor: unknown, padrao: keyof T): keyof T {
  return typeof valor === "string" && valor in paleta ? (valor as keyof T) : padrao;
}

const ROTULO_COR: Record<string, string> = {
  amarelo: "Amarelo", rosa: "Rosa", lilas: "Lilás", azul: "Azul", verde: "Verde",
  cinza: "Cinza", vermelho: "Vermelho",
};

/** Menu ⋯ com as cores de uma paleta (usado pela nota, pela forma e pelo grupo). */
function MenuCores({ paleta, atual, onEscolher }: { paleta: Record<string, string>; atual: string; onEscolher: (cor: string) => void }) {
  return (
    <DropdownMenuContent align="end" className="min-w-36">
      <DropdownMenuLabel>Cor</DropdownMenuLabel>
      {(Object.keys(paleta) as string[]).map((c) => (
        <DropdownMenuItem key={c} onSelect={() => onEscolher(c)}>
          <span className="size-3 rounded-full ring-1 ring-border" style={{ background: paleta[c] }} />
          {ROTULO_COR[c] ?? c}
          {c === atual ? <Check className="ml-auto size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
    </DropdownMenuContent>
  );
}

function BotaoOpcoes({ children, title }: { children: ReactNode; title: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={title} className="nodrag grid size-5 shrink-0 place-items-center rounded text-foreground/70 hover:bg-foreground/10 hover:text-foreground">
          <Ellipsis className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  );
}

function BotaoRemover({ id }: { id: string }) {
  const acoes = useContext(CanvasCtx);
  return (
    <button type="button" title="Remover" onClick={() => acoes.removerNo(id)}
      className="nodrag grid size-5 shrink-0 place-items-center rounded text-foreground/70 hover:bg-destructive/20 hover:text-destructive">
      <X className="size-3.5" />
    </button>
  );
}

/** Titulo editavel no proprio cabecalho (commit no blur/Enter; Esc descarta). */
function TituloEditavel({ valor, onCommit, className }: { valor: string; onCommit: (t: string) => void; className?: string }) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  return (
    <input
      value={rascunho ?? valor}
      placeholder="Título"
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => { if (rascunho != null && rascunho !== valor) onCommit(rascunho); setRascunho(null); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") { setRascunho(null); e.currentTarget.blur(); }
      }}
      className={cn("nodrag min-w-0 flex-1 truncate bg-transparent text-[12px] font-semibold outline-none placeholder:text-foreground/40", className)}
    />
  );
}

/**
 * Alcas nos 4 lados: cada lado tem UMA alca de saida (source) e UMA de entrada (target), entao
 * qualquer lado serve pra ligar. A ordem no DOM define a posicao padrao de uma aresta sem
 * sourceHandle/targetHandle: source[0] = direita e target[0] = esquerda (fluxo esquerda->direita).
 * O tamanho/cor/apagado vem do tema em index.css.
 */
function Alcas() {
  return (
    <>
      <Handle type="target" id="alca-esq" position={Position.Left} />
      <Handle type="source" id="alca-dir" position={Position.Right} />
      <Handle type="source" id="alca-esq-s" position={Position.Left} />
      <Handle type="target" id="alca-dir-t" position={Position.Right} />
      <Handle type="source" id="alca-topo-s" position={Position.Top} />
      <Handle type="target" id="alca-topo" position={Position.Top} />
      <Handle type="source" id="alca-baixo-s" position={Position.Bottom} />
      <Handle type="target" id="alca-baixo" position={Position.Bottom} />
    </>
  );
}

type JanelaProps = {
  id: string;
  selecionado: boolean;
  titulo?: string;
  onTitulo?: (t: string) => void;
  menu?: ReactNode;
  fundo?: string;
  borda?: string;
  minW?: number;
  minH?: number;
  /** false = sem cabecalho; os controles (⋯/✕) viram um overlay no canto superior direito. */
  cabecalho?: boolean;
  rodape?: ReactNode;
  classeCorpo?: string;
  children?: ReactNode;
};

/** Chrome comum dos cards: cantos arredondados, sombra, NodeResizer, cabecalho com titulo/menu/✕. */
export function JanelaCard({
  id, selecionado, titulo, onTitulo, menu, fundo, borda, minW = 120, minH = 80,
  cabecalho = true, rodape, classeCorpo, children,
}: JanelaProps) {
  const acoes = useContext(CanvasCtx);
  return (
    <div
      className={cn(
        "relative flex h-full w-full flex-col overflow-hidden rounded-lg border shadow-lg shadow-black/40",
        selecionado && "ring-2 ring-primary",
      )}
      style={{ background: fundo ?? "var(--card)", borderColor: borda ?? "var(--border)" }}
    >
      <NodeResizer
        minWidth={minW}
        minHeight={minH}
        isVisible={selecionado}
        color={borda ?? "var(--primary)"}
        onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)}
      />
      {cabecalho && (
        <header className="flex shrink-0 items-center gap-1 border-b border-foreground/10 bg-foreground/5 px-1.5 py-1">
          {onTitulo ? <TituloEditavel valor={titulo ?? ""} onCommit={onTitulo} /> : <span className="min-w-0 flex-1 truncate text-[12px] font-semibold">{titulo}</span>}
          {menu && <BotaoOpcoes title="Opções">{menu}</BotaoOpcoes>}
          <BotaoRemover id={id} />
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-hidden", classeCorpo)}>{children}</div>
      {rodape}
      {!cabecalho && (
        <div className="absolute top-1 right-1 flex items-center gap-0.5 rounded bg-popover/80 px-0.5 py-0.5">
          {menu && <BotaoOpcoes title="Opções">{menu}</BotaoOpcoes>}
          <BotaoRemover id={id} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown por blocos (sem HTML cru)
// ---------------------------------------------------------------------------

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) => {
        if (t.negrito) return <strong key={i} className="font-semibold">{t.texto}</strong>;
        if (t.codigo) return <code key={i} className="rounded bg-black/10 px-1 font-mono text-[11px]">{t.texto}</code>;
        return <span key={i}>{t.texto}</span>;
      })}
    </>
  );
}

/** Renderiza os blocos de mdBlocos como elementos React — nada de dangerouslySetInnerHTML. */
export function Md({ texto }: { texto: string }) {
  return (
    <div className="space-y-1 text-[12.5px] leading-snug">
      {mdBlocos(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          const tamanho = b.nivel === 1 ? "text-[13.5px]" : b.nivel === 2 ? "text-[13px]" : "text-[12.5px]";
          return <p key={i} className={cn("font-semibold", tamanho)}><Trechos trechos={b.trechos} /></p>;
        }
        if (b.tipo === "item") {
          return <p key={i} className="flex gap-1.5"><span className="text-foreground/40">•</span><span className="min-w-0 flex-1"><Trechos trechos={b.trechos} /></span></p>;
        }
        if (b.tipo === "codigo") {
          return <pre key={i} className="overflow-x-auto rounded bg-black/10 px-2 py-1 font-mono text-[11px] whitespace-pre-wrap">{b.texto}</pre>;
        }
        return <p key={i} className="whitespace-pre-wrap"><Trechos trechos={b.trechos} /></p>;
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// nodeTypes
// ---------------------------------------------------------------------------

/** Nota: titulo editavel + corpo markdown (double-clique edita; fora disso renderiza os blocos). */
function NoNota({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { titulo?: string; corpo?: string; cor?: string };
  const chave = corDa(CORES_NOTA, d.cor, "amarelo");
  const [editando, setEditando] = useState(false);
  const [corpo, setCorpo] = useState<string | null>(null);
  const texto = corpo ?? d.corpo ?? "";
  const salvar = () => {
    if (corpo != null && corpo !== (d.corpo ?? "")) acoes.editar(id, { corpo });
    setCorpo(null);
    setEditando(false);
  };
  return (
    <JanelaCard
      id={id} selecionado={!!selected} fundo={CORES_NOTA[chave]} borda="rgba(0,0,0,0.18)" minW={160} minH={110}
      titulo={d.titulo ?? "Nota"} onTitulo={(t) => acoes.editar(id, { titulo: t })}
      menu={<MenuCores paleta={CORES_NOTA} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} />}
    >
      <Alcas />
      {editando ? (
        <textarea
          autoFocus value={texto}
          onChange={(e) => setCorpo(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => { if (e.key === "Escape") { setCorpo(null); setEditando(false); } }}
          placeholder="Escreva em markdown…"
          className="nodrag nowheel h-full w-full resize-none bg-transparent p-2 font-mono text-[12px] leading-snug text-zinc-900 outline-none placeholder:text-zinc-500"
        />
      ) : (
        <div
          onDoubleClick={() => setEditando(true)}
          title="Duplo clique para editar"
          className="h-full cursor-text overflow-auto p-2 text-zinc-900"
        >
          {texto.trim() ? <Md texto={texto} /> : <span className="text-[12px] text-zinc-500">Duplo clique para escrever…</span>}
        </div>
      )}
    </JanelaCard>
  );
}

const TEXTO_FORMA: Record<string, string> = {
  amarelo: "text-zinc-900", verde: "text-zinc-900", lilas: "text-zinc-900", cinza: "text-white", vermelho: "text-white",
};

/** Forma: elipse, retangulo ou losango (clip-path) com texto editavel e alcas nos 4 lados. */
function NoForma({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { forma?: string; texto?: string; cor?: string };
  const forma = d.forma === "elipse" || d.forma === "losango" ? d.forma : "retangulo";
  const chave = corDa(CORES_FORMA, d.cor, "cinza");
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const texto = rascunho ?? d.texto ?? "";
  const salvar = () => {
    if (rascunho != null && rascunho !== (d.texto ?? "")) acoes.editar(id, { texto: rascunho });
    setRascunho(null);
    setEditando(false);
  };
  const recorte = forma === "losango" ? "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)" : undefined;
  const raio = forma === "elipse" ? "50%" : forma === "retangulo" ? 10 : 0;
  return (
    <div className="relative h-full w-full">
      <NodeResizer minWidth={90} minHeight={70} isVisible={!!selected} color={CORES_FORMA[chave]} onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      {/* moldura = mesma forma um pouco maior atras do preenchimento (funciona com clip-path do losango) */}
      <div aria-hidden className="absolute inset-0" style={{ background: selected ? "var(--primary)" : "rgba(0,0,0,0.25)", borderRadius: raio, clipPath: recorte }} />
      <div
        aria-hidden className="absolute"
        style={{ inset: 2, background: CORES_FORMA[chave], opacity: 0.92, borderRadius: raio, clipPath: recorte }}
      />
      <div className="absolute top-1 right-1 z-10 flex items-center gap-0.5 rounded bg-popover/70 px-0.5 py-0.5">
        <BotaoOpcoes title="Opções">
          <MenuCores paleta={CORES_FORMA} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} />
        </BotaoOpcoes>
        <BotaoRemover id={id} />
      </div>
      <div className="relative flex h-full w-full items-center justify-center p-3" onDoubleClick={() => setEditando(true)} title="Duplo clique para editar">
        {editando ? (
          <textarea
            autoFocus value={texto}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={salvar}
            onKeyDown={(e) => { if (e.key === "Escape") { setRascunho(null); setEditando(false); } }}
            className={cn("nodrag nowheel h-full w-full resize-none bg-transparent text-center text-[12.5px] font-medium outline-none", TEXTO_FORMA[chave])}
          />
        ) : texto.trim() ? (
          <span className={cn("max-h-full w-full overflow-hidden text-center text-[12.5px] font-medium break-words whitespace-pre-wrap", TEXTO_FORMA[chave])}>{texto}</span>
        ) : null}
      </div>
      <Alcas />
    </div>
  );
}

/** Imagem: preview + legenda com o nome do arquivo. */
function NoImagem({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const d = no.dados as { url?: string; nome?: string };
  return (
    <JanelaCard
      id={id} selecionado={!!selected} minW={120} minH={110}
      titulo={d.nome ?? "Imagem"}
      rodape={<div className="shrink-0 truncate border-t border-foreground/10 bg-foreground/5 px-2 py-1 text-[11px] text-foreground/70">{d.nome ?? "imagem"}</div>}
    >
      <Alcas />
      {d.url
        ? <img src={d.url} alt={d.nome ?? "imagem"} draggable={false} className="h-full w-full object-contain" />
        : <div className="grid h-full place-items-center text-[11px] text-foreground/50">sem imagem</div>}
    </JanelaCard>
  );
}

/** Grupo: moldura colorida translucida com titulo (os filhos entram via parentId). */
function NoGrupo({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { titulo?: string; cor?: string };
  const chave = corDa(CORES_FORMA, d.cor, "lilas");
  const cor = CORES_FORMA[chave];
  return (
    <div className="relative flex h-full w-full flex-col rounded-xl border-2 border-dashed" style={{ borderColor: cor, background: cor + "1f" }}>
      <NodeResizer minWidth={160} minHeight={120} isVisible={!!selected} color={cor} onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      <header className="flex shrink-0 items-center gap-1 px-2 py-1">
        <TituloEditavel valor={d.titulo ?? "Grupo"} onCommit={(t) => acoes.editar(id, { titulo: t })} />
        <BotaoOpcoes title="Opções">
          <MenuCores paleta={CORES_FORMA} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} />
        </BotaoOpcoes>
        <BotaoRemover id={id} />
      </header>
    </div>
  );
}

export const nodeTypes = { nota: NoNota, imagem: NoImagem, forma: NoForma, grupo: NoGrupo };

// ---------------------------------------------------------------------------
// edgeTypes: aresta com rotulo editavel (duplo clique)
// ---------------------------------------------------------------------------

function ArestaRotulo({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd, selected }: EdgeProps) {
  const acoes = useContext(CanvasCtx);
  const [caminho, rotX, rotY] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const rotulo = String((data as { rotulo?: string } | undefined)?.rotulo ?? "");
  const editando = acoes.arestaEditando === id;
  const [rascunho, setRascunho] = useState(rotulo);
  useEffect(() => { if (editando) setRascunho(rotulo); }, [editando, rotulo]);
  const salvar = () => { acoes.rotular(id, rascunho); acoes.editarAresta(null); };
  return (
    <>
      <BaseEdge id={id} path={caminho} markerEnd={markerEnd} style={selected ? { stroke: "var(--primary)" } : undefined} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{ transform: `translate(-50%, -50%) translate(${rotX}px, ${rotY}px)`, pointerEvents: "all" }}
        >
          {editando ? (
            <input
              autoFocus value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onBlur={salvar}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") acoes.editarAresta(null);
              }}
              placeholder="rótulo"
              className="w-28 rounded border border-border bg-popover px-1.5 py-0.5 text-center text-[11px] text-popover-foreground outline-none"
            />
          ) : rotulo ? (
            <button
              type="button" onDoubleClick={() => acoes.editarAresta(id)} title="Duplo clique para editar o rótulo"
              className="rounded bg-popover/90 px-1.5 py-0.5 text-[11px] text-popover-foreground ring-1 ring-border"
            >
              {rotulo}
            </button>
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const edgeTypes = { rotulo: ArestaRotulo };
