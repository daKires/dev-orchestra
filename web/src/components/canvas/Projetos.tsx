// Tela inicial do Canvas (S5): pilha de projetos no estilo Castor. GET /canvas/projetos enquanto os
// cards claros mostram a miniatura do grafo; "+ Projeto" e o menu ⋯ (Renomear / Cor) falam com o
// mesmo POST /canvas/projetos (X-Hermes: 1). Clicar num card chama onAbrir(raiz) e o App troca a
// tela de projetos pelo <Canvas projeto=...>.
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
import { miniatura } from "@/lib/canvas";
import type { Projeto, Snapshot } from "../../../../canvas.ts";

// Paleta das faixas de cabecalho dos projetos (mesmas cores das notas + laranja, como no Castor).
export const CORES_PROJETO = {
  laranja: "#ffb27a",
  amarelo: "#ffe066",
  rosa: "#f5c4dc",
  lilas: "#d6c8f5",
  azul: "#aabaff",
  verde: "#bfe8c8",
} as const;

export type NomeCorProjeto = keyof typeof CORES_PROJETO;

/** Faixa neutra (creme) de um projeto que ainda nao tem cor salva. */
export const COR_PADRAO = "#efeadd";

// Ordem exibida no menu "Cor" (PT-BR, como o Castor).
export const NOMES_COR: readonly NomeCorProjeto[] = ["laranja", "amarelo", "rosa", "lilas", "azul", "verde"];

// Rotacao leve alternada: os cards parecem uma pilha colocada a mao (Castor). Zera no hover/foco.
const ROTACOES = ["-rotate-[1.5deg]", "rotate-[1deg]"] as const;

const ehCor = (v: unknown): v is NomeCorProjeto =>
  typeof v === "string" && (NOMES_COR as readonly string[]).includes(v);

/** Faixa do cabecalho do projeto: a cor salva quando conhecida; senao, o creme padrao. */
export function corDoProjeto(p: Projeto): { nome: NomeCorProjeto | null; hex: string } {
  const nome = ehCor(p.cor) ? p.cor : null;
  return { nome, hex: nome ? CORES_PROJETO[nome] : COR_PADRAO };
}

/** Dimensoes do corpo do card (px): a miniatura do grafo desenha dentro desta caixa. */
export const MINI_LARGURA = 220;
export const MINI_ALTURA = 130;

// Miniatura do grafo (CA-P1): busca o snapshot do projeto e projeta nos/arestas em SVG.

function Miniatura({ raiz }: { raiz: string }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);

  useEffect(() => {
    let vivo = true;
    setSnap(null);
    fetch(`/canvas?projeto=${encodeURIComponent(raiz)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: Snapshot | null) => {
        if (!vivo || !j) return;
        if (Array.isArray(j.nos) && Array.isArray(j.arestas)) setSnap({ nos: j.nos, arestas: j.arestas });
      })
      .catch(() => {});
    return () => { vivo = false; };
  }, [raiz]);

  const m = snap ? miniatura(snap, MINI_LARGURA, MINI_ALTURA) : null;
  const vazio = !m || m.retangulos.length === 0;

  return (
    <svg
      width={MINI_LARGURA} height={MINI_ALTURA}
      viewBox={`0 0 ${MINI_LARGURA} ${MINI_ALTURA}`}
      role="img" aria-label={`Miniatura do canvas de ${raiz}`}
      className="block"
    >
      {vazio ? (
        <text
          x={MINI_LARGURA / 2} y={MINI_ALTURA / 2}
          textAnchor="middle" dominantBaseline="middle"
          fill="#9a9384" fontSize={13}
        >
          Canvas vazio
        </text>
      ) : (
        <>
          {m.linhas.map((l, i) => (
            <line key={`l${i}`} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#606060" strokeWidth={1.5} />
          ))}
          {m.retangulos.map((r, i) => (
            <rect key={`r${i}`} x={r.x} y={r.y} width={r.w} height={r.h} rx={3} fill={r.cor} />
          ))}
        </>
      )}
    </svg>
  );
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
    <div className="cv flex h-full flex-col overflow-auto" style={{ background: "#111" }}>
      <div className="flex shrink-0 items-start justify-between gap-3 px-8 pt-7 pb-5">
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 600, color: "#eee", lineHeight: 1.2 }}>Projetos</h1>
          <p style={{ marginTop: 4, fontSize: 13, color: "#858585" }}>Escolha um projeto para abrir o canvas.</p>
        </div>
        <Button
          size="sm"
          className="gap-1.5"
          style={{ backgroundColor: "#2979ff", color: "#fff" }}
          onClick={abrirNovo}
        >
          <Plus className="size-3.5" />Projeto
        </Button>
      </div>

      {carregando ? (
        <p className="px-8 text-sm" style={{ color: "#858585" }}>Carregando projetos…</p>
      ) : projetos.length === 0 ? (
        <div className="grid flex-1 place-items-center pb-12">
          <div className="text-center">
            <Folder className="mx-auto mb-2 size-8" style={{ color: "#858585" }} />
            <p className="text-sm" style={{ color: "#858585" }}>Nenhum projeto ainda.</p>
            <p className="mt-1 text-xs" style={{ color: "#6b6b6b" }}>Crie um com "+ Projeto".</p>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap content-start gap-6 px-8 pb-10">
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
                className={cn(
                  "group flex w-fit cursor-pointer flex-col overflow-hidden transition-transform duration-150 ease-out",
                  "hover:z-10 hover:rotate-0 focus-visible:rotate-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2979ff]",
                  ROTACOES[i % ROTACOES.length],
                )}
                style={{
                  background: "#f7f4ec",
                  border: "1px solid #e5e0d4",
                  borderRadius: 12,
                  boxShadow: "0 2px 5px #07132626, 0 18px 30px -8px #07132666",
                }}
              >
                <header className="flex items-center gap-2 px-3" style={{ height: 40, background: hex }}>
                  <Folder className="size-4 shrink-0" style={{ color: "#2b2b2b" }} strokeWidth={1.9} />
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ color: "#2b2b2b", fontSize: 14, fontWeight: 600 }}
                  >
                    {p.nome}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        title="Opções do projeto"
                        aria-label={`Opções de ${p.nome}`}
                        onClick={(e) => e.stopPropagation()}
                        className="grid size-6 shrink-0 place-items-center rounded hover:bg-black/10"
                        style={{ color: "#2b2b2b" }}
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
                </header>
                <div style={{ lineHeight: 0 }}>
                  <Miniatura raiz={p.raiz} />
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
