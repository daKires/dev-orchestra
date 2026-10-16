import { CircleStop, Command, GitBranch, TriangleAlert } from "lucide-react";
import { alerta, kpis, progresso, statusVisivel, type Run } from "@/lib/estado";
import { fmtDur, fmtTok, fmtUSD, tituloDaSlice, tomStatus } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { textoAtividade } from "./Atividade";

type Props = { r: Run | null; agora: number; onCancelar: () => void; onPaleta: () => void };

// Barra de status estilo editor: a cor de fundo resume o estado da run aberta.
export function StatusBar({ r, agora, onCancelar, onPaleta }: Props) {
  const st = r ? statusVisivel(r, agora) : "";
  const al = r ? alerta(r, agora) : null;
  const fundo = !r ? "bg-sidebar" : al ? "bg-warn/85 text-black" : st === "rodando" ? "bg-primary/90 text-primary-foreground"
    : st === "COMPLETE" ? "bg-sidebar" : "bg-sidebar";
  const k = r ? kpis(r) : null;
  const { feitas, total } = r ? progresso(r) : { feitas: 0, total: 0 };
  const ativa = r?.slices.find((s) => s.status === "rodando");
  return (
    <footer className={cn("flex h-6 shrink-0 items-center gap-4 border-t px-3 text-[11.5px] transition-colors", fundo)}>
      {r ? (
        <>
          <span className="flex items-center gap-1.5 font-medium">
            {al ? <TriangleAlert className="size-3.5" /> : <span className={cn("size-1.5 rounded-full", st === "rodando" ? "animate-pulse bg-current" : tomStatus(st).ponto)} />}
            {al ?? tomStatus(st).rotulo}
          </span>
          {r.branch && <span className="flex items-center gap-1 opacity-85"><GitBranch className="size-3" />{r.branch}</span>}
          {total > 0 && <span className="font-mono opacity-85">{feitas}/{total} slices</span>}
          {st === "rodando" && ativa && (
            <span className="max-w-[28rem] truncate opacity-90">
              S{ativa.idx} {tituloDaSlice(ativa.idx, ativa.tarefa)}{ativa.inicioTs ? " · " + fmtDur(agora - ativa.inicioTs) : ""}
              {textoAtividade(r, agora) ? " · " + textoAtividade(r, agora) : ""}
            </span>
          )}
          <span className="ml-auto flex items-center gap-4 font-mono opacity-85">
            {k && k.n > 0 && <span>{fmtTok(k.tokensIn + k.tokensOut)} tok</span>}
            {k && k.n > 0 && <span>{fmtUSD(k.custo)}</span>}
          </span>
          {st === "rodando" && (
            <button onClick={onCancelar} className="flex items-center gap-1 rounded px-1.5 hover:bg-black/20">
              <CircleStop className="size-3.5" />Cancelar run
            </button>
          )}
        </>
      ) : <span className="text-muted-foreground">Nenhuma run aberta</span>}
      <button onClick={onPaleta} className={cn("flex items-center gap-1 rounded px-1.5 opacity-80 hover:opacity-100", !r && "ml-auto")}>
        <Command className="size-3" />K
      </button>
    </footer>
  );
}
