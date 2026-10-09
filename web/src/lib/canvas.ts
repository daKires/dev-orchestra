// Logica pura do canvas no front (S3): a mesma base do modelo do hub (S1), mas reimplementada aqui
// para rodar no browser. NUNCA importamos nada de RUNTIME do hub: o modulo do hub usa node:crypto e
// nao vai pro bundle do browser — so' tipos entram, via `import type` (apagado na compilacao).
import type { No, Aresta, Op, Snapshot, TipoNo } from "../../../canvas.ts";

// Aplicacao de operacoes (mesma regra de conflito do hub)

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

// Grupo pai

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

// Nos do react-flow: medidas/selecao (S5 - F1.5, fix das arestas invisiveis)

/**
 * Mescla os nos RECONSTRUIDOS do modelo (`novos`) com os nos antigos do react-flow (`antigos`).
 * Pura (nunca muta a entrada, sempre devolve objetos novos): de cada antigo de mesmo id copia o
 * `measured` que o xyflow preencheu via onNodesChange (mudancas "dimensions") e o `selected`;
 * posicao, dados e todo o resto vem do novo. No' sem antigo fica sem `measured`/`selected`.
 * Sem `measured` o xyflow nao calcula a posicao das alcas e nao desenha as arestas.
 */
export function mesclarNosRf<T extends { id: string; measured?: unknown; selected?: boolean }>(
  novos: T[],
  antigos: T[],
): T[] {
  const porId = new Map(antigos.map((a) => [a.id, a]));
  return novos.map((novo) => {
    const antigo = porId.get(novo.id);
    const saida: Record<string, unknown> = { ...novo };
    delete saida.measured;
    delete saida.selected;
    if (antigo?.measured !== undefined) saida.measured = antigo.measured;
    if (antigo?.selected !== undefined) saida.selected = antigo.selected;
    return saida as unknown as T;
  });
}

// Inspetor (F2.1): so' nos criados a mao abrem o painel de propriedades

/** Tipos que tem editor proprio no inspetor (os cards automaticos ficam de fora). */
const TIPOS_INSPECIONAVEIS = new Set<TipoNo>(["nota", "forma", "imagem", "grupo", "texto"]);

/**
 * true SO' para os nos criados a mao dos tipos com editor (nota/forma/imagem/grupo/texto). Nos do
 * layout automatico (dados.auto, ex.: cards de run/regiao/fluxo) e tipos sem editor (agente, run,
 * worker, arquivo, explorador, navegador) NAO sao inspecionaveis: seleciona-los nao abre o editor.
 */
export function inspecionavel(no: { tipo: TipoNo; dados: Record<string, unknown> }): boolean {
  return TIPOS_INSPECIONAVEIS.has(no.tipo) && no.dados?.auto !== true;
}

// Markdown -> blocos

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

// Zoom

/** Limita o zoom a 10%..200%; NaN (ou nao-finito) cai em 1. */
export function limitarZoom(z: number): number {
  if (!Number.isFinite(z)) return 1;
  return Math.min(2, Math.max(0.1, z));
}

// Imagens

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

// Ferramentas e criacao de nos (S2 - F1.5)

/** Ferramentas da barra flutuante do canvas. */
export type Ferramenta = "selecionar" | "mao" | "nota" | "forma" | "imagem" | "regiao" | "seta" | "texto";

/** Atalho de teclado -> ferramenta (V/H/N/R/C/T, maiuscula ou minuscula); o resto -> null. */
export function ferramentaDoAtalho(tecla: string): Ferramenta | null {
  switch (tecla.toLowerCase()) {
    case "v": return "selecionar";
    case "h": return "mao";
    case "n": return "nota";
    case "r": return "regiao";
    case "c": return "seta";
    case "t": return "texto";
    default: return null;
  }
}

/** Tamanhos padrao (px) dos cards criados por clique (sem arrasto). */
export const TAMANHO_PADRAO = {
  nota: { w: 300, h: 260 },
  forma: { w: 160, h: 80 },
  regiao: { w: 480, h: 320 },
  texto: { w: 240, h: 48 },
} as const;

export type Retangulo = { x: number; y: number; w: number; h: number };

/**
 * Geometrica do clique/arrasto: um clique (< 4px em cada eixo) usa o tamanho padrao na ancora `a`;
 * um arrasto normaliza pelo canto minimo e nunca tem lado menor que 40px.
 */
export function retanguloDeArrasto(
  a: { x: number; y: number },
  b: { x: number; y: number },
  padrao: { w: number; h: number },
): Retangulo {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return { x: a.x, y: a.y, w: padrao.w, h: padrao.h };
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(40, Math.abs(dx)), h: Math.max(40, Math.abs(dy)) };
}

export type NomeForma = "elipse" | "retangulo" | "losango";

/** Cor padrao de uma forma nova (Castor): elipse verde, losango amarelo, retangulo cinza. */
function corDaForma(forma: NomeForma): string {
  return forma === "elipse" ? "verde" : forma === "losango" ? "amarelo" : "cinza";
}

/**
 * No' resultante de uma ferramenta de criacao; `null` para as que nao criam (selecionar/mao/seta/
 * imagem). `rev = Date.now()` garante a ultima-escrita-vence na proxima sincronizacao.
 */
export function noNovo(
  ferramenta: Ferramenta,
  ret: Retangulo,
  id: string,
  extra?: { forma?: NomeForma },
): No | null {
  const base = { id, x: ret.x, y: ret.y, w: ret.w, h: ret.h, rev: Date.now() };
  switch (ferramenta) {
    case "nota":
      return { ...base, tipo: "nota", dados: { titulo: "Nota", corpo: "", cor: "amarelo" } };
    case "forma": {
      const forma: NomeForma = extra?.forma ?? "retangulo";
      return { ...base, tipo: "forma", dados: { forma, texto: "", cor: corDaForma(forma) } };
    }
    case "regiao":
      return { ...base, tipo: "grupo", dados: { titulo: "Região", cor: "cinza" } };
    case "texto":
      return { ...base, tipo: "texto", dados: { texto: "", tamanho: "m" } };
    default:
      return null;
  }
}

// Paletas / tokens visuais do Castor (puro, sem React)

/** Tokens de uma nota: fundo do card, borda, faixa de cabecalho e cor do texto. */
export type EstiloNota = { fundo: string; borda: string; cabecalho: string; texto: string };

const NOTA_AMARELO: EstiloNota = { fundo: "#ffe066", borda: "#e5c33f", cabecalho: "#fff0a8", texto: "#3d3312" };

const NOTAS: Record<string, EstiloNota> = {
  amarelo: NOTA_AMARELO,
  rosa: { fundo: "#f5c4dc", borda: "#d99abb", cabecalho: "#fbe0ed", texto: "#512c40" },
  azul: { fundo: "#aabaff", borda: "#919fe0", cabecalho: "#ccd5ff", texto: "#303953" },
  lilas: { fundo: "#d6c8f5", borda: "#b5a3e0", cabecalho: "#e8defa", texto: "#3b2f5c" },
  verde: { fundo: "#bfe8c8", borda: "#8fcc9c", cabecalho: "#dcf3e1", texto: "#1f4a2a" },
};

/** Tokens da nota para `cor`; cor desconhecida (ou ausente) cai no amarelo. */
export function estiloNota(cor: unknown): EstiloNota {
  return typeof cor === "string" && cor in NOTAS ? NOTAS[cor] : NOTA_AMARELO;
}

/** Tokens de uma forma: preenchimento solido e texto escuro fixo (#242326). */
export type EstiloForma = { fundo: string; texto: string };

const FORMA_CINZA: EstiloForma = { fundo: "#a4a1aa", texto: "#242326" };

const FORMAS: Record<string, EstiloForma> = {
  verde: { fundo: "#46bb94", texto: "#242326" },
  amarelo: { fundo: "#c6be62", texto: "#242326" },
  vermelho: { fundo: "#df7971", texto: "#242326" },
  cinza: FORMA_CINZA,
  lilas: { fundo: "#b9a8e6", texto: "#242326" },
};

/** Tokens da forma para `cor`; cor desconhecida (ou ausente) cai no cinza. */
export function estiloForma(cor: unknown): EstiloForma {
  return typeof cor === "string" && cor in FORMAS ? FORMAS[cor] : FORMA_CINZA;
}

/** Setas (markerEnd) so' aparecem entre duas formas; qualquer outra combinacao fica sem ponta. */
export function pontaDaAresta(tipoOrigem: unknown, tipoDestino: unknown): boolean {
  return tipoOrigem === "forma" && tipoDestino === "forma";
}

/** Cores de nota/forma (mesmas chaves de antes) derivadas do token de `fundo`. */
export const CORES_NOTA = {
  amarelo: estiloNota("amarelo").fundo,
  rosa: estiloNota("rosa").fundo,
  lilas: estiloNota("lilas").fundo,
  azul: estiloNota("azul").fundo,
  verde: estiloNota("verde").fundo,
} as const;

export const CORES_FORMA = {
  verde: estiloForma("verde").fundo,
  cinza: estiloForma("cinza").fundo,
  amarelo: estiloForma("amarelo").fundo,
  vermelho: estiloForma("vermelho").fundo,
  lilas: estiloForma("lilas").fundo,
} as const;

/** Cores de região/grupo (moldura da zona): cinza ou lilás. */
export const CORES_REGIAO = { cinza: "#858585", lilas: "#7966d6" } as const;

// Edicao: duplicar/colar e ordem z (S3 - F1.5, CA-E2/E3)

/**
 * Copia os nos de `ids` mais os filhos RECURSIVOS dos grupos copiados: cada copia ganha id novo e
 * x/y + `desloc`. O `pai` e' remapeado quando o pai tambem foi copiado (senao e' mantido, como um
 * filho que aponta pra um grupo de fora da copia). So' entram as arestas com as DUAS pontas
 * copiadas, com id novo e pontas remapeadas. Nunca muta o snapshot; `ids` vazio devolve
 * `{nos:[], arestas:[]}`.
 */
export function duplicarNos(s: Snapshot, ids: string[], novoId: () => string, desloc = 24): Snapshot {
  if (ids.length === 0) return { nos: [], arestas: [] };
  const porId = new Map(s.nos.map((n) => [n.id, n]));
  const copiar = new Set<string>();
  const fila: string[] = [];
  for (const id of ids) if (porId.has(id) && !copiar.has(id)) { copiar.add(id); fila.push(id); }
  // filhos recursivos dos grupos copiados (BFS na ordem do snapshot).
  for (let i = 0; i < fila.length; i++) {
    const pai = fila[i];
    for (const n of s.nos) {
      if (n.pai === pai && !copiar.has(n.id)) { copiar.add(n.id); fila.push(n.id); }
    }
  }
  const mapa = new Map<string, string>();
  for (const id of copiar) mapa.set(id, novoId());
  const nos: No[] = [];
  for (const id of copiar) {
    const n = porId.get(id)!;
    const pai = n.pai !== undefined && copiar.has(n.pai) ? mapa.get(n.pai) : n.pai;
    nos.push({ ...n, id: mapa.get(id)!, x: n.x + desloc, y: n.y + desloc, pai });
  }
  const arestas: Aresta[] = [];
  for (const a of s.arestas) {
    if (copiar.has(a.de) && copiar.has(a.para)) {
      arestas.push({ ...a, id: novoId(), de: mapa.get(a.de)!, para: mapa.get(a.para)! });
    }
  }
  return { nos, arestas };
}

/** z de um no' em dados.z (numero finito); ausente/nao-numerico conta como 0. */
function zDoNo(n: No): number {
  const z = n.dados?.z;
  return typeof z === "number" && Number.isFinite(z) ? z : 0;
}

/**
 * Devolve SO' os nos de `ids`, cada um com `dados.z = maxZ + 1` ("frente") ou `minZ - 1` ("tras"),
 * considerando o z atual de TODOS os nos. Nunca muta; preserva os demais dados de cada no'.
 */
export function ordemZ(nos: No[], ids: string[], onde: "frente" | "tras"): No[] {
  const zs = nos.map(zDoNo);
  const z = onde === "frente" ? (zs.length ? Math.max(...zs) + 1 : 1) : (zs.length ? Math.min(...zs) - 1 : -1);
  const alvo = new Set(ids);
  return nos.filter((n) => alvo.has(n.id)).map((n) => ({ ...n, dados: { ...n.dados, z } }));
}

// Historico local por ops inversas (S4 - F1.5, CA-E4)

/**
 * Ops que DESFAZEM `ops`, na ordem inversa. Criar -> remove; editar -> volta o item anterior com o
 * `rev` dado; remover no' -> restaura o no' e as arestas ligadas a ele (do snapshot `antes`).
 * Remover um item que nao existia em `antes` nao gera nada.
 */
export function inversoDe(antes: Snapshot, ops: Op[], rev: number): Op[] {
  const nosAntes = new Map(antes.nos.map((n) => [n.id, n]));
  const arestasAntes = new Map(antes.arestas.map((a) => [a.id, a]));
  const out: Op[] = [];
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i];
    if (op.op === "upsert") {
      if (op.tipo === "no") {
        const antigo = nosAntes.get(op.item.id);
        out.push(antigo
          ? { op: "upsert", tipo: "no", item: { ...antigo, rev } }
          : { op: "remove", tipo: "no", item: { id: op.item.id, rev } });
      } else {
        const antigo = arestasAntes.get(op.item.id);
        out.push(antigo
          ? { op: "upsert", tipo: "aresta", item: { ...antigo, rev } }
          : { op: "remove", tipo: "aresta", item: { id: op.item.id, rev } });
      }
    } else if (op.tipo === "no") {
      const antigo = nosAntes.get(op.item.id);
      if (!antigo) continue;
      for (const a of antes.arestas) {
        if (a.de === op.item.id || a.para === op.item.id) out.push({ op: "upsert", tipo: "aresta", item: { ...a, rev } });
      }
      out.push({ op: "upsert", tipo: "no", item: { ...antigo, rev } });
    } else {
      const antigo = arestasAntes.get(op.item.id);
      if (antigo) out.push({ op: "upsert", tipo: "aresta", item: { ...antigo, rev } });
    }
  }
  return out;
}

type PassoHistorico = { inverso: Op[]; refazer: Op[] };

/** Pilha de desfazer/refazer (limite 100); registrar uma acao nova limpa o refazer. */
export class Historico {
  private desfeitos: PassoHistorico[] = [];
  private refeitos: PassoHistorico[] = [];

  registrar(inverso: Op[], refazer: Op[]): void {
    this.desfeitos.push({ inverso, refazer });
    if (this.desfeitos.length > 100) this.desfeitos.shift();
    this.refeitos = [];
  }

  desfazer(): Op[] | null {
    const passo = this.desfeitos.pop();
    if (!passo) return null;
    this.refeitos.push(passo);
    return passo.inverso;
  }

  refazer(): Op[] | null {
    const passo = this.refeitos.pop();
    if (!passo) return null;
    this.desfeitos.push(passo);
    return passo.refazer;
  }
}

// Miniatura do canvas (S5 - F1.5, CA-P1)

export type MiniRetangulo = { x: number; y: number; w: number; h: number; cor: string };
export type MiniLinha = { x1: number; y1: number; x2: number; y2: number };
export type Miniatura = { retangulos: MiniRetangulo[]; linhas: MiniLinha[] };

/** Cor de um no' na miniatura: nota/forma pela paleta, o resto na cor do card. */
function corMini(no: No): string {
  if (no.tipo === "nota") return estiloNota(no.dados.cor).fundo;
  if (no.tipo === "forma") return estiloForma(no.dados.cor).fundo;
  return "#1c1c1c";
}

/**
 * Projecao do grafo numa caixa `largura x altura`: escala uniforme pra caber com margem 4,
 * centralizado, retangulos por no' e linhas entre centros (arestas com ponta inexistente sao
 * ignoradas). Vazio -> `{retangulos:[], linhas:[]}`.
 */
export function miniatura(s: Snapshot, largura: number, altura: number): Miniatura {
  if (s.nos.length === 0) return { retangulos: [], linhas: [] };
  const margem = 4;
  const minX = Math.min(...s.nos.map((n) => n.x));
  const minY = Math.min(...s.nos.map((n) => n.y));
  const maxX = Math.max(...s.nos.map((n) => n.x + n.w));
  const maxY = Math.max(...s.nos.map((n) => n.y + n.h));
  const larguraB = maxX - minX;
  const alturaB = maxY - minY;
  const escX = larguraB > 0 ? (largura - 2 * margem) / larguraB : Infinity;
  const escY = alturaB > 0 ? (altura - 2 * margem) / alturaB : Infinity;
  const bruta = Math.min(escX, escY);
  const escala = Number.isFinite(bruta) ? bruta : 1;
  const deslX = margem + (largura - 2 * margem - larguraB * escala) / 2;
  const deslY = margem + (altura - 2 * margem - alturaB * escala) / 2;
  const retangulos = s.nos.map((n) => ({
    x: deslX + (n.x - minX) * escala,
    y: deslY + (n.y - minY) * escala,
    w: n.w * escala,
    h: n.h * escala,
    cor: corMini(n),
  }));
  const porId = new Map(retangulos.map((r, i) => [s.nos[i].id, r]));
  const linhas: MiniLinha[] = [];
  for (const a of s.arestas) {
    const r1 = porId.get(a.de);
    const r2 = porId.get(a.para);
    if (!r1 || !r2) continue;
    linhas.push({ x1: r1.x + r1.w / 2, y1: r1.y + r1.h / 2, x2: r2.x + r2.w / 2, y2: r2.y + r2.h / 2 });
  }
  return { retangulos, linhas };
}

// Auto-organizar em faixas por tipo + fixar cards (S5 - acabamento)

export const ESPACO_ORGANIZAR = 80;
export const LARGURA_ORGANIZAR = 3200;

export function alternarFixado(nos: No[], ids: string[], rev: number): Op[] {
  const alvos = nos.filter((n) => ids.includes(n.id));
  const fixar = alvos.some((n) => n.dados.fixado !== true);
  return alvos.map((n) => ({ op: "upsert", tipo: "no", item: { ...n, dados: { ...n.dados, fixado: fixar }, rev } }));
}

const FAIXAS: TipoNo[][] = [["agente"], ["navegador"], ["run", "worker", "painel"], ["nota", "imagem", "arquivo", "explorador", "texto"], ["forma", "grupo"]];
const fixo = (n: No) => n.dados.fixado === true;
const bate = (a: Retangulo, b: Retangulo, m: number) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;

// Empilha `itens` em faixas a partir de (x0,y0), largura max `larg`, evitando `obst`. Devolve posicoes e a altura usada.
function empilhar(itens: No[], x0: number, y0: number, larg: number, obst: Retangulo[]): { pos: Map<string, { x: number; y: number }>; fundo: number; direita: number } {
  const pos = new Map<string, { x: number; y: number }>();
  let y = y0;
  let fundo = y0;
  let direita = x0;
  for (const tipos of FAIXAS) {
    const da = itens.filter((n) => tipos.includes(n.tipo)).sort((a, b) => a.x - b.x || a.y - b.y);
    if (!da.length) continue;
    let x = x0;
    let alturaLinha = 0;
    for (const n of da) {
      for (let guarda = 0; guarda < 500; guarda++) {
        if (x > x0 && x + n.w > x0 + larg) {
          y += alturaLinha + ESPACO_ORGANIZAR;
          x = x0;
          alturaLinha = 0;
        }
        const r = { x, y, w: n.w, h: n.h };
        const o = obst.find((b) => bate(r, b, ESPACO_ORGANIZAR / 2));
        if (!o) break;
        x = o.x + o.w + ESPACO_ORGANIZAR;
        if (x + n.w > x0 + larg) {
          y += Math.max(alturaLinha, 1) + ESPACO_ORGANIZAR;
          x = x0;
          alturaLinha = 0;
        }
      }
      pos.set(n.id, { x, y });
      x += n.w + ESPACO_ORGANIZAR;
      alturaLinha = Math.max(alturaLinha, n.h);
      fundo = Math.max(fundo, y + n.h);
      direita = Math.max(direita, x - ESPACO_ORGANIZAR);
    }
    y = fundo + ESPACO_ORGANIZAR;
  }
  return { pos, fundo, direita };
}

/**
 * Auto-organiza o canvas em faixas horizontais por tipo (agente -> navegador -> run/worker ->
 * nota/imagem/arquivo/explorador/texto -> forma/grupo), respeitando os cards fixados. Regioes
 * (grupos) movem como bloco com seus descendentes e rearrumam os filhos por dentro, crescendo se
 * precisar. Devolve so' os upserts dos nos cujo x/y/w/h mudou; tudo fixado (ou vazio) -> [].
 */
export function organizarPorTipo(nos: No[], rev: number): Op[] {
  if (nos.length === 0) return [];
  const atual = new Map<string, No>(nos.map((n) => [n.id, { ...n }]));
  const grupos = nos.filter((n) => n.tipo === "grupo");
  const pai = new Map<string, string | undefined>();
  for (const n of nos) pai.set(n.id, paiDoNo(n, grupos));

  const descendentes = (id: string): string[] => {
    const out: string[] = [];
    const fila = [id];
    for (let i = 0; i < fila.length; i++) {
      for (const n of nos) {
        if (pai.get(n.id) === fila[i]) {
          out.push(n.id);
          fila.push(n.id);
        }
      }
    }
    return out;
  };
  const ehFixo = (n: No): boolean =>
    fixo(n) || (n.tipo === "grupo" && descendentes(n.id).some((d) => fixo(atual.get(d)!)));
  const mover = (id: string, dx: number, dy: number) => {
    const n = atual.get(id)!;
    n.x += dx;
    n.y += dy;
    if (n.tipo === "grupo") {
      for (const d of descendentes(id)) {
        const m = atual.get(d)!;
        m.x += dx;
        m.y += dy;
      }
    }
  };
  const retangulo = (r: Retangulo): Retangulo => ({ x: r.x, y: r.y, w: r.w, h: r.h });

  // 1) Regioes do mais interno ao mais externo: arruma os filhos nao fixados por dentro.
  for (const g of [...grupos].sort((a, b) => a.w * a.h - b.w * b.h)) {
    const filhos = nos.filter((n) => pai.get(n.id) === g.id).map((n) => atual.get(n.id)!);
    if (filhos.length === 0) continue;
    const gAtual = atual.get(g.id)!;
    const contidos = filhos.filter((c) => !ehFixo(c));
    const obst: Retangulo[] = filhos.filter(ehFixo).map(retangulo);
    const larg = Math.max(gAtual.w - 80, ...filhos.map((c) => c.w));
    const { pos, fundo, direita } = empilhar(contidos, gAtual.x + 40, gAtual.y + 48, larg, obst);
    for (const c of contidos) {
      const p = pos.get(c.id)!;
      mover(c.id, p.x - c.x, p.y - c.y);
    }
    gAtual.w = Math.max(gAtual.w, direita - gAtual.x + 40);
    gAtual.h = Math.max(gAtual.h, fundo - gAtual.y + 40);
  }

  // 2) Topo: empilha os nao fixados a partir da origem, desviando dos fixados (e regioes com fixados).
  const topo = nos.filter((n) => !pai.get(n.id)).map((n) => atual.get(n.id)!);
  const obst: Retangulo[] = topo.filter(ehFixo).map(retangulo);
  const moverTopo = topo.filter((n) => !ehFixo(n));
  const { pos } = empilhar(moverTopo, 0, 0, LARGURA_ORGANIZAR, obst);
  for (const n of moverTopo) {
    const p = pos.get(n.id)!;
    mover(n.id, p.x - n.x, p.y - n.y);
  }

  // 3) So' os nos que mudaram de posicao/tamanho.
  const ops: Op[] = [];
  for (const n of nos) {
    const a = atual.get(n.id)!;
    if (a.x !== n.x || a.y !== n.y || a.w !== n.w || a.h !== n.h) {
      ops.push({ op: "upsert", tipo: "no", item: { ...n, x: a.x, y: a.y, w: a.w, h: a.h, rev } });
    }
  }
  return ops;
}
