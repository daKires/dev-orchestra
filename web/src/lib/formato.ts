// Formatacao pra exibicao (PT-BR). Sem regra de negocio: isso fica em estado.ts.
export function fmtDur(ms?: number): string {
  if (ms == null) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

export function fmtIdade(ts: number, agora: number): string {
  const s = Math.max(0, Math.round((agora - ts) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h` : `${Math.round(h / 24)} d`;
}

export function fmtHora(ts: number): string {
  return new Date(ts).toLocaleTimeString("pt-BR", { hour12: false });
}

export const fmtUSD = (v: number) => "$" + v.toFixed(v < 1 ? 4 : 2);
export const fmtTok = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n >= 10_000 ? 0 : 1) + "k" : String(n));
export const fmtPct = (v: number | null) => (v == null ? "—" : Math.round(v * 100) + "%");

// Tom visual por status de run/slice (classes Tailwind com os tokens ok/warn/err/run).
export function tomStatus(st: string): { texto: string; ponto: string; rotulo: string } {
  switch (st) {
    case "rodando": return { texto: "text-run", ponto: "bg-run", rotulo: "rodando" };
    case "COMPLETE": case "ok": return { texto: "text-ok", ponto: "bg-ok", rotulo: st === "ok" ? "ok" : "completa" };
    case "NEEDS-REVIEW": case "incompleta": return { texto: "text-warn", ponto: "bg-warn", rotulo: st === "incompleta" ? "incompleta" : "revisar" };
    case "GATE-FAILED": return { texto: "text-err", ponto: "bg-err", rotulo: "gate falhou" };
    case "ENV-FAILED": return { texto: "text-err", ponto: "bg-err", rotulo: "ambiente" };
    case "FAILED": return { texto: "text-err", ponto: "bg-err", rotulo: "falhou" };
    case "CANCELED": return { texto: "text-muted-foreground", ponto: "bg-muted-foreground", rotulo: "cancelada" };
    case "INTERROMPIDA": return { texto: "text-err", ponto: "bg-err", rotulo: "interrompida" };
    case "COMMIT-SKIP": return { texto: "text-warn", ponto: "bg-warn", rotulo: "sem commit" };
    case "pulada": return { texto: "text-muted-foreground", ponto: "bg-muted-foreground/50", rotulo: "pulada" };
    case "fila": return { texto: "text-muted-foreground", ponto: "bg-muted-foreground/40", rotulo: "na fila" };
    default: return { texto: "text-muted-foreground", ponto: "bg-muted-foreground", rotulo: st };
  }
}
