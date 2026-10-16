// Painel direito da run: abas Feed/Diff/Gate/Detalhes e as acoes (merge/PR/descartar/cancelar) no rodape.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, X } from "lucide-react";
import { kpis, progresso, statusVisivel, type Run } from "@/lib/estado";
import { fmtDur, fmtHora, fmtTok, fmtUSD, tomStatus } from "@/lib/formato";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/DiffView";
import { StatusIcon } from "@/components/StatusIcon";
import { useDefaultLayout } from "react-resizable-panels";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";


const FUNDO = "#1c1c1c";
const BORDA = "#2c2c2c";
const CABECALHO = "#222";
const CINZA = "#858585";
const AZUL = "#74aaff";
const VERDE = "#5fd29a";
const VERMELHO = "#ff7b72";
const FONTE = "400 12px/1.45 ui-sans-serif, system-ui, sans-serif";
const TITULO = "500 12px/1 ui-sans-serif, system-ui, sans-serif";
const BOTAO = "500 11px/1 ui-sans-serif, system-ui, sans-serif";

export type PainelRunProps = {
  run: Run;
  agora: number;
  arquivoDiff: string | null;
  onArquivoDiff: (arquivo: string) => void;
  aba?: string;
  onAba?: (aba: string) => void;
};


type TipoAcao = "merge" | "pr" | "descartar" | "cancelar";
export type Resultado = {
  tipo: TipoAcao;
  ok: boolean;
  base?: string;
  url?: string;
  erro?: string;
  conflitos?: string[];
};

function rotuloResultado(t: TipoAcao): string {
  switch (t) {
    case "pr": return "PR aberto";
    case "merge": return "Merge feito";
    case "descartar": return "Worktree descartado";
    case "cancelar": return "Cancelamento pedido";
  }
}

export function ResultadoAcao({ r, onFechar }: { r: Resultado; onFechar: () => void }) {
  return (
    <div className="min-w-0 rounded-md px-2 py-1.5" style={{ background: "#191919", border: `1px solid ${BORDA}`, font: FONTE }}>
      <div className="flex items-center gap-1">
        <span className="min-w-0 flex-1 truncate" style={{ color: r.ok ? VERDE : VERMELHO }}>
          {r.ok ? rotuloResultado(r.tipo) : r.erro}
        </span>
        <button type="button" className="shrink-0 rounded px-1 hover:bg-white/10" style={{ color: CINZA }} onClick={onFechar}>✕</button>
      </div>
      {r.ok && r.url ? (
        <a href={r.url} target="_blank" rel="noreferrer" className="block truncate underline" style={{ color: AZUL }}>{r.url}</a>
      ) : null}
      {r.ok && r.base ? <div className="truncate" style={{ color: CINZA }}>base: {r.base}</div> : null}
      {!r.ok && r.conflitos && r.conflitos.length > 0 ? (
        <ul className="mt-0.5 list-disc pl-4" style={{ color: VERMELHO }}>
          {r.conflitos.map((c) => <li key={c} className="truncate">{c}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function idCurto(id: string): string {
  return id.length > 9 ? id.slice(0, 8) : id;
}

const nomeDoArquivo = (caminho: string): string => caminho.split(/[\\/]+/).filter(Boolean).pop() ?? caminho;

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="shrink-0" style={{ color: CINZA }}>{rotulo}</span>
      <span className="min-w-0 truncate font-mono" title={valor}>{valor}</span>
    </div>
  );
}

function Aba({ valor, children }: { valor: string; children: ReactNode }) {
  return (
    <TabsTrigger value={valor} className="h-8 rounded-none px-2 text-[11px] font-medium tracking-[0.08em] uppercase data-[state=active]:text-foreground">
      {children}
    </TabsTrigger>
  );
}

function Contador({ children, tom }: { children: ReactNode; tom: string }) {
  return <span className={cn("ml-1.5 rounded px-1 font-mono text-[10px] tracking-normal", tom)}>{children}</span>;
}

function tituloConfirmacao(a: TipoAcao): string {
  switch (a) {
    case "merge": return "Merge --no-ff";
    case "descartar": return "Descartar worktree";
    case "cancelar": return "Cancelar run";
    case "pr": return "Abrir PR";
  }
}

function descricaoConfirmacao(a: TipoAcao, run: Run): string {
  switch (a) {
    case "merge": return `Fazer merge --no-ff de ${run.branch || "?"} na base?`;
    case "descartar": return `Apagar ${run.branch || "?"} e o worktree? Isso não pode ser desfeito.`;
    case "cancelar": return `Pedir o cancelamento da run ${run.feature || run.id}?`;
    case "pr": return `Abrir um PR da run ${run.feature || run.id}?`;
  }
}

type FeedProps = { r: Run; sliceSel: number | null; onSlice: (i: number | null) => void };

function Feed({ r, sliceSel, onSlice }: FeedProps) {
  const [busca, setBusca] = useState("");
  const [soErros, setSoErros] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  const noFundo = useRef(true);
  const itens = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return r.feed.filter((f) =>
      (sliceSel == null || f.slice === sliceSel) && (!soErros || f.erro) && (!q || f.texto.toLowerCase().includes(q)));
  }, [r.feed, sliceSel, soErros, busca]);
  // so' segue o fim se o usuario ja estava no fim (nao rouba a rolagem de quem esta lendo)
  useEffect(() => { const c = caixa.current; if (c && noFundo.current) c.scrollTop = c.scrollHeight; }, [itens.length]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border/60 px-3">
        <Search className="size-3.5 text-muted-foreground" />
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no feed…"
          className="h-6 w-56 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
        />
        {sliceSel != null && (
          <button onClick={() => onSlice(null)} className="flex items-center gap-1 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-primary">
            slice {sliceSel}<X className="size-3" />
          </button>
        )}
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground select-none">
          <input type="checkbox" checked={soErros} onChange={(e) => setSoErros(e.target.checked)} className="accent-[var(--err)]" />
          só erros
        </label>
        <span className="font-mono text-[10.5px] text-muted-foreground">{itens.length}/{r.feed.length}</span>
      </div>
      <div
        ref={caixa}
        onScroll={(e) => { const c = e.currentTarget; noFundo.current = c.scrollTop + c.clientHeight >= c.scrollHeight - 8; }}
        className="min-h-0 flex-1 overflow-auto py-1 font-mono text-[11.5px] leading-[1.35rem]"
      >
        {itens.length === 0 && <p className="px-3 py-2 text-muted-foreground">Nada aqui{busca || soErros || sliceSel != null ? " com esse filtro" : " ainda"}.</p>}
        {itens.map((f, i) => (
          <div key={i} className={cn("flex gap-3 px-3 hover:bg-muted/40", f.erro && "text-err", f.tipo === "slice" && !f.erro && "text-primary", f.tipo === "fase" && "text-muted-foreground")}>
            <span className="shrink-0 text-muted-foreground/60">{fmtHora(f.ts)}</span>
            <span className="w-7 shrink-0 text-muted-foreground/70">{f.slice != null ? "S" + f.slice : ""}</span>
            <span className="break-all whitespace-pre-wrap">{f.texto}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gate({ r }: { r: Run }) {
  if (!r.gate.length) return <p className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">O gate roda depois de todas as slices{r.gateCmds.length ? `: ${r.gateCmds.length} comando(s)` : ""}.</p>;
  // so' o estado final de cada (cmd, tentativa)
  const finais = r.gate.filter((g, i) => !r.gate.slice(i + 1).some((h) => h.cmd === g.cmd && h.tentativa === g.tentativa));
  return (
    <div className="divide-y divide-border/60 font-mono text-[11.5px]">
      {finais.map((g, i) => (
        <div key={i} className="px-3 py-1.5">
          <div className="flex items-center gap-3">
            <span className={cn("w-16 shrink-0 font-semibold", g.status === "ok" ? "text-ok" : g.status === "falha" ? "text-err" : "text-run")}>{g.status.toUpperCase()}</span>
            <span className="truncate" title={g.cmd}>{g.cmd}</span>
            {g.tentativa && <span className="text-warn">reparo {g.tentativa}</span>}
          </div>
          {g.saida && <pre className="mt-1.5 max-h-60 overflow-auto rounded bg-muted/50 p-2 whitespace-pre-wrap text-foreground/80">{g.saida}</pre>}
        </div>
      ))}
    </div>
  );
}

function Metricas({ r }: { r: Run }) {
  if (!r.metricas.length) return <p className="px-3 py-2 font-mono text-[11.5px] text-muted-foreground">As métricas aparecem quando cada slice termina.</p>;
  const nome = (i: number) => r.slices.find((s) => s.idx === i)?.tarefa ?? (i > r.plano.length ? "reparo do gate" : "");
  return (
    <table className="w-full font-mono text-[11.5px]">
      <thead className="sticky top-0 bg-background text-left text-[10.5px] tracking-[0.08em] text-muted-foreground uppercase">
        <tr className="border-b">
          {["Slice", "", "Iter", "1ª", "Teste", "Amb", "Tokens", "Custo", "Tempo"].map((h, i) => <th key={i} className="px-3 py-1.5 font-medium">{h}</th>)}
        </tr>
      </thead>
      <tbody>
        {r.metricas.map((m, i) => (
          <tr key={i} className="border-b border-border/50 hover:bg-muted/30">
            <td className="px-3 py-1">S{m.slice}</td>
            <td className="max-w-72 truncate px-3 py-1 font-sans text-xs text-foreground/85">{nome(m.slice)}</td>
            <td className="px-3 py-1">{m.iteracoes}</td>
            <td className={cn("px-3 py-1", m.passouDePrimeira ? "text-ok" : "text-muted-foreground")}>{m.passouDePrimeira ? "sim" : "não"}</td>
            <td className={cn("px-3 py-1", m.tocouNoTeste ? "text-err" : "")}>{m.tocouNoTeste}</td>
            <td className={cn("px-3 py-1", m.falhasAmbiente ? "text-err" : "")}>{m.falhasAmbiente ?? 0}</td>
            <td className="px-3 py-1">{fmtTok(m.tokensIn)} / {fmtTok(m.tokensOut)}</td>
            <td className="px-3 py-1">{fmtUSD(m.custoUSD)}</td>
            <td className="px-3 py-1">{fmtDur(m.ms)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}


export function PainelRun({ run, agora, arquivoDiff, onArquivoDiff, aba, onAba }: PainelRunProps) {
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [confirmar, setConfirmar] = useState<TipoAcao | null>(null);
  const [sliceSel, setSliceSel] = useState<number | null>(null);
  const [abaInterna, setAbaInterna] = useState("feed");
  // Largura da lista de arquivos da aba Diff (persistida).
  const layoutDiff = useDefaultLayout({ id: "hermes.layout.diff", storage: localStorage });
  const abaAtual = aba ?? abaInterna;
  const trocarAba = (v: string) => {
    if (aba === undefined) setAbaInterna(v);
    onAba?.(v);
  };

  const st = statusVisivel(run, agora);
  const p = progresso(run);
  const k = kpis(run);
  const fim = st === "rodando" ? agora : run.ultimoEventoTs;
  const dur = run.inicioTs ? fmtDur(Math.max(0, fim - run.inicioTs)) : "";
  const rodandoAgora = st === "rodando";
  const terminada = !rodandoAgora && st !== "aguardando";
  const completo = st === "COMPLETE";
  const erros = run.feed.filter((f) => f.erro).length;
  const falhasGate = run.gate.filter((g) => g.status === "falha").length;

  const escolhido = arquivoDiff && run.ordemDiffs.includes(arquivoDiff) ? arquivoDiff : run.ordemDiffs[0] ?? null;
  const patchEscolhido = escolhido ? run.diffs[escolhido] ?? "" : "";

  const acao = async (a: "merge" | "pr" | "descartar") => {
    setResultado(null);
    try {
      const r = await fetch(`/runs/acao?run=${encodeURIComponent(run.id)}`, {
        method: "POST",
        headers: { "X-Hermes": "1", "Content-Type": "application/json" },
        body: JSON.stringify({ acao: a }),
      });
      const j = (await r.json().catch(() => null)) as { ok?: boolean; base?: string; url?: string; erro?: string; conflitos?: string[] } | null;
      if (j?.ok) setResultado({ tipo: a, ok: true, base: j.base, url: j.url });
      else setResultado({ tipo: a, ok: false, erro: j?.erro || `O hub recusou a ação (HTTP ${r.status}).`, conflitos: j?.conflitos });
    } catch (e) {
      setResultado({ tipo: a, ok: false, erro: "Falha de rede ao executar a ação: " + String((e as Error).message) });
    }
  };

  const cancelar = async () => {
    setResultado(null);
    try {
      const r = await fetch(`/cancel?run=${encodeURIComponent(run.id)}`, { method: "POST", headers: { "X-Hermes": "1" } });
      if (r.ok || r.status === 204) setResultado({ tipo: "cancelar", ok: true });
      else setResultado({ tipo: "cancelar", ok: false, erro: `O hub recusou o cancelamento (HTTP ${r.status}).` });
    } catch (e) {
      setResultado({ tipo: "cancelar", ok: false, erro: "Falha de rede ao pedir o cancelamento: " + String((e as Error).message) });
    }
  };

  const confirmarCom = (a: TipoAcao) => {
    if (a === "cancelar") void cancelar();
    else void acao(a);
  };

  const tom = tomStatus(st);
  const btn = "rounded px-2 py-1 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";
  const btnEstilo = (cor: string) => ({ background: "#191919", border: `1px solid ${BORDA}`, color: cor, font: BOTAO }) as const;

  return (
    <div className="flex h-full w-full flex-col overflow-hidden" style={{ background: FUNDO, border: `1px solid ${BORDA}`, font: FONTE, color: "#dedee3" }}>
      <header className="flex shrink-0 items-center gap-2 px-2.5 py-1.5"
        style={{ background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: TITULO }}>
        <StatusIcon status={st} />
        <span className="shrink-0 font-mono" style={{ color: CINZA }} title={run.id}>{idCurto(run.id)}</span>
        <span className={cn("flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5", tom.texto)}
          style={{ background: "#191919", border: `1px solid ${BORDA}`, font: BOTAO }}>
          <span className={cn("size-1.5 rounded-full", tom.ponto)} />
          {tom.rotulo}
        </span>
        <span className="min-w-0 flex-1 truncate" title={run.feature}>{run.feature}</span>
        <span className="shrink-0 font-mono tabular-nums" style={{ color: CINZA }}>{p.feitas}/{p.total} · {k.n ? fmtUSD(k.custo) : "—"}</span>
      </header>

      <Tabs value={abaAtual} onValueChange={trocarAba} className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="flex h-8 shrink-0 items-center border-b px-2" style={{ borderColor: BORDA }}>
          <TabsList variant="line" className="h-8 gap-1 bg-transparent p-0">
            <Aba valor="feed">Feed{erros > 0 && <Contador tom="bg-err/20 text-err">{erros}</Contador>}</Aba>
            <Aba valor="diff">Diff</Aba>
            <Aba valor="gate">Gate{falhasGate > 0 && <Contador tom="bg-err/20 text-err">{falhasGate}</Contador>}</Aba>
            <Aba valor="detalhes">Detalhes</Aba>
          </TabsList>
        </div>

        <TabsContent value="feed" className="min-h-0 flex-1">
          <Feed r={run} sliceSel={sliceSel} onSlice={setSliceSel} />
        </TabsContent>

        <TabsContent value="diff" className="min-h-0 flex-1">
          <ResizablePanelGroup orientation="horizontal" defaultLayout={layoutDiff.defaultLayout} onLayoutChanged={layoutDiff.onLayoutChanged}>
            <ResizablePanel id="arquivos" defaultSize={192} minSize={120} maxSize="60" className="min-h-0 overflow-auto">
              {run.ordemDiffs.length === 0 && (
                <p className="px-3 py-2" style={{ color: CINZA }}>Sem arquivos alterados.</p>
              )}
              {run.ordemDiffs.map((a) => (
                <button key={a} type="button" onClick={() => onArquivoDiff(a)}
                  className={cn("block w-full truncate px-2 py-1 text-left hover:bg-white/5", a === escolhido && "bg-white/10")}
                  style={{ color: a === escolhido ? "#eee" : "#b8b8b8", font: FONTE, borderBottom: `1px solid ${BORDA}` }}
                  title={a}>
                  {nomeDoArquivo(a)}
                </button>
              ))}
            </ResizablePanel>
            <ResizableHandle />
            <ResizablePanel id="patch" className="min-h-0 overflow-hidden">
              {escolhido
                ? <DiffView arquivo={escolhido} patch={patchEscolhido} />
                : <p className="p-4" style={{ color: CINZA }}>Selecione um arquivo no diff.</p>}
            </ResizablePanel>
          </ResizablePanelGroup>
        </TabsContent>

        <TabsContent value="gate" className="min-h-0 flex-1 overflow-auto">
          <Gate r={run} />
        </TabsContent>

        <TabsContent value="detalhes" className="min-h-0 flex-1 overflow-auto">
          <div className="flex flex-col gap-1 px-3 py-2">
            <Campo rotulo="Branch" valor={run.branch || "—"} />
            <Campo rotulo="Baseline" valor={run.baseline || "—"} />
            <Campo rotulo="Duração" valor={dur || "—"} />
          </div>
          <Metricas r={run} />
          <div className="px-3 py-2">
            <div className="mb-1" style={{ color: CINZA }}>Plano</div>
            {run.plano.length === 0 && <p style={{ color: CINZA }}>O plano aparece quando a run começa.</p>}
            {run.plano.map((item, i) => {
              const slice = run.slices.find((s) => s.idx === i + 1);
              const sStatus = slice?.status ?? "fila";
              const custo = slice?.metrica?.custoUSD;
              return (
                <div key={i} className="flex items-center gap-2 py-1" style={{ borderTop: `1px solid ${BORDA}` }}>
                  <span className="w-8 shrink-0 font-mono" style={{ color: CINZA }}>S{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate" title={item.tarefa}>{item.tarefa}</span>
                  <span className={cn("shrink-0", tomStatus(sStatus).texto)}>{tomStatus(sStatus).rotulo}</span>
                  <span className="w-16 shrink-0 text-right font-mono tabular-nums" style={{ color: CINZA }}>{custo != null ? fmtUSD(custo) : "—"}</span>
                </div>
              );
            })}
          </div>
        </TabsContent>
      </Tabs>

      {/* Resultado da acao aparece acima do rodape */}
      {resultado ? (
        <div className="shrink-0 px-2.5 pb-1.5">
          <ResultadoAcao r={resultado} onFechar={() => setResultado(null)} />
        </div>
      ) : null}

      {/* Rodape FIXO com as acoes da run */}
      <footer className="flex shrink-0 items-center gap-2 px-2.5 py-2" style={{ background: CABECALHO, borderTop: `1px solid ${BORDA}` }}>
        <button type="button" disabled={!completo} onClick={() => setConfirmar("merge")} className={btn} style={btnEstilo("#eee")}>
          Merge (--no-ff)
        </button>
        <button type="button" disabled={!completo} onClick={() => void acao("pr")} className={btn} style={btnEstilo(AZUL)}>
          Abrir PR
        </button>
        <button type="button" disabled={!terminada} onClick={() => setConfirmar("descartar")} className={btn} style={btnEstilo(VERMELHO)}>
          Descartar
        </button>
        {rodandoAgora ? (
          <button type="button" onClick={() => setConfirmar("cancelar")} className={cn(btn, "ml-auto")} style={btnEstilo(VERMELHO)}>
            Cancelar run
          </button>
        ) : null}
      </footer>

      {/* Confirmacao das acoes (merge, descartar e cancelar pedem confirmacao) */}
      <Dialog open={confirmar !== null} onOpenChange={(o) => { if (!o) setConfirmar(null); }}>
        <DialogContent className="max-w-sm" style={{ background: FUNDO, border: `1px solid ${BORDA}` }}>
          <DialogTitle style={{ color: "#eee", font: TITULO }}>
            {confirmar ? tituloConfirmacao(confirmar) : ""}
          </DialogTitle>
          <DialogDescription style={{ color: "#b8b8b8", font: FONTE }}>
            {confirmar ? descricaoConfirmacao(confirmar, run) : ""}
          </DialogDescription>
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded px-2 py-1 text-xs hover:bg-white/10"
              style={{ color: "#b8b8b8", border: `1px solid ${BORDA}` }} onClick={() => setConfirmar(null)}>
              Cancelar
            </button>
            <button type="button" className="rounded px-2 py-1 text-xs"
              style={{ background: confirmar === "merge" ? AZUL : VERMELHO, color: "#111", font: BOTAO }}
              onClick={() => { const a = confirmar; setConfirmar(null); if (a) confirmarCom(a); }}>
              Confirmar
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
