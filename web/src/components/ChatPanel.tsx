import { ExternalLink, History, MessageSquare, X } from "lucide-react";
import type { Planejador } from "../../../ui.ts";
import { cn } from "@/lib/utils";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Props = {
  chats: Planejador[];              // abas visiveis (nao fechadas)
  escondidos: Planejador[];         // fechados deste projeto — conteudo do menu "Reabrir chat"
  ativo: string;                    // slug do planejador selecionado
  onAtivo: (slug: string) => void;
  onFechar: (slug: string) => void; // fecha (esconde) a aba; nao encerra o planejador
  onReabrir: (slug: string) => void; // tira o slug dos fechados e o seleciona
};

const tituloDe = (c: Planejador) => (c.feature ? `${c.slug} · ${c.feature}` : c.slug);

// Painel de chat do planejador (orchestra-go.ps1), split a DIREITA da area principal. Abas estilo
// editor (uma por planejador do projeto da run) + iframe com o chat do ativo. Sem visiveis mas com
// escondidos fica em modo "so-menu" (so' a barra com o menu reabrir); sem nenhum o painel nao existe.
export function ChatPanel(p: Props) {
  if (p.chats.length === 0 && p.escondidos.length === 0) return null;
  const sel = p.chats.find((c) => c.slug === p.ativo) ?? p.chats[0] ?? null;
  return (
    <div className="flex h-full flex-col bg-background">
      <div role="tablist" className="flex h-9 shrink-0 items-stretch overflow-x-auto border-b bg-sidebar [scrollbar-width:none]">
        {p.chats.map((c) => {
          const ativa = c.slug === sel?.slug;
          const titulo = tituloDe(c);
          return (
            <div
              key={c.slug} role="tab" aria-selected={ativa} title={titulo}
              onClick={() => p.onAtivo(c.slug)}
              onAuxClick={(e) => { if (e.button === 1) p.onFechar(c.slug); }}
              className={cn(
                "group relative flex shrink-0 cursor-pointer items-center gap-1.5 border-r px-3 text-[12.5px] text-muted-foreground select-none hover:text-foreground",
                ativa && "bg-background text-foreground",
              )}
            >
              {ativa && <span className="absolute inset-x-0 top-0 h-px bg-primary" />}
              <MessageSquare className="size-3.5 text-primary/80" />
              <span className="max-w-[16rem] truncate">{titulo}</span>
              {/* X aparece no hover da aba (estilo editor); na ativa fica sempre acessivel */}
              <button
                aria-label={"Fechar " + c.slug} title="Fechar aba"
                onClick={(e) => { e.stopPropagation(); p.onFechar(c.slug); }}
                className={cn(
                  "ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground",
                  ativa && "opacity-70",
                )}
              >
                <X className="size-3" />
              </button>
            </div>
          );
        })}
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-2">
          {sel && (
            <button
              aria-label="Abrir chat em outra aba" title="Abrir em outra aba"
              onClick={() => window.open(sel.url, "_blank")}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="size-3.5" />
            </button>
          )}
          {p.escondidos.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Reabrir chat" title="Reabrir chat"
                  className="flex items-center gap-1 rounded px-1.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
                >
                  <History className="size-3.5" />
                  Reabrir chat
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[14rem]">
                <DropdownMenuLabel>Reabrir chat</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {p.escondidos.map((c) => (
                  <DropdownMenuItem key={c.slug} title={tituloDe(c)} onSelect={() => p.onReabrir(c.slug)} className="cursor-pointer">
                    <MessageSquare className="size-3.5 text-primary/80" />
                    <span className="max-w-[16rem] truncate">{tituloDe(c)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {sel && (
        <div className="min-h-0 flex-1 bg-background">
          <iframe
            key={sel.slug} src={sel.url} title={`Chat do planejador ${sel.slug}`}
            className="h-full w-full border-0"
          />
        </div>
      )}
    </div>
  );
}
