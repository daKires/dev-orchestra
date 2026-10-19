import { FileDiff, ListTree, Play } from "lucide-react";
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { porProjeto, statusVisivel, type Estado, type Run } from "@/lib/estado";
import { fmtIdade, tituloDaSlice, tomStatus } from "@/lib/formato";
import { StatusIcon } from "./StatusIcon";

type Props = {
  aberto: boolean; onAberto: (v: boolean) => void; estado: Estado; r: Run | null; agora: number;
  titulos: Record<string, string>; // titulo do chat por run, entra no value pra busca do Ctrl+K
  onRun: (id: string) => void; onSlice: (i: number) => void; onArquivo: (f: string) => void;
};

// Ctrl+K: pula pra run, slice (da run aberta) ou arquivo de diff.
export function CommandPalette({ aberto, onAberto, estado, r, agora, titulos, onRun, onSlice, onArquivo }: Props) {
  const ir = (f: () => void) => { f(); onAberto(false); };
  return (
    <CommandDialog open={aberto} onOpenChange={onAberto} title="Ir para…" description="Runs, slices e arquivos" className="sm:max-w-xl">
      <Command>
      <CommandInput placeholder="Ir para run, slice ou arquivo…" />
      <CommandList>
        <CommandEmpty>Nada encontrado.</CommandEmpty>
        {r && r.ordemDiffs.length > 0 && (
          <CommandGroup heading="Arquivos alterados">
            {r.ordemDiffs.map((f) => (
              <CommandItem key={f} value={"arquivo " + f} onSelect={() => ir(() => onArquivo(f))}>
                <FileDiff /><span className="font-mono text-xs">{f}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {r && r.slices.length > 0 && (
          <CommandGroup heading="Slices da run aberta">
            {r.slices.map((s) => (
              <CommandItem key={s.idx} value={`slice ${s.idx} ${s.tarefa}`} onSelect={() => ir(() => onSlice(s.idx))}>
                <StatusIcon status={s.status} /><span>S{s.idx} · {tituloDaSlice(s.idx, s.tarefa)}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {porProjeto(estado).map((g) => (
          <CommandGroup key={g.cwd} heading={g.projeto}>
            {g.runs.map((x) => {
              const st = statusVisivel(x, agora);
              return (
                <CommandItem
                  key={x.id} value={`run ${g.projeto} ${x.feature} ${titulos[x.id] ?? ""} ${x.id}`}
                  onSelect={() => ir(() => onRun(x.id))}
                >
                  {st === "rodando" ? <Play className="text-run" /> : <ListTree />}
                  <span className="truncate">{x.feature}</span>
                  <span className={"ml-auto text-xs " + tomStatus(st).texto}>{tomStatus(st).rotulo} · {fmtIdade(x.inicioTs, agora)}</span>
                </CommandItem>
              );
            })}
          </CommandGroup>
        ))}
      </CommandList>
      </Command>
    </CommandDialog>
  );
}
