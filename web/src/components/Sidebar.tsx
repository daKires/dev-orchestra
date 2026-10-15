// Sidebar: Explorador do projeto, Runs recentes e Pool de agentes.
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen } from "lucide-react";
import { arvoreDeCaminhos, type NoArvore } from "@/lib/colab";
import { kpis, progresso, runsDoProjeto, statusVisivel, type Estado, type Run } from "@/lib/estado";
import { fmtIdade, fmtUSD, tomStatus } from "@/lib/formato";
import { agentesDoPool, badgesArquivos, type Badge } from "@/lib/unido";
import { cn } from "@/lib/utils";
import { PontoStatus } from "./StatusIcon";

type AgenteSidebar = { id: string; nome: string; modelo: string; ocupado: boolean; status: string };

type Props = {
  projeto: string;
  estado: Estado;
  agora: number;
  agentes: AgenteSidebar[];
  runSel: Run | null;
  novas: Set<string>;
  onRun: (runId: string) => void;
  onFocar: (noId: string) => void;
  onArquivo: (caminho: string) => void;
};

const ROTULO =
  "flex h-8 shrink-0 items-center justify-between px-3 text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase";

const profundidade = (caminho: string): number => caminho.split("/").length - 1;

function nomePasta(projeto: string): string {
  const partes = String(projeto).replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : projeto;
}

export function Sidebar(p: Props) {
  const badges = useMemo(() => badgesArquivos(p.runSel), [p.runSel]);

  const runs = useMemo(
    () => runsDoProjeto(Object.values(p.estado.runs), p.projeto).sort((a, b) => b.inicioTs - a.inicioTs),
    [p.estado, p.projeto],
  );

  const pool = useMemo(
    () => agentesDoPool(p.agentes, runsDoProjeto(Object.values(p.estado.runs), p.projeto), p.agora),
    [p.agentes, p.estado, p.projeto, p.agora],
  );

  const [caminhos, setCaminhos] = useState<string[]>([]);
  const [erroArvore, setErroArvore] = useState(false);
  const [abertos, setAbertos] = useState<Map<string, boolean>>(new Map());

  useEffect(() => {
    setAbertos(new Map());
    if (!p.projeto) { setCaminhos([]); setErroArvore(false); return; }
    let vivo = true;
    setErroArvore(false);
    fetch(`/arvore?projeto=${encodeURIComponent(p.projeto)}`)
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j) => {
        if (!vivo) return;
        if (Array.isArray(j)) setCaminhos(j.filter((x): x is string => typeof x === "string"));
        else setErroArvore(true);
      })
      .catch(() => { if (vivo) setErroArvore(true); });
    return () => { vivo = false; };
  }, [p.projeto]);

  const arvore = useMemo(() => arvoreDeCaminhos(caminhos), [caminhos]);
  const estaAberta = (caminho: string): boolean => abertos.get(caminho) ?? profundidade(caminho) < 2;
  const alternarPasta = (caminho: string) => {
    const abertoAgora = estaAberta(caminho);
    setAbertos((m) => { const n = new Map(m); n.set(caminho, !abertoAgora); return n; });
  };

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* (a) Explorador do projeto */}
      <section className="flex min-h-0 flex-[3] flex-col border-b border-sidebar-border">
        <div className={ROTULO}>
          <span className="truncate" title={`Explorador · ${p.projeto}`}>
            Explorador · {p.projeto ? nomePasta(p.projeto) : "—"}
          </span>
          <span className="shrink-0 pl-2 font-normal tracking-normal">{badges.size} tocados</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {erroArvore
            ? <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">Não foi possível ler os arquivos do projeto</p>
            : arvore.length === 0
              ? <p className="px-2 py-3 text-xs leading-relaxed text-muted-foreground">{p.projeto ? "sem arquivos." : "Nenhum projeto selecionado."}</p>
              : arvore.map((it) => (
                <Ramo
                  key={it.caminho} item={it} nivel={0} badges={badges}
                  aberta={estaAberta} onAlternar={alternarPasta} onArquivo={p.onArquivo}
                />
              ))}
        </div>
      </section>

      {/* (b) Runs recentes */}
      <section className="flex min-h-0 flex-[2] flex-col border-b border-sidebar-border">
        <div className={ROTULO}>
          <span>Runs recentes</span>
          <span className="shrink-0 pl-2 font-normal tracking-normal">{runs.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-1">
          {runs.length === 0 ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">Nenhuma run neste projeto.</p>
          ) : runs.map((r) => {
            const st = statusVisivel(r, p.agora);
            const tom = tomStatus(st);
            const sel = p.runSel?.id === r.id;
            const { feitas, total } = progresso(r);
            const k = kpis(r);
            return (
              <button
                key={r.id} type="button" onClick={() => p.onRun(r.id)}
                className={cn(
                  "relative flex w-full flex-col gap-0.5 py-1.5 pr-2 pl-3 text-left transition-colors hover:bg-sidebar-accent/60",
                  sel && "bg-sidebar-accent text-sidebar-accent-foreground",
                  p.novas.has(r.id) && "sb-nova",
                )}
              >
                {sel && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" />}
                <span className="flex w-full items-center gap-2">
                  <PontoStatus rodando={st === "rodando"} cor={tom.ponto} />
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">#{r.id.slice(0, 8)}</span>
                  <span className={cn("shrink-0 text-[10.5px]", tom.texto)}>{tom.rotulo}</span>
                  <span className="truncate text-[13px]">{r.feature}</span>
                </span>
                <span className="flex w-full items-center gap-2 pl-4 text-[11px] text-muted-foreground">
                  {total > 0 && <span className="shrink-0 font-mono">{feitas}/{total} slices</span>}
                  {k.n > 0 && <span className="shrink-0 font-mono">{fmtUSD(k.custo)}</span>}
                  <span className="ml-auto shrink-0">{r.inicioTs ? fmtIdade(r.inicioTs, p.agora) : ""}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* (c) Pool de agentes */}
      <section className="flex min-h-0 flex-[2] flex-col">
        <div className={ROTULO}>
          <span>Pool de agentes</span>
          <span className="shrink-0 pl-2 font-normal tracking-normal">{pool.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto pb-1">
          {pool.length === 0 ? (
            <p className="px-4 py-3 text-xs leading-relaxed text-muted-foreground">Nenhum agente no projeto.</p>
          ) : pool.map((a) => (
            <button
              key={a.id} type="button" onClick={() => p.onFocar(a.foco)}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60"
            >
              <span className="truncate text-[13px]">{a.nome}</span>
              {a.modelo && <span className="truncate font-mono text-[10.5px] text-muted-foreground">{a.modelo}</span>}
              <span className={cn(
                "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
                a.executando ? "bg-run/15 text-run" : "bg-muted text-muted-foreground",
              )}>
                {a.executando ? "executando" : "ocioso"}
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function Ramo({ item, nivel, badges, aberta, onAlternar, onArquivo }: {
  item: NoArvore;
  nivel: number;
  badges: Map<string, Badge>;
  aberta: (caminho: string) => boolean;
  onAlternar: (caminho: string) => void;
  onArquivo: (caminho: string) => void;
}) {
  const pasta = Array.isArray(item.filhos);
  const aberto = pasta && aberta(item.caminho);
  const badge = pasta ? undefined : badges.get(item.caminho);
  return (
    <>
      <button
        type="button" title={item.caminho}
        onClick={() => (pasta ? onAlternar(item.caminho) : onArquivo(item.caminho))}
        className="flex w-full items-center gap-1 rounded py-px pr-1 text-left hover:bg-sidebar-accent/60"
        style={{ paddingLeft: 4 + nivel * 10 }}
      >
        {pasta
          ? <ChevronRight className={cn("size-3 shrink-0 text-muted-foreground transition-transform", aberto && "rotate-90")} />
          : <span className="size-3 shrink-0" />}
        {pasta
          ? (aberto
            ? <FolderOpen className="size-3.5 shrink-0 text-run" />
            : <Folder className="size-3.5 shrink-0 text-run" />)
          : <FileText className="size-3.5 shrink-0 text-muted-foreground" />}
        <span className="truncate font-mono text-[12px]">{item.nome}</span>
        {badge && (
          <span className={cn("ml-auto shrink-0 pl-1 font-mono text-[10.5px] font-semibold", badge === "A" ? "text-ok" : "text-warn")}>
            {badge}
          </span>
        )}
      </button>
      {pasta && aberto && item.filhos!.map((f) => (
        <Ramo
          key={f.caminho} item={f} nivel={nivel + 1} badges={badges}
          aberta={aberta} onAlternar={onAlternar} onArquivo={onArquivo}
        />
      ))}
    </>
  );
}
