// Nos (cards) do canvas no visual do Castor (F1.5 - S1): card escuro com cabecalho #222, nota na cor
// da paleta, forma em SVG solido, imagem com rodape e grupo/regiao como rotulo de zona. O render de
// markdown e' por blocos (SEM dangerouslySetInnerHTML) e a aresta usa bezier com rotulo em pilula.
// Toda a UI fica em PT-BR, so' tema escuro, reaproveitando tailwind + components/ui + lucide-react.
import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  BaseEdge, EdgeLabelRenderer, Handle, NodeResizer, Position, getBezierPath,
  type EdgeProps, type NodeProps,
} from "@xyflow/react";
import { Check, Ellipsis, FileText, Image as ImageIcon, Pin, X } from "lucide-react";
import {
  CORES_FORMA, CORES_NOTA, estiloForma, estiloNota, mdBlocos, type Trecho,
} from "@/lib/canvas";
import { cn } from "@/lib/utils";
import type { EmConversa } from "@/lib/colab";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { No } from "../../../../src/canvas.ts";

// Contexto: acoes que os cards/arestas chamam de volta pro Canvas

export type CanvasAcoes = {
  nos: No[];
  /** !conectado: edicao bloqueada (os handlers ignoram quando true). */
  bloquear: boolean;
  editar: (id: string, dados: Record<string, unknown>) => void;
  removerNo: (id: string) => void;
  redimensionar: (id: string, largura: number, altura: number) => void;
  rotular: (id: string, rotulo: string) => void;
  /** Alterna dados.fixado do no' (card fixado fica de fora do auto-organizar). */
  fixar: (id: string) => void;
  arestaEditando: string | null;
  editarAresta: (id: string | null) => void;
};

export const CanvasCtx = createContext<CanvasAcoes>({
  nos: [], bloquear: true,
  editar: () => {}, removerNo: () => {}, redimensionar: () => {}, rotular: () => {}, fixar: () => {},
  arestaEditando: null, editarAresta: () => {},
});

// Pecas comuns

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

/** Cores de regiao/grupo no estilo das zonas do Castor. */
const CORES_REGIAO = { cinza: "#858585", lilas: "#7966d6" } as const;

/** Azul do alfinete (mesmo #74aaff das alcas ativas e das arestas em conversa). */
const AZUL_ALFINETE = "#74aaff";

/**
 * Menu ⋯ com as cores de uma paleta (usado pela nota, pela forma e pelo grupo) e, quando o card passa
 * o proprio `id`, o item que fixa/desafixa o no' (dados.fixado) — card fixado nao se move no
 * auto-organizar. Fixar NAO trava o arrasto: so' marca o card pro organizar respeitar.
 */
function MenuCores({ paleta, atual, onEscolher, id, fixado }: {
  paleta: Record<string, string>; atual: string; onEscolher: (cor: string) => void;
  id?: string; fixado?: boolean;
}) {
  const acoes = useContext(CanvasCtx);
  return (
    <DropdownMenuContent align="end" className="cv-menu min-w-36">
      <DropdownMenuLabel>Cor</DropdownMenuLabel>
      {(Object.keys(paleta) as string[]).map((c) => (
        <DropdownMenuItem key={c} onSelect={() => onEscolher(c)}>
          <span className="size-3 rounded-full ring-1 ring-white/20" style={{ background: paleta[c] }} />
          {ROTULO_COR[c] ?? c}
          {c === atual ? <Check className="ml-auto size-3.5" /> : null}
        </DropdownMenuItem>
      ))}
      {id && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => acoes.fixar(id)}>
            <Pin className="size-3.5" style={{ color: AZUL_ALFINETE }} />
            {fixado ? "Desafixar" : "Fixar"}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );
}

/** Alfinete do cabecalho: so' aparece quando o card esta' fixado (dados.fixado). */
function Alfinete() {
  return <Pin className="size-3.5 shrink-0" style={{ color: AZUL_ALFINETE }} aria-label="Fixado" />;
}

function BotaoOpcoes({ children, title, cor }: { children: ReactNode; title: string; cor?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" title={title} style={{ color: cor ?? "var(--cv-icone)" }}
          className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10">
          <Ellipsis className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      {children}
    </DropdownMenu>
  );
}

function BotaoRemover({ id, cor }: { id: string; cor?: string }) {
  const acoes = useContext(CanvasCtx);
  return (
    <button type="button" title="Remover" onClick={() => acoes.removerNo(id)} style={{ color: cor ?? "var(--cv-icone)" }}
      className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10">
      <X className="size-3.5" />
    </button>
  );
}

/** Titulo editavel no proprio cabecalho (commit no blur/Enter; Esc descarta). */
function TituloEditavel({ valor, onCommit, className, style }: { valor: string; onCommit: (t: string) => void; className?: string; style?: CSSProperties }) {
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
      className={cn("cv-title nodrag truncate bg-transparent text-[12px] font-medium outline-none", className)}
      style={style}
    />
  );
}

/**
 * Alcas nos 4 lados: cada lado tem UMA alca de saida (source) e UMA de entrada (target), entao
 * qualquer lado serve pra ligar. A ordem no DOM define a posicao padrao de uma aresta sem
 * sourceHandle/targetHandle: source[0] = direita e target[0] = esquerda (fluxo esquerda->direita).
 * O tamanho/cor/apagado vem do tema em index.css (aparecem no hover do no').
 */
export function Alcas() {
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
  minW?: number;
  minH?: number;
  /** false = sem cabecalho (o card e' so' corpo + rodape, como a imagem). */
  cabecalho?: boolean;
  rodape?: ReactNode;
  classeCorpo?: string;
  children?: ReactNode;
};

/** Chrome comum dos cards (Castor): fundo #1c1c1c, borda #303030, raio 12, sombra + NodeResizer. */
export function JanelaCard({
  id, selecionado, titulo, onTitulo, menu, minW = 120, minH = 80,
  cabecalho = true, rodape, classeCorpo, children,
}: JanelaProps) {
  const acoes = useContext(CanvasCtx);
  return (
    <div className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", selecionado && "cv-sel")}>
      <NodeResizer
        minWidth={minW}
        minHeight={minH}
        isVisible={selecionado}
        color="var(--cv-selecao)"
        onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)}
      />
      {cabecalho && (
        <header className="cv-head shrink-0">
          {onTitulo ? <TituloEditavel valor={titulo ?? ""} onCommit={onTitulo} /> : <span className="cv-title truncate">{titulo}</span>}
          {menu && <BotaoOpcoes title="Opções">{menu}</BotaoOpcoes>}
          <BotaoRemover id={id} />
        </header>
      )}
      <div className={cn("min-h-0 flex-1 overflow-hidden", classeCorpo)}>{children}</div>
      {rodape}
    </div>
  );
}

// Markdown por blocos (sem HTML cru)

function Trechos({ trechos }: { trechos: Trecho[] }) {
  return (
    <>
      {trechos.map((t, i) => {
        if (t.negrito) return <strong key={i} className="font-semibold">{t.texto}</strong>;
        if (t.codigo) return <code key={i} className="rounded bg-black/15 px-1 font-mono text-[0.9em]">{t.texto}</code>;
        return <span key={i}>{t.texto}</span>;
      })}
    </>
  );
}

/** Renderiza os blocos de mdBlocos como elementos React — nada de dangerouslySetInnerHTML. */
export function Md({ texto }: { texto: string }) {
  return (
    <div className="space-y-1 text-[15px] leading-[1.45]">
      {mdBlocos(texto).map((b, i) => {
        if (b.tipo === "titulo") {
          const tamanho = b.nivel === 1 ? "text-[18px]" : b.nivel === 2 ? "text-[16.5px]" : "text-[15px]";
          return <p key={i} className={cn("font-semibold", tamanho)}><Trechos trechos={b.trechos} /></p>;
        }
        if (b.tipo === "item") {
          return <p key={i} className="flex gap-1.5"><span className="opacity-50">•</span><span className="min-w-0 flex-1"><Trechos trechos={b.trechos} /></span></p>;
        }
        if (b.tipo === "codigo") {
          return <pre key={i} className="overflow-x-auto rounded bg-black/15 px-2 py-1 font-mono text-[13px] whitespace-pre-wrap">{b.texto}</pre>;
        }
        return <p key={i} className="whitespace-pre-wrap"><Trechos trechos={b.trechos} /></p>;
      })}
    </div>
  );
}

// nodeTypes

/** Nota: card inteiro na cor da paleta, faixa de cabecalho + corpo markdown no tom `texto`. */
function NoNota({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { titulo?: string; corpo?: string; cor?: string; fixado?: boolean };
  const chave = corDa(CORES_NOTA, d.cor, "amarelo");
  const t = estiloNota(chave);
  const [editando, setEditando] = useState(false);
  const [corpo, setCorpo] = useState<string | null>(null);
  const texto = corpo ?? d.corpo ?? "";
  const salvar = () => {
    if (corpo != null && corpo !== (d.corpo ?? "")) acoes.editar(id, { corpo });
    setCorpo(null);
    setEditando(false);
  };
  return (
    <div
      className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", !!selected && "cv-sel")}
      style={{ background: t.fundo, borderColor: t.borda }}
    >
      <NodeResizer minWidth={160} minHeight={110} isVisible={!!selected} color="var(--cv-selecao)" onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      <header className="cv-head shrink-0" style={{ background: t.cabecalho, borderColor: t.borda, color: t.texto }}>
        <FileText className="size-3.5 shrink-0 opacity-75" style={{ color: t.texto }} />
        <TituloEditavel valor={d.titulo ?? "Nota"} onCommit={(x) => acoes.editar(id, { titulo: x })} style={{ color: t.texto }} />
        {d.fixado === true && <Alfinete />}
        <BotaoOpcoes title="Opções" cor={t.texto}>
          <MenuCores paleta={CORES_NOTA} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} id={id} fixado={d.fixado === true} />
        </BotaoOpcoes>
        <BotaoRemover id={id} cor={t.texto} />
      </header>
      <div className="min-h-0 flex-1 overflow-hidden" style={{ color: t.texto }}>
        {editando ? (
          <textarea
            autoFocus value={texto}
            onChange={(e) => setCorpo(e.target.value)}
            onBlur={salvar}
            onKeyDown={(e) => { if (e.key === "Escape") { setCorpo(null); setEditando(false); } }}
            placeholder="Escreva em markdown…"
            className="nodrag nowheel h-full w-full resize-none bg-transparent p-2.5 text-[15px] leading-[1.45] outline-none"
            style={{ color: t.texto }}
          />
        ) : (
          <div
            onDoubleClick={() => setEditando(true)}
            title="Duplo clique para editar"
            className="h-full cursor-text overflow-auto p-2.5"
            style={{ color: t.texto }}
          >
            {texto.trim() ? <Md texto={texto} /> : <span className="text-[13px] opacity-60">Duplo clique para escrever…</span>}
          </div>
        )}
      </div>
      <Alcas />
    </div>
  );
}

/**
 * Forma: SVG solido, texto #242326 centralizado; selecao = contorno azul. O ⋯ do canto (no hover)
 * traz as cores e o Fixar/Desafixar; o alfinete aparece quando o card esta' fixado.
 */
function NoForma({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { forma?: string; texto?: string; cor?: string; fixado?: boolean };
  const forma = d.forma === "elipse" || d.forma === "losango" ? d.forma : "retangulo";
  const chave = corDa(CORES_FORMA, d.cor, "cinza");
  const t = estiloForma(chave);
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const texto = rascunho ?? d.texto ?? "";
  const salvar = () => {
    if (rascunho != null && rascunho !== (d.texto ?? "")) acoes.editar(id, { texto: rascunho });
    setRascunho(null);
    setEditando(false);
  };
  const fonte = { color: t.texto, font: "500 15px/1.35 ui-sans-serif, system-ui, sans-serif" };
  return (
    <div className={cn("group relative h-full w-full", !!selected && "cv-forma-sel")}>
      <NodeResizer minWidth={90} minHeight={70} isVisible={!!selected} color="var(--cv-selecao)" onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 block h-full w-full">
        {forma === "elipse"
          ? <ellipse cx={50} cy={50} rx={50} ry={50} fill={t.fundo} />
          : forma === "losango"
            ? <polygon points="50,0 100,50 50,100 0,50" fill={t.fundo} />
            : <rect x={0} y={0} width={100} height={100} rx={10} ry={10} fill={t.fundo} />}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center p-3" onDoubleClick={() => setEditando(true)} title="Duplo clique para editar">
        {editando ? (
          <textarea
            autoFocus value={texto}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={salvar}
            onKeyDown={(e) => { if (e.key === "Escape") { setRascunho(null); setEditando(false); } }}
            className="nodrag nowheel h-full w-full resize-none bg-transparent text-center outline-none"
            style={fonte}
          />
        ) : texto.trim() ? (
          <span className="max-h-full w-full overflow-hidden text-center break-words whitespace-pre-wrap" style={fonte}>{texto}</span>
        ) : null}
      </div>
      <div className="absolute top-1 right-1 flex items-center gap-0.5">
        {d.fixado === true && <Alfinete />}
        <span className="opacity-0 transition-opacity group-hover:opacity-100">
          <BotaoOpcoes title="Opções" cor={t.texto}>
            <MenuCores paleta={CORES_FORMA} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} id={id} fixado={d.fixado === true} />
          </BotaoOpcoes>
        </span>
      </div>
      <Alcas />
    </div>
  );
}

/** Imagem: preview cobrindo o card + rodape #222 com o nome do arquivo. */
function NoImagem({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const d = no.dados as { url?: string; nome?: string };
  return (
    <JanelaCard
      id={id} selecionado={!!selected} cabecalho={false} minW={120} minH={110}
      rodape={
        <div className="flex shrink-0 items-center gap-1.5 px-2" style={{ height: 34, background: "var(--cv-cabecalho)", borderTop: "1px solid var(--cv-borda)" }}>
          <ImageIcon className="size-3.5 shrink-0" style={{ color: "var(--cv-icone)" }} />
          <span className="truncate text-[12px]" style={{ color: "#b8b8b8" }}>{d.nome ?? "imagem"}</span>
        </div>
      }
    >
      <Alcas />
      {d.url
        ? <img src={d.url} alt={d.nome ?? "imagem"} draggable={false} className="h-full w-full object-cover" />
        : <div className="grid h-full place-items-center text-[12px]" style={{ color: "var(--cv-icone)" }}>sem imagem</div>}
    </JanelaCard>
  );
}

/** Grupo (regiao): sem fundo, so' a moldura; titulo grande em cima, fora do retangulo (como o Castor). */
function NoGrupo({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { titulo?: string; cor?: string; fixado?: boolean };
  const chave = corDa(CORES_REGIAO, d.cor, "lilas");
  const cor = CORES_REGIAO[chave];
  return (
    <div className="relative h-full w-full">
      <NodeResizer minWidth={160} minHeight={120} isVisible={!!selected} color={cor} onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      <div aria-hidden className="absolute inset-0" style={{ border: `1.5px solid ${cor}`, borderRadius: 18 }} />
      <div className="absolute -top-6 left-0.5 flex items-center gap-1">
        <TituloEditavel valor={d.titulo ?? "Região"} onCommit={(t) => acoes.editar(id, { titulo: t })} className="text-[16px] font-semibold" style={{ color: cor }} />
        {d.fixado === true && <Alfinete />}
        <BotaoOpcoes title="Opções" cor={cor}>
          <MenuCores paleta={CORES_REGIAO} atual={chave} onEscolher={(c) => acoes.editar(id, { cor: c })} id={id} fixado={d.fixado === true} />
        </BotaoOpcoes>
        <BotaoRemover id={id} cor={cor} />
      </div>
      <Alcas />
    </div>
  );
}

/** Texto solto (CA-F6): sem card, so' o texto em #eee; tamanho p/m/g = 14/20/32px. Duplo clique edita. */
function NoTexto({ id, data, selected }: NodeProps) {
  const { no } = lerDados(data);
  const acoes = useContext(CanvasCtx);
  const d = no.dados as { texto?: string; tamanho?: string };
  const tamanho = d.tamanho === "p" ? 14 : d.tamanho === "g" ? 32 : 20;
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<string | null>(null);
  const texto = rascunho ?? d.texto ?? "";
  const salvar = () => {
    if (rascunho != null && rascunho !== (d.texto ?? "")) acoes.editar(id, { texto: rascunho });
    setRascunho(null);
    setEditando(false);
  };
  const fonte: CSSProperties = { color: "#eee", fontSize: tamanho, lineHeight: 1.3, fontWeight: 400 };
  return (
    <div className={cn("relative h-full w-full", !!selected && "cv-forma-sel")}>
      <NodeResizer minWidth={80} minHeight={28} isVisible={!!selected} color="var(--cv-selecao)" onResizeEnd={(_e, p) => acoes.redimensionar(id, p.width, p.height)} />
      {editando ? (
        <textarea
          autoFocus value={texto}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={salvar}
          onKeyDown={(e) => { if (e.key === "Escape") { setRascunho(null); setEditando(false); } }}
          placeholder="Escreva…"
          className="nodrag nowheel h-full w-full resize-none bg-transparent outline-none"
          style={fonte}
        />
      ) : (
        <div
          onDoubleClick={() => setEditando(true)}
          title="Duplo clique para editar"
          className="h-full w-full cursor-text overflow-hidden break-words whitespace-pre-wrap"
          style={fonte}
        >
          {texto.trim() ? texto : <span className="opacity-50">Duplo clique para escrever…</span>}
        </div>
      )}
      <Alcas />
    </div>
  );
}

export const nodeTypes = { nota: NoNota, imagem: NoImagem, forma: NoForma, grupo: NoGrupo, texto: NoTexto };

// edgeTypes: aresta bezier com rotulo editavel (duplo clique) em pilula

/** Cor do tracejado/balao das arestas em conversa (F3 S4) — mesmo azul das alcas ativas. */
const AZUL_CONVERSA = "#74aaff";

/** data da aresta: `rotulo` do usuario e, quando em conversa, `{sentido, balao}` (F3 S4). */
type DadosAresta = { rotulo?: string; conversa?: EmConversa };

function ArestaRotulo({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerStart, markerEnd, style }: EdgeProps) {
  const acoes = useContext(CanvasCtx);
  const dados = data as DadosAresta | undefined;
  const conversa = dados?.conversa;
  // Aresta em conversa (F3 S4): o balao do chat virou rotulo e a animacao azul e' o destaque.
  const [caminho, rotX, rotY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition });
  const rotulo = conversa ? conversa.balao : String(dados?.rotulo ?? "");
  const editando = acoes.arestaEditando === id && !conversa;
  const [rascunho, setRascunho] = useState(rotulo);
  useEffect(() => { if (editando) setRascunho(rotulo); }, [editando, rotulo]);
  const salvar = () => { acoes.rotular(id, rascunho); acoes.editarAresta(null); };
  return (
    <>
      <BaseEdge
        id={id}
        path={caminho}
        markerStart={markerStart}
        markerEnd={markerEnd}
        style={conversa ? { ...style, stroke: AZUL_CONVERSA } : style}
      />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan absolute"
          style={{ transform: `translate(-50%, -50%) translate(${rotX}px, ${rotY}px)`, pointerEvents: "all" }}
        >
          {conversa ? (
            <span className="cv-rotulo-conversa" title={conversa.balao}>{conversa.balao}</span>
          ) : editando ? (
            <input
              autoFocus value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              onBlur={salvar}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                else if (e.key === "Escape") acoes.editarAresta(null);
              }}
              placeholder="rótulo"
              className="cv-rotulo nodrag w-28 text-center outline-none placeholder:opacity-50"
            />
          ) : rotulo ? (
            <button
              type="button" onDoubleClick={() => acoes.editarAresta(id)} title="Duplo clique para editar o rótulo"
              className="cv-rotulo cursor-text"
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
