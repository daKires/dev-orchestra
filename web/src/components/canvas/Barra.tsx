// Barra flutuante do canvas no estilo Castor (F1.5 - S2): ferramenta ativa + atalhos (CA-F1).
// Componente bobo: so' escolhe a ferramenta (icone de 36px) e chama de volta pro Canvas. Desabilitada
// quando !conectado (bloquear). A criacao em si (clique/arrasto) mora no Canvas.
import { useRef, type ChangeEvent, type ReactNode } from "react";
import {
  ArrowUpRight, Circle, Diamond, Frame, Hand, Image as ImageIcon,
  MousePointer2, Square, StickyNote, Type,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Ferramenta, NomeForma } from "@/lib/canvas";

export type { NomeForma };

type Props = {
  bloquear: boolean;
  ferramenta: Ferramenta;
  onFerramenta: (f: Ferramenta) => void;
  onForma: (forma: NomeForma) => void;
  onImagem: (arquivo: File) => void;
};

const TAM = 36; // icone de 36px (Castor)

/** Classes comuns dos botoes de icone: 36px, raio 8, hover #fff2, ativo #2979ff. */
const classesBotao = (ativo?: boolean) =>
  cn(
    "grid shrink-0 place-items-center rounded-lg transition-colors",
    "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
    ativo ? "bg-[#2979ff] text-white hover:bg-[#2979ff]" : "text-[#b8b8b8] hover:bg-[#fff2]",
  );

const estiloBotao = { width: TAM, height: TAM } as const;

/** Botao so' de icone com tooltip PT-BR (atalho no titulo). */
function Botao({ titulo, ativo, disabled, onClick, children }: {
  titulo: string; ativo?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      aria-pressed={ativo}
      disabled={disabled}
      onClick={onClick}
      className={classesBotao(ativo)}
      style={estiloBotao}
    >
      {children}
    </button>
  );
}

export function Barra({ bloquear, ferramenta, onFerramenta, onForma, onImagem }: Props) {
  const arquivo = useRef<HTMLInputElement | null>(null);

  const escolherArquivo = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) onImagem(f);
    e.target.value = ""; // permite escolher o mesmo arquivo duas vezes
  };

  return (
    <div
      className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center"
      style={{
        background: "#222e",
        border: "1px solid #414141",
        borderRadius: 14,
        boxShadow: "0 10px 30px #0009",
        padding: 5,
        gap: 2,
      }}
    >
      <Botao titulo="Selecionar (V)" ativo={ferramenta === "selecionar"} onClick={() => onFerramenta("selecionar")}>
        <MousePointer2 className="size-4" />
      </Botao>
      <Botao titulo="Mão (H) — arrastar o canvas" ativo={ferramenta === "mao"} onClick={() => onFerramenta("mao")}>
        <Hand className="size-4" />
      </Botao>

      <Botao titulo="Nota (N)" ativo={ferramenta === "nota"} disabled={bloquear} onClick={() => onFerramenta("nota")}>
        <StickyNote className="size-4" />
      </Botao>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="Formas (clique e arraste)"
            aria-label="Formas"
            aria-pressed={ferramenta === "forma"}
            disabled={bloquear}
            className={classesBotao(ferramenta === "forma")}
            style={estiloBotao}
          >
            <Square className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="center" className="cv-menu min-w-36">
          <DropdownMenuItem onSelect={() => onForma("elipse")}>
            <Circle className="size-3.5" />Elipse
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onForma("retangulo")}>
            <Square className="size-3.5" />Retângulo
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onForma("losango")}>
            <Diamond className="size-3.5" />Losango
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Botao titulo="Imagem (envie um arquivo)" disabled={bloquear} onClick={() => arquivo.current?.click()}>
        <ImageIcon className="size-4" />
      </Botao>
      <input ref={arquivo} type="file" accept="image/*" className="hidden" onChange={escolherArquivo} />

      <Botao titulo="Região (R)" ativo={ferramenta === "regiao"} disabled={bloquear} onClick={() => onFerramenta("regiao")}>
        <Frame className="size-4" />
      </Botao>
      <Botao titulo="Seta (C) — ligue um nó a outro" ativo={ferramenta === "seta"} disabled={bloquear} onClick={() => onFerramenta("seta")}>
        <ArrowUpRight className="size-4" />
      </Botao>
      <Botao titulo="Texto (T)" ativo={ferramenta === "texto"} disabled={bloquear} onClick={() => onFerramenta("texto")}>
        <Type className="size-4" />
      </Botao>
    </div>
  );
}
