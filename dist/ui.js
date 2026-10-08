// Dashboard web local multi-sessao (http+SSE nativos; o app React/shadcn e' compilado em dist/web e
// servido estatico). Cada RUN (uma chamada de executar_orchestra) escreve seus eventos num JSONL
// proprio numa pasta compartilhada; QUEM pega a porta vira o "hub", le TODOS os arquivos e empurra
// pro browser. Varias sessoes do Claude aparecem juntas. Unica acao pela UI: cancelar uma run.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execSync, spawn } from "node:child_process";
import { aplicarOps, idProjeto, mesclarProjetos, validarAsset, validarOps } from "./canvas.js";
const PORT = Number(process.env.HERMES_UI_PORT || "4123");
export const RUNS_DIR = path.join(os.tmpdir(), "hermes", "runs"); // barramento em disco, compartilhado entre processos
// Registros dos planejadores: orchestra-go.ps1 grava um JSON por worktree com o chat do planejador.
export const PLANEJADORES_DIR = process.env.HERMES_PLANEJADORES_DIR || path.join(os.tmpdir(), "hermes", "planejadores");
// Canvas (S2): um subdiretorio por projeto (idProjeto) com canvas.json + assets/. Injetavel por env.
export const CANVAS_DIR = process.env.HERMES_CANVAS_DIR || path.join(os.tmpdir(), "hermes", "canvas");
// Pasta onde os anexos de POST /nova-feature sao gravados (uma subpasta por pedido). Injetavel por env.
export const ANEXOS_DIR = process.env.HERMES_ANEXOS_DIR || path.join(os.tmpdir(), "hermes", "anexos");
// POST /nova-feature carrega anexos em base64 (inflam ~33%): teto proprio bem maior que o padrao de 64KB.
// Injetavel em iniciarUI (opcao limiteBodyNovaFeature) pra testar sem trafegar centenas de MB.
export const LIMITE_BODY_NOVA_FEATURE = 350 * 1024 * 1024; // 350MB
const SWARM_ID = randomUUID().slice(0, 8); // um id por processo/sessao
const PODA_MS = 7 * 24 * 3600 * 1000; // historico de 7 dias
const WEB_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "web");
try {
    fs.mkdirSync(RUNS_DIR, { recursive: true });
}
catch { }
// Run corrente deste processo: cada evento "run" abre um arquivo NOVO (nunca trunca o anterior).
// O sufixo sequencial garante ids distintos mesmo se duas runs abrirem no MESMO milissegundo.
let runId = "";
let runFile = "";
let seq = 0;
export function runAtual() { return runId; }
export function arquivoCancel(id) { return path.join(RUNS_DIR, id + ".cancel"); }
// Unica porta de saida deste processo: grava o evento no JSONL da run corrente. Best-effort.
export function emitir(ev) {
    try {
        if (ev.ts == null)
            ev.ts = Date.now();
        if (ev.t === "run" || !runFile) {
            runId = SWARM_ID + "-" + Date.now().toString(36) + "-" + (seq++).toString(36);
            runFile = path.join(RUNS_DIR, runId + ".jsonl");
        }
        fs.appendFileSync(runFile, JSON.stringify(ev) + "\n");
    }
    catch { }
}
// Parse de um JSONL de run; linha corrompida e' ignorada. Pura (dado o texto).
function parse(txt) {
    const evs = [];
    for (const l of txt.split("\n"))
        if (l) {
            try {
                evs.push(JSON.parse(l));
            }
            catch { }
        }
    return evs;
}
// Le a pasta de runs e devolve os eventos agrupados por run (basename do arquivo). Testavel.
export function lerRuns(dir) {
    const m = new Map();
    let files = [];
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
    }
    catch {
        return m;
    }
    for (const f of files) {
        try {
            m.set(f.slice(0, -6), parse(fs.readFileSync(path.join(dir, f), "utf8")));
        }
        catch { }
    }
    return m;
}
// ---- registros de planejadores (orchestra-go.ps1) ----
// Valida/estrutura um registro cru; null se faltar campo obrigatorio (JSON incompleto e' descartado).
function planejadorDe(j) {
    if (!j || typeof j !== "object")
        return null;
    for (const k of ["slug", "projeto", "raiz", "cwd", "feature", "url", "base"])
        if (typeof j[k] !== "string" || !j[k])
            return null;
    if (typeof j.pid !== "number" || !j.pid)
        return null;
    if (typeof j.ts !== "number")
        return null;
    return {
        slug: j.slug, projeto: j.projeto, raiz: j.raiz, cwd: j.cwd,
        feature: j.feature, url: j.url, base: j.base, pid: j.pid, ts: j.ts,
    };
}
// Le a pasta de registros. Tolerante: JSON corrompido/sem campos obrigatorios e' ignorado; pasta
// inexistente vira []. Sincrona (usada no replay do SSE e no rescan do intervalo).
export function lerPlanejadores(dir) {
    const out = [];
    let files = [];
    try {
        files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    }
    catch {
        return out;
    }
    for (const f of files) {
        try {
            const p = planejadorDe(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));
            if (p)
                out.push(p);
        }
        catch { }
    }
    return out;
}
// Worktree que o registro descreve (mesma regra do orchestra-go.ps1: <raiz>/.claude/worktrees/<slug>).
function worktreeDe(p) {
    return path.join(p.raiz, ".claude", "worktrees", p.slug);
}
// process.kill(pid, 0): sem erro = vivo; EPERM (processo de outro usuario) tambem conta como vivo.
function vivoReal(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch (e) {
        return e?.code === "EPERM";
    }
}
// tasklist com filtro de PID: imagem do processo contem 'opencode'? Falha do tasklist -> false (conservador).
function ehOpencodeReal(pid) {
    return new Promise((ok) => {
        try {
            const saida = execSync(`tasklist /FI "PID eq ${pid}" /FO CSV /NH`, { encoding: "utf8", timeout: 4000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
            ok(/opencode/i.test(saida));
        }
        catch {
            ok(false);
        }
    });
}
const depsReais = {
    existeCwd: (cwd) => { try {
        return fs.existsSync(cwd);
    }
    catch {
        return true;
    } },
    vivo: vivoReal,
    ehOpencode: ehOpencodeReal,
    matar: (pid) => { try {
        process.kill(pid);
    }
    catch { } },
    remover: (arq) => { try {
        fs.unlinkSync(arq);
    }
    catch { } },
};
// Limpa registros de planejadores que nao servem mais:
//   pid morto -> so' remove o JSON (nao ha o que matar);
//   worktree sumiu + pid vivo + opencode -> mata o orfao e remove;
//   worktree sumiu + pid vivo + NAO opencode -> pid reutilizado: so' remove (nunca mata alheio);
//   worktree existe + pid vivo -> mantem.
export async function limparPlanejadores(dir, deps = depsReais) {
    let arquivos = [];
    try {
        arquivos = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
    }
    catch {
        return;
    }
    for (const f of arquivos) {
        const arq = path.join(dir, f);
        let p = null;
        try {
            p = planejadorDe(JSON.parse(fs.readFileSync(arq, "utf8")));
        }
        catch { }
        if (!p)
            continue;
        if (!deps.vivo(p.pid)) {
            deps.remover(arq);
            continue;
        }
        if (deps.existeCwd(worktreeDe(p)))
            continue;
        if (await deps.ehOpencode(p.pid))
            deps.matar(p.pid);
        deps.remover(arq);
    }
}
// Deriva a linha de texto crua (stderr + HERMES_LOG) de um evento, preservando o log ao vivo de sempre.
export function linhaDe(ev) {
    switch (ev.t) {
        case "run": return `PLANO recebido: ${ev.total} slice(s)`;
        case "fase": return ev.nome.toUpperCase() + (ev.info ? " " + ev.info : "");
        case "slice":
            if (ev.status === "fila")
                return "";
            if (ev.status === "rodando")
                return `Tarefa ${ev.idx}/${ev.total}: ${ev.tarefa}`;
            if (ev.status === "ok")
                return `[T${ev.idx}] concluida: ${(ev.escritos ?? []).length} arq${ev.semMudancas ? " (sem mudancas)" : ""}${ev.comandos?.length ? ", " + ev.comandos.length + " cmd" : ""}`;
            if (ev.status === "pulada")
                return `[T${ev.idx}] PULADA: ${ev.motivo ?? ""}`;
            return `[T${ev.idx}] INCOMPLETA: ${ev.motivo ?? ""}`;
        case "tool": {
            const alvoTxt = ev.alvo ? " " + ev.alvo : "";
            return ev.ok ? `[T${ev.slice}] ${ev.nome}${alvoTxt} ok` : `[T${ev.slice}] REJEITADO ${ev.nome}${alvoTxt}: ${ev.resumo ?? ""}`;
        }
        case "gerando": return "";
        case "comando": return "";
        case "gate": {
            const marca = ev.status === "ok" ? "OK" : ev.status === "falha" ? "FALHA" : "rodando";
            return `GATE ${marca}: ${ev.cmd}${ev.tentativa ? " (reparo " + ev.tentativa + ")" : ""}`;
        }
        case "diff": return "";
        case "painel": return "";
        case "metrica": return `[T${ev.slice}] metrica: ${ev.iteracoes} iter, ${ev.passouDePrimeira ? "1a" : "reparo"}, teste:${ev.tocouNoTeste}, amb:${ev.falhasAmbiente ?? 0}, ${ev.tokensIn}+${ev.tokensOut} tok, $ ${ev.custoUSD.toFixed(4)}`;
        case "log": return ev.texto;
    }
}
const clientes = new Set();
const estado = new Map();
const vistos = new Map(); // arquivo -> "size:mtime" (so rele o que mudou)
let servidor = null;
let intervalo = null;
let watcher = null;
let limpeza = null; // poda os registros de planejadores orfaos
let reassumir = null; // quem ficou sem porta tenta de novo
let planejadores = []; // ultima lista empurrada via SSE
let planejadoresAssinatura = ""; // muda -> avisa os clientes
let onCeder = null; // chamado no fim do ceder() (modo --ui encerra o processo)
let sempreAssumir = false; // modo --ui: assume a porta de QUALQUER hub Hermes (sem comparar versao)
let executarNovaFeature = executarNovaFeatureReal;
let novaFeatureEmAndamento = false; // 409 em concorrencia: uma criacao de cada vez
let limiteBodyNovaFeature = LIMITE_BODY_NOVA_FEATURE; // teto proprio da rota (injetavel em iniciarUI)
function sse(c, dado) {
    try {
        c.res.write(`data: ${JSON.stringify(dado)}\n\n`);
    }
    catch { }
}
// Envia pro cliente so os eventos ainda nao enviados (deltas), por run.
function enviar(c) {
    for (const [run, evs] of estado) {
        const sent = c.offsets.get(run) || 0;
        for (let i = sent; i < evs.length; i++)
            sse(c, { swarm: run, ev: evs[i] });
        c.offsets.set(run, evs.length);
    }
}
// Rele os registros de planejadores; se a lista mudou, empurra pra quem esta conectado. Chamada no
// rescan (intervalo + fs.watch); o replay do novo cliente usa `planejadores` direto.
function atualizarPlanejadores() {
    const lista = lerPlanejadores(PLANEJADORES_DIR);
    const assinatura = JSON.stringify(lista);
    if (assinatura === planejadoresAssinatura)
        return;
    planejadoresAssinatura = assinatura;
    planejadores = lista;
    for (const c of clientes)
        sse(c, { planejadores: lista });
}
// Rele so os arquivos que mudaram e empurra novidades/drops. Chamada por fs.watch e por um intervalo
// (o fs.watch no Windows coalesce/perde eventos — o intervalo e' a rede de seguranca).
function rescan() {
    atualizarPlanejadores();
    let files = [];
    try {
        files = fs.readdirSync(RUNS_DIR).filter((f) => f.endsWith(".jsonl"));
    }
    catch {
        return;
    }
    const drops = [];
    const presentes = new Set(files.map((f) => f.slice(0, -6)));
    for (const run of estado.keys())
        if (!presentes.has(run))
            drops.push(run);
    for (const f of files) {
        const run = f.slice(0, -6);
        try {
            const st = fs.statSync(path.join(RUNS_DIR, f));
            const marca = st.size + ":" + st.mtimeMs;
            if (vistos.get(f) === marca)
                continue;
            vistos.set(f, marca);
            const evs = parse(fs.readFileSync(path.join(RUNS_DIR, f), "utf8"));
            if (evs.length < (estado.get(run)?.length ?? 0))
                drops.push(run); // arquivo reescrito: reenvia do zero
            estado.set(run, evs);
        }
        catch { }
    }
    for (const run of drops)
        if (!presentes.has(run)) {
            estado.delete(run);
            vistos.delete(run + ".jsonl");
        }
    for (const c of clientes) {
        for (const run of drops) {
            sse(c, { swarm: run, drop: true });
            c.offsets.delete(run);
        }
        enviar(c);
    }
}
// Remove logs (e pedidos de cancelamento) mais velhos que PODA_MS.
function podar() {
    const limite = Date.now() - PODA_MS;
    try {
        for (const f of fs.readdirSync(RUNS_DIR)) {
            if (!f.endsWith(".jsonl") && !f.endsWith(".cancel"))
                continue;
            const p = path.join(RUNS_DIR, f);
            try {
                if (fs.statSync(p).mtimeMs < limite)
                    fs.unlinkSync(p);
            }
            catch { }
        }
    }
    catch { }
}
// Versao da UI = mtime do index.html compilado: build mais novo vence no handoff da porta.
export function versaoUI() {
    try {
        return fs.statSync(path.join(WEB_DIR, "index.html")).mtimeMs;
    }
    catch {
        return 0;
    }
}
const TIPOS = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon", ".json": "application/json",
    ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".map": "application/json",
};
function servirEstatico(url, res) {
    let rel = "index.html";
    try {
        rel = decodeURIComponent(url.split("?")[0]).replace(/^\/+/, "") || "index.html";
    }
    catch { }
    let alvo = path.resolve(WEB_DIR, rel);
    if (alvo !== WEB_DIR && !alvo.startsWith(WEB_DIR + path.sep)) {
        res.writeHead(403);
        res.end();
        return;
    }
    if (!fs.existsSync(alvo) || fs.statSync(alvo).isDirectory())
        alvo = path.join(WEB_DIR, "index.html"); // SPA
    fs.readFile(alvo, (err, buf) => {
        if (err) {
            res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
            res.end("UI nao compilada: rode npm run build no hermes-bridge");
            return;
        }
        res.writeHead(200, { "Content-Type": TIPOS[path.extname(alvo)] || "application/octet-stream" });
        res.end(buf);
    });
}
// Acoes so via POST com header X-Hermes: header custom forca preflight CORS, que este servidor nao
// responde -> site externo aberto no browser nao consegue cancelar run nem derrubar o hub.
function acaoValida(req) {
    return req.method === "POST" && req.headers["x-hermes"] === "1";
}
// Extensoes aceitas em anexos: apenas IMAGEM e DOCUMENTO (video/audio/executavel ficam de fora).
const EXTENSOES_PERMITIDAS = new Set([
    // imagens
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "ico", "tif", "tiff", "avif", "heic", "heif",
    // documentos
    "pdf", "txt", "md", "markdown", "csv", "tsv", "json", "xml", "yaml", "yml", "log",
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "rtf", "epub",
]);
export const MAX_ANEXOS = 10;
export const MAX_ANEXO_BYTES = 25 * 1024 * 1024; // 25MB DECODIFICADOS por anexo
// Sanitiza o nome do anexo pelo basename (Windows e POSIX): traversal "..\\..\\x.png" vira "x.png".
// Nome que some na sanacao (vazio, "." ou "..") -> null (pedido inteiro rejeitado).
function sanearNomeAnexo(nome) {
    const base = nome.replace(/\\/g, "/").split("/").pop() ?? "";
    const limpo = base.trim();
    if (!limpo || limpo === "." || limpo === "..")
        return null;
    return limpo;
}
// Base64 estrito: alfabeto valido, comprimento multiplo de 4 e padding correto (Buffer.from e' permissivo).
function b64Valido(s) {
    if (!s || s.length % 4 !== 0)
        return false;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s))
        return false;
    return true;
}
// Valida um anexo cru -> { nome saneado, tipo, dadosB64 } ou null (extensao proibida/ b64 ruim / grande / tipo errado).
function validarAnexo(a) {
    if (!a || typeof a !== "object")
        return null;
    const o = a;
    if (typeof o.nome !== "string" || typeof o.dadosB64 !== "string")
        return null;
    const nome = sanearNomeAnexo(o.nome);
    if (!nome)
        return null;
    const ext = path.extname(nome).slice(1).toLowerCase();
    if (!ext || !EXTENSOES_PERMITIDAS.has(ext))
        return null;
    if (!b64Valido(o.dadosB64))
        return null;
    if (Buffer.byteLength(o.dadosB64, "base64") > MAX_ANEXO_BYTES)
        return null;
    return { nome, tipo: typeof o.tipo === "string" ? o.tipo : "", dadosB64: o.dadosB64 };
}
// Valida o corpo de um pedido de criacao de feature. COMPAT EXATA: sem os campos novos devolve
// EXATAMENTE { projeto, feature } (deepEqual estrito). descricao opcional (nao-string -> null; em
// branco some); anexos opcional (ate 10, cada um <=25MB decodificado, b64 valido, imagem/documento).
export function validarNovaFeature(body) {
    if (!body || typeof body !== "object")
        return null;
    const j = body;
    const projeto = typeof j.projeto === "string" ? j.projeto.trim() : "";
    const feature = typeof j.feature === "string" ? j.feature.trim() : "";
    if (!projeto || !feature)
        return null;
    const out = { projeto, feature };
    if (j.descricao !== undefined) {
        if (typeof j.descricao !== "string")
            return null; // tipo errado -> null
        const d = j.descricao.trim();
        if (d)
            out.descricao = d; // em branco some do resultado
    }
    if (j.anexos !== undefined) {
        if (!Array.isArray(j.anexos))
            return null; // nao-array -> null
        if (j.anexos.length > MAX_ANEXOS)
            return null;
        const anexos = [];
        for (const a of j.anexos) {
            const v = validarAnexo(a);
            if (!v)
                return null; // qualquer anexo invalido derruba o pedido
            anexos.push(v);
        }
        if (anexos.length)
            out.anexos = anexos; // lista vazia some
    }
    return out;
}
function broadcast(dado) { for (const c of clientes)
    sse(c, dado); }
// ---- canvas (S2): grafo por projeto, persistido em <CANVAS_DIR>/<idProjeto>/canvas.json ----
const LIMITE_BODY_CANVAS = 2 * 1024 * 1024; // 2MB: lotes de ops
const LIMITE_BODY_CANVAS_ASSET = 40 * 1024 * 1024; // 40MB: imagem em base64 (infla ~33%)
const CANVAS_DEBOUNCE_MS = 300; // gravacao em disco com debounce
const canvasCache = new Map(); // idProjeto -> snapshot em memoria
const canvasTimers = new Map(); // idProjeto -> gravacao pendente
// Content-type das imagens servidas em GET /canvas/asset (so' imagem entra no canvas).
const TIPOS_IMG = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon",
};
function arquivoCanvas(id) { return path.join(CANVAS_DIR, id, "canvas.json"); }
// Cache por projeto: no primeiro acesso (ou apos restart) le do disco; projeto novo = vazio.
function lerCanvas(id) {
    const emCache = canvasCache.get(id);
    if (emCache)
        return emCache;
    let s = { nos: [], arestas: [] };
    try {
        const j = JSON.parse(fs.readFileSync(arquivoCanvas(id), "utf8"));
        if (j && Array.isArray(j.nos) && Array.isArray(j.arestas))
            s = { nos: j.nos, arestas: j.arestas };
    }
    catch { }
    canvasCache.set(id, s);
    return s;
}
function gravarCanvasAgora(id) {
    const s = canvasCache.get(id);
    if (!s)
        return;
    try {
        fs.mkdirSync(path.join(CANVAS_DIR, id), { recursive: true });
        fs.writeFileSync(arquivoCanvas(id), JSON.stringify(s));
    }
    catch { }
}
// Debounce ~300ms: rajadas de ops (arrastar varios nos) viram UMA gravacao.
function gravarCanvasDebounced(id) {
    const t = canvasTimers.get(id);
    if (t)
        clearTimeout(t);
    const timer = setTimeout(() => { canvasTimers.delete(id); gravarCanvasAgora(id); }, CANVAS_DEBOUNCE_MS);
    timer.unref?.();
    canvasTimers.set(id, timer);
}
// Grava o que estiver pendente (chamado no pararUI pra nao perder ops na janela do debounce).
function descarregarCanvas() {
    for (const [id, t] of canvasTimers) {
        clearTimeout(t);
        gravarCanvasAgora(id);
    }
    canvasTimers.clear();
}
// Raizes descobertas: cwd das runs EM MEMORIA + raiz dos planejadores.
function raizesDescobertas() {
    const out = [];
    for (const evs of estado.values())
        for (const ev of evs)
            if (ev.t === "run" && ev.cwd)
                out.push(ev.cwd);
    for (const p of planejadores)
        out.push(p.raiz);
    return out;
}
function lerProjetosSalvos() {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(CANVAS_DIR, "projetos.json"), "utf8"));
        if (!Array.isArray(j))
            return [];
        return j
            .filter((p) => p && typeof p.raiz === "string" && typeof p.nome === "string")
            .map((p) => (typeof p.cor === "string" ? { raiz: p.raiz, nome: p.nome, cor: p.cor } : { raiz: p.raiz, nome: p.nome }));
    }
    catch {
        return [];
    }
}
function gravarProjetosSalvos(salvos) {
    try {
        fs.mkdirSync(CANVAS_DIR, { recursive: true });
        fs.writeFileSync(path.join(CANVAS_DIR, "projetos.json"), JSON.stringify(salvos));
    }
    catch { }
}
function nomeBase(raiz) {
    const base = raiz.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
    return base || raiz;
}
// Upsert por idProjeto: mesma raiz (grafias diferentes) nao duplica; campo ausente preserva o salvo.
function salvarProjeto(raiz, nome, cor) {
    const id = idProjeto(raiz);
    const salvos = lerProjetosSalvos();
    const i = salvos.findIndex((p) => idProjeto(p.raiz) === id);
    const atual = i >= 0 ? salvos[i] : undefined;
    const nomeLimpo = typeof nome === "string" ? nome.trim() : "";
    const novo = { raiz: atual?.raiz ?? raiz, nome: nomeLimpo || atual?.nome || nomeBase(raiz) };
    const corLimpa = typeof cor === "string" ? cor.trim() : "";
    if (corLimpa)
        novo.cor = corLimpa;
    else if (atual?.cor !== undefined)
        novo.cor = atual.cor;
    if (i >= 0)
        salvos[i] = novo;
    else
        salvos.push(novo);
    gravarProjetosSalvos(salvos);
}
// Le o corpo de um POST com teto de bytes; null = estourou o limite (o chamador responde 400).
function lerCorpo(req, limite) {
    return new Promise((ok) => {
        let corpo = "";
        let cortou = false;
        req.on("data", (d) => {
            if (cortou)
                return;
            corpo += d.toString();
            if (Buffer.byteLength(corpo) > limite) {
                cortou = true;
                ok(null);
            }
        });
        req.on("end", () => { if (!cortou)
            ok(corpo); });
        req.on("error", () => { if (!cortou) {
            cortou = true;
            ok(null);
        } });
    });
}
// GET /canvas/asset/<idProjeto>/<arquivo>: so' imagem, id hex, recusa traversal e inexistente -> 404.
function servirCanvasAsset(caminho, res) {
    const resto = caminho.slice("/canvas/asset/".length);
    const barra = resto.indexOf("/");
    if (barra < 0) {
        res.writeHead(404);
        res.end();
        return;
    }
    let id = resto.slice(0, barra);
    let arquivo = resto.slice(barra + 1);
    try {
        id = decodeURIComponent(id);
        arquivo = decodeURIComponent(arquivo);
    }
    catch {
        res.writeHead(400);
        res.end();
        return;
    }
    if (!/^[0-9a-f]+$/i.test(id)) {
        res.writeHead(400);
        res.end();
        return;
    }
    if (!arquivo || /[\\/]/.test(arquivo) || arquivo.includes("..")) {
        res.writeHead(400);
        res.end();
        return;
    }
    const alvo = path.join(CANVAS_DIR, id, "assets", arquivo);
    fs.readFile(alvo, (err, buf) => {
        if (err) {
            res.writeHead(404);
            res.end();
            return;
        }
        res.writeHead(200, { "Content-Type": TIPOS_IMG[path.extname(arquivo).toLowerCase()] || "application/octet-stream" });
        res.end(buf);
    });
}
// Raiz do hermes-bridge (um nivel acima de dist/web ou de web no dev): onde vive orchestra-go.ps1.
const RAIZ_BRIDGE = path.resolve(WEB_DIR, "..", "..");
const LIMITE_BODY = 64 * 1024; // 64KB: teto padrao dos demais POSTs; acima disso e' abuso -> 400
// Executor real: roda orchestra-go.ps1 via pwsh e interpreta a ULTIMA linha do stdout como o JSON do
// registro (que carrega a url do chat). pwsh ausente (ENOENT) ou exit != 0 -> rejeita com o stderr.
// Descricao/anexos do pedido viram -Descricao/-AnexosDir (so' quando existem).
function executarNovaFeatureReal(projeto, feature, extras) {
    return new Promise((ok, falha) => {
        const script = path.join(RAIZ_BRIDGE, "orchestra-go.ps1");
        // Args base de sempre; -Descricao/-AnexosDir SO' quando existirem (sem eles a chamada fica como hoje).
        const args = ["-NoProfile", "-File", script, "-Projeto", projeto, "-Feature", feature];
        if (extras?.descricao)
            args.push("-Descricao", extras.descricao);
        if (extras?.anexosDir)
            args.push("-AnexosDir", extras.anexosDir);
        let p;
        try {
            p = spawn("pwsh", args, { windowsHide: true, env: process.env });
        }
        catch (e) {
            falha(new Error(String(e?.message ?? e)));
            return;
        }
        let saida = "";
        let err = "";
        p.stdout?.on("data", (d) => { saida += d.toString(); });
        p.stderr?.on("data", (d) => { err += d.toString(); });
        p.on("error", (e) => falha(new Error(e?.code === "ENOENT" ? "pwsh nao encontrado no PATH" : String(e?.message ?? e))));
        p.on("close", (code) => {
            if (code !== 0) {
                falha(new Error(err.trim() || `orchestra-go.ps1 saiu com codigo ${code}`));
                return;
            }
            const linha = saida.split("\n").map((l) => l.trim()).filter(Boolean).pop() ?? "";
            let j = null;
            try {
                j = JSON.parse(linha);
            }
            catch {
                falha(new Error("saida do orchestra-go.ps1 nao e' JSON: " + linha));
                return;
            }
            if (typeof j?.url !== "string" || !j.url) {
                falha(new Error("saida do orchestra-go.ps1 sem url"));
                return;
            }
            ok({ url: j.url });
        });
    });
}
// Libera a porta (pedido de um processo com UI mais nova). No modo --ui, onCeder encerra o processo.
function ceder() {
    for (const c of clientes) {
        try {
            c.res.end();
        }
        catch { }
    }
    clientes.clear();
    if (intervalo) {
        clearInterval(intervalo);
        intervalo = null;
    }
    if (limpeza) {
        clearInterval(limpeza);
        limpeza = null;
    }
    if (watcher) {
        try {
            watcher.close();
        }
        catch { }
        watcher = null;
    }
    descarregarCanvas(); // grava ops pendentes antes de ceder a porta
    servidor?.closeAllConnections(); // derruba as conexoes keep-alive do servidor antigo (nao reusa socket morto)
    servidor?.close();
    servidor = null;
    onCeder?.();
}
function criarServidor() {
    return http.createServer(async (req, res) => {
        const url = req.url || "/";
        const caminho = url.split("?")[0];
        if (url === "/events") {
            res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
            res.write(": conectado\n\n");
            const c = { res, offsets: new Map() };
            clientes.add(c);
            enviar(c); // replay do estado atual (todas as runs) pra quem acabou de conectar
            sse(c, { planejadores }); // registros de planejadores (chat embutido) antes do {pronto}
            sse(c, { pronto: true }); // fim do replay: a UI so aplica depois disso (sem estado pela metade)
            req.on("close", () => clientes.delete(c));
            return;
        }
        // Toda resposta que NAO e' SSE sai SEM keep-alive: o socket morre junto com a resposta e o cliente
        // (undici) nunca reaproveita uma conexao do servidor antigo depois de um restart/ceder de porta
        // (evita ECONNRESET no primeiro pedido pos-restart).
        res.shouldKeepAlive = false;
        if (url === "/versao") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ versao: versaoUI() }));
            return;
        }
        if (url.startsWith("/cancel")) {
            const id = new URL(url, "http://x").searchParams.get("run") || "";
            if (!acaoValida(req) || !/^[a-z0-9-]+$/.test(id)) {
                res.writeHead(400);
                res.end();
                return;
            }
            try {
                fs.writeFileSync(arquivoCancel(id), String(Date.now()));
                res.writeHead(204);
            }
            catch {
                res.writeHead(500);
            }
            res.end();
            return;
        }
        if (url === "/ceder") {
            if (!acaoValida(req)) {
                res.writeHead(400);
                res.end();
                return;
            }
            res.writeHead(204);
            res.end();
            setTimeout(ceder, 50);
            return;
        }
        if (url === "/nova-feature") {
            if (!acaoValida(req)) {
                res.writeHead(400);
                res.end();
                return;
            }
            let corpo = "";
            let cortou = false;
            req.on("data", (d) => {
                if (cortou)
                    return;
                corpo += d.toString();
                if (Buffer.byteLength(corpo) > limiteBodyNovaFeature) {
                    cortou = true;
                    res.writeHead(400);
                    res.end();
                }
            });
            req.on("end", () => {
                if (cortou)
                    return;
                let j = null;
                try {
                    j = JSON.parse(corpo);
                }
                catch { }
                const v = validarNovaFeature(j);
                if (!v) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                if (novaFeatureEmAndamento) {
                    res.writeHead(409);
                    res.end();
                    return;
                }
                novaFeatureEmAndamento = true;
                const exec = executarNovaFeature;
                // Extras SO' quando o pedido tem descricao e/ou anexos (compat: sem campos novos, sem extras).
                let extras;
                if (v.descricao || v.anexos?.length) {
                    extras = {};
                    if (v.descricao)
                        extras.descricao = v.descricao;
                    if (v.anexos?.length) {
                        const dir = path.join(ANEXOS_DIR, randomUUID()); // pasta UNICA por pedido
                        try {
                            fs.mkdirSync(dir, { recursive: true });
                            for (const a of v.anexos)
                                fs.writeFileSync(path.join(dir, a.nome), Buffer.from(a.dadosB64, "base64"));
                            extras.anexosDir = dir;
                        }
                        catch { }
                    }
                }
                res.writeHead(202);
                res.end(); // dispara em background; o andamento vai por SSE
                broadcast({ novaFeature: { status: "rodando", projeto: v.projeto, feature: v.feature } });
                exec(v.projeto, v.feature, extras)
                    .then(({ url: u }) => broadcast({ novaFeature: { status: "ok", projeto: v.projeto, feature: v.feature, url: u } }))
                    .catch((e) => broadcast({ novaFeature: { status: "erro", projeto: v.projeto, feature: v.feature, erro: String(e?.message ?? e) } }))
                    .finally(() => { novaFeatureEmAndamento = false; });
            });
            return;
        }
        // ---- canvas (S2) ----
        if (caminho === "/canvas/op") {
            // Drena o corpo ANTES de responder 400: corpo sem ler deixa a conexao suja (reset no cliente).
            const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS);
            if (corpo === null) {
                res.writeHead(400);
                res.end();
                return;
            }
            if (!acaoValida(req)) {
                res.writeHead(400);
                res.end();
                return;
            }
            let j = null;
            try {
                j = JSON.parse(corpo);
            }
            catch { }
            const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
            const ops = j ? validarOps(j.ops) : null;
            if (!projeto || !ops) {
                res.writeHead(400);
                res.end();
                return;
            }
            const id = idProjeto(projeto);
            canvasCache.set(id, aplicarOps(lerCanvas(id), ops));
            gravarCanvasDebounced(id);
            broadcast({ canvasOp: { projeto, ops } });
            res.writeHead(204);
            res.end();
            return;
        }
        if (caminho === "/canvas/asset") {
            // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
            const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS_ASSET);
            if (corpo === null) {
                res.writeHead(400);
                res.end();
                return;
            }
            if (!acaoValida(req)) {
                res.writeHead(400);
                res.end();
                return;
            }
            let j = null;
            try {
                j = JSON.parse(corpo);
            }
            catch { }
            const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
            const v = j ? validarAsset(j.nome, j.dadosB64) : null;
            if (!projeto || !v) {
                res.writeHead(400);
                res.end();
                return;
            }
            const id = idProjeto(projeto);
            const arquivo = randomUUID() + "." + v.ext;
            try {
                fs.mkdirSync(path.join(CANVAS_DIR, id, "assets"), { recursive: true });
                fs.writeFileSync(path.join(CANVAS_DIR, id, "assets", arquivo), v.bytes);
            }
            catch {
                res.writeHead(500);
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ url: `/canvas/asset/${id}/${arquivo}` }));
            return;
        }
        if (caminho.startsWith("/canvas/asset/")) {
            servirCanvasAsset(caminho, res);
            return;
        }
        if (caminho === "/canvas/projetos") {
            if (req.method === "POST") {
                // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
                const corpo = await lerCorpo(req, LIMITE_BODY);
                if (corpo === null) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                if (!acaoValida(req)) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                let j = null;
                try {
                    j = JSON.parse(corpo);
                }
                catch { }
                const raiz = j && typeof j.raiz === "string" ? j.raiz.trim() : "";
                if (!raiz) {
                    res.writeHead(400);
                    res.end();
                    return;
                }
                salvarProjeto(raiz, j.nome, j.cor);
                res.writeHead(204);
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(mesclarProjetos(raizesDescobertas(), lerProjetosSalvos())));
            return;
        }
        if (caminho === "/canvas") {
            const projeto = new URL(url, "http://x").searchParams.get("projeto") || "";
            if (!projeto) {
                res.writeHead(400);
                res.end();
                return;
            }
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(lerCanvas(idProjeto(projeto))));
            return;
        }
        servirEstatico(url, res);
    });
}
// Em EADDRINUSE: se a porta fala /versao (e' um hub Hermes), pede pra ele ceder e assume a porta.
// Com sempreAssumir (modo --ui, o app de verdade) o pedido e' INCONDICIONAL: abrir o app derruba o node
// do dashboard anterior e o novo passa a servir o dist mais atualizado, mesmo com versoes empatadas
// (mesmo dist) ou o hub "mais novo". Sem sempreAssumir (modo stdio) mantem a regra antiga: so' assume se
// a nossa UI for MAIS NOVA. Processo ALHEIO na porta (nao responde /versao / hub quebrado) nunca e' tocado.
async function tentarAssumir() {
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/versao`, { signal: AbortSignal.timeout(1500) });
        let j = null;
        try {
            j = await r.json();
        }
        catch { } // corpo nao-JSON (processo alheio) -> j fica null
        const ehHub = r.ok && typeof j?.versao === "number";
        if (!ehHub)
            return; // nao e' o Hermes: nunca interferir
        if (!sempreAssumir && !(j.versao < versaoUI()))
            return; // stdio: so' cede pra uma UI mais nova
        await fetch(`http://127.0.0.1:${PORT}/ceder`, { method: "POST", headers: { "X-Hermes": "1" }, signal: AbortSignal.timeout(1500) });
    }
    catch {
        return;
    }
    for (let i = 0; i < 6; i++) {
        await new Promise((ok) => setTimeout(ok, 500));
        if (await escutar())
            return;
    }
}
function escutar() {
    return new Promise((ok) => {
        const srv = criarServidor();
        srv.once("error", () => ok(false));
        srv.once("listening", () => {
            servidor = srv;
            process.stderr.write(`[hermes-bridge] dashboard: http://127.0.0.1:${PORT}\n`);
            podar();
            rescan();
            void limparPlanejadores(PLANEJADORES_DIR); // uma vez no start
            limpeza = setInterval(() => { void limparPlanejadores(PLANEJADORES_DIR); }, 5000);
            limpeza.unref();
            try {
                watcher = fs.watch(RUNS_DIR, () => rescan());
            }
            catch { }
            intervalo = setInterval(rescan, 1000);
            intervalo.unref();
            ok(true);
        });
        srv.listen(PORT, "127.0.0.1");
    });
}
export async function iniciarUI(opts = {}) {
    if (servidor)
        return;
    onCeder = opts.onCeder ?? null;
    sempreAssumir = opts.sempreAssumir ?? false;
    executarNovaFeature = opts.executarNovaFeature ?? executarNovaFeatureReal;
    limiteBodyNovaFeature = opts.limiteBodyNovaFeature ?? LIMITE_BODY_NOVA_FEATURE;
    if (!(await escutar()))
        await tentarAssumir();
    // Se o hub sumir (sessao fechou ou cedeu pra outro que depois saiu), quem estiver vivo reassume a porta.
    if (!reassumir)
        reassumir = setInterval(() => { if (!servidor)
            void escutar(); }, 10_000);
    reassumir.unref();
}
// Encerra o servidor/watcher e limpa TODOS os intervalos (rescan, reassumir, limpeza). Usado nos testes.
export function pararUI() {
    if (intervalo) {
        clearInterval(intervalo);
        intervalo = null;
    }
    if (reassumir) {
        clearInterval(reassumir);
        reassumir = null;
    }
    if (limpeza) {
        clearInterval(limpeza);
        limpeza = null;
    }
    if (watcher) {
        try {
            watcher.close();
        }
        catch { }
        watcher = null;
    }
    descarregarCanvas(); // grava ops pendentes do debounce antes de desligar
    for (const c of clientes) {
        try {
            c.res.end();
        }
        catch { }
    }
    clientes.clear();
    servidor?.closeAllConnections(); // fecha conexoes abertas antes do close: o proximo servidor nao herda socket morto
    servidor?.close();
    servidor = null;
    onCeder = null;
    sempreAssumir = false;
}
