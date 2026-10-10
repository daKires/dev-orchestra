import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Loader2, Plus, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ANEXO_ACCEPT, ANEXO_MAX, corpoNovaFeature, nomeSeguroAnexo, podeCriarComPlanejador, problemaAnexo,
  projetosConhecidos, tamanhoLegivel, type Anexo, type Estado, type PlanejadorEscolha,
} from "@/lib/estado";
import { cn } from "@/lib/utils";

type Props = { estado: Estado; aberto: boolean; onAberto: (v: boolean) => void; projetoInicial?: string };

// Modelos do Claude Code: "" = Padrão (quem escolhe e' a conta), o resto vai como --model. Mesma lista
// do NovoAgente; o planejador escolhido pelo usuario aqui e' OBRIGATORIO (sem padrao).
const MODELOS_CLAUDE: readonly { valor: string; nome: string }[] = [
  { valor: "", nome: "Padrão" },
  { valor: "opus", nome: "opus" },
  { valor: "sonnet", nome: "sonnet" },
  { valor: "haiku", nome: "haiku" },
];

// Modelos do OpenCode disponiveis na pasta do projeto (GET /agentes/modelos?cwd=): mesmo endpoint que o
// NovoAgente usa (useAgentes.modelos). [] quando o serve do OpenCode ainda nao subiu naquela cwd.
async function carregarModelos(cwd: string): Promise<string[]> {
  try {
    const r = await fetch(`/agentes/modelos?cwd=${encodeURIComponent(cwd)}`);
    if (!r.ok) return [];
    const j: unknown = await r.json();
    return Array.isArray(j) ? j.filter((m): m is string => typeof m === "string") : [];
  } catch { return []; }
}

/** Classes de um select no mesmo tom dos campos do dialog (o Input do shadcn). */
const CLASSE_SELECT =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors " +
  "outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none " +
  "disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 dark:bg-input/30";

// Le um File como base64 puro (sem o prefixo "data:...;base64,"), que e' o que o hub espera em dadosB64.
function base64De(arquivo: File): Promise<string> {
  return new Promise((ok, falha) => {
    const fr = new FileReader();
    fr.onerror = () => falha(fr.error ?? new Error("falha ao ler " + arquivo.name));
    fr.onload = () => ok(String(fr.result ?? "").replace(/^data:[^,]*,/, ""));
    fr.readAsDataURL(arquivo);
  });
}

// Dialog "Nova feature": projeto (da lista de projetos conhecidos ou caminho colado) + feature +
// descricao OPCIONAL (multi-linha) + anexos OPCIONAIS (imagem/documento: ate' 10, 25MB cada) ->
// POST /nova-feature (header X-Hermes:1). O hub responde 202 e roda orchestra-go.ps1 em background,
// mandando o andamento pelo SSE ({novaFeature}); em 'ok' o dialog fecha e o App abre o chat do
// planejador novo no painel da direita (regra do App); em 'erro' a mensagem do hub aparece aqui.
// Regras do hub: 409 = ja existe uma criacao em andamento (uma por vez), 400 = pedido recusado.
// Sem descricao e sem anexos o corpo sai EXATAMENTE { projeto, feature } (compatibilidade).
export function NovaFeatureDialog({ estado, aberto, onAberto, projetoInicial }: Props) {
  const [projeto, setProjeto] = useState("");
  const [feature, setFeature] = useState("");
  const [descricao, setDescricao] = useState("");
  const [anexos, setAnexos] = useState<Anexo[]>([]);
  const [errosAnexo, setErrosAnexo] = useState<string[]>([]);
  const [arrastando, setArrastando] = useState(false);
  const [msg, setMsg] = useState("");
  const [erro, setErro] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [criando, setCriando] = useState(false); // 202 aceito: esperando o desfecho pelo SSE
  // Planejador escolhido (G2/S4b): sem padrao — o usuario TEM que escolher Claude ou OpenCode.
  const [planejador, setPlanejador] = useState<"claude" | "opencode" | null>(null);
  const [modelo, setModelo] = useState("");
  const [modelos, setModelos] = useState<string[]>([]);
  const pedido = useRef<{ projeto: string; feature: string } | null>(null);
  const seletorAnexos = useRef<HTMLInputElement>(null);
  const projetos = useMemo(() => projetosConhecidos(estado, estado.planejadores), [estado]);
  const nf = estado.novaFeature;
  const escolha: PlanejadorEscolha | undefined = planejador ? { planejador, modelo } : undefined;
  const pode = podeCriarComPlanejador(projeto, feature, escolha) && !enviando && !criando;

  // Fechar o dialog limpa o formulario (reabrir sempre comeca do zero).
  useEffect(() => {
    if (aberto) return;
    pedido.current = null;
    setProjeto(""); setFeature(""); setDescricao(""); setAnexos([]); setErrosAnexo([]); setArrastando(false);
    setMsg(""); setErro(false); setEnviando(false); setCriando(false);
    setPlanejador(null); setModelo(""); setModelos([]);
  }, [aberto]);

  // Abrir pelo canvas: o projeto do canvas ja' entra preenchido (o resto do formulario comeca vazio).
  // Abrir pelo botao do topo manda projetoInicial vazio, entao nada e' preenchido.
  useEffect(() => {
    if (!aberto || !projetoInicial) return;
    setProjeto(projetoInicial);
  }, [aberto, projetoInicial]);

  // Modelos do OpenCode da pasta do projeto (mesmo GET /agentes/modelos do NovoAgente). So' carrega
  // quando o planejador OpenCode esta' escolhido; trocar a pasta recarrega.
  useEffect(() => {
    if (!aberto || planejador !== "opencode" || !projeto.trim()) { setModelos([]); return; }
    let vivo = true;
    void carregarModelos(projeto.trim()).then((ms) => { if (vivo) setModelos(ms); });
    return () => { vivo = false; };
  }, [aberto, planejador, projeto]);

  /** Troca o planejador e zera o modelo: Padrão ("" = a conta decide) no Claude; sem padrao no OpenCode. */
  const escolherPlanejador = (p: "claude" | "opencode") => {
    setPlanejador(p);
    setModelo("");
  };

  // Acompanha o andamento pelo SSE: so' reage ao NOSSO pedido (projeto/feature ecoados pelo hub),
  // pra um pedido de outra sessao nao fechar/mexer neste formulario.
  useEffect(() => {
    const p = pedido.current;
    if (!aberto || !p || !nf || nf.status === "rodando") return;
    if (nf.projeto !== p.projeto || nf.feature !== p.feature) return;
    pedido.current = null;
    setCriando(false);
    // 'ok': fecha o dialog. Com url (OpenCode) o App abre o chat do planejador; com url vazia (Claude,
    // que roda no worktree) so' fechamos — o agente planejador aparece no canvas do projeto.
    if (nf.status === "ok") { onAberto(false); return; }
    setErro(true);
    setMsg(nf.erro || "Não deu pra criar a feature.");
  }, [aberto, nf, onAberto]);

  // Fila de anexos: cada arquivo passa por problemaAnexo (contando os ja' aceitos). Recusado vira
  // mensagem PT-BR ao lado do campo; aceito entra como chip (nome saneado + tamanho) e ja' e' lido
  // em base64, pra o chip e o payload usarem a mesma fonte.
  const adicionar = async (lista: File[]) => {
    if (!lista.length) return;
    const aceitos: Anexo[] = [];
    const recusados: string[] = [];
    let n = anexos.length;
    for (const f of lista) {
      const nome = nomeSeguroAnexo(f.name);
      const problema = problemaAnexo({ nome, tamanho: f.size }, n);
      if (problema) { recusados.push(`${nome || f.name}: ${problema}`); continue; }
      try {
        aceitos.push({ nome, tamanho: f.size, tipo: f.type || "application/octet-stream", dadosB64: await base64De(f) });
        n++;
      } catch {
        recusados.push(`${nome || f.name}: não deu pra ler o arquivo.`);
      }
    }
    if (aceitos.length) setAnexos((a) => [...a, ...aceitos]);
    setErrosAnexo(recusados);
  };

  const removerAnexo = (idx: number) => {
    setAnexos((a) => a.filter((_, i) => i !== idx));
    setErrosAnexo([]);
  };

  // Arrastar-e-soltar sobre a area do dialog: mesma regra do clique (input file multiple).
  const sobre = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    if (!arrastando) setArrastando(true);
  };

  const soltar = (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setArrastando(false);
    void adicionar([...(e.dataTransfer?.files ?? [])]);
  };

  const criar = async () => {
    if (!pode || !escolha) return;
    const corpo = corpoNovaFeature(projeto, feature, descricao, anexos, escolha);
    pedido.current = { projeto: corpo.projeto, feature: corpo.feature };
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
      <DialogContent
        className={cn("sm:max-w-lg", arrastando && "ring-2 ring-ring")}
        onDragEnter={sobre}
        onDragOver={sobre}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setArrastando(false); }}
        onDrop={soltar}
      >
        <DialogHeader>
          <DialogTitle>Nova feature</DialogTitle>
          <DialogDescription>
            Cria o worktree e sobe o planejador escolhido (Claude ou OpenCode) do projeto. Com o OpenCode
            o chat abre no painel da direita; com o Claude o agente planejador aparece no canvas. Descrição
            e anexos são opcionais.
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
          <div className="flex flex-col gap-1.5">
            <span id="nova-planejador" className="text-xs font-medium">
              Planejador <span className="font-normal text-muted-foreground">(obrigatório)</span>
            </span>
            <div className="flex gap-1.5" role="group" aria-labelledby="nova-planejador">
              {(["claude", "opencode"] as const).map((p) => (
                <button
                  key={p} type="button" aria-pressed={planejador === p}
                  className={cn("cv-insp-seg", planejador === p && "cv-insp-seg-on")}
                  style={{ font: "500 12px/1 ui-sans-serif, system-ui, sans-serif", padding: "7px 12px" }}
                  onClick={() => escolherPlanejador(p)}
                >
                  {p === "claude" ? "Claude" : "OpenCode"}
                </button>
              ))}
            </div>
            {planejador === "claude" && (
              <select
                aria-label="Modelo do Claude" value={modelo} className={CLASSE_SELECT}
                onChange={(e) => setModelo(e.target.value)}
              >
                {MODELOS_CLAUDE.map((m) => <option key={m.nome} value={m.valor}>{m.nome}</option>)}
              </select>
            )}
            {planejador === "opencode" && (
              <>
                {/* Campo LIVRE com sugestoes: a lista pode vir vazia (serve ainda nao subiu na pasta),
                    entao o usuario digita provider/modelo mesmo sem opcoes carregadas. */}
                <Input
                  aria-label="Modelo do OpenCode" list="modelos-opencode" value={modelo} autoComplete="off"
                  spellCheck={false} placeholder="opencode-go/glm-5.2" onChange={(e) => setModelo(e.target.value)}
                />
                <datalist id="modelos-opencode">
                  {modelos.map((m) => <option key={m} value={m} />)}
                </datalist>
              </>
            )}
            <p className="text-[11px] text-muted-foreground">
              {planejador === "claude"
                ? "O Claude Code planeja no worktree da feature; Padrão deixa o modelo a cargo da conta."
                : planejador === "opencode"
                  ? "Escolha um modelo provider/modelo do OpenCode desta pasta."
                  : "Escolha quem vai planejar a feature — Claude ou OpenCode."}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="nova-descricao" className="text-xs font-medium">
              Descrição <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Textarea
              id="nova-descricao" value={descricao} rows={4} spellCheck={false}
              placeholder="Contexto, objetivo e o que precisa entrar nesta feature..."
              onChange={(e) => setDescricao(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">Vai como contexto pro planejador; pode ficar em branco.</p>
          </div>
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="nova-anexos" className="text-xs font-medium">
                Anexos <span className="font-normal text-muted-foreground">({anexos.length}/{ANEXO_MAX}{" · opcional"})</span>
              </label>
              <Button
                type="button" variant="outline" size="sm" disabled={criando || enviando}
                onClick={() => seletorAnexos.current?.click()}
              >
                <Plus />Adicionar
              </Button>
            </div>
            <input
              id="nova-anexos" ref={seletorAnexos} type="file" multiple accept={ANEXO_ACCEPT} className="sr-only"
              onChange={(e) => { const l = [...(e.target.files ?? [])]; e.target.value = ""; void adicionar(l); }}
            />
            <p className="text-[11px] text-muted-foreground">
              {"10 anexos · 25MB cada · png/jpg/jpeg/gif/webp/pdf/txt/md/docx"} · arraste e solte aqui ou clique em Adicionar.
            </p>
            {anexos.length > 0 && (
              <ul className="flex flex-wrap gap-1.5">
                {anexos.map((a, i) => (
                  <li
                    key={a.nome + ":" + i}
                    className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 py-1 pr-1 pl-2 text-xs"
                  >
                    <span className="max-w-52 truncate" title={a.nome}>{a.nome}</span>
                    <span className="text-muted-foreground">{tamanhoLegivel(a.tamanho)}</span>
                    <button
                      type="button" title={`Remover ${a.nome}`} aria-label={`Remover ${a.nome}`}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => removerAnexo(i)}
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {errosAnexo.length > 0 && (
              <ul className="flex flex-col gap-1">
                {errosAnexo.map((t, i) => (
                  <li key={i} role="alert" className="text-[11px] text-err">{t}</li>
                ))}
              </ul>
            )}
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
