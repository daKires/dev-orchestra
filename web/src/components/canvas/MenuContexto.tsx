// Menu de contexto do canvas no visual do Castor (F1.5 - S3b): clique direito num no' oferece
// Duplicar / Cor (submenu com a paleta do tipo) / Trazer para frente / Enviar para tras / Apagar; no
// vazio, Nova nota aqui / Colar. Construido sobre o ContextMenu do pacote `radix-ui` (mesma familia do
// DropdownMenu dos cards). O Radix posiciona o menu pelo contextmenu nativo no gatilho; como o Canvas
// registra o alvo por conta propria (onNode/PaneContextMenu), reenviamos um contextmenu sintetico no
// ponto do clique. UI em PT-BR, so' tema escuro.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ContextMenu } from "radix-ui";
import { Check, ChevronRight, ClipboardPaste, Copy, Layers, StickyNote, Trash2 } from "lucide-react";
import { CORES_FORMA, CORES_NOTA, CORES_REGIAO } from "@/lib/canvas";
import type { No } from "../../../../canvas.ts";

// Tipos

// Onde o clique direito aconteceu: num no' (id + ponto na tela) ou no vazio (ponto na tela + ponto no
// plano do canvas, usado pra criar a nota no lugar certo).
export type MenuAlvo =
  | { tipo: "no"; id: string; x: number; y: number }
  | { tipo: "pane"; x: number; y: number; fx: number; fy: number };

// Acoes que o menu chama de volta pro Canvas (o Canvas decide o que vira op pro hub).
export type MenuAcoes = {
  duplicar: (id: string) => void;
  mudarCor: (id: string, cor: string) => void;
  paraFrente: (id: string) => void;
  paraTras: (id: string) => void;
  apagar: (id: string) => void;
  novaNota: (x: number, y: number) => void;
  colar: () => void;
};

export type MenuContextoProps = {
  alvo: MenuAlvo | null;
  /** No' do alvo (tipo/paleta) quando `alvo.tipo === "no"`. */
  no?: No;
  acoes: MenuAcoes;
  /** Fecha o menu (limpa o alvo no Canvas). */
  onFechar: () => void;
  children: ReactNode;
};

// Paletas / rotulos

const ROTULO_COR: Record<string, string> = {
  amarelo: "Amarelo", rosa: "Rosa", lilas: "Lilás", azul: "Azul", verde: "Verde",
  cinza: "Cinza", vermelho: "Vermelho",
};

/** Paleta de cores de um tipo (mesma regra do render: o que nao tem paleta cai na da nota). */
function paletaDoTipo(tipo: No["tipo"]): Record<string, string> {
  if (tipo === "forma") return CORES_FORMA;
  if (tipo === "grupo") return CORES_REGIAO;
  return CORES_NOTA;
}

/** Chave da paleta guardada em dados.cor; cai no padrao quando ausente/desconhecida. */
function corAtual(paleta: Record<string, string>, valor: unknown, padrao: string): string {
  return typeof valor === "string" && valor in paleta ? valor : padrao;
}

// Itens

function Item({ children, onSelect }: { children: ReactNode; onSelect: () => void }) {
  return (
    <ContextMenu.Item className="cv-ctx-item" onSelect={onSelect}>
      {children}
    </ContextMenu.Item>
  );
}

/** Itens do menu de um no' (Duplicar, Cor, ordem z e Apagar). */
function ItensNo({ no, acoes }: { no: No; acoes: MenuAcoes }) {
  const paleta = paletaDoTipo(no.tipo);
  const padrao = no.tipo === "forma" || no.tipo === "grupo" ? "cinza" : "amarelo";
  const atual = corAtual(paleta, (no.dados as { cor?: unknown }).cor, padrao);
  return (
    <>
      <Item onSelect={() => acoes.duplicar(no.id)}>
        <Copy className="size-3.5 shrink-0 opacity-70" /> Duplicar
      </Item>
      <ContextMenu.Sub>
        <ContextMenu.SubTrigger className="cv-ctx-item">
          <Layers className="size-3.5 shrink-0 opacity-70" /> Cor
          <ChevronRight className="cv-ctx-seta size-3.5 shrink-0 opacity-70" />
        </ContextMenu.SubTrigger>
        <ContextMenu.Portal>
          <ContextMenu.SubContent className="cv-ctx" sideOffset={4} alignOffset={-6}>
            {Object.entries(paleta).map(([nome, cor]) => (
              <ContextMenu.Item key={nome} className="cv-ctx-item" onSelect={() => acoes.mudarCor(no.id, nome)}>
                <span className="size-3 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: cor }} />
                {ROTULO_COR[nome] ?? nome}
                {nome === atual ? <Check className="ml-auto size-3.5 shrink-0" /> : null}
              </ContextMenu.Item>
            ))}
          </ContextMenu.SubContent>
        </ContextMenu.Portal>
      </ContextMenu.Sub>
      <ContextMenu.Separator className="cv-ctx-sep" />
      <Item onSelect={() => acoes.paraFrente(no.id)}>Trazer para frente</Item>
      <Item onSelect={() => acoes.paraTras(no.id)}>Enviar para trás</Item>
      <ContextMenu.Separator className="cv-ctx-sep" />
      <Item onSelect={() => acoes.apagar(no.id)}>
        <Trash2 className="size-3.5 shrink-0 opacity-70" /> Apagar
      </Item>
    </>
  );
}

/** Itens do menu do vazio (Nova nota aqui / Colar). */
function ItensPane({ alvo, acoes }: { alvo: Extract<MenuAlvo, { tipo: "pane" }>; acoes: MenuAcoes }) {
  return (
    <>
      <Item onSelect={() => acoes.novaNota(alvo.fx, alvo.fy)}>
        <StickyNote className="size-3.5 shrink-0 opacity-70" /> Nova nota aqui
      </Item>
      <Item onSelect={() => acoes.colar()}>
        <ClipboardPaste className="size-3.5 shrink-0 opacity-70" /> Colar
      </Item>
    </>
  );
}

// MenuContexto

export function MenuContexto({ alvo, no, acoes, onFechar, children }: MenuContextoProps) {
  const gatilho = useRef<HTMLSpanElement>(null);
  const [aberto, setAberto] = useState(false);

  // Posiciona o menu no ponto do clique: o Radix aprende a posicao pelo contextmenu nativo no gatilho,
  // entao reenviamos o evento sinteticamente quando o Canvas registra o alvo.
  useEffect(() => {
    if (!alvo) { setAberto(false); return; }
    const el = gatilho.current;
    if (!el) return;
    el.dispatchEvent(new MouseEvent("contextmenu", {
      bubbles: true, cancelable: true, view: window, clientX: alvo.x, clientY: alvo.y,
    }));
    setAberto(true);
  }, [alvo]);

  return (
    <ContextMenu.Root
      open={aberto}
      onOpenChange={(o) => { if (!o) { setAberto(false); onFechar(); } }}
    >
      <ContextMenu.Trigger ref={gatilho} className="contents">
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className="cv-ctx" collisionPadding={8}>
          {alvo?.tipo === "no" && no ? (
            <ItensNo no={no} acoes={acoes} />
          ) : alvo?.tipo === "pane" ? (
            <ItensPane alvo={alvo} acoes={acoes} />
          ) : null}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

export default MenuContexto;
