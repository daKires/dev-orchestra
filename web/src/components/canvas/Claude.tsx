// Card Claude (F4 S6): o nodeType 'agente' usa ESTE card no lugar do card Agente quando o agente e'
// tipo 'claude'. Um xterm (@xterm/xterm + fit) ligado ao PTY do hub: ao montar escreve o buffer de
// GET /agentes/:id/pty (base64) e depois a saida ao vivo ({pty} do SSE); as teclas vao por POST
// /agentes/:id/teclas (X-Hermes). O cabecalho mostra o ponto de status e o selo 'aguardando você'.
import { useContext, useEffect, useRef } from "react";
import { type NodeProps } from "@xyflow/react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { X } from "lucide-react";
import { Alcas } from "./Nos";
import { cn } from "@/lib/utils";
import { temaXterm } from "@/lib/desktop";
import { AgentesCtx } from "./Agente";
import type { No } from "../../../../canvas.ts";

const MONO = "'JetBrains Mono Variable', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const VERDE = "#46d3a0"; // ocioso
const AZUL = "#74aaff"; // ocupado (pulsando)
const AMARELO = "#e3b341"; // aguardando você
const VERMELHO = "#e5534b"; // falhou / encerrado

/** Cor do ponto de status: amarelo aguardando, azul ocupado, vermelho falhou/encerrado, verde ocioso. */
const corStatus = (status: string, ocupado: boolean, aguardando: boolean): string =>
  aguardando ? AMARELO : ocupado ? AZUL : status === "falhou" || status === "encerrado" ? VERMELHO : VERDE;

/** base64 (utf-8) do hub -> texto do terminal. */
function deBase64(b64: string): string {
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return ""; }
}

const idDoNo = (data: unknown): string => {
  const no = (data as { no?: No }).no;
  return no && typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
};

/** No' do agente Claude: terminal ao vivo + status + "Retomar sessão" quando encerrado/falhou. */
export function NoClaude({ id, data, selected }: NodeProps) {
  const { agentes, acoes, onFechar, assinarPty } = useContext(AgentesCtx);
  const agenteId = idDoNo(data);
  const agente = agentes.find((a) => a.id === agenteId);
  const status = agente?.status ?? "ocioso";
  const ocupado = agente?.ocupado === true;
  const aguardando = agente?.aguardando === true;
  const cor = corStatus(status, ocupado, aguardando);
  const parado = status === "encerrado" || status === "falhou";
  const host = useRef<HTMLDivElement | null>(null);

  // Monta o xterm uma vez por agente: buffer do GET /pty + {pty} do SSE; teclas vao pro PTY.
  useEffect(() => {
    const el = host.current;
    if (!el || !agenteId) return;
    const term = new Terminal({
      theme: temaXterm,
      fontFamily: MONO,
      fontSize: 13,
      cursorBlink: true,
      convertEol: false, // saida de PTY ja vem com \r\n; converter quebra a TUI do claude
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    // Cada fit avisa o PTY do tamanho real do card (senao o claude desenha na largura do spawn e corta).
    let ultimo = "";
    let espera: ReturnType<typeof setTimeout> | undefined;
    const ajustar = () => {
      try { fit.fit(); } catch { return; }
      const chave = `${term.cols}x${term.rows}`;
      if (chave === ultimo) return;
      ultimo = chave;
      clearTimeout(espera);
      espera = setTimeout(() => {
        void fetch(`/agentes/${encodeURIComponent(agenteId)}/tamanho`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Hermes": "1" },
          body: JSON.stringify({ cols: term.cols, rows: term.rows }),
        }).catch(() => {});
      }, 150);
    };
    ajustar();
    const ro = new ResizeObserver(ajustar);
    ro.observe(el);
    const sub = term.onData((dados) => {
      void fetch(`/agentes/${encodeURIComponent(agenteId)}/teclas`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify({ dados }),
      }).catch(() => {});
    });

    // Assina a saida ao vivo ANTES do GET e enfileira ate' o buffer entrar (sem perder nem trocar a ordem).
    let pronto = false;
    const fila: string[] = [];
    const escrever = (b64: string) => { if (b64) term.write(deBase64(b64)); };
    const cancelar = assinarPty(agenteId, (b64) => { if (pronto) escrever(b64); else fila.push(b64); });
    const liberarFila = () => { pronto = true; for (const b of fila.splice(0)) escrever(b); };
    let vivo = true;
    fetch(`/agentes/${encodeURIComponent(agenteId)}/pty`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { dados?: string } | null) => {
        if (!vivo) return;
        if (j && typeof j.dados === "string") escrever(j.dados);
        liberarFila();
      })
      .catch(() => { if (vivo) liberarFila(); });

    return () => {
      vivo = false;
      cancelar();
      sub.dispose();
      ro.disconnect();
      term.dispose();
    };
  }, [agenteId, assinarPty]);

  const retomar = () => { if (agenteId) acoes.reiniciar(agenteId); };

  return (
    <div className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", !!selected && "cv-sel")}>
      <header
        className="flex shrink-0 items-center gap-2 px-2.5"
        style={{ height: 32, background: "#222", borderBottom: "1px solid #303030", color: "#eee", font: "500 12px/1 ui-sans-serif, system-ui, sans-serif" }}
      >
        <span className={cn("size-2 shrink-0 rounded-full", ocupado && !aguardando && "animate-pulse")} style={{ background: cor }} title={status} />
        <span className="truncate">{agente?.nome ?? (agenteId || "Claude")}</span>
        <span className="shrink-0" style={{ color: "#858585", font: "400 11px/1 ui-sans-serif, system-ui, sans-serif" }}>Claude Code</span>
        {aguardando && (
          <span className="shrink-0 rounded-full px-1.5 py-0.5" style={{ background: "#e3b34126", border: `1px solid ${AMARELO}`, color: AMARELO, fontSize: 11 }}>
            aguardando você
          </span>
        )}
        <button type="button" title="Fechar" onClick={() => onFechar(id, agenteId)} className="nodrag ml-auto grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: "#858585" }}>
          <X className="size-3.5" />
        </button>
      </header>

      <div
        ref={host}
        className="nodrag nowheel min-h-0 flex-1"
        style={{ background: temaXterm.background, padding: 6, fontFamily: MONO, fontSize: 13 }}
      />

      {parado && (
        <div className="shrink-0 space-y-1.5 px-2.5 py-2" style={{ borderTop: "1px solid #303030", font: "400 12px/1.4 ui-sans-serif, system-ui, sans-serif" }}>
          <p style={{ color: VERMELHO }}>
            {status === "encerrado" ? "Sessão encerrada." : (agente?.erro || "o agente não iniciou (falha no Claude Code)")}
          </p>
          <button
            type="button"
            onClick={retomar}
            className="nodrag rounded font-medium transition-[filter] hover:brightness-110"
            style={{ background: "#2979ff", color: "#fff", borderRadius: 7, fontSize: 12, padding: "5px 10px" }}
          >
            Retomar sessão
          </button>
        </div>
      )}

      <Alcas />
    </div>
  );
}

export default NoClaude;
