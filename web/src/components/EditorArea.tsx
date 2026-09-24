import { FileDiff, ListTree, X } from "lucide-react";
import type { Run } from "@/lib/estado";
import { cn } from "@/lib/utils";
import { DiffView } from "./DiffView";
import { PlanoView } from "./PlanoView";

type Props = {
  r: Run; agora: number; abas: string[]; ativa: string;
  onAtiva: (a: string) => void; onFechar: (a: string) => void; onArquivo: (f: string) => void;
  sliceSel: number | null; onSlice: (i: number | null) => void;
};

export const PLANO = "__plano__";

// Abas estilo editor: "Plano" fixa + um diff por arquivo aberto.
export function EditorArea(p: Props) {
  const nome = (f: string) => f.split("/").pop() ?? f;
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar [scrollbar-width:none]">
        {[PLANO, ...p.abas].map((a) => {
          const ativa = a === p.ativa;
          return (
            <div
              key={a} role="tab" aria-selected={ativa} title={a === PLANO ? "Plano da run" : a}
              onClick={() => p.onAtiva(a)}
              onAuxClick={(e) => { if (e.button === 1 && a !== PLANO) p.onFechar(a); }}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[12.5px] text-muted-foreground select-none hover:text-foreground",
                ativa && "bg-background text-foreground",
              )}
            >
              {ativa && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
              {a === PLANO ? <ListTree className="size-3.5 text-primary/80" /> : <FileDiff className="size-3.5 text-muted-foreground" />}
              <span>{a === PLANO ? "Plano" : nome(a)}</span>
              {a !== PLANO && (
                <button
                  aria-label={"Fechar " + a}
                  onClick={(e) => { e.stopPropagation(); p.onFechar(a); }}
                  className={cn("ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-muted", ativa && "opacity-70")}
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <div className="min-h-0 flex-1">
        {p.ativa === PLANO || !(p.ativa in p.r.diffs) ? (
          <PlanoView r={p.r} agora={p.agora} sliceSel={p.sliceSel} onSlice={p.onSlice} onArquivo={p.onArquivo} />
        ) : (
          <DiffView key={p.ativa} arquivo={p.ativa} patch={p.r.diffs[p.ativa]} />
        )}
      </div>
    </div>
  );
}
