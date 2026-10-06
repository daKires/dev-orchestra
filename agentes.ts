// Agentes do canvas (F2): modelo puro de agentes (S1) e normalizacao dos eventos do OpenCode (S1)
// + contexto dos agentes a partir do canvas (S2).
// Roda direto com `node --experimental-strip-types`, por isso: apenas `import type` para tipos,
// importando somente de ./canvas.ts e ./ui.ts (nada e' importado em runtime), imports de `node:`
// quando precisar, sem enum/namespace.
import type { No, Snapshot } from "./canvas.js";
import type { Planejador } from "./ui.js";

// ---------------------------------------------------------------------------
// Papeis (CA-5)
// ---------------------------------------------------------------------------

export type Papel = "lider" | "designer" | "dev" | "revisor" | "livre";

export type DefinicaoPapel = { nome: string; instrucao: string };

/**
 * Os 4 papeis "prontos" trazem uma instrucao PT-BR curta que manda ler o contexto de trabalho
 * em `.orchestra/contexto/<id>/README.md` (o `<id>` e' o id do agente, substituido em runtime).
 * `livre` nao tem instrucao (o planejador usa o prompt do proprio OpenCode).
 */
export const PAPEIS: Record<Papel, DefinicaoPapel> = {
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
};

// ---------------------------------------------------------------------------
// Modelo de agente
// ---------------------------------------------------------------------------

export type OrigemAgente = "canvas" | "planejador";

export type Agente = {
  id: string;
  projeto: string;
  cwd: string;
  base: string;
  sessao: string;
  nome: string;
  papel: Papel;
  modelo: string;
  instrucao: string;
  tipo: "opencode";
  origem: OrigemAgente;
};

const CAMPOS_TEXTO: readonly (keyof Agente)[] = [
  "projeto",
  "cwd",
  "base",
  "sessao",
  "nome",
  "modelo",
  "instrucao",
];

/** id so' com [a-z0-9-] e nao vazio; strings obrigatorias; papel/origem validos; senao null. */
export function validarAgente(x: unknown): Agente | null {
  if (!x || typeof x !== "object") return null;
  const a = x as Record<string, unknown>;
  if (typeof a.id !== "string" || !/^[a-z0-9-]+$/.test(a.id)) return null;
  for (const k of CAMPOS_TEXTO) if (typeof a[k] !== "string") return null;
  if (typeof a.papel !== "string" || !Object.prototype.hasOwnProperty.call(PAPEIS, a.papel)) return null;
  if (a.origem !== "canvas" && a.origem !== "planejador") return null;
  if (a.tipo !== "opencode") return null;
  return x as Agente;
}

/** Ultimo segmento depois de `/session/` na url do chat do planejador. */
function sessaoDaUrl(url: string): string {
  const marca = "/session/";
  const i = url.indexOf(marca);
  if (i < 0) return "";
  const resto = url.slice(i + marca.length).split(/[?#]/)[0];
  const partes = resto.split("/").filter(Boolean);
  return partes.length ? partes[partes.length - 1] : "";
}

/** O planejador do orchestra-go vira um agente `plan-<slug>` com o contexto do worktree (CA-5b). */
export function agenteDePlanejador(p: Planejador): Agente {
  return {
    id: "plan-" + p.slug,
    projeto: p.raiz,
    cwd: p.cwd,
    base: p.base,
    sessao: sessaoDaUrl(p.url),
    nome: p.feature,
    papel: "livre",
    modelo: "opencode-go/glm-5.2",
    instrucao: PAPEIS.livre.instrucao,
    tipo: "opencode",
    origem: "planejador",
  };
}

/** 'provider/modelo/x' -> { providerID: 'provider', modelID: 'modelo/x' }; sem barra valida -> null. */
export function separarModelo(modelo: string): { providerID: string; modelID: string } | null {
  if (typeof modelo !== "string" || modelo.length === 0) return null;
  const i = modelo.indexOf("/");
  if (i <= 0 || i === modelo.length - 1) return null;
  return { providerID: modelo.slice(0, i), modelID: modelo.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Linhas (transcricao do chat do OpenCode) (CA-4a)
// ---------------------------------------------------------------------------

export type EstadoLinha = "pendente" | "rodando" | "ok" | "erro";
export type TipoLinha = "usuario" | "texto" | "tool";

export type Linha = {
  id: string;
  msg: string;
  tipo: TipoLinha;
  estado?: EstadoLinha;
  texto: string;
};

/** Resultado de um evento do OpenCode: sempre traz a sessao, e opcionalmente a linha ou o status. */
export type ResultadoEvento = { sessao: string; linha?: Linha; status?: "ocupado" | "ocioso" };

function mapearEstado(status: unknown): EstadoLinha | undefined {
  if (status === "pending") return "pendente";
  if (status === "running") return "rodando";
  if (status === "completed") return "ok";
  if (status === "error") return "erro";
  return undefined;
}

/** `tool` + alvo (title || filePath || command || pattern), sem espaco sobrando. */
function textoDaFerramenta(part: any): string {
  const state = part.state && typeof part.state === "object" ? part.state : {};
  const input = state.input && typeof state.input === "object" ? state.input : {};
  const alvo = state.title || input.filePath || input.command || input.pattern || "";
  const ferramenta = typeof part.tool === "string" ? part.tool : "";
  return [ferramenta, alvo].filter((s) => typeof s === "string" && s.length > 0).join(" ");
}

/** Converte uma parte (`text`/`tool`) em linha; qualquer outra parte vira null. */
function linhaDaParte(part: any, role: string, msgPadrao: string): Linha | null {
  if (!part || typeof part !== "object") return null;
  if (typeof part.id !== "string" || part.id.length === 0) return null;
  const msg = typeof part.messageID === "string" && part.messageID ? part.messageID : msgPadrao;
  if (part.type === "text") {
    if (typeof part.text !== "string" || part.text.length === 0) return null;
    return { id: part.id, msg, tipo: role === "user" ? "usuario" : "texto", texto: part.text };
  }
  if (part.type === "tool") {
    const linha: Linha = { id: part.id, msg, tipo: "tool", texto: textoDaFerramenta(part) };
    const estado = mapearEstado(part.state && part.state.status);
    if (estado) linha.estado = estado;
    return linha;
  }
  return null;
}

/**
 * Normaliza um evento cru do `/event` do OpenCode. `papeis` (messageID -> role) e' alimentado pelos
 * `message.updated` para decidir se uma parte de texto e' do usuario ou do assistente.
 */
export function normalizarEvento(ev: unknown, papeis: Map<string, string>): ResultadoEvento | null {
  if (!ev || typeof ev !== "object") return null;
  const e = ev as { type?: unknown; properties?: any };
  const props = e.properties;
  if (!props || typeof props !== "object") return null;
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : "";

  if (e.type === "message.updated") {
    const info = props.info;
    if (!info || typeof info !== "object") return null;
    if (typeof info.id !== "string" || info.id.length === 0) return null;
    if (typeof info.role === "string") papeis.set(info.id, info.role);
    const sid = typeof info.sessionID === "string" ? info.sessionID : sessionID;
    return { sessao: sid };
  }

  if (e.type === "message.part.updated") {
    const part = props.part;
    if (!part || typeof part !== "object") return null;
    const sid = typeof part.sessionID === "string" ? part.sessionID : sessionID;
    const role = papeis.get(String(part.messageID)) ?? "";
    const linha = linhaDaParte(part, role, typeof part.messageID === "string" ? part.messageID : "");
    if (!linha) return null;
    return { sessao: sid, linha };
  }

  if (e.type === "session.idle") {
    return { sessao: sessionID, status: "ocioso" };
  }

  if (e.type === "session.status") {
    const tipo = props.status && props.status.type;
    if (tipo === "busy") return { sessao: sessionID, status: "ocupado" };
    if (tipo === "idle") return { sessao: sessionID, status: "ocioso" };
    return null;
  }

  return null;
}

/** Resposta de `GET /session/:id/message` em linhas, na ordem; ignora partes sem texto/tool. */
export function historicoParaLinhas(msgs: unknown): Linha[] {
  const out: Linha[] = [];
  if (!Array.isArray(msgs)) return out;
  for (const m of msgs) {
    if (!m || typeof m !== "object") continue;
    const info = (m as any).info;
    if (!info || typeof info !== "object" || typeof info.id !== "string") continue;
    const role = typeof info.role === "string" ? info.role : "";
    const parts = (m as any).parts;
    if (!Array.isArray(parts)) continue;
    for (const p of parts) {
      const linha = linhaDaParte(p, role, info.id);
      if (linha) out.push(linha);
    }
  }
  return out;
}

/**
 * Upsert por id preservando a ordem (item existente e' trocado no lugar; novo entra no fim) e
 * mantendo so' as ultimas `maxMsgs` mensagens distintas (mensagens == agrupamento por `msg`).
 */
export function aplicarLinhas(atual: Linha[], novas: Linha[], maxMsgs = 50): Linha[] {
  const out = atual.slice();
  const pos = new Map<string, number>();
  out.forEach((l, i) => pos.set(l.id, i));
  for (const n of novas) {
    const i = pos.get(n.id);
    if (i === undefined) {
      pos.set(n.id, out.length);
      out.push(n);
    } else {
      out[i] = n;
    }
  }
  const ordem: string[] = [];
  const vistos = new Set<string>();
  for (const l of out) {
    if (!vistos.has(l.msg)) {
      vistos.add(l.msg);
      ordem.push(l.msg);
    }
  }
  if (ordem.length <= maxMsgs) return out;
  const manter = new Set(ordem.slice(ordem.length - maxMsgs));
  return out.filter((l) => manter.has(l.msg));
}

// ---------------------------------------------------------------------------
// Contexto dos agentes a partir do canvas (S2, CA-9)
// ---------------------------------------------------------------------------

export type ItemContexto =
  | { noId: string; tipo: "nota"; titulo: string; corpo: string }
  | { noId: string; tipo: "imagem"; titulo: string; url: string };

function itemDeNo(n: No): ItemContexto {
  if (n.tipo === "imagem") {
    return { noId: n.id, tipo: "imagem", titulo: String(n.dados.nome ?? ""), url: String(n.dados.url ?? "") };
  }
  return { noId: n.id, tipo: "nota", titulo: String(n.dados.titulo ?? ""), corpo: String(n.dados.corpo ?? "") };
}

/**
 * Itens de contexto ligados ao no' do agente: notas/imagens ligadas em QUALQUER direcao, mais os
 * itens (nota/imagem) de um grupo ligado ao agente. Dedup por id; ordem = ordem dos nos.
 */
export function itensDeContexto(s: Snapshot, idNo: string): ItemContexto[] {
  if (!s.nos.some((n) => n.id === idNo)) return [];
  const ligados = new Set<string>();
  for (const a of s.arestas) {
    if (a.de === idNo) ligados.add(a.para);
    else if (a.para === idNo) ligados.add(a.de);
  }
  const ids = new Set<string>();
  for (const id of ligados) {
    const n = s.nos.find((x) => x.id === id);
    if (!n) continue;
    if (n.tipo === "nota" || n.tipo === "imagem") {
      ids.add(n.id);
    } else if (n.tipo === "grupo") {
      for (const f of s.nos) {
        if (f.pai === n.id && (f.tipo === "nota" || f.tipo === "imagem")) ids.add(f.id);
      }
    }
  }
  const out: ItemContexto[] = [];
  for (const n of s.nos) if (ids.has(n.id)) out.push(itemDeNo(n));
  return out;
}

export type ArquivoPlano = { nome: string; conteudo?: string; url?: string };
export type PlanoArquivos = { arquivos: ArquivoPlano[]; readme: string };

function sanearNome(titulo: string): string {
  return titulo.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "").trim();
}

/** Reserva um nome unico: "x.md" repetido vira "x (2).md", "x (3).md", ... (preserva a extensao). */
function nomeUnico(base: string, usados: Map<string, number>): string {
  const n = usados.get(base) ?? 0;
  usados.set(base, n + 1);
  if (n === 0) return base;
  const ponto = base.lastIndexOf(".");
  const stem = ponto > 0 ? base.slice(0, ponto) : base;
  const ext = ponto > 0 ? base.slice(ponto) : "";
  return stem + " (" + (n + 1) + ")" + ext;
}

/** Plano de arquivos de contexto: notas viram `.md`, imagens entram com a url e o README lista tudo. */
export function planoArquivos(itens: ItemContexto[]): PlanoArquivos {
  const arquivos: ArquivoPlano[] = [];
  const usados = new Map<string, number>();
  for (const it of itens) {
    if (it.tipo === "imagem") {
      const base = sanearNome(it.titulo) || "imagem.png";
      arquivos.push({ nome: nomeUnico(base, usados), url: it.url });
    } else {
      const base = (sanearNome(it.titulo) || "Nota") + ".md";
      const titulo = it.titulo || "Nota";
      arquivos.push({ nome: nomeUnico(base, usados), conteudo: "# " + titulo + "\n\n" + it.corpo + "\n" });
    }
  }
  let readme: string;
  if (arquivos.length === 0) {
    readme = "# Contexto do canvas\n\nNenhum item ligado a este agente.\n";
  } else {
    // Cada linha cita o nome do arquivo, o tipo (nota/imagem) e o titulo do item de origem.
    const linhas = itens.map((it, i) => {
      const titulo = it.titulo || (it.tipo === "imagem" ? "" : "Nota");
      return "- " + arquivos[i].nome + " (" + it.tipo + ")" + (titulo ? ": " + titulo : "");
    });
    readme =
      "# Contexto do canvas\n\n" +
      "Notas viram arquivos .md; imagens sao copiadas e ficam disponiveis aqui.\n\n" +
      "Itens de contexto disponiveis nesta pasta:\n\n" +
      linhas.join("\n") +
      "\n";
  }
  return { arquivos, readme };
}

export type AssinaturaArquivo = { nome: string; assinatura: string };
export type DiffContexto = { gravar: string[]; remover: string[] };

/** Grava novos/alterados (assinatura diferente), mantem iguais e remove o que sobrou no disco. */
export function diffContexto(atual: AssinaturaArquivo[], anterior: AssinaturaArquivo[]): DiffContexto {
  const antigos = new Map<string, string>(anterior.map((a) => [a.nome, a.assinatura]));
  const gravar: string[] = [];
  for (const a of atual) {
    const assinatura = antigos.get(a.nome);
    if (assinatura === undefined || assinatura !== a.assinatura) gravar.push(a.nome);
  }
  const presentes = new Set<string>(atual.map((a) => a.nome));
  const remover = anterior.filter((a) => !presentes.has(a.nome)).map((a) => a.nome);
  return { gravar, remover };
}

type EstadoAviso = { ocupado: boolean; pendentes: Set<string>; ultimo?: number };

/**
 * Fila de avisos de contexto por agente: junta nomes, segura enquanto o agente esta ocupado e, no
 * maximo, emite 1 aviso a cada `intervaloMs`.
 */
export class FilaAvisos {
  intervaloMs: number;
  estados: Map<string, EstadoAviso>;

  constructor(intervaloMs = 5000) {
    this.intervaloMs = intervaloMs;
    this.estados = new Map();
  }

  private estado(id: string): EstadoAviso {
    let e = this.estados.get(id);
    if (!e) {
      e = { ocupado: false, pendentes: new Set() };
      this.estados.set(id, e);
    }
    return e;
  }

  adicionar(id: string, nomes: string[]): void {
    const e = this.estado(id);
    for (const n of nomes) e.pendentes.add(n);
  }

  marcarOcupado(id: string): void {
    this.estado(id).ocupado = true;
  }

  marcarOcioso(id: string): void {
    this.estado(id).ocupado = false;
  }

  /** Devolve a mensagem do aviso (e consome a fila) ou null se nada a avisar agora. */
  liberar(id: string, agora: number): string | null {
    const e = this.estado(id);
    if (e.ocupado) return null;
    if (e.pendentes.size === 0) return null;
    if (e.ultimo !== undefined && agora - e.ultimo < this.intervaloMs) return null;
    const nomes = [...e.pendentes];
    e.pendentes.clear();
    e.ultimo = agora;
    return "contexto atualizado: " + nomes.join(", ") + " (leia .orchestra/contexto/" + id + "/README.md)";
  }
}
