import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { Run } from "@/lib/estado";
import { fmtDur, fmtHora, fmtTok, fmtUSD } from "@/lib/formato";
import { cn } from "@/lib/utils";

type Props = { r: Run; sliceSel: number | null; onSlice: (i: number | null) => void };

export function BottomPanel({ r, sliceSel, onSlice }: Props) {
  const falhasGate = r.gate.filter((g) => g.status === "falha").length;
  const erros = r.feed.filter((f) => f.erro).length;
  return (
    <Tabs defaultValue="feed" className="flex h-full flex-col gap-0 bg-background">
      <div className="flex h-8 shrink-0 items-center border-b px-2">
        <TabsList variant="line" className="h-8 gap-1 bg-transparent p-0">
          <Aba valor="feed">Tool calls{erros > 0 && <Contador tom="bg-err/20 text-err">{erros}</Contador>}</Aba>
          <Aba valor="gate">Gate{falhasGate > 0 && <Contador tom="bg-err/20 text-err">{falhasGate}</Contador>}</Aba>
          <Aba valor="metricas">Métricas</Aba>
        </TabsList>
      </div>
      <TabsContent value="feed" className="min-h-0 flex-1"><Feed r={r} sliceSel={sliceSel} onSlice={onSlice} /></TabsContent>
      <TabsContent value="gate" className="min-h-0 flex-1 overflow-auto"><Gate r={r} /></TabsContent>
      <TabsContent value="metricas" className="min-h-0 flex-1 overflow-auto"><Metricas r={r} /></TabsContent>
    </Tabs>
  );
}

function Aba({ valor, children }: { valor: string; children: React.ReactNode }) {
  return (
    <TabsTrigger value={valor} className="h-8 rounded-none px-2 text-[11px] font-medium tracking-[0.08em] uppercase data-[state=active]:text-foreground">
      {children}
    </TabsTrigger>
  );
}

function Contador({ children, tom }: { children: React.ReactNode; tom: string }) {
  return <span className={cn("ml-1.5 rounded px-1 font-mono text-[10px] tracking-normal", tom)}>{children}</span>;
}

export function Feed({ r, sliceSel, onSlice }: Props) {
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

export function Gate({ r }: { r: Run }) {
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

export function Metricas({ r }: { r: Run }) {
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
