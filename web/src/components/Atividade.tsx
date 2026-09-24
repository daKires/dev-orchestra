import type { Run } from "@/lib/estado";
import { fmtDur, fmtTok } from "@/lib/formato";

// Texto curto do que a run esta fazendo agora: "gerando… ~1.2k tok" ou "rodando lune… 34s".
export function textoAtividade(r: Run, agora: number): string | null {
  const a = r.atividade;
  if (!a) return null;
  if (a.tipo === "gerando") return `gerando… ~${fmtTok(a.tokens)} tok`;
  const exe = a.cmd.replace(/^"[^"]*[\\/]([^"\\/]+)"/, "$1").replace(/^\S*[\\/]/, "").slice(0, 40);
  return `rodando ${exe} · ${fmtDur(agora - a.desde)}`;
}
