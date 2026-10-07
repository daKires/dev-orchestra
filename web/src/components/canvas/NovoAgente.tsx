// Novo agente (F2 S6): dialog no estilo do Inspetor (#1c1c1c, borda #414141, raio 14) para criar um
// agente do canvas. So' fala com o hub (POST /agentes) e avisa o Canvas (onCriar) — posicionar o no'
// `ag:<id>` no centro visivel e' responsabilidade do Canvas. UI em PT-BR, so' tema escuro.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// Papeis com os textos padrao PT-BR COPIADOS de PAPEIS do hub (agentes.ts) — nada de import de runtime
// do hub aqui. O `<id>` e' substituido pelo hub em runtime; na UI fica literal, so' como template.
const PAPEIS = {
  lider: {
    nome: "Líder",
    instrucao: "Você é o Líder do time: leia .orchestra/contexto/<id>/README.md e coordene os outros agentes.",
  },
  designer: {
    nome: "Designer",
    instrucao: "Você é o Designer: leia .orchestra/contexto/<id>/README.md e cuide da experiência e do visual.",
  },
  dev: {
    nome: "Dev",
    instrucao: "Você é o Dev: leia .orchestra/contexto/<id>/README.md antes de implementar cada tarefa.",
  },
  revisor: {
    nome: "Revisor",
    instrucao: "Você é o Revisor: leia .orchestra/contexto/<id>/README.md e revise com cuidado o que foi feito.",
  },
  livre: { nome: "Livre", instrucao: "" },
} as const;

type Papel = keyof typeof PAPEIS;
const ORDEM: readonly Papel[] = ["lider", "designer", "dev", "revisor", "livre"];
const MODELO_PADRAO = "opencode-go/glm-5.2";

// Tipo do agente (F4 S6): OpenCode (padrao, modelos da cwd) ou Claude Code (PTY do app desktop).
type TipoAgente = "opencode" | "claude";
const TIPOS: readonly { id: TipoAgente; nome: string }[] = [
  { id: "opencode", nome: "OpenCode" },
  { id: "claude", nome: "Claude Code" },
];
// Modelos do Claude: "" e' o padrao do proprio Claude Code (sem --model).
const MODELO_CLAUDE_PADRAO = "Padrão";
const MODELOS_CLAUDE: readonly string[] = [MODELO_CLAUDE_PADRAO, "opus", "sonnet", "haiku"];

const FUNDO = "#1c1c1c";
const CABECALHO = "#222";
const BORDA = "#414141";
const DIVISOR = "#303030";
const RAIO = 14;
const FONTE = "400 13px/1.4 ui-sans-serif, system-ui, sans-serif";
const ROTULO = "400 11px/1 ui-sans-serif, system-ui, sans-serif";
const CAMPO: CSSProperties = {
  width: "100%", background: "#111", border: `1px solid ${BORDA}`, borderRadius: 7,
  color: "#fff", font: FONTE, padding: "7px 9px", outline: "none",
};

export type NovoAgenteProps = {
  aberto: boolean;
  onAberto: (v: boolean) => void;
  projeto: string;
  /** Agentes do projeto: as pastas distintas viram opcoes e a do ultimo e' o padrao. */
  agentes: { id: string; nome: string; cwd: string }[];
  /** GET /agentes/modelos?cwd= (mesma acao do useAgentes). */
  modelos: (cwd: string) => Promise<string[]>;
  /** Recebe o id criado pelo hub; o Canvas posiciona o no' `ag:<id>` no centro visivel. */
  onCriar: (agenteId: string) => void;
};

/** Campo com rotulo cinza (mesmo padrao do Inspetor). */
function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span style={{ font: ROTULO, color: "#858585" }}>{rotulo}</span>
      {children}
    </div>
  );
}

export function NovoAgente({ aberto, onAberto, projeto, agentes, modelos, onCriar }: NovoAgenteProps) {
  // Pastas: cwd distintos dos agentes + a raiz do projeto; padrao = cwd do ultimo agente.
  const pastas = useMemo(() => {
    const out: string[] = [];
    const vistos = new Set<string>();
    for (const a of agentes) if (a.cwd && !vistos.has(a.cwd)) { vistos.add(a.cwd); out.push(a.cwd); }
    if (projeto && !vistos.has(projeto)) out.push(projeto);
    return out;
  }, [agentes, projeto]);
  const padraoCwd = agentes.length ? (agentes[agentes.length - 1].cwd || projeto) : projeto;

  const [tipo, setTipo] = useState<TipoAgente>("opencode");
  const [papel, setPapel] = useState<Papel>("lider");
  const [nome, setNome] = useState<string>(PAPEIS.lider.nome);
  const [instrucao, setInstrucao] = useState<string>(PAPEIS.lider.instrucao);
  const [modelo, setModelo] = useState(MODELO_PADRAO);
  const [cwd, setCwd] = useState(padraoCwd);
  const [lista, setLista] = useState<string[]>([]);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const nomeTocado = useRef(false); // nome customizado nao e' sobrescrito ao trocar de papel

  // Reabrir sempre comeca do zero (Líder; pasta = ultimo agente; modelo padrao).
  useEffect(() => {
    if (!aberto) return;
    setTipo("opencode");
    setPapel("lider"); setNome(PAPEIS.lider.nome); setInstrucao(PAPEIS.lider.instrucao);
    setModelo(MODELO_PADRAO); setCwd(padraoCwd); setLista([]); setErro(""); setEnviando(false);
    nomeTocado.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  // Modelos da pasta escolhida (GET /agentes/modelos?cwd=), recarregados ao trocar a pasta.
  // So' faz sentido pro OpenCode: o Claude tem a lista fixa (Padrão/opus/sonnet/haiku).
  useEffect(() => {
    if (!aberto || !cwd || tipo !== "opencode") return;
    let vivo = true;
    void modelos(cwd).then((ms) => { if (vivo) setLista(ms); });
    return () => { vivo = false; };
  }, [aberto, cwd, tipo, modelos]);

  /** Troca o tipo do agente e ajusta o modelo pro padrao daquele tipo. */
  const escolherTipo = (t: TipoAgente) => {
    setTipo(t);
    setModelo(t === "claude" ? MODELO_CLAUDE_PADRAO : MODELO_PADRAO);
    if (t === "claude") setLista([]);
  };

  const escolherPapel = (p: Papel) => {
    setPapel(p);
    setInstrucao(PAPEIS[p].instrucao);
    if (!nomeTocado.current) setNome(PAPEIS[p].nome);
  };

  const opcoesModelo = useMemo(
    () => (tipo === "claude" ? [...MODELOS_CLAUDE] : [...new Set([modelo, ...lista].filter(Boolean))]),
    [tipo, modelo, lista],
  );
  const pode = !!projeto && !!cwd && !!nome.trim() && !enviando;

  // Confirma: POST /agentes {projeto,cwd,papel,nome,modelo,instrucao}; com o Claude vai tambem
  // tipo:'claude' e o modelo e' o da lista fixa (Padrão = "" -> o Claude escolhe). Avisa o Canvas.
  const confirmar = async () => {
    if (!pode) return;
    setEnviando(true); setErro("");
    try {
      const modeloEnviado = tipo === "claude" ? (modelo === MODELO_CLAUDE_PADRAO ? "" : modelo) : modelo;
      const corpo: Record<string, unknown> = { projeto, cwd, papel, nome: nome.trim(), modelo: modeloEnviado, instrucao };
      if (tipo === "claude") corpo.tipo = "claude";
      const r = await fetch("/agentes", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Hermes": "1" },
        body: JSON.stringify(corpo),
      });
      if (!r.ok) {
        setErro(r.status === 400 ? "O hub recusou o pedido." : `O hub recusou (HTTP ${r.status}).`);
        setEnviando(false);
        return;
      }
      const j = (await r.json()) as { id?: string };
      if (!j || typeof j.id !== "string" || !j.id) { setErro("O hub não devolveu o id do agente."); setEnviando(false); return; }
      onCriar(j.id);
      onAberto(false);
    } catch (e) {
      setErro("Não deu pra falar com o hub: " + String((e as Error).message));
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberto} onOpenChange={onAberto}>
      <DialogContent
        className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
        style={{ background: FUNDO, border: `1px solid ${BORDA}`, borderRadius: RAIO }}
      >
        <DialogHeader className="gap-0 px-3 py-2" style={{ background: CABECALHO, borderBottom: `1px solid ${DIVISOR}` }}>
          <DialogTitle style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>Novo agente</DialogTitle>
          <DialogDescription className="sr-only">Escolha o papel, o nome, o modelo e a pasta do agente.</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
          <Campo rotulo="Tipo">
            <div className="flex flex-wrap gap-1.5">
              {TIPOS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={tipo === t.id}
                  onClick={() => escolherTipo(t.id)}
                  className={cn("cv-insp-seg", tipo === t.id && "cv-insp-seg-on")}
                  style={{ font: "500 12px/1 ui-sans-serif, system-ui, sans-serif", padding: "7px 12px" }}
                >
                  {t.nome}
                </button>
              ))}
            </div>
          </Campo>

          <Campo rotulo="Papel">
            <div className="flex flex-wrap gap-1.5">
              {ORDEM.map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={papel === p}
                  onClick={() => escolherPapel(p)}
                  className={cn("cv-insp-seg", papel === p && "cv-insp-seg-on")}
                  style={{ font: "500 12px/1 ui-sans-serif, system-ui, sans-serif", padding: "7px 12px" }}
                >
                  {PAPEIS[p].nome}
                </button>
              ))}
            </div>
          </Campo>

          <Campo rotulo="Instrução">
            <textarea
              value={instrucao}
              spellCheck={false}
              rows={4}
              placeholder="O que este agente deve fazer…"
              onChange={(e) => setInstrucao(e.target.value)}
              className="cv-insp-area"
              style={{ ...CAMPO, minHeight: 92, resize: "vertical" }}
            />
          </Campo>

          <Campo rotulo="Nome">
            <input
              value={nome}
              spellCheck={false}
              placeholder="Nome"
              onChange={(e) => { nomeTocado.current = true; setNome(e.target.value); }}
              className="cv-insp-campo"
              style={CAMPO}
            />
          </Campo>

          <Campo rotulo="Modelo">
            <select value={modelo} onChange={(e) => setModelo(e.target.value)} className="cv-insp-campo" style={CAMPO}>
              {opcoesModelo.length === 0
                ? <option value={MODELO_PADRAO}>{MODELO_PADRAO}</option>
                : opcoesModelo.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Campo>

          <Campo rotulo="Pasta">
            <select value={cwd} onChange={(e) => setCwd(e.target.value)} className="cv-insp-campo" style={CAMPO}>
              {pastas.length === 0
                ? <option value={projeto}>{projeto || "—"}</option>
                : pastas.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Campo>

          {erro && <p role="alert" style={{ font: FONTE, color: "#ff7b72" }}>{erro}</p>}
        </div>

        <DialogFooter
          className="mx-0 mb-0 rounded-b-none px-3 py-2 sm:flex-row sm:justify-end"
          style={{ background: CABECALHO, borderTop: `1px solid ${DIVISOR}` }}
        >
          <Button type="button" variant="outline" disabled={enviando} onClick={() => onAberto(false)}>Cancelar</Button>
          <Button type="button" disabled={!pode} onClick={() => void confirmar()}>
            {enviando ? <Loader2 className="animate-spin" /> : <Plus />}Criar agente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default NovoAgente;
