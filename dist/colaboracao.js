import { posix } from "node:path";
// ---------------------------------------------------------------------------
// Nomes
// ---------------------------------------------------------------------------
/** Slug de um nome: minusculas, sem acento, separador '-'. Ex.: "Líder do Projeto" -> "lider-do-projeto". */
export function slugNome(nome) {
    return nome
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
// ---------------------------------------------------------------------------
// Grafo de colaboracao
// ---------------------------------------------------------------------------
/**
 * Agentes ligados a `agenteId` por uma aresta (em qualquer direcao), sem ele mesmo,
 * na ordem em que aparecem em `agentes` (CA-6a).
 */
export function conectados(snap, agenteId, agentes) {
    const no = snap.nos.find((n) => n.tipo === "agente" && n.dados.agenteId === agenteId);
    if (!no)
        return [];
    const ids = new Set();
    for (const a of snap.arestas) {
        const outro = a.de === no.id ? a.para : a.para === no.id ? a.de : null;
        if (outro === null)
            continue;
        const vizinho = snap.nos.find((n) => n.id === outro);
        if (vizinho && vizinho.tipo === "agente") {
            const id = vizinho.dados.agenteId;
            if (typeof id === "string" && id !== agenteId)
                ids.add(id);
        }
    }
    return agentes.filter((a) => ids.has(a.id));
}
/**
 * Resolve o alvo por id exato ou pelo slug do nome (case-insensitive). Ambiguo devolve
 * erro com 'ambíguo' e os ids; nenhum devolve "agente <alvo> não está conectado a você" (CA-6b, 6c).
 */
export function resolverAlvo(lista, alvo) {
    const exato = lista.find((a) => a.id === alvo);
    if (exato)
        return { ok: exato };
    const slug = slugNome(alvo);
    const casam = lista.filter((a) => slugNome(a.nome) === slug);
    if (casam.length === 0)
        return { erro: `agente ${alvo} não está conectado a você` };
    if (casam.length === 1)
        return { ok: casam[0] };
    return { erro: `agente ${alvo} é ambíguo: ${casam.map((a) => a.id).join(", ")}` };
}
/**
 * Registro de perguntas/respostas entre agentes. `q-N` e' global; no maximo 3 pendentes
 * por origem e profundidade maxima 4; pendentes expiram em 30 min (CA-6b..6f).
 */
export class Conversas {
    agora;
    maxPendentes;
    maxProfundidade;
    ttlMs;
    n = 0;
    todas = [];
    constructor(agora = Date.now, opts = {}) {
        this.agora = agora;
        this.maxPendentes = opts.maxPendentes ?? 3;
        this.maxProfundidade = opts.maxProfundidade ?? 4;
        this.ttlMs = opts.ttlMs ?? 30 * 60_000;
    }
    /** Pergunta de `de` para `para`; consome um `q-N` apenas quando bem-sucedida. */
    perguntar(de, para, texto) {
        if (de === para)
            return { erro: "você não pode perguntar a si mesmo" };
        const pendentesDe = this.todas.filter((p) => !p.respondida && p.de === de);
        if (pendentesDe.length >= this.maxPendentes) {
            return { erro: `limite de ${this.maxPendentes} perguntas pendentes` };
        }
        const paraDe = this.todas.filter((p) => !p.respondida && p.para === de);
        const maior = paraDe.reduce((m, p) => (p.profundidade > m ? p.profundidade : m), 0);
        const profundidade = 1 + maior;
        if (profundidade > this.maxProfundidade) {
            return { erro: `limite de profundidade ${this.maxProfundidade}` };
        }
        const p = { q: `q-${++this.n}`, de, para, texto, profundidade, criadaEm: this.agora(), respondida: false };
        this.todas.push(p);
        return { ok: p };
    }
    /** Responde `q`; so o alvo pode responder e apenas uma vez. */
    responder(de, q) {
        const p = this.todas.find((x) => x.q === q);
        if (!p)
            return { erro: `${q} não existe` };
        if (p.respondida)
            return { erro: `${q} já respondida` };
        if (p.para !== de)
            return { erro: `só ${p.para} pode responder a ${q}` };
        p.respondida = true;
        return { ok: p };
    }
    /** Remove e devolve as pendentes expiradas (mais antigas que o TTL). */
    expirar() {
        const agora = this.agora();
        const expiradas = this.todas.filter((p) => !p.respondida && agora - p.criadaEm >= this.ttlMs);
        if (expiradas.length > 0) {
            const set = new Set(expiradas);
            this.todas = this.todas.filter((p) => !set.has(p));
        }
        return expiradas;
    }
    /** Encerra `agenteId`: devolve as pendentes PARA ele e remove tambem as DELE (CA-6e). */
    encerrarAgente(agenteId) {
        const paraEle = this.todas.filter((p) => !p.respondida && p.para === agenteId);
        this.todas = this.todas.filter((p) => p.de !== agenteId && p.para !== agenteId);
        return paraEle;
    }
    /** Pendentes atuais (na ordem de criacao). */
    pendentes() {
        return this.todas.filter((p) => !p.respondida);
    }
}
// ---------------------------------------------------------------------------
// Fila de entregas
// ---------------------------------------------------------------------------
/** Fila por agente; um agente desconhecido conta como ocioso (CA-6e). */
export class FilaEntregas {
    filas = new Map();
    ocupados = new Map();
    enfileirar(agenteId, item) {
        const fila = this.filas.get(agenteId);
        if (fila)
            fila.push(item);
        else
            this.filas.set(agenteId, [item]);
    }
    marcarOcupado(agenteId) {
        this.ocupados.set(agenteId, true);
    }
    marcarOcioso(agenteId) {
        this.ocupados.set(agenteId, false);
    }
    /** Devolve e esvazia a fila; devolve [] (sem esvaziar) enquanto o agente esta ocupado. */
    liberar(agenteId) {
        if (this.ocupados.get(agenteId))
            return [];
        const fila = this.filas.get(agenteId) ?? [];
        this.filas.set(agenteId, []);
        return fila;
    }
}
// ---------------------------------------------------------------------------
// Formatadores
// ---------------------------------------------------------------------------
export function fmtPergunta(de, q, texto) {
    return `[pergunta de ${de} · ${q}] ${texto} -- responda com: canvas reply ${q} "<resultado>"`;
}
export function fmtResposta(de, q, texto) {
    return `[resposta de ${de} · ${q}] ${texto}`;
}
export function fmtMensagem(de, texto) {
    return `[mensagem de ${de}] ${texto}`;
}
export function fmtSemResposta(de, q) {
    return `[sem resposta de ${de} para ${q}]`;
}
/** Linha com a identidade do agente para o system prompt: nome (id) + comando `canvas --eu id:token`. */
export function linhaIdentidade(nome, id, token) {
    return `${nome} (${id}) — use: canvas --eu ${id}:${token}`;
}
// ---------------------------------------------------------------------------
// Flow do agente (regiao + formas)
// ---------------------------------------------------------------------------
const FORMAS = ["elipse", "losango", "retangulo"];
const CORES_FORMA = ["amarelo", "cinza", "lilas", "verde", "vermelho"];
const FORMA_W = 180;
const FORMA_H = 80;
const REG_PAD = 24;
const REG_GAP = 48;
const REG_TITULO = 40;
const REG_ACIMA = 40;
/** Cor padrao de uma forma nova: elipse verde, losango amarelo, retangulo cinza. */
export function corPadraoForma(forma) {
    return forma === "elipse" ? "verde" : forma === "losango" ? "amarelo" : "cinza";
}
/**
 * Cria/atualiza uma forma no fluxo do agente. Garante a regiao `flowreg:<agenteId>`
 * acima do agente (crescendo para caber) e mantem a posicao da forma no update (CA-11c).
 */
export function opsFlowAdd(snap, agNo, nomeAgente, chave, forma, texto, cor, rev = 0) {
    const agenteId = String(agNo.dados.agenteId);
    if (!FORMAS.includes(forma))
        return { erro: `forma inválida: ${forma}` };
    if (cor !== undefined && !CORES_FORMA.includes(cor))
        return { erro: `cor inválida: ${cor}` };
    const regId = `flowreg:${agenteId}`;
    const idForma = `flow:${agenteId}:${chave}`;
    const regAtual = snap.nos.find((n) => n.id === regId);
    const existente = snap.nos.find((n) => n.id === idForma);
    const regX = regAtual ? regAtual.x : agNo.x;
    const regH = REG_TITULO + REG_PAD * 2 + FORMA_H;
    const regY = agNo.y - REG_ACIMA - regH;
    const baseY = regY + REG_TITULO + REG_PAD;
    const outras = snap.nos.filter((n) => n.pai === regId && n.id !== idForma).sort((a, b) => a.x - b.x);
    let x;
    let y;
    if (existente) {
        x = existente.x;
        y = existente.y;
    }
    else {
        const ultimo = outras[outras.length - 1];
        x = ultimo ? ultimo.x + ultimo.w + REG_GAP : regX + REG_PAD;
        y = baseY;
    }
    const maxRight = [...outras.map((n) => n.x + n.w), x + FORMA_W].reduce((m, v) => (v > m ? v : m), x + FORMA_W);
    const regW = maxRight - regX + REG_PAD;
    const ops = [
        {
            op: "upsert",
            tipo: "no",
            item: { id: regId, tipo: "grupo", x: regX, y: regY, w: regW, h: regH, dados: { titulo: `Fluxo de ${nomeAgente}`, cor: "lilas" }, rev },
        },
        {
            op: "upsert",
            tipo: "no",
            item: {
                id: idForma,
                tipo: "forma",
                x,
                y,
                w: FORMA_W,
                h: FORMA_H,
                pai: regId,
                dados: { forma, texto, cor: cor ?? corPadraoForma(forma) },
                rev,
            },
        },
    ];
    return { ops };
}
/** Liga duas formas do fluxo; erro cita a chave inexistente (CA-11c). */
export function opsFlowLink(snap, agenteId, a, b, rotulo, rev = 0) {
    const idA = `flow:${agenteId}:${a}`;
    const idB = `flow:${agenteId}:${b}`;
    if (!snap.nos.some((n) => n.id === idA))
        return { erro: `forma "${a}" não existe no fluxo` };
    if (!snap.nos.some((n) => n.id === idB))
        return { erro: `forma "${b}" não existe no fluxo` };
    const id = `${idA}->${idB}`;
    const item = rotulo !== undefined ? { id, de: idA, para: idB, rotulo, rev } : { id, de: idA, para: idB, rev };
    return { ops: [{ op: "upsert", tipo: "aresta", item }] };
}
// ---------------------------------------------------------------------------
// Cards do agente (arquivo + nota)
// ---------------------------------------------------------------------------
const CARD_W = 300;
const CARD_GAP = 24;
const CARD_H_ARQUIVO = 100;
const CARD_H_NOTA = 120;
const ehCardDoAgente = (id, agenteId) => id.startsWith(`arq-ag:${agenteId}:`) || id.startsWith(`nota-ag:${agenteId}:`);
/** Proximo y empilhado abaixo dos cards ja existentes do agente. */
function proximoY(snap, agenteId, agNo) {
    const cards = snap.nos.filter((n) => ehCardDoAgente(n.id, agenteId));
    if (cards.length === 0)
        return agNo.y;
    return cards.reduce((m, n) => (n.y + n.h > m ? n.y + n.h : m), agNo.y) + CARD_GAP;
}
/** Card de arquivo `arq-ag:<agenteId>:<caminho>`, a direita do agente e empilhado, ligado a ele (CA-13b). */
export function opsFile(snap, agNo, caminho, status, rev = 0) {
    const agenteId = String(agNo.dados.agenteId);
    const id = `arq-ag:${agenteId}:${caminho}`;
    const existente = snap.nos.find((n) => n.id === id);
    const x = existente ? existente.x : agNo.x + agNo.w + 40;
    const y = existente ? existente.y : proximoY(snap, agenteId, agNo);
    const no = { id, tipo: "arquivo", x, y, w: CARD_W, h: CARD_H_ARQUIVO, dados: { agenteId, caminho, status }, rev };
    const aresta = { id: `${agNo.id}->${id}`, de: agNo.id, para: id, rev };
    return [
        { op: "upsert", tipo: "no", item: no },
        { op: "upsert", tipo: "aresta", item: aresta },
    ];
}
/** Nota `nota-ag:<agenteId>:<slug>` (upsert pelo titulo), empilhada abaixo dos outros cards do agente (CA-13d). */
export function opsNote(snap, agNo, titulo, corpo, rev = 0) {
    const agenteId = String(agNo.dados.agenteId);
    const id = `nota-ag:${agenteId}:${slugNome(titulo)}`;
    const existente = snap.nos.find((n) => n.id === id);
    const x = existente ? existente.x : agNo.x + agNo.w + 40;
    const y = existente ? existente.y : proximoY(snap, agenteId, agNo);
    const no = { id, tipo: "nota", x, y, w: CARD_W, h: CARD_H_NOTA, dados: { titulo, corpo, cor: "amarelo" }, rev };
    const aresta = { id: `${agNo.id}->${id}`, de: agNo.id, para: id, rev };
    return [
        { op: "upsert", tipo: "no", item: no },
        { op: "upsert", tipo: "aresta", item: aresta },
    ];
}
// ---------------------------------------------------------------------------
// Caminhos
// ---------------------------------------------------------------------------
/** Normaliza um caminho relativo para '/'; devolve null se absoluto, vazio ou com '..' (traversal). */
export function validarCaminho(_cwd, rel) {
    if (typeof rel !== "string" || rel.length === 0)
        return null;
    if (/^[a-zA-Z]:/.test(rel))
        return null;
    if (rel.startsWith("/") || rel.startsWith("\\"))
        return null;
    const limpo = posix.normalize(rel.replace(/\\/g, "/"));
    if (limpo === "" || limpo === "." || limpo === ".." || limpo.startsWith("../"))
        return null;
    if (posix.isAbsolute(limpo))
        return null;
    return limpo;
}
