// Card Gate da fase 3: comandos da ultima tentativa, saida recolhivel (a que falhou vem aberta) e veredito.
import { useContext, useState } from "react";
import { type NodeProps } from "@xyflow/react";
import { resumoGate, type ResumoGate } from "@/lib/layout";
import { cn } from "@/lib/utils";
import { Alcas } from "./Nos";
import { AMARELO, AZUL, BORDA, BOTAO, CABECALHO, CINZA, FONTE, MONO, RunsCtx, TITULO, VERDE, VERMELHO, lerDados, moldura, texto } from "./Run";

type Comando = ResumoGate["comandos"][number];

function Marca({ status }: { status: Comando["status"] }) {
  if (status === "ok") return <span className="shrink-0" style={{ color: VERDE }}>✓</span>;
  if (status === "falha") return <span className="shrink-0" style={{ color: VERMELHO }}>✗</span>;
  if (status === "rodando") {
    return (
      <span
        className="inline-block size-3 shrink-0 animate-spin rounded-full"
        style={{ border: `2px solid ${AZUL}`, borderTopColor: "transparent" }}
        aria-label="rodando"
      />
    );
  }
  return <span className="shrink-0" style={{ color: CINZA }}>•</span>;
}

function rodapeDoGate(final: ResumoGate["final"]): { texto: string; cor: string } {
  if (final === "ok") return { texto: "GATE APROVADO", cor: VERDE };
  if (final === "falha") return { texto: "GATE FALHOU", cor: VERMELHO };
  if (final === "rodando") return { texto: "rodando", cor: AZUL };
  return { texto: "aguardando", cor: CINZA };
}

function NoGate({ data, selected }: NodeProps) {
  const { runs } = useContext(RunsCtx);
  const no = lerDados(data);
  const runId = texto(no.dados.runId);
  const run = runs[runId];
  const [abertos, setAbertos] = useState<Record<string, boolean>>({});

  if (!run) {
    return (
      <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel")} style={moldura}>
        <header className="shrink-0 px-2 py-1.5" style={{ background: CABECALHO, color: "#eee", font: TITULO }}>Gate</header>
        <div className="p-2.5" style={{ color: CINZA, font: FONTE }}>run {runId || "?"} indisponível</div>
        <Alcas />
      </div>
    );
  }

  const g = resumoGate(run);
  const rodape = rodapeDoGate(g.final);
  const abertoDe = (c: Comando) => abertos[c.cmd] ?? c.status === "falha";
  const alternar = (c: Comando) => setAbertos((a) => ({ ...a, [c.cmd]: !abertoDe(c) }));

  return (
    <div className={cn("relative flex h-full w-full flex-col overflow-hidden", selected && "cv-sel", g.final === "rodando" && "cv-rodando")} style={moldura}>
      <header className="flex shrink-0 items-center gap-1.5 px-2 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <span className="min-w-0 flex-1 truncate">Gate</span>
        {g.reparo != null && (
          <span className="shrink-0 rounded px-1.5 py-0.5" style={{ background: "#2a2617", border: `1px solid ${AMARELO}`, color: AMARELO, font: BOTAO }}>
            reparo {g.reparo}
          </span>
        )}
      </header>

      <div className="nodrag nowheel flex min-h-0 flex-1 flex-col overflow-auto px-2 py-1" style={{ font: FONTE }}>
        {g.comandos.length === 0 && <p style={{ color: CINZA }}>aguardando…</p>}
        {g.comandos.map((c) => {
          const aberto = abertoDe(c);
          return (
            <div key={c.cmd} className="min-w-0 shrink-0">
              <button
                type="button"
                className="nodrag flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-white/5"
                title={c.cmd}
                onClick={() => alternar(c)}
              >
                <Marca status={c.status} />
                <span className="min-w-0 flex-1 truncate font-mono" style={{ color: c.status === "falha" ? VERMELHO : "#dedee3" }}>{c.cmd}</span>
                <span className="shrink-0" style={{ color: CINZA }}>{aberto ? "▾" : "▸"}</span>
              </button>
              {aberto && (
                <pre
                  className="nodrag nowheel mt-0.5 mb-1 max-h-40 overflow-auto rounded px-1.5 py-1 whitespace-pre-wrap break-words"
                  style={{ background: "#191919", border: `1px solid ${BORDA}`, color: c.status === "falha" ? VERMELHO : "#b8b8b8", font: MONO }}
                >{c.saida || "…"}</pre>
              )}
            </div>
          );
        })}
      </div>

      <footer className="shrink-0 px-2 py-1 text-center" style={{ background: CABECALHO, borderTop: `1px solid ${BORDA}`, color: rodape.cor, font: BOTAO }}>
        {rodape.texto}
      </footer>
      <Alcas />
    </div>
  );
}

export const nodeTypes = { gate: NoGate };
