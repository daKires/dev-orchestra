// Barra flutuante do canvas (S4): cria nota/elipse/retangulo/losango e agrupa os selecionados.
// Componente bobo: so' chama de volta pro Canvas. Desabilitado quando !conectado (bloquear).
import { Circle, Diamond, Group, Plus, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

export type NomeForma = "elipse" | "retangulo" | "losango";

type Props = {
  bloquear: boolean;
  onNota: () => void;
  onForma: (forma: NomeForma) => void;
  onAgrupar: () => void;
};

export function Barra({ bloquear, onNota, onForma, onAgrupar }: Props) {
  return (
    <div className="pointer-events-auto absolute top-3 left-3 z-20 flex items-center gap-0.5 rounded-xl border border-border bg-card/95 p-1 shadow-lg backdrop-blur">
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={bloquear} title="Nova nota" onClick={onNota}>
        <Plus className="size-3.5" />Nota
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={bloquear} title="Nova elipse" onClick={() => onForma("elipse")}>
        <Circle className="size-3.5" />Elipse
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={bloquear} title="Novo retângulo" onClick={() => onForma("retangulo")}>
        <Square className="size-3.5" />Retângulo
      </Button>
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={bloquear} title="Novo losango" onClick={() => onForma("losango")}>
        <Diamond className="size-3.5" />Losango
      </Button>
      <span className="mx-0.5 h-5 w-px bg-border" />
      <Button size="sm" variant="ghost" className="gap-1.5" disabled={bloquear} title="Agrupar os selecionados" onClick={onAgrupar}>
        <Group className="size-3.5" />Agrupar
      </Button>
    </div>
  );
}
