// Hub do canvas (S2 do partir-ui): grafo por projeto, projetos/assets em disco e as rotas /canvas*.
// Codigo movido LITERALMENTE do ui.ts, sem mudanca de comportamento (CA-7). Este modulo NUNCA importa
// ./ui.js (dependencia de mao unica: o ui.ts importa daqui) e liga, por gancho, o contexto dos agentes
// que continua no ui.ts — o canvas NAO conhece agentes, so' avisa quem aplica ops.
import fs from "node:fs";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { aplicarOps, idProjeto, mesclarProjetos, validarAsset, validarOps, type Op, type Projeto, type Snapshot } from "./canvas.js";
import { CANVAS_DIR, acaoValida, broadcast, estado, lerCorpo, planejadores } from "./hub.js";

// Gancho do ui.ts: aplicar ops no canvas dispara a sincronizacao do contexto em disco dos nos 'agente'
// (que mora no ui.ts, junto dos agentes). Sem gancho ligado, nada acontece (mesmo padrao do definirGanchosHub).
export type GanchosCanvas = { aoAplicarOps: (snap: Snapshot) => void };
let ganchosCanvas: GanchosCanvas = { aoAplicarOps: () => {} };
export function definirGanchosCanvas(g: GanchosCanvas): void { ganchosCanvas = g; }

// ---- canvas (S2): grafo por projeto, persistido em <CANVAS_DIR>/<idProjeto>/canvas.json ----
const LIMITE_BODY_CANVAS = 2 * 1024 * 1024;        // 2MB: lotes de ops
const LIMITE_BODY_CANVAS_ASSET = 40 * 1024 * 1024; // 40MB: imagem em base64 (infla ~33%)
const CANVAS_DEBOUNCE_MS = 300;                    // gravacao em disco com debounce
const LIMITE_BODY = 64 * 1024;                     // 64KB: teto padrao dos demais POSTs; acima disso e' abuso -> 400

const canvasCache = new Map<string, Snapshot>();       // idProjeto -> snapshot em memoria
const canvasTimers = new Map<string, NodeJS.Timeout>(); // idProjeto -> gravacao pendente

// Content-type das imagens servidas em GET /canvas/asset (so' imagem entra no canvas).
const TIPOS_IMG: Record<string, string> = {
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
  ".webp": "image/webp", ".bmp": "image/bmp", ".svg": "image/svg+xml", ".avif": "image/avif", ".ico": "image/x-icon",
};

function arquivoCanvas(id: string): string { return path.join(CANVAS_DIR, id, "canvas.json"); }

// Cache por projeto: no primeiro acesso (ou apos restart) le do disco; projeto novo = vazio.
export function lerCanvas(id: string): Snapshot {
  const emCache = canvasCache.get(id);
  if (emCache) return emCache;
  let s: Snapshot = { nos: [], arestas: [] };
  try {
    const j = JSON.parse(fs.readFileSync(arquivoCanvas(id), "utf8"));
    if (j && Array.isArray(j.nos) && Array.isArray(j.arestas)) s = { nos: j.nos, arestas: j.arestas };
  } catch {}
  canvasCache.set(id, s);
  return s;
}

function gravarCanvasAgora(id: string): void {
  const s = canvasCache.get(id);
  if (!s) return;
  try {
    fs.mkdirSync(path.join(CANVAS_DIR, id), { recursive: true });
    fs.writeFileSync(arquivoCanvas(id), JSON.stringify(s));
  } catch {}
}

// Debounce ~300ms: rajadas de ops (arrastar varios nos) viram UMA gravacao.
function gravarCanvasDebounced(id: string): void {
  const t = canvasTimers.get(id);
  if (t) clearTimeout(t);
  const timer = setTimeout(() => { canvasTimers.delete(id); gravarCanvasAgora(id); }, CANVAS_DEBOUNCE_MS);
  timer.unref?.();
  canvasTimers.set(id, timer);
}

// Grava o que estiver pendente (chamado no pararUI pra nao perder ops na janela do debounce).
export function descarregarCanvas(): void {
  for (const [id, t] of canvasTimers) { clearTimeout(t); gravarCanvasAgora(id); }
  canvasTimers.clear();
}

// Raizes descobertas: cwd das runs EM MEMORIA + raiz dos planejadores.
export function raizesDescobertas(): string[] {
  const out: string[] = [];
  for (const evs of estado.values()) for (const ev of evs) if (ev.t === "run" && ev.cwd) out.push(ev.cwd);
  for (const p of planejadores) out.push(p.raiz);
  return out;
}

export function lerProjetosSalvos(): Projeto[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(CANVAS_DIR, "projetos.json"), "utf8"));
    if (!Array.isArray(j)) return [];
    return j
      .filter((p: any) => p && typeof p.raiz === "string" && typeof p.nome === "string")
      .map((p: any) => (typeof p.cor === "string" ? { raiz: p.raiz, nome: p.nome, cor: p.cor } : { raiz: p.raiz, nome: p.nome }));
  } catch { return []; }
}

function gravarProjetosSalvos(salvos: Projeto[]): void {
  try {
    fs.mkdirSync(CANVAS_DIR, { recursive: true });
    fs.writeFileSync(path.join(CANVAS_DIR, "projetos.json"), JSON.stringify(salvos));
  } catch {}
}

function nomeBase(raiz: string): string {
  const base = raiz.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop();
  return base || raiz;
}

// Upsert por idProjeto: mesma raiz (grafias diferentes) nao duplica; campo ausente preserva o salvo.
function salvarProjeto(raiz: string, nome?: unknown, cor?: unknown): void {
  const id = idProjeto(raiz);
  const salvos = lerProjetosSalvos();
  const i = salvos.findIndex((p) => idProjeto(p.raiz) === id);
  const atual = i >= 0 ? salvos[i] : undefined;
  const nomeLimpo = typeof nome === "string" ? nome.trim() : "";
  const novo: Projeto = { raiz: atual?.raiz ?? raiz, nome: nomeLimpo || atual?.nome || nomeBase(raiz) };
  const corLimpa = typeof cor === "string" ? cor.trim() : "";
  if (corLimpa) novo.cor = corLimpa;
  else if (atual?.cor !== undefined) novo.cor = atual.cor;
  if (i >= 0) salvos[i] = novo; else salvos.push(novo);
  gravarProjetosSalvos(salvos);
}

// GET /canvas/asset/<idProjeto>/<arquivo>: so' imagem, id hex, recusa traversal e inexistente -> 404.
function servirCanvasAsset(caminho: string, res: ServerResponse): void {
  const resto = caminho.slice("/canvas/asset/".length);
  const barra = resto.indexOf("/");
  if (barra < 0) { res.writeHead(404); res.end(); return; }
  let id = resto.slice(0, barra);
  let arquivo = resto.slice(barra + 1);
  try { id = decodeURIComponent(id); arquivo = decodeURIComponent(arquivo); } catch { res.writeHead(400); res.end(); return; }
  if (!/^[0-9a-f]+$/i.test(id)) { res.writeHead(400); res.end(); return; }
  if (!arquivo || /[\\/]/.test(arquivo) || arquivo.includes("..")) { res.writeHead(400); res.end(); return; }
  const alvo = path.join(CANVAS_DIR, id, "assets", arquivo);
  fs.readFile(alvo, (err, buf) => {
    if (err) { res.writeHead(404); res.end(); return; }
    // sandbox: SVG aberto direto nao roda script na origem do hub.
    res.writeHead(200, {
      "Content-Type": TIPOS_IMG[path.extname(arquivo).toLowerCase()] || "application/octet-stream",
      "Content-Security-Policy": "sandbox",
    });
    res.end(buf);
  });
}

// Aplica um lote de ops no canvas do projeto pelo MESMO caminho do POST /canvas/op.
export function aplicarOpsProjeto(projeto: string, ops: Op[]): void {
  const id = idProjeto(projeto);
  const snapNovo = aplicarOps(lerCanvas(id), ops);
  canvasCache.set(id, snapNovo);
  gravarCanvasDebounced(id);
  broadcast({ canvasOp: { projeto, ops } });
  try { ganchosCanvas.aoAplicarOps(snapNovo); } catch {}
}

// Rotas /canvas* do criarServidor: true = tratou (respondeu). O ui.ts so' chama e retorna no mesmo lugar.
export async function rotasCanvas(req: IncomingMessage, res: ServerResponse, caminho: string, url: string): Promise<boolean> {
  if (caminho === "/canvas/op") {
    // Drena o corpo ANTES de responder 400: corpo sem ler deixa a conexao suja (reset no cliente).
    const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS);
    if (corpo === null) { res.writeHead(400); res.end(); return true; }
    if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
    let j: any = null;
    try { j = JSON.parse(corpo); } catch {}
    const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
    const ops = j ? validarOps(j.ops) : null;
    if (!projeto || !ops) { res.writeHead(400); res.end(); return true; }
    const id = idProjeto(projeto);
    const snapNovo = aplicarOps(lerCanvas(id), ops);
    canvasCache.set(id, snapNovo);
    gravarCanvasDebounced(id);
    broadcast({ canvasOp: { projeto, ops } });
    try { ganchosCanvas.aoAplicarOps(snapNovo); } catch {}
    res.writeHead(204); res.end();
    return true;
  }
  if (caminho === "/canvas/asset") {
    // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
    const corpo = await lerCorpo(req, LIMITE_BODY_CANVAS_ASSET);
    if (corpo === null) { res.writeHead(400); res.end(); return true; }
    if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
    let j: any = null;
    try { j = JSON.parse(corpo); } catch {}
    const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
    const v = j ? validarAsset(j.nome, j.dadosB64) : null;
    if (!projeto || !v) { res.writeHead(400); res.end(); return true; }
    const id = idProjeto(projeto);
    const arquivo = randomUUID() + "." + v.ext;
    try {
      fs.mkdirSync(path.join(CANVAS_DIR, id, "assets"), { recursive: true });
      fs.writeFileSync(path.join(CANVAS_DIR, id, "assets", arquivo), v.bytes);
    } catch { res.writeHead(500); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ url: `/canvas/asset/${id}/${arquivo}` }));
    return true;
  }
  if (caminho.startsWith("/canvas/asset/")) { servirCanvasAsset(caminho, res); return true; }
  if (caminho === "/canvas/projetos") {
    if (req.method === "POST") {
      // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return true; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      const raiz = j && typeof j.raiz === "string" ? j.raiz.trim() : "";
      if (!raiz) { res.writeHead(400); res.end(); return true; }
      salvarProjeto(raiz, j.nome, j.cor);
      res.writeHead(204); res.end();
      return true;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    // Pasta apagada some da lista (nada e' removido: se a pasta voltar, o projeto reaparece).
    res.end(JSON.stringify(mesclarProjetos(raizesDescobertas(), lerProjetosSalvos()).filter((p) => fs.existsSync(p.raiz))));
    return true;
  }
  if (caminho === "/canvas") {
    const projeto = new URL(url, "http://x").searchParams.get("projeto") || "";
    if (!projeto) { res.writeHead(400); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(lerCanvas(idProjeto(projeto))));
    return true;
  }
  return false;
}
