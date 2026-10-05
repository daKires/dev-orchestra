// Logica pura do canvas no front (S3): a mesma base do modelo do hub (S1), mas reimplementada aqui
// para rodar no browser. NUNCA importamos nada de RUNTIME do hub: o modulo do hub usa node:crypto e
// nao vai pro bundle do browser — so' tipos entram, via `import type` (apagado na compilacao).
import type { No, Aresta, Op, Snapshot } from "../../../canvas.ts";

// ---------------------------------------------------------------------------
// Aplicacao de operacoes (mesma regra de conflito do hub)
// ---------------------------------------------------------------------------

/**
 * Devolve um NOVO snapshot (nunca muta o original). Mesma regra do aplicarOps do hub: a ultima
 * escrita vence POR ITEM (aplica quando o item nao existe ou `rev >= rev` atual) e remover um no'
 * tambem remove as arestas ligadas a ele e solta os filhos (pai).
 */
export function aplicarOpsLocal(s: Snapshot, ops: Op[]): Snapshot {
  const nos = new Map<string, No>(s.nos.map((n) => [n.id, n]));
  const arestas = new Map<string, Aresta>(s.arestas.map((a) => [a.id, a]));

  for (const op of ops) {
    if (op.op === "upsert" && op.tipo === "no") {
      const atual = nos.get(op.item.id);
      if (!atual || op.item.rev >= atual.rev) nos.set(op.item.id, op.item);
    } else if (op.op === "upsert" && op.tipo === "aresta") {
      const atual = arestas.get(op.item.id);
      if (!atual || op.item.rev >= atual.rev) arestas.set(op.item.id, op.item);
    } else if (op.op === "remove" && op.tipo === "no") {
      const atual = nos.get(op.item.id);
      if (atual && op.item.rev >= atual.rev) {
        nos.delete(op.item.id);
        for (const [id, a] of arestas) {
          if (a.de === op.item.id || a.para === op.item.id) arestas.delete(id);
        }
        for (const [id, n] of nos) {
          if (n.pai === op.item.id) nos.set(id, { ...n, pai: undefined });
        }
      }
    } else if (op.op === "remove" && op.tipo === "aresta") {
      const atual = arestas.get(op.item.id);
      if (atual && op.item.rev >= atual.rev) arestas.delete(op.item.id);
    }
  }

  return { nos: [...nos.values()], arestas: [...arestas.values()] };
}

// ---------------------------------------------------------------------------
// Grupo pai
// ---------------------------------------------------------------------------

/**
 * Id do MENOR grupo que contem o no' INTEIRO (comparando x,y,w,h absolutos com o retangulo do
 * grupo). Nunca devolve o proprio no'; sem grupo que o contenha, devolve undefined.
 */
export function paiDoNo(no: No, grupos: No[]): string | undefined {
  const x1 = no.x;
  const y1 = no.y;
  const x2 = no.x + no.w;
  const y2 = no.y + no.h;
  let melhor: No | undefined;
  for (const g of grupos) {
    if (g.id === no.id) continue; // um grupo nunca e' pai de si mesmo
    if (g.x <= x1 && g.y <= y1 && g.x + g.w >= x2 && g.y + g.h >= y2) {
      if (!melhor || g.w * g.h < melhor.w * melhor.h) melhor = g;
    }
  }
  return melhor?.id;
}

// ---------------------------------------------------------------------------
// Markdown -> blocos
// ---------------------------------------------------------------------------

/** Trecho inline de markdown. Chaves so' aparecem quando verdadeiras (sem false/undefined). */
export type Trecho = { texto: string; negrito?: true; codigo?: true };

export type BlocoMd =
  | { tipo: "titulo"; nivel: number; trechos: Trecho[] }
  | { tipo: "item"; trechos: Trecho[] }
  | { tipo: "codigo"; texto: string }
  | { tipo: "paragrafo"; trechos: Trecho[] };

// Quebra um texto em trechos de **negrito** e `codigo`; o resto e' texto puro (html NAO e' escapado,
// vira texto). Delimitador sem par fica literal.
function trechosInline(texto: string): Trecho[] {
  const out: Trecho[] = [];
  let buf = "";
  const soltar = () => {
    if (buf) {
      out.push({ texto: buf });
      buf = "";
    }
  };
  let i = 0;
  while (i < texto.length) {
    if (texto.startsWith("**", i)) {
      const fim = texto.indexOf("**", i + 2);
      if (fim > i + 2) {
        soltar();
        out.push({ texto: texto.slice(i + 2, fim), negrito: true });
        i = fim + 2;
        continue;
      }
    }
    if (texto[i] === "`") {
      const fim = texto.indexOf("`", i + 1);
      if (fim > i + 1) {
        soltar();
        out.push({ texto: texto.slice(i + 1, fim), codigo: true });
        i = fim + 1;
        continue;
      }
    }
    buf += texto[i];
    i++;
  }
  soltar();
  return out;
}

const RE_TITULO = /^(#{1,3})\s+(.*)$/;
const RE_ITEM = /^[-*]\s+(.*)$/;
const ehCerca = (l: string) => l.startsWith("```");
const ehLinhaEspecial = (l: string) => ehCerca(l) || RE_TITULO.test(l) || RE_ITEM.test(l);

/**
 * Converte um markdown simples em blocos: # ## ### (titulo), "- "/"* " (item), cerca ``` (codigo) e
 * linhas consecutivas nao vazias (paragrafo, unidas por um espaco). Vazio -> [].
 */
export function mdBlocos(texto: string): BlocoMd[] {
  const linhas = texto.split("\n");
  const blocos: BlocoMd[] = [];
  let i = 0;
  while (i < linhas.length) {
    const limpa = linhas[i].trim();
    if (limpa === "") {
      i++;
      continue;
    }
    if (ehCerca(limpa)) {
      const conteudo: string[] = [];
      i++;
      while (i < linhas.length && !ehCerca(linhas[i].trim())) {
        conteudo.push(linhas[i]);
        i++;
      }
      if (i < linhas.length) i++; // pula a cerca de fechamento
      blocos.push({ tipo: "codigo", texto: conteudo.join("\n") });
      continue;
    }
    const titulo = RE_TITULO.exec(limpa);
    if (titulo) {
      blocos.push({ tipo: "titulo", nivel: titulo[1].length, trechos: trechosInline(titulo[2]) });
      i++;
      continue;
    }
    const item = RE_ITEM.exec(limpa);
    if (item) {
      blocos.push({ tipo: "item", trechos: trechosInline(item[1]) });
      i++;
      continue;
    }
    const buf = [limpa];
    i++;
    while (i < linhas.length) {
      const prox = linhas[i].trim();
      if (prox === "" || ehLinhaEspecial(prox)) break;
      buf.push(prox);
      i++;
    }
    blocos.push({ tipo: "paragrafo", trechos: trechosInline(buf.join(" ")) });
  }
  return blocos;
}

// ---------------------------------------------------------------------------
// Zoom
// ---------------------------------------------------------------------------

/** Limita o zoom a 10%..200%; NaN (ou nao-finito) cai em 1. */
export function limitarZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(2, Math.max(0.1, z));
}

// ---------------------------------------------------------------------------
// Imagens
// ---------------------------------------------------------------------------

export const MAX_IMAGEM_BYTES = 25 * 1024 * 1024;

/** Mesmas extensoes de imagem do hub (validarAsset). */
const EXT_IMAGEM: readonly string[] = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "bmp",
  "svg",
  "avif",
  "ico",
];

function extensaoDe(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(i + 1).toLowerCase() : "";
}

/**
 * null = pode anexar; string = motivo da recusa em PT-BR (mensagem com a palavra "formato" quando a
 * extensao nao e' de imagem, e com "25MB" quando passa do limite).
 */
export function checarImagem(nome: string, bytes: number): string | null {
  const ext = extensaoDe(nome);
  if (ext.length === 0 || !EXT_IMAGEM.includes(ext)) {
    const qual = ext ? `extensão .${ext}` : "sem extensão";
    return `Formato de imagem não aceito (${qual}). Use: ${EXT_IMAGEM.join("/")}.`;
  }
  if (bytes > MAX_IMAGEM_BYTES) {
    return "Imagem grande demais: o tamanho máximo é 25MB por arquivo.";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Paletas (cores CSS, pastel nas notas como o Castor)
// ---------------------------------------------------------------------------

export const CORES_NOTA = {
  amarelo: "#FFF3C4",
  rosa: "#FFD6E0",
  lilas: "#E7D8FF",
  azul: "#D6E8FF",
  verde: "#D6F5D6",
} as const;

export const CORES_FORMA = {
  verde: "#22C55E",
  cinza: "#64748B",
  amarelo: "#EAB308",
  vermelho: "#EF4444",
  lilas: "#A78BFA",
} as const;
