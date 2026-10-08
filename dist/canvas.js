// Modelo puro do canvas (S1): tipos do grafo e operacoes deterministicas.
// Roda direto com `node --experimental-strip-types`, por isso: apenas `import type` para
// tipos, importando somente de `node:` (node:crypto, node:path), sem enum/namespace.
import { createHash } from "node:crypto";
import { posix } from "node:path";
/** Lista canonica de tipos de no', usado tambem na validacao. */
export const TIPOS_NO = [
    "nota",
    "imagem",
    "forma",
    "grupo",
    "texto",
    "agente",
    "worker",
    "run",
    "arquivo",
    "explorador",
    "navegador",
];
// Validacao de operacoes
const ehString = (v) => typeof v === "string";
const ehNumero = (v) => typeof v === "number" && Number.isFinite(v);
const ehId = (v) => ehString(v) && v.length > 0;
const ehTipoNo = (v) => typeof v === "string" && TIPOS_NO.includes(v);
function ehNo(v) {
    if (!v || typeof v !== "object")
        return false;
    const n = v;
    return (ehId(n.id) &&
        ehTipoNo(n.tipo) &&
        ehNumero(n.x) &&
        ehNumero(n.y) &&
        ehNumero(n.w) &&
        ehNumero(n.h) &&
        ehNumero(n.rev) &&
        !!n.dados &&
        typeof n.dados === "object" &&
        (n.pai === undefined || ehString(n.pai)));
}
function ehAresta(v) {
    if (!v || typeof v !== "object")
        return false;
    const a = v;
    return (ehId(a.id) &&
        ehId(a.de) &&
        ehId(a.para) &&
        ehNumero(a.rev) &&
        (a.rotulo === undefined || ehString(a.rotulo)));
}
function ehRemocao(v) {
    if (!v || typeof v !== "object")
        return false;
    const r = v;
    return ehId(r.id) && ehNumero(r.rev);
}
/** Um item invalido invalida o lote inteiro. */
export function validarOps(x) {
    if (!Array.isArray(x))
        return null;
    for (const bruto of x) {
        if (!bruto || typeof bruto !== "object")
            return null;
        const op = bruto;
        if (op.op === "upsert") {
            if (op.tipo === "no") {
                if (!ehNo(op.item))
                    return null;
            }
            else if (op.tipo === "aresta") {
                if (!ehAresta(op.item))
                    return null;
            }
            else {
                return null;
            }
        }
        else if (op.op === "remove") {
            if (op.tipo !== "no" && op.tipo !== "aresta")
                return null;
            if (!ehRemocao(op.item))
                return null;
        }
        else {
            return null;
        }
    }
    return x;
}
// Aplicacao de operacoes
/**
 * Devolve um NOVO snapshot (nunca muta o original). Regra de conflito: a ultima
 * escrita vence por item — aplica quando o item nao existe ou `rev >= rev` atual.
 * Remover um no' tambem remove as arestas ligadas a ele e solta os filhos (pai).
 */
export function aplicarOps(s, ops) {
    const nos = new Map(s.nos.map((n) => [n.id, n]));
    const arestas = new Map(s.arestas.map((a) => [a.id, a]));
    for (const op of ops) {
        if (op.op === "upsert" && op.tipo === "no") {
            const atual = nos.get(op.item.id);
            if (!atual || op.item.rev >= atual.rev)
                nos.set(op.item.id, op.item);
        }
        else if (op.op === "upsert" && op.tipo === "aresta") {
            const atual = arestas.get(op.item.id);
            if (!atual || op.item.rev >= atual.rev)
                arestas.set(op.item.id, op.item);
        }
        else if (op.op === "remove" && op.tipo === "no") {
            const atual = nos.get(op.item.id);
            if (atual && op.item.rev >= atual.rev) {
                nos.delete(op.item.id);
                for (const [id, a] of arestas) {
                    if (a.de === op.item.id || a.para === op.item.id)
                        arestas.delete(id);
                }
                for (const [id, n] of nos) {
                    if (n.pai === op.item.id)
                        nos.set(id, { ...n, pai: undefined });
                }
            }
        }
        else if (op.op === "remove" && op.tipo === "aresta") {
            const atual = arestas.get(op.item.id);
            if (atual && op.item.rev >= atual.rev)
                arestas.delete(op.item.id);
        }
    }
    return { nos: [...nos.values()], arestas: [...arestas.values()] };
}
// Assets (imagens anexadas a nos)
export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
const EXT_IMAGEM = [
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
function decodificarBase64(s) {
    if (typeof s !== "string" || s.length === 0)
        return null;
    if (s.length % 4 !== 0)
        return null;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s))
        return null;
    const bytes = Buffer.from(s, "base64");
    return bytes.length > 0 ? bytes : null;
}
/**
 * Sana o nome (basename win e posix), aceita so extensoes de imagem e base64
 * valido/nao vazio dentro do limite de {@link MAX_ASSET_BYTES}.
 */
export function validarAsset(nome, dadosB64) {
    if (typeof nome !== "string" || nome.length === 0)
        return null;
    const base = posix.basename(nome.replace(/\\/g, "/"));
    if (base.length === 0)
        return null;
    const ext = posix.extname(base).slice(1).toLowerCase();
    if (ext.length === 0 || !EXT_IMAGEM.includes(ext))
        return null;
    const bytes = decodificarBase64(dadosB64);
    if (!bytes || bytes.length > MAX_ASSET_BYTES)
        return null;
    return { nome: base, ext, bytes };
}
// Projetos
const normalizarRaiz = (raiz) => raiz.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
/** sha1 hex da raiz normalizada: grafias diferentes da mesma pasta => mesmo id. */
export function idProjeto(raiz) {
    return createHash("sha1").update(normalizarRaiz(raiz), "utf8").digest("hex");
}
function nomeDaPasta(raiz) {
    const base = posix.basename(raiz.replace(/\\/g, "/").replace(/\/+$/, ""));
    return base.length > 0 ? base : raiz;
}
/**
 * Deduplica por {@link idProjeto}. O projeto salvo vence nome/cor; o descoberto
 * sem salvo usa o basename da pasta como nome; projetos so salvos tambem entram.
 */
export function mesclarProjetos(raizesDescobertas, salvos) {
    const porId = new Map();
    for (const raiz of raizesDescobertas) {
        const id = idProjeto(raiz);
        if (porId.has(id))
            continue;
        porId.set(id, { raiz, nome: nomeDaPasta(raiz) });
    }
    for (const p of salvos) {
        const id = idProjeto(p.raiz);
        const atual = porId.get(id);
        if (atual) {
            porId.set(id, { ...atual, nome: p.nome, cor: p.cor });
        }
        else {
            porId.set(id, p.cor !== undefined ? { raiz: p.raiz, nome: p.nome, cor: p.cor } : { raiz: p.raiz, nome: p.nome });
        }
    }
    return [...porId.values()];
}
