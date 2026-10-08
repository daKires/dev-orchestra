// Card do agente (F2 S5b): um nodeType do xyflow para os nos tipo 'agente', no visual do terminal
// Castor/Codex. O agente, a transcricao (linhas) e as acoes chegam por PROPS vindas de um contexto
// React simples (AgentesCtx) exportado daqui, pra nao mexer no CanvasCtx dos outros cards.
import {
  createContext, useContext, useEffect, useRef, useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { type NodeProps } from "@xyflow/react";
import { Ellipsis, MessagesSquare, Pin, X } from "lucide-react";
import { Alcas, CanvasCtx } from "./Nos";
import { cn } from "@/lib/utils";
import { ehLinhaColab } from "@/lib/colab";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { AgenteVisivel, Linha } from "@/hooks/useAgentes";
import type { No } from "../../../../canvas.ts";

// Contexto (S5b): agentes do projeto + transcricoes + acoes + fechar o no'

/** Resumo do agente como o hub devolve (o `erro` so' aparece quando o agente falhou). */
export type AgenteDoCanvas = AgenteVisivel & { erro?: string };

export type AcoesAgente = {
  carregarHistorico: (id: string) => void;
  mensagem: (id: string, texto: string) => void;
  abortar: (id: string) => void;
  /** Reinicia a sessao do agente encerrado/falho (POST /agentes/:id/reiniciar). */
  reiniciar: (id: string) => void;
  /** Troca o modelo do agente (POST /agentes/:id/modelo). */
  trocarModelo: (id: string, modelo: string) => void;
  /** Modelos disponiveis na cwd (GET /agentes/modelos?cwd=). */
  modelos: (cwd: string) => Promise<string[]>;
  /** Opcional: recria o agente que falhou ("Tentar de novo"). */
  recriar?: (id: string) => void;
  /** Opcional: cria o card Explorador (`exp:<agenteId>`) a esquerda do agente, com uma aresta. */
  explorador?: (agenteId: string) => void;
};

export type AgentesValor = {
  agentes: AgenteDoCanvas[];
  linhasPorId: Record<string, Linha[]>;
  acoes: AcoesAgente;
  onFechar: (noId: string, agenteId: string) => void;
  /** Assina a saida do PTY ({pty}) de um agente; devolve o cancelamento (card Claude, F4/S6). */
  assinarPty: (id: string, cb: (dados: string) => void) => () => void;
};

export const AgentesCtx = createContext<AgentesValor>({
  agentes: [],
  linhasPorId: {},
  acoes: { carregarHistorico: () => {}, mensagem: () => {}, abortar: () => {}, reiniciar: () => {}, trocarModelo: () => {}, modelos: async () => [] },
  onFechar: () => {},
  assinarPty: () => () => {},
});

// Cores do terminal

const VERDE = "#46d3a0"; // ocioso / tool ok
const AZUL = "#74aaff"; // ocupado (pulsando)
const VERMELHO = "#e5534b"; // falhou / encerrado / tool erro
const CINZA = "#b8b8b8"; // tool rodando/pendente
const MONO = "400 13px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Cor do ponto de status: azul quando ocupado (o resumo traz `ocupado`), vermelho em falha/encerrado
// e verde (ocioso) no resto. O campo `ocupado` e' a fonte de verdade do pulso do card (CA-4a).
const corStatus = (status: string, ocupado: boolean): string =>
  ocupado ? AZUL : status === "falhou" || status === "encerrado" ? VERMELHO : VERDE;

/** Uma linha da transcricao: usuario (fundo #2a2a2a), texto (paragrafo) ou tool (✓/✗/→). */
function LinhaTxt({ l }: { l: Linha }) {
  if (l.tipo === "usuario") {
    // Linha de colaboracao entre agentes (F3 S4): destaque azul + icone de conversa.
    if (ehLinhaColab(l.texto)) {
      return (
        <p
          className="flex items-start gap-1.5 whitespace-pre-wrap rounded px-1.5 py-0.5"
          style={{ background: "#19253a", borderLeft: "2px solid #74aaff" }}
        >
          <MessagesSquare className="mt-0.5 size-3.5 shrink-0" style={{ color: "#74aaff" }} />
          <span className="min-w-0 flex-1">{l.texto}</span>
        </p>
      );
    }
    return (
      <p className="whitespace-pre-wrap rounded px-1.5 py-0.5" style={{ background: "#2a2a2a" }}>
        <span style={{ color: "#858585" }}>{"› "}</span>{l.texto}
      </p>
    );
  }
  if (l.tipo === "tool") {
    const ok = l.estado === "ok";
    const erro = l.estado === "erro";
    const cor = ok ? VERDE : erro ? VERMELHO : CINZA;
    const marca = ok ? "✓" : erro ? "✗" : "→";
    return (
      <p className="whitespace-pre-wrap" style={{ color: cor }}>
        {marca} {l.texto}
      </p>
    );
  }
  return <p className="whitespace-pre-wrap">{l.texto}</p>;
}

const idDoNo = (data: unknown): string => {
  const no = (data as { no?: No }).no;
  return no && typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
};

/** No' do modelo guardado em props.data (o card le' dados.fixado daqui). */
export const noDoDado = (data: unknown): No | undefined => (data as { no?: No }).no;

/**
 * Select pequeno do modelo no rodape: a lista (GET /agentes/modelos?cwd=) e' carregada ao focar/abrir
 * (uma vez por cwd) e trocar chama acoes.trocarModelo. O modelo atual entra na lista pra nunca sumir.
 */
function SelectModelo({ agenteId, modelo, cwd, acoes }: {
  agenteId: string; modelo: string; cwd: string; acoes: AcoesAgente;
}) {
  const [lista, setLista] = useState<string[]>([]);
  const carregado = useRef("");
  const carregar = () => {
    if (!cwd || carregado.current === cwd) return;
    carregado.current = cwd;
    void acoes.modelos(cwd).then(setLista);
  };
  const opcoes = [...new Set([modelo, ...lista].filter(Boolean))];
  return (
    <select
      value={modelo}
      title="Modelo"
      aria-label="Modelo"
      onFocus={carregar}
      onPointerDown={carregar}
      onChange={(e) => { const m = e.target.value; if (m && m !== modelo && agenteId) acoes.trocarModelo(agenteId, m); }}
      className="nodrag nowheel max-w-[60%] cursor-pointer truncate bg-transparent outline-none"
      style={{ color: "inherit", font: "inherit" }}
    >
      {opcoes.length === 0
        ? <option value={modelo}>{modelo || "—"}</option>
        : opcoes.map((m) => <option key={m} value={m}>{m}</option>)}
    </select>
  );
}

// nodeType

/** No' do agente: cabecalho com status, banner do OpenCode, transcricao rolavel e input. */
export function NoAgente({ id, data, selected }: NodeProps) {
  const { agentes, linhasPorId, acoes, onFechar } = useContext(AgentesCtx);
  const { fixar } = useContext(CanvasCtx);
  const agenteId = idDoNo(data);
  const fixado = noDoDado(data)?.dados.fixado === true;
  const agente = agentes.find((a) => a.id === agenteId);
  const linhas = linhasPorId[agenteId] ?? [];
  const [texto, setTexto] = useState("");
  const rolagem = useRef<HTMLDivElement | null>(null);
  const carregado = useRef("");

  // Ao montar (ou trocar de agente), busca o historico UMA vez por id.
  useEffect(() => {
    if (!agenteId || carregado.current === agenteId) return;
    carregado.current = agenteId;
    acoes.carregarHistorico(agenteId);
  }, [agenteId, acoes]);

  // Auto-scroll pro fim a cada lote de linhas (nova array = novidade no chat).
  useEffect(() => {
    const el = rolagem.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [linhas]);

  const enviar = () => {
    const t = texto.trim();
    if (!t || !agenteId) return;
    acoes.mensagem(agenteId, t);
    setTexto("");
  };

  const aoTeclar = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { e.preventDefault(); enviar(); }
    else if (e.key === "Escape") { e.preventDefault(); if (agenteId) acoes.abortar(agenteId); }
  };

  const status = agente?.status ?? "ocioso";
  const ocupado = agente?.ocupado === true;
  const cor = corStatus(status, ocupado);
  // Sessao encerrada (serve morto) ou falha no start: o agente nao fala mais -> input travado.
  const parado = status === "encerrado" || status === "falhou";

  return (
    <div className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", !!selected && "cv-sel")}>
      <header
        className="flex shrink-0 items-center gap-2 px-2.5"
        style={{ height: 32, background: "#222", borderBottom: "1px solid #303030", color: "#eee", font: "500 12px/1 ui-sans-serif, system-ui, sans-serif" }}
      >
        <span className={cn("size-2 shrink-0 rounded-full", ocupado && "animate-pulse")} style={{ background: cor }} title={status} />
        <span className="truncate">{agente?.nome ?? (agenteId || "agente")}</span>
        {fixado && <Pin className="size-3.5 shrink-0" style={{ color: "#74aaff" }} aria-label="Fixado" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Opções" className="nodrag ml-auto grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: "#858585" }}>
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="cv-menu min-w-40">
            <DropdownMenuItem onSelect={() => { if (agenteId) acoes.carregarHistorico(agenteId); }}>Recarregar histórico</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { if (agenteId) acoes.abortar(agenteId); }}>Interromper</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { if (agenteId) acoes.explorador?.(agenteId); }}>+ Explorador</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => fixar(id)}>
              <Pin className="size-3.5" style={{ color: "#74aaff" }} />
              {fixado ? "Desafixar" : "Fixar"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" title="Fechar" onClick={() => onFechar(id, agenteId)} className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: "#858585" }}>
          <X className="size-3.5" />
        </button>
      </header>

      <div ref={rolagem} className="nowheel nodrag min-h-0 flex-1 overflow-auto p-2.5" style={{ font: MONO, color: "#dedee3" }}>
        <div className="mb-2 space-y-0.5 px-1.5 py-1" style={{ border: "1px solid #858585", borderRadius: 2 }}>
          <p>{">_ OpenCode"}</p>
          <p>model: {agente?.modelo || "—"}</p>
          <p>directory: {agente?.cwd || "—"}</p>
        </div>
        <div className="space-y-1">
          {linhas.map((l) => <LinhaTxt key={l.id} l={l} />)}
        </div>
        {ocupado && <p className="mt-1" style={{ color: "#858585" }}>Working • esc para interromper</p>}
      </div>

      {parado && (
        <div className="shrink-0 space-y-1.5 px-2.5 py-2" style={{ borderTop: "1px solid #303030", font: "400 12px/1.4 ui-sans-serif, system-ui, sans-serif" }}>
          <p style={{ color: VERMELHO }}>
            {status === "encerrado" ? "Sessão encerrada." : (agente?.erro || "o agente não iniciou (falha no OpenCode)")}
          </p>
          {acoes.recriar && status === "falhou" && (
            <button type="button" onClick={() => acoes.recriar?.(agenteId)} className="nodrag rounded px-2 py-1 hover:bg-white/10" style={{ border: "1px solid #414141", color: "#eee" }}>
              Tentar de novo
            </button>
          )}
          <button
            type="button"
            onClick={() => { if (agenteId) acoes.reiniciar(agenteId); }}
            className="nodrag rounded font-medium transition-[filter] hover:brightness-110"
            style={{ background: "#2979ff", color: "#fff", borderRadius: 7, fontSize: 12, padding: "5px 10px" }}
          >
            Reiniciar sessão
          </button>
        </div>
      )}

      <input
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={aoTeclar}
        disabled={parado}
        placeholder="Peça ao agente…"
        className="nodrag nowheel shrink-0 bg-transparent px-2.5 py-2 outline-none placeholder:opacity-50 disabled:cursor-not-allowed disabled:opacity-50"
        style={{ borderTop: "1px solid #303030", color: "#dedee3", font: MONO }}
      />

      <footer className="flex shrink-0 items-center gap-1 px-2.5 py-1" style={{ background: "#ecd9ac", color: "#3d3312", font: "400 12px/1.4 ui-sans-serif, system-ui, sans-serif" }}>
        <SelectModelo agenteId={agenteId} modelo={agente?.modelo || ""} cwd={agente?.cwd || ""} acoes={acoes} />
        <span className="shrink-0">·</span>
        <span className="truncate" title={agente?.cwd}>{agente?.cwd || "—"}</span>
      </footer>

      <Alcas />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra `agente: NoAgente`). */
export const nodeTypes = { agente: NoAgente };

export default NoAgente;
