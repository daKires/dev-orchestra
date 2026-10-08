// Tela inicial do Canvas (S5): pilha de projetos no estilo Castor. GET /canvas/projetos enquanto os
// cards ficam empilhados/levemente rotacionados (icone de pasta, nome e fundo pastel conforme a cor).
// "+ Projeto" e o menu ⋯ (Renomear / Cor) falam com o mesmo POST /canvas/projetos (X-Hermes: 1).
// Clicar num card chama onAbrir(raiz) e o App troca a tela de projetos pelo <Canvas projeto=...>.
import { useEffect, useState } from "react";
import { Folder, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub, DropdownMenuSubContent,
  DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { Projeto } from "../../../../canvas.ts";

// Paleta pastel dos projetos (mesmas cores das notas + laranja, como no Castor).
export const CORES_PROJETO = {
  laranja: "#FFD8B0",
  amarelo: "#FFF3C4",
  rosa: "#FFD6E0",
  lilas: "#E7D8FF",
  azul: "#D6E8FF",
  verde: "#D6F5D6",
} as const;

export type NomeCorProjeto = keyof typeof CORES_PROJETO;

// Ordem exibida no menu "Cor" (PT-BR, como o Castor).
export const NOMES_COR: readonly NomeCorProjeto[] = ["laranja", "amarelo", "rosa", "lilas", "azul", "verde"];

// Rotacao leve alternada: os cards parecem uma pilha colocada a mao (Castor).
const ROTACOES = ["-rotate-1", "rotate-1", "-rotate-2", "rotate-2"] as const;

const ehCor = (v: unknown): v is NomeCorProjeto =>
  typeof v === "string" && (NOMES_COR as readonly string[]).includes(v);

// Cor deterministica quando o projeto ainda nao tem `cor`: sempre a mesma pra mesma raiz.
function corPadrao(raiz: string): NomeCorProjeto {
  let h = 0;
  for (const ch of raiz) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return NOMES_COR[Math.abs(h) % NOMES_COR.length];
}

/** Fundo pastel do projeto: usa a `cor` salva quando conhecida; senao, uma cor estavel pela raiz. */
export function corDoProjeto(p: Projeto): { nome: NomeCorProjeto; hex: string } {
  const nome = ehCor(p.cor) ? p.cor : corPadrao(p.raiz);
  return { nome, hex: CORES_PROJETO[nome] };
}

type Props = { onAbrir: (raiz: string) => void };

// Dialogo de criacao (`novo`) ou renomeacao (`projeto` presente): os dois usam o mesmo POST.
type Dialogo = { projeto?: Projeto } | null;

export function Projetos({ onAbrir }: Props) {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [dlg, setDlg] = useState<Dialogo>(null);
  const [pasta, setPasta] = useState("");
  const [nome, setNome] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const carregar = async () => {
    try {
      const r = await fetch("/canvas/projetos");
      const j = r.ok ? await r.json() : null;
      if (Array.isArray(j)) setProjetos(j as Projeto[]);
    } catch {
      /* sem hub: mantem o que ja' tem */
    } finally {
      setCarregando(false);
    }
  };

  useEffect(() => { void carregar(); }, []);

  // Mesmo POST pra criar, renomear e pintar (o hub faz upsert por raiz e preserva o que nao veio).
  const postar = async (corpo: { raiz: string; nome?: string; cor?: string }): Promise<boolean> => {
    try {
      const r = await fetch("/canvas/projetos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) return false;
      await carregar();
      return true;
    } catch {
      return false;
    }
  };

  const abrirNovo = () => { setPasta(""); setNome(""); setErro(""); setDlg({}); };
  const abrirRenomear = (p: Projeto) => { setNome(p.nome); setErro(""); setDlg({ projeto: p }); };

  const confirmar = async () => {
    const renomeando = dlg?.projeto;
    const raiz = renomeando?.raiz ?? pasta.trim();
    const limpo = nome.trim();
    if (!raiz) { setErro("Informe a pasta do projeto."); return; }
    setSalvando(true);
    setErro("");
    const ok = await postar({ raiz, nome: limpo || undefined });
    setSalvando(false);
    if (!ok) { setErro("O hub recusou o pedido. Confira a pasta e tente de novo."); return; }
    setDlg(null);
  };

  const pintar = async (p: Projeto, cor: NomeCorProjeto) => { await postar({ raiz: p.raiz, cor }); };

  const podeSalvar = !!dlg?.projeto || pasta.trim() !== "";

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex shrink-0 items-center justify-between gap-3 px-6 py-4">
        <div>
          <h1 className="text-base font-semibold tracking-tight">Projetos</h1>
          <p className="text-xs text-muted-foreground">Escolha um projeto para abrir o canvas.</p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={abrirNovo}>
          <Plus className="size-3.5" />Projeto
        </Button>
      </div>

      {carregando ? (
        <p className="px-6 text-sm text-muted-foreground">Carregando projetos…</p>
      ) : projetos.length === 0 ? (
        <div className="grid flex-1 place-items-center pb-12">
          <div className="text-center">
            <Folder className="mx-auto mb-2 size-8 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">Nenhum projeto ainda.</p>
            <p className="mt-1 text-xs text-muted-foreground/70">Crie um com "+ Projeto".</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap content-start gap-5 px-6 pb-8">
          {projetos.map((p, i) => {
            const { hex } = corDoProjeto(p);
            return (
              <div
                key={p.raiz}
                role="button"
                tabIndex={0}
                title={p.raiz}
                onClick={() => onAbrir(p.raiz)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onAbrir(p.raiz); }
                }}
                style={{ backgroundColor: hex }}
                className={cn(
                  "group relative flex w-44 cursor-pointer flex-col gap-2 rounded-xl p-3 text-slate-900 shadow-md ring-1 ring-black/10 transition-transform duration-150",
                  "hover:z-10 hover:rotate-0 hover:shadow-lg focus-visible:rotate-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                  ROTACOES[i % ROTACOES.length],
                )}
              >
                <div className="flex items-start justify-between">
                  <Folder className="size-7 text-slate-700" strokeWidth={1.75} />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title="Opções do projeto"
                        aria-label={`Opções de ${p.nome}`}
                        onClick={(e) => e.stopPropagation()}
                        className="rounded p-1 text-slate-700/70 hover:bg-black/10 hover:text-slate-900"
                      >
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => abrirRenomear(p)}>Renomear</DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>Cor</DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {NOMES_COR.map((c) => (
                            <DropdownMenuItem key={c} onSelect={() => void pintar(p, c)} className="gap-2 capitalize">
                              <span
                                aria-hidden
                                className="size-3.5 rounded-full ring-1 ring-black/15"
                                style={{ backgroundColor: CORES_PROJETO[c] }}
                              />
                              {c}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{p.nome}</p>
                  <p className="truncate text-[11px] text-slate-700/80">{p.raiz}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={!!dlg} onOpenChange={(o) => { if (!o) setDlg(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dlg?.projeto ? "Renomear projeto" : "Novo projeto"}</DialogTitle>
            <DialogDescription>
              {dlg?.projeto
                ? "O novo nome aparece no card do canvas."
                : "Informe a pasta do projeto e um nome. No canvas, clique no card para abrir o grafo."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => { e.preventDefault(); void confirmar(); }}
          >
            {dlg?.projeto ? (
              <p className="truncate rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground" title={dlg.projeto.raiz}>
                {dlg.projeto.raiz}
              </p>
            ) : (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="projeto-pasta" className="text-xs font-medium">Pasta (caminho absoluto)</label>
                <Input
                  id="projeto-pasta" value={pasta} autoComplete="off" spellCheck={false} autoFocus
                  placeholder="D:\\pasta\\do\\projeto" onChange={(e) => setPasta(e.target.value)}
                />
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <label htmlFor="projeto-nome" className="text-xs font-medium">Nome</label>
              <Input
                id="projeto-nome" value={nome} autoComplete="off" spellCheck={false}
                placeholder="ex.: Meu site" onChange={(e) => setNome(e.target.value)}
              />
            </div>
            {erro && <p role="alert" className="text-xs text-err">{erro}</p>}
          </form>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="button" disabled={!podeSalvar || salvando} onClick={() => void confirmar()}>
              {dlg?.projeto ? "Renomear" : "Criar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default Projetos;
