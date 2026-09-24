import { CircleCheck, CircleDashed, CircleMinus, LoaderCircle, TriangleAlert, CircleX, Ban } from "lucide-react";
import { cn } from "@/lib/utils";

// Icone por status de slice/run. "rodando" gira; o resto e' estatico.
export function StatusIcon({ status, className }: { status: string; className?: string }) {
  const c = cn("size-3.5 shrink-0", className);
  switch (status) {
    case "rodando": return <LoaderCircle className={cn(c, "animate-spin text-run")} />;
    case "ok": case "COMPLETE": return <CircleCheck className={cn(c, "text-ok")} />;
    case "incompleta": case "NEEDS-REVIEW": case "COMMIT-SKIP": return <TriangleAlert className={cn(c, "text-warn")} />;
    case "GATE-FAILED": case "FAILED": case "INTERROMPIDA": return <CircleX className={cn(c, "text-err")} />;
    case "CANCELED": return <Ban className={cn(c, "text-muted-foreground")} />;
    case "pulada": return <CircleMinus className={cn(c, "text-muted-foreground/60")} />;
    default: return <CircleDashed className={cn(c, "text-muted-foreground/50")} />;
  }
}

// Ponto de status da run; pulsa enquanto roda.
export function PontoStatus({ rodando, cor }: { rodando: boolean; cor: string }) {
  return (
    <span className="relative flex size-2 shrink-0">
      {rodando && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", cor)} />}
      <span className={cn("relative inline-flex size-2 rounded-full", cor)} />
    </span>
  );
}
