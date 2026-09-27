import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { podeCriar, projetosConhecidos, type Estado } from "@/lib/estado";
import { cn } from "@/lib/utils";

type Props = { estado: Estado; aberto: boolean; onAberto: (v: boolean) => void };

// Dialog "Nova feature": projeto (da lista de projetos conhecidos ou caminho colado) + feature ->
// POST /nova-feature (header X-Hermes:1). O hub responde 202 e roda orchestra-go.ps1 em background,
// mandando o andamento pelo SSE ({novaFeature}); em 'ok' o dialog fecha e o App abre o chat do
// planejador novo no painel da direita (regra do App); em 'erro' a mensagem do hub aparece aqui.
// Regras do hub: 409 = ja existe uma criacao em andamento (uma por vez), 400 = pedido recusado.
export function NovaFeatureDialog({ estado, aberto, onAberto }: Props) {
  const [projeto, setProjeto] = useState("");
  const [feature, setFeature] = useState("");
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [criando, setCriando] = useState(false); // 202 aceito: esperando o desfecho pelo SSE
  const pedido = useRef<{ projeto: string; feature: string } | null>(null);
  const projetos = useMemo(() => projetosConhecidos(estado, estado.planejadores), [estado]);
  const nf = estado.novaFeature;
  const pode = podeCriar(projeto, feature) && !enviando && !criando;

  // Fechar o dialog limpa o formulario (reabrir sempre comeca do zero).
  useEffect(() => {
    if (aberto) return;
    pedido.current = null;
    setProjeto(""); setFeature(""); setMsg(""); setErro(false); setEnviando(false); setCriando(false);
  }, [aberto]);

  // Acompanha o andamento pelo SSE: so' reage ao NOSSO pedido (projeto/feature ecoados pelo hub),
  // pra um pedido de outra sessao nao fechar/mexer neste formulario.
  useEffect(() => {
    const p = pedido.current;
    if (!aberto || !p || !nf || nf.status === "rodando") return;
    if (nf.projeto !== p.projeto || nf.feature !== p.feature) return;
    pedido.current = null;
    setCriando(false);
    if (nf.status === "ok") { onAberto(false); return; }
    setErro(true);
    setMsg(nf.erro || "Não deu pra criar a feature.");
  }, [aberto, nf, onAberto]);

  const criar = async () => {
    if (!pode) return;
    const corpo = { projeto: projeto.trim(), feature: feature.trim() };
    pedido.current = corpo;
    setEnviando(true); setErro(false); setMsg("");
    try {
      const res = await fetch("/nova-feature", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify(corpo),
      });
      setEnviando(false);
      if (!pedido.current) return; // o SSE ja' deu o desfecho antes da resposta HTTP
      if (res.status === 202) {
        setCriando(true);
        setMsg("criando worktree... (pode levar 1-2 min)");
        return;
      }
      pedido.current = null;
      setErro(true);
      setMsg(
        res.status === 409 ? "Já existe uma criação em andamento."
          : res.status === 400 ? "Pedido recusado pelo hub. Confira o projeto e a feature e tente de novo."
            : `O hub recusou o pedido (HTTP ${res.status}).`,
      );
    } catch (e) {
      setEnviando(false);
      pedido.current = null;
      setErro(true);
      setMsg("Não deu pra falar com o hub: " + String((e as Error).message));
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova feature</DialogTitle>
          <DialogDescription>
            Cria o worktree e sobe o planejador (orchestra-go.ps1) do projeto escolhido. O chat abre no
            painel da direita assim que o worktree ficar pronto.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void criar(); }}>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nova-projeto" className="text-xs font-medium">Projeto</label>
            <Input
              id="nova-projeto" list="projetos-conhecidos" value={projeto} autoComplete="off" spellCheck={false}
              placeholder="D:\\pasta\\do\\projeto" onChange={(e) => setProjeto(e.target.value)}
            />
            <datalist id="projetos-conhecidos">
              {projetos.map((p) => <option key={p} value={p} />)}
            </datalist>
            <p className="text-[11px] text-muted-foreground">Escolha um projeto já usado ou cole o caminho da pasta.</p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nova-feature" className="text-xs font-medium">Feature</label>
            <Input
              id="nova-feature" value={feature} autoComplete="off" spellCheck={false}
              placeholder="ex.: relatorio-mensal" onChange={(e) => setFeature(e.target.value)}
            />
          </div>
        </form>
        {msg && <p role="status" className={cn("text-sm", erro ? "text-err" : "text-muted-foreground")}>{msg}</p>}
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">Cancelar</Button>
          </DialogClose>
          <Button type="button" disabled={!pode} onClick={() => void criar()}>
            {criando ? <Loader2 className="animate-spin" /> : <Plus />}Criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}