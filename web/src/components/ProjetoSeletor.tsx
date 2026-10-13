// Seletor de projeto da topbar (tela unida, Run A): um DropdownMenu com os projetos do hub
// (GET /canvas/projetos — nome + raiz em mono pequena) e o item "+ Projeto", que abre um Dialog pra
// criar um projeto novo (mesmo POST /canvas/projetos com X-Hermes: 1 do Projetos.tsx). Ao criar, o
// projeto novo ja' fica selecionado (onProjeto). UI em PT-BR, so' tema escuro.
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Folder, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { Projeto } from "../../../canvas.ts";

/** Chave canonica de uma raiz (barras '/', sem barra final, minuscula): mesma regra do hub. */
function canonico(raiz: string): string {
  return String(raiz ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** Nome de exibicao da ultima pasta de um caminho (fallback quando o hub ainda nao respondeu). */
function nomeDaPasta(raiz: string): string {
  const partes = String(raiz ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).filter(Boolean);
  return partes.length ? partes[partes.length - 1] : "";
}

type Props = {
  /** Raiz do projeto mostrado (vazio = nenhum escolhido ainda). */
  projeto: string;
  /** Escolheu um projeto (no dropdown ou recem-criado): o dono da tela grava e troca o canvas. */
  onProjeto: (raiz: string) => void;
};

export function ProjetoSeletor({ projeto, onProjeto }: Props) {
  const [projetos, setProjetos] = useState<Projeto[]>([]);
  const [dlg, setDlg] = useState(false);
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
    }
  };

  useEffect(() => { void carregar(); }, []);

  // Nome mostrado no trigger: o salvo pelo hub (mesma raiz) ou a ultima pasta do caminho.
  const rotulo = useMemo(() => {
    const salvo = projetos.find((p) => canonico(p.raiz) === canonico(projeto));
    return salvo?.nome || nomeDaPasta(projeto);
  }, [projetos, projeto]);

  const abrirNovo = () => { setPasta(""); setNome(""); setErro(""); setDlg(true); };

  // Mesmo POST do Projetos.tsx: upsert por raiz (preserva o que nao veio). Ao criar, seleciona o novo.
  const criar = async () => {
    const raiz = pasta.trim();
    if (!raiz) { setErro("Informe a pasta do projeto."); return; }
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch("/canvas/projetos", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify({ raiz, nome: nome.trim() || undefined }),
      });
      if (!r.ok) { setErro("O hub recusou o pedido. Confira a pasta e tente de novo."); return; }
      await carregar();
      setDlg(false);
      onProjeto(raiz);
    } catch {
      setErro("Não deu pra falar com o hub. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={projeto || "Escolher projeto"}
            aria-label="Escolher projeto"
            className="flex h-6.5 min-w-0 max-w-72 shrink-0 items-center gap-1.5 rounded-md border bg-background/40 px-2 text-xs transition-colors hover:bg-background/70"
          >
            <Folder className="size-3.5 shrink-0 text-run" />
            <span className="min-w-0 truncate">{rotulo || "Escolher projeto"}</span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-64">
          <DropdownMenuLabel>Projetos</DropdownMenuLabel>
          {projetos.length === 0 ? (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhum projeto ainda.</p>
          ) : projetos.map((p) => (
            <DropdownMenuItem key={p.raiz} onSelect={() => onProjeto(p.raiz)} className="gap-2">
              <span className="min-w-0 truncate">{p.nome}</span>
              <span className="ml-auto max-w-40 truncate font-mono text-[10.5px] text-muted-foreground" title={p.raiz}>
                {p.raiz}
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={abrirNovo}>
            <Plus className="size-3.5" />Projeto
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dlg} onOpenChange={(o) => { if (!o) setDlg(false); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo projeto</DialogTitle>
            <DialogDescription>
              Informe a pasta do projeto e um nome. No canvas, os runs e os cards ficam salvos por projeto.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="seletor-projeto-pasta" className="text-xs font-medium">Pasta (caminho absoluto)</label>
              <Input
                id="seletor-projeto-pasta" value={pasta} autoComplete="off" spellCheck={false} autoFocus
                placeholder="D:\\pasta\\do\\projeto" onChange={(e) => setPasta(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="seletor-projeto-nome" className="text-xs font-medium">Nome</label>
              <Input
                id="seletor-projeto-nome" value={nome} autoComplete="off" spellCheck={false}
                placeholder="ex.: Meu site" onChange={(e) => setNome(e.target.value)}
              />
            </div>
            {erro && <p role="alert" className="text-xs text-err">{erro}</p>}
          </form>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancelar</Button>
            </DialogClose>
            <Button type="button" disabled={pasta.trim() === "" || salvando} onClick={() => void criar()}>
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default ProjetoSeletor;
