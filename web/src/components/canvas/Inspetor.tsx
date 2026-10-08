// Inspetor do canvas no estilo Castor (F1.5 - S3): painel de propriedades flutuante no canto
// superior direito. Abre quando ha EXATAMENTE 1 no' INSPECIONAVEL (ou 1 aresta) selecionado e mostra
// os campos do tipo; com 2+ itens vira o painel de acoes (Agrupar / Apagar). Nos automaticos (run,
// worker, arquivo, agente, regiao/fluxo) nao abrem o painel (F2.1). Toda a logica de edicao vem pronta
// do Canvas (upsert via enviar) — aqui so' montamos os campos e commitamos no blur/Enter (a cor e'
// imediata). UI em PT-BR, so' tema escuro.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { X } from "lucide-react";
import {
  CORES_FORMA, CORES_NOTA, CORES_REGIAO, estiloNota, inspecionavel,
} from "@/lib/canvas";
import { cn } from "@/lib/utils";
import type { Aresta, No } from "../../../../canvas.ts";

// ---------------------------------------------------------------------------
// Tokens visuais do painel
// ---------------------------------------------------------------------------

const FUNDO = "#1c1c1c";
const CABECALHO = "#222";
const BORDA = "#414141";
const DIVISOR = "#303030";
const RAIO = 14;
const SOMBRA = "0 18px 50px #0009";

/** Estilo base dos campos (input/textarea): fundo #111, borda #414141, raio 7, texto #fff. */
const CAMPO: CSSProperties = {
  width: "100%",
  background: "#111",
  border: `1px solid ${BORDA}`,
  borderRadius: 7,
  color: "#fff",
  font: "400 13px/1.4 ui-sans-serif, system-ui, sans-serif",
  padding: "7px 9px",
  outline: "none",
};

// ---------------------------------------------------------------------------
// Pecas de formulario
// ---------------------------------------------------------------------------

/** Titulo de um tipo de no' no cabecalho do painel. */
const TITULO_TIPO: Record<string, string> = {
  nota: "Nota",
  forma: "Forma",
  imagem: "Imagem",
  grupo: "Região",
  texto: "Texto",
};

/** Chave da paleta para uma cor guardada em dados.cor; cai no padrao quando ausente/desconhecida. */
function chaveCor<T extends Record<string, string>>(paleta: T, valor: unknown, padrao: keyof T): keyof T {
  return typeof valor === "string" && valor in paleta ? (valor as keyof T) : padrao;
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span style={{ fontSize: 11, color: "#858585" }}>{rotulo}</span>
      {children}
    </div>
  );
}

type ComumCampo = { valor: string; placeholder?: string; disabled?: boolean; onCommit: (v: string) => void };

/** Input de uma linha: commita no blur ou Enter; Esc descarta. */
function CampoTexto({ valor, placeholder, disabled, onCommit }: ComumCampo) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const descartar = useRef(false);
  const v = rascunho ?? valor;
  return (
    <input
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        if (descartar.current) { descartar.current = false; }
        else if (rascunho != null && rascunho !== valor) onCommit(rascunho);
        setRascunho(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") { descartar.current = true; e.currentTarget.blur(); }
      }}
      className="cv-insp-campo"
      style={CAMPO}
    />
  );
}

/** Textarea grande: commita no blur; Esc descarta. `estilo` sobrescreve as cores (ex.: nota). */
function AreaTexto({ valor, placeholder, disabled, onCommit, min = 150, estilo }: ComumCampo & { min?: number; estilo?: CSSProperties }) {
  const [rascunho, setRascunho] = useState<string | null>(null);
  const descartar = useRef(false);
  const v = rascunho ?? valor;
  return (
    <textarea
      value={v}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setRascunho(e.target.value)}
      onBlur={() => {
        if (descartar.current) { descartar.current = false; }
        else if (rascunho != null && rascunho !== valor) onCommit(rascunho);
        setRascunho(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") { descartar.current = true; e.currentTarget.blur(); }
      }}
      className="cv-insp-area"
      style={{ ...CAMPO, minHeight: min, resize: "vertical", ...estilo }}
    />
  );
}

/** Fileira de bolinhas de cor (paleta de nota/forma/regiao); a atual fica com anel branco. */
function Bolinhas({ paleta, atual, disabled, onEscolher }: {
  paleta: Record<string, string>; atual: string; disabled?: boolean; onEscolher: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {Object.entries(paleta).map(([nome, cor]) => (
        <button
          key={nome}
          type="button"
          title={nome}
          aria-label={nome}
          aria-pressed={nome === atual}
          disabled={disabled}
          onClick={() => onEscolher(nome)}
          className={cn("cv-insp-bola size-5 rounded-full", nome === atual && "cv-insp-bola-on")}
          style={{ background: cor }}
        />
      ))}
    </div>
  );
}

/** Botoes segmentados P/M/G do texto solto. */
function Tamanhos({ atual, disabled, onEscolher }: { atual: string; disabled?: boolean; onEscolher: (t: string) => void }) {
  return (
    <div className="flex gap-1.5">
      {(["p", "m", "g"] as const).map((t) => (
        <button
          key={t}
          type="button"
          disabled={disabled}
          aria-pressed={atual === t}
          onClick={() => onEscolher(t)}
          className={cn("cv-insp-seg", atual === t && "cv-insp-seg-on")}
        >
          {t.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Corpos por tipo de item
// ---------------------------------------------------------------------------

type EdicaoProps = {
  no: No;
  bloquear: boolean;
  editar: (id: string, dados: Record<string, unknown>) => void;
};

function CamposNota({ no, bloquear, editar }: EdicaoProps) {
  const d = no.dados as { titulo?: string; corpo?: string; cor?: string };
  const atual = chaveCor(CORES_NOTA, d.cor, "amarelo");
  const t = estiloNota(d.cor);
  return (
    <>
      <Campo rotulo="Título">
        <CampoTexto valor={d.titulo ?? ""} placeholder="Título" disabled={bloquear} onCommit={(v) => editar(no.id, { titulo: v })} />
      </Campo>
      <Campo rotulo="Conteúdo">
        <AreaTexto
          valor={d.corpo ?? ""} placeholder="Escreva em markdown…" disabled={bloquear} min={150}
          estilo={{ background: t.fundo, borderColor: t.borda, color: t.texto }}
          onCommit={(v) => editar(no.id, { corpo: v })}
        />
      </Campo>
      <Campo rotulo="Cor">
        <Bolinhas paleta={CORES_NOTA} atual={atual} disabled={bloquear} onEscolher={(c) => editar(no.id, { cor: c })} />
      </Campo>
    </>
  );
}

function CamposForma({ no, bloquear, editar }: EdicaoProps) {
  const d = no.dados as { texto?: string; cor?: string };
  const atual = chaveCor(CORES_FORMA, d.cor, "cinza");
  return (
    <>
      <Campo rotulo="Texto">
        <AreaTexto valor={d.texto ?? ""} placeholder="Texto da forma…" disabled={bloquear} min={90} onCommit={(v) => editar(no.id, { texto: v })} />
      </Campo>
      <Campo rotulo="Cor">
        <Bolinhas paleta={CORES_FORMA} atual={atual} disabled={bloquear} onEscolher={(c) => editar(no.id, { cor: c })} />
      </Campo>
    </>
  );
}

function CamposImagem({ no }: { no: No }) {
  const d = no.dados as { url?: string; nome?: string };
  return (
    <>
      {d.url
        ? <img src={d.url} alt={d.nome ?? "imagem"} draggable={false} style={{ width: "100%", borderRadius: 8, border: `1px solid ${BORDA}` }} />
        : <div className="grid place-items-center" style={{ height: 120, borderRadius: 8, border: `1px dashed ${BORDA}`, color: "#858585", fontSize: 12 }}>sem imagem</div>}
      <Campo rotulo="Nome">
        <p style={{ fontSize: 13, color: "#fff", overflowWrap: "anywhere" }}>{d.nome ?? "imagem"}</p>
      </Campo>
    </>
  );
}

function CamposGrupo({ no, bloquear, editar }: EdicaoProps) {
  const d = no.dados as { titulo?: string; cor?: string };
  const atual = chaveCor(CORES_REGIAO, d.cor, "cinza");
  return (
    <>
      <Campo rotulo="Título">
        <CampoTexto valor={d.titulo ?? "Região"} placeholder="Título" disabled={bloquear} onCommit={(v) => editar(no.id, { titulo: v })} />
      </Campo>
      <Campo rotulo="Cor">
        <Bolinhas paleta={CORES_REGIAO} atual={atual} disabled={bloquear} onEscolher={(c) => editar(no.id, { cor: c })} />
      </Campo>
    </>
  );
}

function CamposTexto({ no, bloquear, editar }: EdicaoProps) {
  const d = no.dados as { texto?: string; tamanho?: string };
  const atual = d.tamanho === "p" || d.tamanho === "g" ? d.tamanho : "m";
  return (
    <>
      <Campo rotulo="Conteúdo">
        <AreaTexto valor={d.texto ?? ""} placeholder="Escreva…" disabled={bloquear} min={90} onCommit={(v) => editar(no.id, { texto: v })} />
      </Campo>
      <Campo rotulo="Tamanho">
        <Tamanhos atual={atual} disabled={bloquear} onEscolher={(t) => editar(no.id, { tamanho: t })} />
      </Campo>
    </>
  );
}

/** Corpo do no' conforme o tipo (os tipos sem campo proprio caem no card de nota). */
function CorpoDoNo({ no, bloquear, editar }: EdicaoProps) {
  switch (no.tipo) {
    case "forma": return <CamposForma no={no} bloquear={bloquear} editar={editar} />;
    case "imagem": return <CamposImagem no={no} />;
    case "grupo": return <CamposGrupo no={no} bloquear={bloquear} editar={editar} />;
    case "texto": return <CamposTexto no={no} bloquear={bloquear} editar={editar} />;
    default: return <CamposNota no={no} bloquear={bloquear} editar={editar} />;
  }
}

// ---------------------------------------------------------------------------
// Inspetor
// ---------------------------------------------------------------------------

export type InspetorProps = {
  /** Nos selecionados (modelo); 1 = painel do no', 2+ = acoes em lote. */
  nos: No[];
  /** Arestas selecionadas (modelo); 1 = painel do rotulo. */
  arestas: Aresta[];
  bloquear: boolean;
  editar: (id: string, dados: Record<string, unknown>) => void;
  rotular: (id: string, rotulo: string) => void;
  apagar: (alvos: { nos: string[]; arestas: string[] }) => void;
  agrupar: (ids: string[]) => void;
  /** Desmarca a selecao (o painel some). */
  fechar: () => void;
};

const BOTAO_BASE: CSSProperties = {
  flex: 1,
  borderRadius: 7,
  padding: "7px 12px",
  font: "500 13px/1 ui-sans-serif, system-ui, sans-serif",
  cursor: "pointer",
};

export function Inspetor({ nos, arestas, bloquear, editar, rotular, apagar, agrupar, fechar }: InspetorProps) {
  // So' nos EDITAVEIS (criados a mao) contam: selecionar um card automatico (run/worker/arquivo) ou
  // de agente NAO abre o painel (antes caia no editor de NOTA por engano). Arestas seguem normais.
  const editaveis = nos.filter(inspecionavel);
  const total = editaveis.length + arestas.length;
  if (total === 0) return null;

  const umNo = editaveis.length === 1 && arestas.length === 0 ? editaveis[0] : null;
  const umaAresta = arestas.length === 1 && editaveis.length === 0 ? arestas[0] : null;
  const titulo = umNo ? (TITULO_TIPO[umNo.tipo] ?? "Nó") : umaAresta ? "Aresta" : `${total} itens`;

  return (
    <aside
      className="cv-insp absolute z-30 flex flex-col"
      aria-label="Inspetor"
      style={{
        top: 60,
        right: 16,
        width: 360,
        maxHeight: "calc(100% - 145px)",
        overflowY: "auto",
        background: FUNDO,
        border: `1px solid ${BORDA}`,
        borderRadius: RAIO,
        boxShadow: SOMBRA,
      }}
      onPointerDownCapture={(e) => e.stopPropagation()}
    >
      <header
        className="cv-insp-head sticky top-0 z-10 flex items-center gap-2"
        style={{ background: CABECALHO, borderBottom: `1px solid ${DIVISOR}`, padding: "8px 12px", borderTopLeftRadius: RAIO - 1, borderTopRightRadius: RAIO - 1 }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "#eee" }}>{titulo}</span>
        <button
          type="button"
          title="Fechar"
          aria-label="Fechar inspetor"
          onClick={fechar}
          className="ml-auto grid size-6 place-items-center rounded hover:bg-white/10"
          style={{ color: "#b8b8b8" }}
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-3">
        {umNo ? (
          <CorpoDoNo no={umNo} bloquear={bloquear} editar={editar} />
        ) : umaAresta ? (
          <Campo rotulo="Rótulo">
            <CampoTexto valor={umaAresta.rotulo ?? ""} placeholder="rótulo" disabled={bloquear} onCommit={(v) => rotular(umaAresta.id, v)} />
          </Campo>
        ) : (
          <>
            <p style={{ fontSize: 13, color: "#b8b8b8" }}>{total} itens</p>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={bloquear}
                onClick={() => agrupar(editaveis.map((n) => n.id))}
                style={{ ...BOTAO_BASE, background: "#2979ff", color: "#fff", border: "1px solid #2979ff" }}
              >
                Agrupar
              </button>
              <button
                type="button"
                disabled={bloquear}
                onClick={() => apagar({ nos: editaveis.map((n) => n.id), arestas: arestas.map((a) => a.id) })}
                style={{ ...BOTAO_BASE, background: "#2a1516", color: "#ff7b72", border: "1px solid #5a2020" }}
              >
                Apagar
              </button>
            </div>
          </>
        )}
      </div>
    </aside>
  );
}

export default Inspetor;
