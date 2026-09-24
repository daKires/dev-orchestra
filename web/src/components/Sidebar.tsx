import { ChevronRight, Folder } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { porProjeto, progresso, statusVisivel, type Estado, type Run } from "@/lib/estado";
import { fmtDur, fmtIdade, fmtUSD, tomStatus } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { PontoStatus, StatusIcon } from "./StatusIcon";
import { textoAtividade } from "./Atividade";

type Props = {
  estado: Estado; agora: number; conectado: boolean;
  runId: string | null; onRun: (id: string) => void;
  sliceSel: number | null; onSlice: (idx: number | null) => void;
  fechados: string[]; onFechados: (v: string[]) => void;
};

export function Sidebar(p: Props) {
  const grupos = porProjeto(p.estado);
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex h-9 shrink-0 items-center justify-between px-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">
        <span>Runs</span>
        <span className="flex items-center gap-1.5 font-normal tracking-normal normal-case" title={p.conectado ? "conectado ao hub" : "desconectado"}>
          <span className={cn("size-1.5 rounded-full", p.conectado ? "bg-ok" : "bg-err")} />
          {p.conectado ? "ao vivo" : "offline"}
        </span>
      </div>
      {/* Radix poe o conteudo em display:table, o que quebra o truncate e cria scroll horizontal */}
      <ScrollArea className="min-h-0 flex-1 [&_[data-slot=scroll-area-viewport]>div]:!block">
        {grupos.length === 0 && (
          <p className="px-4 py-6 text-xs leading-relaxed text-muted-foreground">
            Nenhuma run nos últimos 7 dias. Rode <code className="font-mono text-foreground">/orchestra "feature"</code> numa sessão do Claude.
          </p>
        )}
        <div className="pb-3">
          {grupos.map((g, gi) => {
            const aberto = !p.fechados.includes(g.cwd);
            return (
              <Collapsible
                key={g.cwd} open={aberto}
                onOpenChange={(o) => p.onFechados(o ? p.fechados.filter((x) => x !== g.cwd) : [...p.fechados, g.cwd])}
                className="animate-in fade-in slide-in-from-left-1 fill-mode-both" style={{ animationDelay: `${gi * 40}ms` }}
              >
                <CollapsibleTrigger className="group flex w-full items-center gap-1 px-2 py-1 text-left text-xs font-semibold text-sidebar-foreground/90 hover:bg-sidebar-accent/60">
                  <ChevronRight className={cn("size-3.5 text-muted-foreground transition-transform", aberto && "rotate-90")} />
                  <Folder className="size-3.5 text-muted-foreground" />
                  <span className="truncate" title={g.cwd}>{g.projeto}</span>
                  <span className="ml-auto pr-1 text-[10px] font-normal text-muted-foreground">{g.runs.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  {g.runs.map((r) => (
                    <LinhaRun key={r.id} r={r} {...p} />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}

function LinhaRun({ r, agora, runId, onRun, sliceSel, onSlice }: Props & { r: Run }) {
  const st = statusVisivel(r, agora);
  const tom = tomStatus(st);
  const sel = r.id === runId;
  const { feitas, total } = progresso(r);
  const ativ = st === "rodando" ? textoAtividade(r, agora) : null;
  return (
    <div>
      <button
        onClick={() => { onRun(r.id); onSlice(null); }}
        className={cn(
          "group relative flex w-full flex-col gap-0.5 py-1.5 pr-2 pl-7 text-left transition-colors hover:bg-sidebar-accent/60",
          sel && "bg-sidebar-accent text-sidebar-accent-foreground",
        )}
      >
        {sel && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
        <span className="flex w-full items-center gap-2">
          <PontoStatus rodando={st === "rodando"} cor={tom.ponto} />
          <span className="truncate text-[13px]">{r.feature}</span>
        </span>
        <span className="flex w-full items-center gap-2 pl-4 text-[11px] text-muted-foreground">
          <span className={tom.texto}>{tom.rotulo}</span>
          {total > 0 && <span className="font-mono">{feitas}/{total}</span>}
          <span className="ml-auto">{r.inicioTs ? fmtIdade(r.inicioTs, agora) : ""}</span>
        </span>
        {ativ && <span className="truncate pl-4 font-mono text-[10.5px] text-run/90">{ativ}</span>}
      </button>
      {sel && r.slices.length > 0 && (
        <ul className="relative mb-1 ml-[1.35rem] border-l border-sidebar-border py-0.5">
          {r.slices.map((s) => {
            const vivo = s.status === "rodando";
            const dur = vivo && s.inicioTs ? agora - s.inicioTs : s.ms;
            const selS = sliceSel === s.idx;
            return (
              <li key={s.idx}>
                <button
                  onClick={() => onSlice(selS ? null : s.idx)}
                  title={s.motivo ? `${s.tarefa}\n${s.motivo}` : s.tarefa}
                  className={cn(
                    "flex w-full items-center gap-1.5 py-[3px] pr-2 pl-2.5 text-left text-xs hover:bg-sidebar-accent/60",
                    selS && "bg-primary/15 text-foreground",
                    s.status === "pulada" && "opacity-55",
                  )}
                >
                  <StatusIcon status={s.status} className="size-3" />
                  <span className="truncate">{s.tarefa}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10.5px] text-muted-foreground">
                    {s.metrica && <span>{fmtUSD(s.metrica.custoUSD)}</span>}
                    {dur != null && <span className={cn(vivo && "text-run")}>{fmtDur(dur)}</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
