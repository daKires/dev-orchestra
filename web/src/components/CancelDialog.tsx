import { useState } from "react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Run } from "@/lib/estado";

type Props = { r: Run | null; aberto: boolean; onAberto: (v: boolean) => void };

// Pede o cancelamento pro hub (POST /cancel); o processo dono da run ve o pedido em ate 1s.
export function CancelDialog({ r, aberto, onAberto }: Props) {
  const [erro, setErro] = useState("");
  const cancelar = async () => {
    if (!r) return;
    setErro("");
    try {
      const res = await fetch(`/cancel?run=${encodeURIComponent(r.id)}`, { method: "POST", headers: { "X-Dev-Orchestra": "1" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      onAberto(false);
    } catch (e) {
      setErro("Não deu pra pedir o cancelamento: " + String((e as Error).message));
    }
  };
  return (
    <AlertDialog open={aberto} onOpenChange={(v) => { onAberto(v); if (!v) setErro(""); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Cancelar esta run?</AlertDialogTitle>
          <AlertDialogDescription>
            O swarm para em até 2 segundos: nenhuma slice nova roda, o gate não roda e <strong>nada é commitado</strong>.
            Os arquivos já editados ficam no working tree; o comando REVERTER aparece no painel final.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {erro && <p className="text-sm text-err">{erro}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Continuar rodando</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={(e) => { e.preventDefault(); void cancelar(); }}>Cancelar run</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
