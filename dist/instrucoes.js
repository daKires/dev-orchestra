// G3: caixa de instrucoes e pausa por slice, em arquivos no RUNS_DIR (mesmo padrao do <runId>.cancel).
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
export function arquivoInstrucao(dir, id) { return path.join(dir, id + ".instrucao.jsonl"); }
export function arquivoPausa(dir, id) { return path.join(dir, id + ".pausa"); }
export function gravarInstrucao(dir, id, slice, texto) {
    appendFileSync(arquivoInstrucao(dir, id), JSON.stringify({ slice, texto, ts: Date.now() }) + "\n");
}
export function tomarInstrucoes(dir, id, slice) {
    const arq = arquivoInstrucao(dir, id);
    if (!existsSync(arq))
        return [];
    const linhas = readFileSync(arq, "utf8").split("\n").filter((l) => l.trim() !== "");
    const minhas = [];
    const outras = [];
    for (const linha of linhas) {
        let obj;
        try {
            obj = JSON.parse(linha);
        }
        catch {
            continue;
        } // linha corrompida: descarta
        if (obj && obj.slice === slice)
            minhas.push(obj.texto);
        else
            outras.push(linha);
    }
    if (outras.length === 0)
        rmSync(arq, { force: true }); // nada sobrou: apaga o arquivo
    else
        writeFileSync(arq, outras.join("\n") + "\n");
    return minhas;
}
export function pausarSlice(dir, id, slice) {
    writeFileSync(arquivoPausa(dir, id), String(slice));
}
export function retomarSlice(dir, id, slice, texto) {
    const arq = arquivoPausa(dir, id);
    if (existsSync(arq))
        rmSync(arq, { force: true });
    if (texto?.trim())
        gravarInstrucao(dir, id, slice, texto);
}
export function pausada(dir, id, slice) {
    const arq = arquivoPausa(dir, id);
    if (!existsSync(arq))
        return false;
    return Number(readFileSync(arq, "utf8")) === slice;
}
export function validarAcaoSlice(evs, slice, cancelado) {
    if (!evs)
        return { status: 404, erro: "run desconhecida" };
    if (cancelado || evs.some((e) => e.t === "painel"))
        return { status: 409, erro: "a run já terminou" };
    const total = evs.find((e) => e.t === "run")?.total;
    if (slice < 1 || slice > total) {
        return { status: 409, erro: `slice S${slice} não está rodando (reparo do gate ou inexistente)` };
    }
    // Ultimo evento de slice com esse idx define o status atual (default: fila).
    let status = "fila";
    for (const e of evs)
        if (e.t === "slice" && e.idx === slice)
            status = e.status;
    if (status !== "rodando")
        return { status: 409, erro: `slice S${slice} não está rodando (${status})` };
    return null;
}
export function validarTexto(texto, obrigatorio) {
    if (texto === undefined || texto === null)
        return obrigatorio ? "instrução vazia" : null;
    if (typeof texto !== "string")
        return "instrução inválida";
    if (texto.trim() === "")
        return obrigatorio ? "instrução vazia" : null;
    if (texto.length > 4000)
        return "instrução acima de 4000 caracteres";
    return null;
}
export async function esperarRetomada(o) {
    const agora = o.agora ?? Date.now;
    const dormir = o.dormir ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const inicio = agora();
    while (o.pausada()) {
        if (o.signal?.aborted)
            throw new Error("cancelado");
        if (agora() - inicio >= o.tetoMs)
            return "teto";
        await dormir(1000);
        if (o.signal?.aborted)
            throw new Error("cancelado"); // checa de novo apos dormir
    }
    return "retomada";
}
export function estaPausada(evs) {
    let estado;
    for (const e of evs)
        if (e.t === "pausa")
            estado = e.estado;
    return estado === "pausada";
}
