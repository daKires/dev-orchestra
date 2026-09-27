import { ExternalLink, MessageSquare } from "lucide-react";
import type { Planejador } from "../../../ui.ts";
import { cn } from "@/lib/utils";

type Props = {
  chats: Planejador[];
  ativo: string;                 // slug do planejador selecionado
  onAtivo: (slug: string) => void;
};

// Painel de chat do planejador (orchestra-go.ps1), split a DIREITA da area principal. Abas estilo
// editor (uma por planejador do projeto da run) + iframe com o chat do ativo; so' existe se ha chats.
export function ChatPanel(p: Props) {
  if (p.chats.length === 0) return null;
  const sel = p.chats.find((c) => c.slug === p.ativo) ?? p.chats[0];
  return (
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar [scrollbar-width:none]">
        {p.chats.map((c) => {
          const ativa = c.slug === sel.slug;
          const titulo = c.feature ? `${c.slug} · ${c.feature}` : c.slug;
          return (
            <div
              key={c.slug} role="tab" aria-selected={ativa} title={titulo}
              onClick={() => p.onAtivo(c.slug)}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[12.5px] text-muted-foreground select-none hover:text-foreground",
                ativa && "bg-background text-foreground",
              )}
            >
              {ativa && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
              <MessageSquare className="size-3.5 text-primary/80" />
              <span className="max-w-[16rem] truncate">{titulo}</span>
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center pr-2">
          <button
            aria-label="Abrir chat em outra aba" title="Abrir em outra aba"
            onClick={() => window.open(sel.url, "_blank")}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 bg-background">
        <iframe
          key={sel.slug} src={sel.url} title={`Chat do planejador ${sel.slug}`}
          className="h-full w-full border-0"
        />
      </div>
    </div>
  );
}
