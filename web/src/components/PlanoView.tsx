import { useEffect, useRef, useState } from "react";
import { Check, Copy, FileDiff, GitBranch, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { alerta, kpis, statusVisivel, type Run, type SliceEstado } from "@/lib/estado";
import { fmtDur, fmtPct, fmtTok, fmtUSD, tomStatus } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { StatusIcon } from "./StatusIcon";
import { textoAtividade } from "./Atividade";

type Props = { r: Run; agora: number; sliceSel: number | null; onSlice: (i: number | null) => void; onArquivo: (f: string) => void };

export function PlanoView({ r, agora, sliceSel, onSlice, onArquivo }: Props) {
  const st = statusVisivel(r, agora);
  const tom = tomStatus(st);
  const k = kpis(r);
  const al = alerta(r, agora);
  const refs = useRef<Record<number, HTMLElement | null>>({});
  // antes do 1o evento de slice, mostra o plano como fila
  const lista: SliceEstado[] = r.slices.length ? r.slices
    : r.plano.map((pl, i) => ({ idx: i + 1, tarefa: pl.tarefa, status: "fila", plano: pl, escritos: [], comandos: [] }));
  useEffect(() => { if (sliceSel != null) refs.current[sliceSel]?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [sliceSel]);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-5xl px-8 pt-7 pb-16">
        {/* cabecalho */}
        <div className="flex items-start gap-4">
          <div className="min-w-0 flex-1">
            <div className="mb-1.5 flex items-center gap-2 text-[11px] tracking-[0.12em] text-muted-foreground uppercase">
              <span>{r.projeto || "run"}</span>
              {r.branch && (<><span className="text-border">/</span><GitBranch className="size-3" /><span className="font-mono tracking-normal normal-case">{r.branch}</span></>)}
            </div>
            <h1 className="text-xl leading-snug font-semibold text-balance">{r.feature}</h1>
          </div>
          <span className={cn("mt-1 flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs", tom.texto)}>
            <StatusIcon status={st} className="size-3" />{tom.rotulo}
          </span>
        </div>

        {st === "rodando" && (
          <div className={cn("mt-4 flex items-center gap-2 rounded-md border px-3 py-2 font-mono text-xs", al ? "border-warn/40 bg-warn/10 text-warn" : "border-run/30 bg-run/[0.07] text-run")}>
            <span className={cn("size-1.5 rounded-full", al ? "bg-warn" : "animate-pulse bg-run")} />
            {al ?? textoAtividade(r, agora) ?? "trabalhando…"}
          </div>
        )}

        {/* KPIs */}
        <div className="mt-6 grid grid-cols-5 overflow-hidden rounded-lg border bg-card">
          <Kpi rotulo="Passou de 1ª" valor={fmtPct(k.passouDePrimeira)} tom={k.passouDePrimeira == null ? "" : k.passouDePrimeira >= 0.6 ? "text-ok" : "text-warn"} />
          <Kpi rotulo="Iterações/slice" valor={k.mediaIteracoes == null ? "—" : k.mediaIteracoes.toFixed(1)} />
          <Kpi rotulo="Tocou no teste" valor={fmtPct(k.tocouNoTeste)} tom={k.tocouNoTeste ? "text-err" : k.n ? "text-ok" : ""} />
          <Kpi rotulo="Falha de ambiente" valor={k.n ? String(k.falhasAmbiente) : "—"} tom={k.falhasAmbiente ? "text-err" : k.n ? "text-ok" : ""} />
          <Kpi rotulo="Custo" valor={k.n ? fmtUSD(k.custo) : "—"} sub={k.n ? `${fmtTok(k.tokensIn)} in · ${fmtTok(k.tokensOut)} out` : undefined} />
        </div>

        {/* slices */}
        <h2 className="mt-9 mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Slices</h2>
        <ol className="space-y-2.5">
          {lista.map((s) => {
            const pl = s.plano ?? r.plano[s.idx - 1];
            const selS = sliceSel === s.idx;
            const m = s.metrica;
            return (
              <li
                key={s.idx} ref={(el) => { refs.current[s.idx] = el; }}
                onClick={() => onSlice(selS ? null : s.idx)}
                className={cn(
                  "cursor-pointer rounded-lg border bg-card/60 transition-colors hover:border-foreground/15",
                  selS && "border-primary/50 ring-1 ring-primary/25",
                  s.status === "pulada" && "opacity-60",
                )}
              >
                <div className="flex items-center gap-2.5 px-4 py-2.5">
                  <span className="w-5 font-mono text-[11px] text-muted-foreground">{String(s.idx).padStart(2, "0")}</span>
                  <StatusIcon status={s.status} />
                  <span className="truncate text-sm font-medium">{s.tarefa}</span>
                  {s.semMudancas && <span className="rounded bg-muted px-1.5 py-px text-[10.5px] text-muted-foreground">sem mudanças</span>}
                  <span className="ml-auto flex shrink-0 items-center gap-3 font-mono text-[11px] text-muted-foreground">
                    {m && <span title="iterações até verde">{m.iteracoes} iter</span>}
                    {m && <span>{fmtUSD(m.custoUSD)}</span>}
                    {s.ms != null && <span>{fmtDur(s.ms)}</span>}
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-6 border-t border-border/60 px-4 py-3 text-[12.5px]">
                  <div className="min-w-0">
                    <Rotulo>Plano</Rotulo>
                    {pl?.descricao ? <p className="leading-relaxed whitespace-pre-wrap text-foreground/85">{pl.descricao}</p> : <p className="text-muted-foreground">—</p>}
                    {pl?.arquivos_alvo?.length ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {pl.arquivos_alvo.map((f) => <span key={f} className="rounded bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">{f}</span>)}
                      </div>
                    ) : null}
                  </div>
                  <div className="min-w-0">
                    <Rotulo>Resultado</Rotulo>
                    {s.motivo && <p className={cn("mb-2", s.status === "pulada" ? "text-muted-foreground" : "text-warn")}>{s.motivo}</p>}
                    {s.escritos.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {s.escritos.map((f) => (
                          <button key={f} onClick={(e) => { e.stopPropagation(); onArquivo(f); }}
                            className="flex items-center gap-1 rounded border border-border/70 px-1.5 py-px font-mono text-[11px] text-foreground/85 hover:border-primary/60 hover:text-primary">
                            <FileDiff className="size-3" />{f}
                          </button>
                        ))}
                      </div>
                    )}
                    {s.comandos.length > 0 && (
                      <ul className="mt-2 space-y-0.5 font-mono text-[11px]">
                        {s.comandos.map((c, i) => {
                          const falhou = / \(exit [^)]+\)$/.test(c);
                          return <li key={i} className={cn("truncate", falhou ? "text-err/90" : "text-muted-foreground")} title={c}>{falhou ? "✗" : "✓"} {c.replace(/^\S*[\\/]/, "")}</li>;
                        })}
                      </ul>
                    )}
                    {!s.escritos.length && !s.comandos.length && !s.motivo && <p className="text-muted-foreground">{s.status === "rodando" ? "em andamento…" : "—"}</p>}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        {/* verificacao */}
        {(r.cmds.length > 0 || r.gateCmds.length > 0) && (
          <>
            <h2 className="mt-9 mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Verificação</h2>
            <div className="grid grid-cols-2 gap-4 text-[12px]">
              <ListaCmd titulo="Allowlist das slices" cmds={r.cmds} />
              <ListaCmd titulo="Gate" cmds={r.gateCmds} />
            </div>
          </>
        )}

        {r.painel && r.painel.length > 0 && <Painel r={r} status={st} />}
      </div>
    </div>
  );
}

function Kpi({ rotulo, valor, tom, sub }: { rotulo: string; valor: string; tom?: string; sub?: string }) {
  return (
    <div className="border-r px-4 py-3 last:border-r-0">
      <div className="text-[10.5px] tracking-[0.1em] text-muted-foreground uppercase">{rotulo}</div>
      <div className={cn("mt-1 font-mono text-xl font-medium tabular-nums", tom)}>{valor}</div>
      {sub && <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function Rotulo({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10.5px] tracking-[0.1em] text-muted-foreground/80 uppercase">{children}</div>;
}

function ListaCmd({ titulo, cmds }: { titulo: string; cmds: string[] }) {
  return (
    <div className="rounded-lg border bg-card/60 p-3">
      <Rotulo>{titulo}</Rotulo>
      {cmds.length ? (
        <ul className="space-y-1 font-mono text-[11.5px]">
          {cmds.map((c) => <li key={c} className="flex gap-1.5 truncate" title={c}><TerminalSquare className="mt-0.5 size-3 shrink-0 text-muted-foreground" />{c.replace(/^\S*[\\/]/, "")}</li>)}
        </ul>
      ) : <p className="text-muted-foreground">nenhum</p>}
    </div>
  );
}

function Painel({ r, status }: { r: Run; status: string }) {
  const [copiado, setCopiado] = useState(false);
  const cmd = r.baseline ? `git checkout ${r.baseline.slice(0, 8)} -- .` : "";
  return (
    <>
      <h2 className="mt-9 mb-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Painel final</h2>
      <div className="overflow-hidden rounded-lg border bg-card/60">
        <pre className="overflow-x-auto px-4 py-3 font-mono text-[11.5px] leading-5 text-foreground/80">{"STATUS: " + status + "\n" + (r.painel ?? []).join("\n")}</pre>
        {cmd && (
          <div className="flex items-center gap-3 border-t px-4 py-2.5 text-xs">
            <span className="text-muted-foreground">Reverter pro estado antes da run:</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono">{cmd}</code>
            <Button size="sm" variant="outline" className="ml-auto h-7"
              onClick={() => { navigator.clipboard?.writeText(cmd); setCopiado(true); setTimeout(() => setCopiado(false), 1500); }}>
              {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}{copiado ? "Copiado" : "Copiar"}
            </Button>
          </div>
        )}
      </div>
    </>
  );
}
