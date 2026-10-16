// Card Navegador (F4 S6): nodeType 'navegador' — um <webview> do Electron (particao persistente por
// projeto) com a barra voltar/avancar/recarregar e o campo da url. Fora do app desktop (sem a ponte
// do preload) o card so' mostra o aviso "Abra no app Hermes para usar este card".
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { type NodeProps } from "@xyflow/react";
import { ArrowLeft, ArrowRight, Ellipsis, Pin, RotateCw, X } from "lucide-react";
import { Alcas, CanvasCtx } from "./Nos";
import { cn } from "@/lib/utils";
import { emDesktop, idProjetoFront, particaoDoProjeto, type ElementoWebview } from "@/lib/desktop";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { No } from "../../../../src/canvas.ts";

/** Raiz do projeto do canvas (o card calcula o idProjeto sha1 e a particao da webview a partir dela). */
export const ProjetoCtx = createContext("");

const VERMELHO = "#e5534b";
const CABECALHO = "#222";
const BARRA = "#151515";
const BORDA = "#303030";
const CINZA = "#858585";
const FONTE_UI = "400 12px/1.4 ui-sans-serif, system-ui, sans-serif";

/** url digitada sem esquema vira https:// (mesma regra do hub: so' http(s) navega). */
const normalizarUrl = (bruta: string): string => {
  const t = bruta.trim();
  if (!t) return "";
  return /^[a-z][a-z0-9+.-]*:/i.test(t) ? t : "https://" + t;
};

/** Botao pequeno da barra de navegacao (‹ › ⟳). */
function BotaoBarra({ titulo, onClick, children }: { titulo: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      className="nodrag grid size-6 shrink-0 place-items-center rounded hover:bg-white/10"
      style={{ color: "#b8b8b8" }}
    >
      {children}
    </button>
  );
}

/** No' do navegador: cabecalho com o ponto vermelho + menu ⋯ (Limpar dados) + ✕; barra de 35px e a pagina. */
export function NoNavegador({ id, data, selected }: NodeProps) {
  const acoes = useContext(CanvasCtx);
  const projeto = useContext(ProjetoCtx);
  const no = (data as { no?: No }).no;
  const d = (no?.dados ?? {}) as { nome?: string; url?: string; fixado?: boolean };
  const nome = d.nome ?? "Navegador";
  const fixado = d.fixado === true;
  const desktop = emDesktop(typeof window === "undefined" ? undefined : window);
  const [url, setUrl] = useState(d.url ?? "");
  const [idProjeto, setIdProjeto] = useState("");
  const [erro, setErro] = useState("");
  const wv = useRef<ElementoWebview | null>(null);
  // src inicial do <webview>: congelado no primeiro render (o dados.url do hub pode mudar depois por
  // causa da navegacao do agente; trocar o atributo src a cada eco recarregaria a pagina sem motivo).
  const srcInicial = useRef(d.url ?? "");

  // idProjeto = sha1 hex da raiz normalizada (mesmo idProjeto do hub): define persist:hermes-<id>.
  useEffect(() => {
    if (!desktop || !projeto) { setIdProjeto(""); return; }
    let vivo = true;
    void idProjetoFront(projeto).then((v) => { if (vivo) setIdProjeto(v); }).catch(() => {});
    return () => { vivo = false; };
  }, [desktop, projeto]);

  const particao = idProjeto ? particaoDoProjeto(idProjeto) : "";
  const pronto = desktop && !!particao;

  // Eventos da webview: 'dom-ready' registra no main; 'did-navigate' sincroniza a barra;
  // 'did-fail-load' liga o overlay de erro.
  useEffect(() => {
    const el = wv.current;
    if (!el || !pronto) return;
    const aoPronto = () => {
      try { window.hermesDesktop?.registrarNavegador(id, el.getWebContentsId()); } catch {}
    };
    const aoNavegar = (e: Event) => {
      const u = (e as unknown as { url?: string }).url;
      if (typeof u === "string" && u) setUrl(u);
      setErro("");
    };
    const aoFalhar = (e: Event) => {
      const ev = e as unknown as { errorCode?: number; errorDescription?: string; isMainFrame?: boolean };
      if (ev.isMainFrame === false) return;
      if (ev.errorCode === -3) return; // ABORTED: navegacao cancelada de proposito (troca de url)
      setErro(ev.errorDescription || "não foi possível carregar a página");
    };
    el.addEventListener("dom-ready", aoPronto);
    el.addEventListener("did-navigate", aoNavegar);
    el.addEventListener("did-navigate-in-page", aoNavegar);
    el.addEventListener("did-fail-load", aoFalhar);
    return () => {
      el.removeEventListener("dom-ready", aoPronto);
      el.removeEventListener("did-navigate", aoNavegar);
      el.removeEventListener("did-navigate-in-page", aoNavegar);
      el.removeEventListener("did-fail-load", aoFalhar);
      try { window.hermesDesktop?.desregistrarNavegador(id); } catch {}
    };
  }, [id, pronto, particao]);

  /** Enter na url (ou o clique da barra): navega a webview; fora do desktop so' guarda o valor. */
  const irPara = (bruta: string) => {
    const u = normalizarUrl(bruta);
    if (!u) return;
    setUrl(u);
    if (!pronto) return;
    const el = wv.current;
    if (!el) return;
    setErro("");
    void el.loadURL(u).catch(() => {});
  };

  const tentarDeNovo = () => { setErro(""); wv.current?.reload(); };

  return (
    <div className={cn("cv-card relative flex h-full w-full flex-col overflow-hidden", !!selected && "cv-sel")}>
      <header
        className="flex shrink-0 items-center gap-2 px-2.5"
        style={{ height: 32, background: CABECALHO, borderBottom: `1px solid ${BORDA}`, color: "#eee", font: "500 12px/1 ui-sans-serif, system-ui, sans-serif" }}
      >
        <span className="size-2 shrink-0 rounded-full" style={{ background: VERMELHO }} title="navegador" />
        <span className="truncate">{nome}</span>
        {fixado && <Pin className="size-3.5 shrink-0" style={{ color: "#74aaff" }} aria-label="Fixado" />}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" title="Opções" className="nodrag ml-auto grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: CINZA }}>
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="cv-menu min-w-40">
            <DropdownMenuItem onSelect={() => { if (particao) window.hermesDesktop?.limparDados(particao); }}>
              Limpar dados
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => acoes.fixar(id)}>
              <Pin className="size-3.5" style={{ color: "#74aaff" }} />
              {fixado ? "Desafixar" : "Fixar"}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button type="button" title="Fechar" onClick={() => acoes.removerNo(id)} className="nodrag grid size-5 shrink-0 place-items-center rounded hover:bg-white/10" style={{ color: CINZA }}>
          <X className="size-3.5" />
        </button>
      </header>

      <div className="flex shrink-0 items-center gap-1 px-1.5" style={{ height: 35, background: BARRA, borderBottom: `1px solid ${BORDA}` }}>
        <BotaoBarra titulo="Voltar" onClick={() => wv.current?.goBack()}>
          <ArrowLeft className="size-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Avançar" onClick={() => wv.current?.goForward()}>
          <ArrowRight className="size-4" />
        </BotaoBarra>
        <BotaoBarra titulo="Recarregar" onClick={() => { setErro(""); wv.current?.reload(); }}>
          <RotateCw className="size-4" />
        </BotaoBarra>
        <input
          value={url}
          spellCheck={false}
          placeholder="https://…"
          aria-label="Endereço"
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); irPara(url); } }}
          className="nodrag nowheel min-w-0 flex-1 bg-transparent px-1.5 py-1 outline-none placeholder:opacity-50"
          style={{ color: "#dedee3", font: FONTE_UI }}
        />
      </div>

      <div className="nodrag nowheel relative min-h-0 flex-1 overflow-hidden" style={{ background: "#fff" }}>
        {!desktop ? (
          <div className="grid h-full place-items-center px-4 text-center" style={{ background: "#1c1c1c", color: CINZA, font: FONTE_UI }}>
            Abra no app Hermes para usar este card
          </div>
        ) : !particao ? (
          <div className="grid h-full place-items-center" style={{ background: "#1c1c1c", color: CINZA, font: FONTE_UI }}>
            carregando…
          </div>
        ) : (
          <>
            <webview ref={wv} src={srcInicial.current} partition={particao} className="h-full w-full" />
            {erro && (
              <div className="absolute inset-0 grid place-items-center px-4 text-center" style={{ background: "#1c1c1ce6" }}>
                <div className="space-y-2">
                  <p style={{ color: VERMELHO, font: FONTE_UI }}>Falha ao carregar: {erro}</p>
                  <button
                    type="button"
                    onClick={tentarDeNovo}
                    className="nodrag rounded px-2 py-1 hover:bg-white/10"
                    style={{ border: "1px solid #414141", color: "#eee", font: FONTE_UI }}
                  >
                    Tentar de novo
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <Alcas />
    </div>
  );
}

/** Mapa de nodeTypes do xyflow (o Canvas registra `navegador: NoNavegador`). */
export const nodeTypes = { navegador: NoNavegador };

export default NoNavegador;
