// Hub dos agentes (S4a/S4b/S4c do partir-ui): registro em disco, serve do OpenCode (subir/reaproveitar),
// a ponte SSE do /event que vira transcricao, a lista de modelos do provider, o PTY dos agentes Claude,
// a colaboracao entre agentes (identidade por token, conversas e fila de entregas), o contexto em disco
// e as rotas /agentes*, /arvore e /arquivo (rotasAgentes).
// Codigo movido LITERALMENTE do ui.ts, sem mudanca de comportamento (CA-7). Este modulo NUNCA importa
// ./ui.js (dependencia de mao unica: o ui.ts importa daqui). O que ainda mora no ui.ts (servidor e
// hubAtivo) chega por GANCHO, mesmo padrao do definirGanchosHub/definirGanchosCanvas.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execSync, spawn } from "node:child_process";
import type { IncomingMessage, ServerResponse } from "node:http";
import { idProjeto, mesclarProjetos, type Aresta, type No, type Snapshot } from "./canvas.js";
import { AGENTES_DIR, CANVAS_DIR, WEB_DIR, acaoValida, broadcast, lerCorpo, planejadores, responderTexto, type Planejador } from "./hub.js";
// S4c: raizDeProjeto cruza as raizes descobertas (runs/planejadores) com os projetos salvos do canvas.
// S5: as rotas /cli/* (rotasCli) tambem usam o lerCanvas/aplicarOpsProjeto daqui.
import { lerCanvas, aplicarOpsProjeto, lerProjetosSalvos, raizesDescobertas } from "./canvas-hub.js";
import {
  PAPEIS, agenteDePlanejador, validarAgente, normalizarEvento, aplicarLinhas, separarModelo, FilaAvisos,
  historicoParaLinhas, itensDeContexto, planoArquivos, diffContexto,
  type Agente, type AssinaturaArquivo, type Linha, type OrigemAgente, type Papel, type ParteRegistrada,
} from "./agentes.js";
// Agentes Claude Code via PTY (F4/S3) e colaboracao entre agentes (F3/S2): logica pura importada AQUI
// (os modulos puros nao importam em runtime).
import { argsClaude, settingsHooks, textoParaPty } from "./claude-pty.js";
import {
  linhaIdentidade, fmtSemResposta, validarCaminho, conectados, resolverAlvo, slugNome,
  fmtPergunta, fmtResposta, fmtMensagem, opsFlowAdd, opsFlowLink, opsFile, opsNote,
  Conversas, FilaEntregas, type AgenteRef,
} from "./colaboracao.js";
// S5: as rotas /cli/browser-* usam o driver injetado (navegador-hub) e os utilitarios do navegador.
import { urlPermitida, formatarLeitura, resolverElemento, nomeShot } from "./navegador.js";
import { obterNavegador, lerNavegador, resolverNavegador, elementosDoNavegador } from "./navegador-hub.js";

// Ganchos do ui.ts: o que a ponte do /event dispara ao mudar o status de um agente (fila de entregas da
// colaboracao, avisos de contexto presos, 'aguardando' dos hooks do Claude) e o hubAtivo (o servidor
// ainda esta de pe' -> nao abre ponte orfa). Sem gancho ligado, nada acontece (padrao do definirGanchosHub).
export type GanchosAgentes = {
  marcarOcupadoColab: (id: string) => void; // fila de entregas da colaboracao
  marcarOciosoColab: (id: string) => void;
  liberarAviso: (id: string) => void;       // avisos de contexto que estavam presos
  liberarEntregas: (id: string) => void;    // entregas enfileiradas do agente
  estaAguardando: (id: string) => boolean;  // 'aguardando' = hooks do Claude pedindo permissao
  hubAtivo: () => boolean;                  // o servidor ainda esta de pe' (nao abre ponte orfa)
};
let ganchosAgentes: GanchosAgentes = {
  marcarOcupadoColab: () => {}, marcarOciosoColab: () => {}, liberarAviso: () => {},
  liberarEntregas: () => {}, estaAguardando: () => false, hubAtivo: () => true,
};
export function definirGanchosAgentes(g: GanchosAgentes): void { ganchosAgentes = g; }

// Registro em disco de um agente: o Agente do modelo + campos de runtime (erro do ultimo start,
// pid do serve e status explicito marcado pelo reiniciar, que destaca o serve como saudavel).
export type RegistroAgente = Agente & { erro?: string; pid?: number; status?: string; token?: string };

export const agentes = new Map<string, RegistroAgente>();               // id -> registro
export const serves = new Map<string, { base: string; pid: number }>(); // cwd -> serve do OpenCode (reaproveitado)
export const agenteLinhas = new Map<string, Linha[]>();                 // id -> transcricao (linhas do chat)
export const pontes = new Map<string, AbortController>();               // base -> ponte do /event
export const basesMortas = new Set<string>();                           // base -> serve inacessivel (status 'encerrado')
let reconectando = false;                                     // serializa o reconectar das pontes (sem sobrepor)
export const ctxAssinaturas = new Map<string, AssinaturaArquivo[]>();   // id -> assinaturas do contexto em disco
export const fila = new FilaAvisos();
let agentesCarregados = false;

// Raiz do dev-orchestra (um nivel acima de dist/web ou de web no dev): onde vive a pasta bin/.
export const RAIZ_BRIDGE = path.resolve(WEB_DIR, "..", "..");

export function novoToken(): string { return randomBytes(24).toString("hex"); } // 48 chars (>=16)

// Porta livre escolhida pelo SO (mesma ideia de um TcpListener na porta 0).
function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}

// Caminho do exe do OpenCode (exe direto, nao o shim .cmd/.ps1).
function caminhoOpencode(): string {
  try {
    const cmd = process.platform === "win32" ? "where opencode" : "which opencode";
    const linhas = execSync(cmd, { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
      .split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    for (const l of linhas) if (/\.exe$/i.test(l)) return l;
    for (const l of linhas) {
      const exe = path.join(path.dirname(l), "node_modules", "opencode-ai", "bin", "opencode.exe");
      if (fs.existsSync(exe)) return exe;
    }
  } catch {}
  return "opencode";
}

// PATH do serve: bin/ (CLI `canvas`) e a pasta do node na frente. No Windows a chave pode vir como 'Path'.
export function envServe(): NodeJS.ProcessEnv {
  const bin = path.join(RAIZ_BRIDGE, "bin");
  const env: NodeJS.ProcessEnv = { ...process.env };
  const atual = env.PATH ?? env.Path ?? "";
  delete env.Path;
  env.PATH = bin + path.delimiter + path.dirname(process.execPath) + path.delimiter + atual;
  return env;
}

// Env do `claude` no PTY: o do serve (bin/ no PATH, onde fica o `canvas`) sem as variaveis de uma sessao
// Claude Code/desktop que abriu o app (ANTHROPIC_BASE_URL, CLAUDE_CODE_*...): com elas o claude cobra
// pela API em vez de usar o login da conta. CLAUDE_CONFIG_DIR fica (escolha do usuario).
export function envClaude(base: NodeJS.ProcessEnv = envServe()): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (/^(ANTHROPIC_|CLAUDE_CODE_|CLAUDE_AGENT_SDK|CLAUDECODE$|CLAUDE_PID$|CLAUDE_EFFORT$)/i.test(k)) continue;
    env[k] = v;
  }
  return env;
}

// Sobe `opencode serve --port <livre>` na cwd e espera o /doc responder.
export async function subirServeReal(cwd: string, env?: Record<string, string | undefined>): Promise<{ base: string; pid: number }> {
  const porta = await portaLivre();
  // detached + unref: o serve vira processo independente (novo grupo no Windows) e SOBREVIVE ao hub
  // de um Start-Process). Sem isso ele e' filho do processo do hub e
  // morre junto quando o hub reinicia ou cede a porta, deixando o agente 'encerrado' para sempre.
  const p = spawn(caminhoOpencode(), ["serve", "--port", String(porta)], { cwd, windowsHide: true, stdio: "ignore", env: env ?? process.env, detached: true });
  p.unref();
  let falha: Error | null = null;
  p.once("error", (e) => { falha = e; }); // cwd inexistente/opencode ausente: sem isso o hub inteiro cai
  const base = `http://127.0.0.1:${porta}`;
  for (let i = 0; i < 60; i++) {
    await new Promise((ok) => setTimeout(ok, 500));
    if (falha) throw new Error("não foi possível iniciar o OpenCode: " + (falha as Error).message);
    try { const r = await fetch(base + "/doc", { signal: AbortSignal.timeout(2000) }); if (r.ok) return { base, pid: p.pid ?? 0 }; } catch {}
  }
  try { if (p.pid) process.kill(p.pid); } catch {}
  throw new Error("o servidor do OpenCode nao subiu na porta " + porta);
}

export function arquivoAgente(id: string): string { return path.join(AGENTES_DIR, id + ".json"); }

// Le (uma vez) os registros do disco. JSON corrompido/invalido e' ignorado; pasta inexistente vira vazio.
export function carregarAgentes(): void {
  if (agentesCarregados) return;
  agentesCarregados = true;
  let files: string[] = [];
  try { files = fs.readdirSync(AGENTES_DIR).filter((f) => f.endsWith(".json")); } catch { return; }
  for (const f of files) {
    try {
      const a = validarAgente(JSON.parse(fs.readFileSync(path.join(AGENTES_DIR, f), "utf8"))) as RegistroAgente | null;
      if (!a) continue; // nao e' um agente do canvas (ex.: registro {id,token} de planejador): ignora
      if (!a.token) { a.token = novoToken(); gravarAgente(a); } // agente antigo sem token ganha um ao carregar
      else agentes.set(a.id, a);
      // Agente Claude nao sobrevive ao restart do hub (PTY morre junto): entra como 'encerrado'.
      if (a.tipo === "claude") a.status = "encerrado";
    } catch {}
  }
}

export function gravarAgente(a: RegistroAgente): void {
  agentes.set(a.id, a);
  try { fs.mkdirSync(AGENTES_DIR, { recursive: true }); fs.writeFileSync(arquivoAgente(a.id), JSON.stringify(a)); } catch {}
}

export function removerAgenteDoDisco(id: string): void {
  agentes.delete(id);
  agenteLinhas.delete(id);
  fila.estados.delete(id);
  try { fs.unlinkSync(arquivoAgente(id)); } catch {}
}

// status de um agente: 'falhou' quando o serve/sessao nao subiu; 'encerrado' quando a base nao
// responde mais (serve morto); senao ocupado/ocioso pela fila de avisos.
export function statusDe(id: string, base = ""): string {
  const a = agentes.get(id);
  const b = base || a?.base || "";
  if (b && basesMortas.has(b)) return "encerrado";
  if (!a) return "ocioso";
  if (a.erro) return "falhou";
  if (fila.estados.get(id)?.ocupado) return "ocupado";
  // Agente reiniciado com sucesso grava status 'ok' (serve/sessao novos); os demais ficam 'ocioso'.
  return a.status ?? "ocioso";
}

export type ResumoAgente = { id: string; nome: string; papel: string; modelo: string; cwd: string; origem: string; tipo: string; status: string; ocupado: boolean; aguardando: boolean };

export function resumoAgente(a: Agente): ResumoAgente {
  return {
    id: a.id, nome: a.nome, papel: a.papel, modelo: a.modelo, cwd: a.cwd, origem: a.origem, tipo: a.tipo,
    status: statusDe(a.id, a.base), ocupado: fila.estados.get(a.id)?.ocupado === true, aguardando: ganchosAgentes.estaAguardando(a.id),
  };
}

// Agentes do canvas daquele projeto + os derivados dos planejadores (agenteDePlanejador).
export function listarAgentes(projeto: string): ResumoAgente[] {
  const out: ResumoAgente[] = [];
  // Inclui tambem agentes cujo cwd casa com o projeto consultado (G2: o planejador Claude roda no
  // worktree, entao aparece em /agentes?projeto=<worktree> mesmo tendo projeto = raiz do pedido).
  for (const a of agentes.values()) if (a.projeto === projeto || a.cwd === projeto) out.push(resumoAgente(a));
  for (const p of planejadores) {
    if (p.projeto !== projeto && idProjeto(p.raiz) !== idProjeto(projeto)) continue;
    out.push(resumoAgente(agenteDePlanejador(p)));
  }
  return out;
}

export function serveDoCwd(cwd: string): { base: string; pid: number } | undefined {
  const s = serves.get(cwd);
  if (s) return s;
  for (const a of agentes.values()) if (a.cwd === cwd && a.base) return { base: a.base, pid: 0 };
  return undefined;
}

// Base do OpenCode usada pra listar os modelos (GET /agentes/modelos): a do cwd pedido; sem serve
// naquela pasta, cai no primeiro serve conhecido (serves.values()) ou na base de um planejador do
// orchestra-go — a lista de providers do OpenCode e' da CONTA, nao da pasta. Sem nenhum -> "" (-> []).
export function baseParaModelos(cwd: string): string {
  const s = cwd ? serveDoCwd(cwd) : undefined;
  if (s) return s.base;
  for (const x of serves.values()) if (x.base) return x.base;
  for (const p of planejadores) if (p.base) return p.base;
  return "";
}

// ['provider/modelo', ...] a partir de GET {base}/config/providers.
export async function listarModelos(base: string): Promise<string[]> {
  try {
    const r = await fetch(base + "/config/providers");
    if (!r.ok) return [];
    const j: any = await r.json();
    const out: string[] = [];
    if (Array.isArray(j?.providers)) {
      for (const p of j.providers) {
        if (!p || typeof p.id !== "string" || !p.models || typeof p.models !== "object") continue;
        for (const m of Object.keys(p.models)) out.push(p.id + "/" + m);
      }
    }
    return out;
  } catch { return []; }
}

// ---- ponte do /event (uma por base): le o stream SSE e empurra linhas/status pros clientes ----
export function abrirPonte(base: string): void {
  if (!base || pontes.has(base)) return;
  const ctrl = new AbortController();
  pontes.set(base, ctrl);
  void loopPonte(base, ctrl);
}

async function loopPonte(base: string, ctrl: AbortController): Promise<void> {
  const papeis = new Map<string, string>();
  const partes = new Map<string, ParteRegistrada>(); // por ponte (por base): acumula os deltas de texto
  while (!ctrl.signal.aborted) {
    try {
      const r = await fetch(base + "/event", { signal: ctrl.signal, headers: { Accept: "text/event-stream" } });
      if (!r.ok || !r.body) throw new Error("evento indisponivel");
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const bloco = buf.slice(0, i);
          buf = buf.slice(i + 2);
          for (const l of bloco.split("\n")) {
            if (!l.startsWith("data:")) continue;
            const dados = l.slice(5).trim();
            if (!dados) continue;
            let ev: unknown = null;
            try { ev = JSON.parse(dados); } catch { continue; }
            tratarEvento(base, ev, papeis, partes);
          }
        }
      }
    } catch {}
    if (ctrl.signal.aborted) break;
    await new Promise((ok) => setTimeout(ok, 1000)); // reconecta sem loop agressivo
  }
}

export function fecharPonte(base: string): void {
  const ctrl = pontes.get(base);
  if (!ctrl) return;
  try { ctrl.abort(); } catch {}
  pontes.delete(base);
}

// O serve do OpenCode responde? GET {base}/doc com timeout curto (~1.5s), usado ANTES de abrir a
// ponte de um agente recarregado do disco (nao adianta assinar /event de um serve que morreu).
export async function serveVivo(base: string): Promise<boolean> {
  try {
    const r = await fetch(base + "/doc", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}

// Empurra a lista de agentes de cada projeto conhecido (canvas + raiz dos planejadores).
export function broadcastAgentes(): void {
  const projetos = new Set<string>();
  for (const a of agentes.values()) projetos.add(a.projeto);
  for (const p of planejadores) projetos.add(p.raiz);
  for (const projeto of projetos) broadcast({ agentes: listarAgentes(projeto) });
}

// Reabre as pontes de /event dos agentes conhecidos (canvas recarregado do disco + derivados dos
// planejadores do orchestra-go): para cada base distinta testa o serve com GET /doc e so' entao abre
// a ponte (abrirPonte ja ignora base repetida). Base inacessivel NAO abre ponte e fica marcada como
// morta (status 'encerrado' no GET /agentes e no broadcast {agentes}); e' retentada de forma espacada
// (no intervalo de limpeza), nunca em loop agressivo.
export async function reconectarPontes(): Promise<void> {
  if (reconectando) return;
  reconectando = true;
  try {
    const bases = new Set<string>();
    for (const a of agentes.values()) if (a.base) bases.add(a.base);
    for (const p of planejadores) { const b = agenteDePlanejador(p).base; if (b) bases.add(b); }
    let mudou = false;
    for (const base of bases) {
      if (!ganchosAgentes.hubAtivo()) return; // hub parou durante a checagem: nao abre ponte orfa
      if (pontes.has(base)) continue; // ja conectado
      if (await serveVivo(base)) {
        if (basesMortas.delete(base)) mudou = true;
        abrirPonte(base);
      } else if (!basesMortas.has(base)) {
        basesMortas.add(base);
        mudou = true;
      }
    }
    for (const base of [...basesMortas]) if (!bases.has(base)) { basesMortas.delete(base); mudou = true; }
    if (mudou) broadcastAgentes();
  } finally { reconectando = false; }
}

export function agenteDaSessao(base: string, sessao: string): RegistroAgente | undefined {
  for (const a of agentes.values()) if (a.base === base && a.sessao === sessao) return a;
  return undefined;
}

function tratarEvento(base: string, ev: unknown, papeis: Map<string, string>, partes: Map<string, ParteRegistrada>): void {
  const r = normalizarEvento(ev, papeis, partes);
  if (!r) return;
  const ag = agenteDaSessao(base, r.sessao);
  if (!ag) return;
  if (r.linha) {
    const novas = aplicarLinhas(agenteLinhas.get(ag.id) ?? [], [r.linha]);
    agenteLinhas.set(ag.id, novas);
    broadcast({ agenteLinhas: { id: ag.id, linhas: novas } });
  }
  if (r.status) {
    if (r.status === "ocupado") { fila.marcarOcupado(ag.id); ganchosAgentes.marcarOcupadoColab(ag.id); }
    else {
      fila.marcarOcioso(ag.id); ganchosAgentes.marcarOciosoColab(ag.id);
      ganchosAgentes.liberarAviso(ag.id);
      ganchosAgentes.liberarEntregas(ag.id);
    }
    broadcast({ agentes: listarAgentes(ag.projeto) });
  }
}

// ---- agentes Claude Code via PTY (F4/S3) ----
// Driver de PTY injetado pelo app desktop (electron). Sem ele, POST /agentes tipo 'claude' responde
// 'falhou' com "abra o app Dev Orchestra para usar agentes Claude". O hub nunca abre PTY por conta propria.
type PtyProc = {
  pid: number;
  write(d: string): void;
  kill(): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (c: number) => void): void;
  resize?(cols: number, rows: number): void;
};
export type PtyDriver = {
  spawn(opts: { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }): PtyProc;
};
let ptyAtual: PtyDriver | undefined;
export const ptyProcs = new Map<string, PtyProc>();   // id -> processo do `claude`
export const ptyBuffers = new Map<string, string>();  // id -> ultimas ~200KB de saida do PTY (GET /agentes/:id/pty)
export const aguardandoSet = new Set<string>();       // ids aguardando permissao (aguardando = ocupado na fila)
export const tamanhoPty = new Map<string, { cols: number; rows: number }>(); // id -> ultimo tamanho do xterm do card (reusado no retomar)
const LIMITE_BUFFER_PTY = 200 * 1024;          // ~200KB de buffer por agente

// Drivers injetados pelo iniciarAgentes (o app desktop passa os reais; sem opts, sobem os de verdade).
export let subirServeAtual: (cwd: string, env?: Record<string, string | undefined>) => Promise<{ base: string; pid: number }> = subirServeReal;
export let matarProcessoAtual: (pid: number) => void = (pid) => { try { process.kill(pid); } catch {} };

// system do prompt: instrucao do papel (com o <id> substituido) + linha do README de contexto +
// a identidade do agente (nome (id) + comando `canvas --eu id:token`, F3/S2).
function instrucaoDe(a: RegistroAgente): string {
  const comId = (a.instrucao ?? "").replace(/<id>/g, a.id).trim();
  const partes: string[] = [];
  if (comId) partes.push(comId);
  if (!/README\.md/.test(comId)) partes.push("Antes de responder, leia .orchestra/contexto/" + a.id + "/README.md se existir.");
  if (a.token) partes.push(linhaIdentidade(a.nome, a.id, a.token));
  return partes.join(" ");
}

// POST /session/<sessao>/prompt_async (best-effort); model/system opcionais.
async function enviarTexto(base: string, sessao: string, texto: string, sistema?: string, modelo?: unknown): Promise<void> {
  if (!base || !sessao) return;
  const corpo: Record<string, unknown> = { parts: [{ type: "text", text: texto }] };
  if (modelo) corpo.model = modelo;
  if (sistema) corpo.system = sistema;
  try {
    await fetch(`${base}/session/${sessao}/prompt_async`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo),
    });
  } catch {}
}

export async function enviarPrompt(a: RegistroAgente, texto: string): Promise<void> {
  // Agentes Claude Code (F4/S3): a entrega e' digitada no PTY (nao ha' OpenCode/sessao).
  if (a.tipo === "claude") { escreverPty(a.id, textoParaPty(texto)); return; }
  await enviarTexto(a.base, a.sessao, texto, instrucaoDe(a), separarModelo(a.modelo));
}

export function tentarLiberarAviso(id: string): void {
  const a = agentes.get(id);
  if (!a) return;
  const msg = fila.liberar(id, Date.now());
  if (msg) void enviarPrompt(a, msg);
}

// Escreve no PTY do agente (teclas do xterm ou texto de uma entrega); sem processo, ignora.
export function escreverPty(id: string, dados: string): void {
  const p = ptyProcs.get(id);
  if (!p) return;
  try { p.write(dados); } catch {}
}

// Mata o PTY do agente e descarta o buffer (usado no encerrar/reiniciar).
export function matarPty(id: string): void {
  const p = ptyProcs.get(id);
  if (p) { try { p.kill(); } catch {} }
  ptyProcs.delete(id);
  ptyBuffers.delete(id);
}

// Prompt de sistema do Claude: instrucao do papel (id substituido) + identidade + leitura do contexto.
function promptClaude(instrucao: string, id: string, nome: string, token: string): string {
  const comId = instrucao.replace(/<id>/g, id).trim();
  return [
    comId,
    linhaIdentidade(nome, id, token),
    `Antes de responder, leia .orchestra/contexto/${id}/README.md se existir.`,
  ].filter(Boolean).join(" ");
}

// Sobe o PTY do Claude: grava os hooks de status, monta os args e liga a saida ao SSE + buffer.
// Lanca se o driver de PTY nao estiver disponivel (sem app desktop) ou se o spawn falhar.
// `inicial` (G2): prompt inicial posicional do Claude (ex.: `/orchestra "<feature>"`), so' no primeiro start.
export function subirPtyClaude(a: RegistroAgente, continuar: boolean, inicial?: string): void {
  const settingsPath = path.join(AGENTES_DIR, a.id + ".settings.json");
  try {
    fs.mkdirSync(AGENTES_DIR, { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settingsHooks(a.id, a.token ?? "", process.execPath, path.join(RAIZ_BRIDGE, "bin", "canvas.mjs"))));
  } catch {}
  if (!ptyAtual) throw new Error("abra o app Dev Orchestra para usar agentes Claude");
  const prompt = promptClaude(a.instrucao ?? "", a.id, a.nome, a.token ?? "");
  const proc = ptyAtual.spawn({
    comando: "claude",
    args: argsClaude({ prompt, settingsPath, modelo: a.modelo, continuar, inicial }),
    cwd: a.cwd,
    env: {
      ...envClaude(),
      DEV_ORCHESTRA_EU: `${a.id}:${a.token}`, // um processo por agente: `canvas` ja' sai identificado
      // app Electron: o `node` do hook e' o exe do app; sem isso ele abriria uma nova janela do Dev Orchestra.
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    },
    cols: tamanhoPty.get(a.id)?.cols ?? 120,
    rows: tamanhoPty.get(a.id)?.rows ?? 32,
  });
  ptyProcs.set(a.id, proc);
  ptyBuffers.set(a.id, "");
  proc.onData((d) => {
    const atual = ptyBuffers.get(a.id) ?? "";
    const novo = atual + d;
    ptyBuffers.set(a.id, novo.length > LIMITE_BUFFER_PTY ? novo.slice(novo.length - LIMITE_BUFFER_PTY) : novo);
    broadcast({ pty: { id: a.id, dados: Buffer.from(d, "utf8").toString("base64") } });
  });
  proc.onExit(() => {
    ptyProcs.delete(a.id);
    const reg = agentes.get(a.id);
    if (!reg) return; // ja' encerrado/removido: nao ressuscita o registro
    reg.status = "encerrado";
    gravarAgente(reg);
    broadcast({ agentes: listarAgentes(reg.projeto) });
  });
}

// Cria um agente Claude: registro em disco, PTY e broadcast. Falha vira status 'falhou' (com a mensagem).
// `origem`/`inicial`: um agente pode nascer com origem propria e um prompt inicial (ex.: auto-contido).
export function criarAgenteClaude(projeto: string, cwd: string, papel: Papel, nome: string, modelo: string, instrucao: string, origem: OrigemAgente = "canvas", inicial?: string): { id: string; ok: boolean; erro: string } {
  const id = "ag-" + randomUUID().slice(0, 8);
  const reg: RegistroAgente = {
    id, projeto, cwd, base: "", sessao: "", nome, papel, modelo, instrucao,
    tipo: "claude", origem, token: novoToken(),
  };
  let erro = "";
  try { subirPtyClaude(reg, false, inicial); }
  catch (e: any) { erro = String(e?.message ?? e); reg.erro = erro; }
  gravarAgente(reg);
  broadcast({ agentes: listarAgentes(projeto) });
  return { id, ok: !erro, erro };
}

// ---- colaboracao entre agentes (F3/S2): identidade por token, conversas e fila de entregas ----
export const conversas = new Conversas();
export const filaEntregas = new FilaEntregas<string>();
const tokensPlanejadores = new Map<string, string>();  // "plan-<slug>" -> token
let expiracao: NodeJS.Timeout | null = null;           // varre as conversas pendentes a cada 60s

// Referencia de um agente para as rotas /cli (id + nome + contexto de entrega + token).
export type Colab = { id: string; nome: string; projeto: string; cwd: string; base: string; sessao: string; token: string };

// Contexto de colaboracao de um id: agente do canvas (registro em disco) ou planejador derivado.
export function colabDe(id: string): Colab | undefined {
  const a = agentes.get(id);
  if (a) return { id: a.id, nome: a.nome, projeto: a.projeto, cwd: a.cwd, base: a.base, sessao: a.sessao, token: a.token ?? "" };
  const tok = tokensPlanejadores.get(id);
  const p = planejadores.find((x) => "plan-" + x.slug === id);
  if (p && tok) { const ag = agenteDePlanejador(p); return { id, nome: ag.nome, projeto: ag.projeto, cwd: ag.cwd, base: ag.base, sessao: ag.sessao, token: tok }; }
  return undefined;
}

// X-Eu: "id:token" -> Colab so' se o token bater (senao undefined = identidade invalida).
export function colabDoToken(eu: string): Colab | undefined {
  const i = eu.indexOf(":");
  if (i <= 0 || i === eu.length - 1) return undefined;
  const id = eu.slice(0, i);
  const token = eu.slice(i + 1);
  const c = colabDe(id);
  return c && c.token === token ? c : undefined;
}

// Agentes do projeto do agente (id + nome), na ordem dos registros; alimenta conectados/resolverAlvo.
export function agentesRefProjeto(projeto: string): AgenteRef[] {
  const out: AgenteRef[] = [];
  for (const a of agentes.values()) if (a.projeto === projeto) out.push({ id: a.id, nome: a.nome });
  for (const p of planejadores) {
    if (p.raiz !== projeto && idProjeto(p.raiz) !== idProjeto(projeto)) continue;
    const ag = agenteDePlanejador(p);
    out.push({ id: ag.id, nome: ag.nome });
  }
  return out;
}

// Status de colaboracao: ocupado -> "trabalhando"; encerrado -> "encerrado"; resto -> "ocioso".
export function statusColab(id: string): string {
  const s = statusDe(id);
  if (s === "encerrado") return "encerrado";
  if (s === "ocupado") return "trabalhando";
  return "ocioso";
}

function estaOcupado(id: string): boolean { return fila.estados.get(id)?.ocupado === true; }

// /cli/status (F4/S3): os hooks do Claude marcam ocupado/ocioso/aguardando. 'aguardando' conta como
// ocupado na fila de entregas; 'ocioso' libera os avisos e as entregas pendentes.
export function marcarStatusAgente(id: string, estado: "ocupado" | "ocioso" | "aguardando"): void {
  if (estado === "ocioso") {
    fila.marcarOcioso(id);
    filaEntregas.marcarOcioso(id);
    aguardandoSet.delete(id);
    tentarLiberarAviso(id);
    tentarLiberarEntregas(id);
  } else {
    fila.marcarOcupado(id);
    filaEntregas.marcarOcupado(id);
    if (estado === "aguardando") aguardandoSet.add(id);
    else aguardandoSet.delete(id);
  }
  const a = agentes.get(id);
  if (a) broadcast({ agentes: listarAgentes(a.projeto) });
  else broadcastAgentes();
}

// Envia agora (ocioso) ou enfileira (ocupado). Devolve true se entregou na hora.
export async function entregarColab(id: string, texto: string): Promise<boolean> {
  if (estaOcupado(id)) { filaEntregas.enfileirar(id, texto); return false; }
  const a = agentes.get(id);
  if (a) { await enviarPrompt(a, texto); return true; }
  const c = colabDe(id);
  if (c) await enviarTexto(c.base, c.sessao, texto);
  return true;
}

// Alvo ficou ocioso: esvazia a fila de entregas dele.
export function tentarLiberarEntregas(id: string): void {
  const pend = filaEntregas.liberar(id);
  for (const texto of pend) void entregarColab(id, texto);
}

// {conversas:[{q,de,para,texto}]} em toda mudanca (ids de agentes).
export function broadcastConversas(): void {
  broadcast({ conversas: conversas.pendentes().map((p) => ({ q: p.q, de: p.de, para: p.para, texto: p.texto })) });
}

// Expiracao das perguntas pendentes: avisa a origem que o alvo nao respondeu.
function expirarConversas(): void {
  const expiradas = conversas.expirar();
  if (!expiradas.length) return;
  for (const p of expiradas) {
    const nomeAlvo = colabDe(p.para)?.nome ?? p.para;
    void entregarColab(p.de, fmtSemResposta(nomeAlvo, p.q));
  }
  broadcastConversas();
}

export function iniciarExpiracao(): void {
  if (expiracao) return;
  expiracao = setInterval(expirarConversas, 60_000);
  expiracao.unref?.();
}

export function pararExpiracao(): void { if (expiracao) { clearInterval(expiracao); expiracao = null; } }

// Planejadores: na primeira vez que sao vistos, ganham um token (AGENTES_DIR/<id>.json = {id,token})
// e recebem UMA vez a linha de identidade como mensagem.
function arquivoTokenPlanejador(id: string): string { return path.join(AGENTES_DIR, id + ".json"); }

export async function garantirTokenPlanejador(p: Planejador): Promise<void> {
  const id = "plan-" + p.slug;
  if (tokensPlanejadores.has(id)) return;
  try {
    const j = JSON.parse(fs.readFileSync(arquivoTokenPlanejador(id), "utf8"));
    if (j && j.id === id && typeof j.token === "string" && j.token.length >= 16) { tokensPlanejadores.set(id, j.token); return; }
  } catch {}
  const token = novoToken();
  tokensPlanejadores.set(id, token);
  try { fs.mkdirSync(AGENTES_DIR, { recursive: true }); fs.writeFileSync(arquivoTokenPlanejador(id), JSON.stringify({ id, token })); } catch {}
  const ag = agenteDePlanejador(p);
  await entregarColab(id, linhaIdentidade(ag.nome, id, token));
}

// ---- liga/desliga o estado dos agentes (o iniciarUI/pararUI chama isto) ----
export type OpcoesAgentes = {
  subirServe?: (cwd: string, env?: Record<string, string | undefined>) => Promise<{ base: string; pid: number }>; // sobe `opencode serve` na cwd (injetavel)
  matarProcesso?: (pid: number) => void; // encerra o serve (injetavel)
  pty?: PtyDriver; // driver de PTY (F4/S3): liga os agentes Claude Code; sem ele, POST /agentes tipo 'claude' falha
};

// O que o iniciarUI fazia com subirServeAtual/matarProcessoAtual/ptyAtual + carregarAgentes.
export function iniciarAgentes(opts: OpcoesAgentes = {}): void {
  subirServeAtual = opts.subirServe ?? subirServeReal;
  matarProcessoAtual = opts.matarProcesso ?? ((pid: number) => { try { process.kill(pid); } catch {} });
  ptyAtual = opts.pty; // F4/S3: sem driver, POST /agentes tipo 'claude' responde 'falhou'
  carregarAgentes();
}

// O que o pararUI fazia: varredura das conversas (expiracao), pontes do /event, serves do OpenCode,
// PTYs dos agentes Claude (processo + buffer) e o estado de 'aguardando' dos hooks.
export function pararAgentes(): void {
  pararExpiracao();
  for (const ctrl of pontes.values()) { try { ctrl.abort(); } catch {} }
  pontes.clear();
  serves.clear();
  for (const p of ptyProcs.values()) { try { p.kill(); } catch {} } // F4/S3: encerra os PTYs dos agentes Claude
  ptyProcs.clear();
  ptyBuffers.clear();
  ptyAtual = undefined;
  aguardandoSet.clear();
}

// ---- S4c do partir-ui: arvore, sessoes do OpenCode, contexto em disco e as rotas /agentes*, /arvore e
// /arquivo. Codigo movido LITERALMENTE do ui.ts (CA-7), sem mudanca de comportamento: os handlers do
// criarServidor viraram o `rotasAgentes` (true = tratou; o ui.ts so' chama e retorna no mesmo lugar). ----

// Arvore do worktree do agente: `git ls-files` + nao rastreados (exclui ignorados), barras '/', ate 5000.
function listarArvore(cwd: string): string[] {
  const opcoes = { cwd, encoding: "utf8" as const, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] as ("ignore" | "pipe")[] };
  const out = new Set<string>();
  try {
    for (const linha of execSync("git ls-files", opcoes).split(/\r?\n/)) if (linha.trim()) out.add(linha.trim().replace(/\\/g, "/"));
    for (const linha of execSync("git ls-files --others --exclude-standard", opcoes).split(/\r?\n/)) if (linha.trim()) out.add(linha.trim().replace(/\\/g, "/"));
  } catch {}
  return [...out].slice(0, 5000);
}

// Raiz absoluta de um projeto a partir de ?projeto=<raiz>: so' vale se idProjeto(<projeto>) bater com
// idProjeto(p.raiz) de algum item de mesclarProjetos(raizesDescobertas(), lerProjetosSalvos()); caso
// contrario undefined (o chamador responde 404). Grafias diferentes da mesma pasta casam pelo id.
function raizDeProjeto(projeto: string): string | undefined {
  const id = idProjeto(projeto);
  return mesclarProjetos(raizesDescobertas(), lerProjetosSalvos()).find((p) => idProjeto(p.raiz) === id)?.raiz;
}

async function criarSessao(base: string, nome: string): Promise<string | null> {
  try {
    const r = await fetch(base + "/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: nome }),
    });
    if (!r.ok) return null;
    const j: any = await r.json();
    return typeof j?.id === "string" && j.id ? j.id : null;
  } catch { return null; }
}

async function buscarHistorico(a: RegistroAgente): Promise<Linha[]> {
  if (!a.base || !a.sessao) return [];
  try {
    const r = await fetch(`${a.base}/session/${a.sessao}/message?limit=50`);
    if (!r.ok) return [];
    return historicoParaLinhas(await r.json());
  } catch { return []; }
}

async function abortarSessao(a: RegistroAgente): Promise<void> {
  if (!a.base || !a.sessao) return;
  try { await fetch(`${a.base}/session/${a.sessao}/abort`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}
}

// Encerra: apaga a sessao, remove o registro e mata o serve se nao sobrou nenhum agente no mesmo base.
async function encerrarAgente(a: RegistroAgente): Promise<void> {
  const base = a.base;
  if (base && a.sessao) {
    try { await fetch(`${base}/session/${a.sessao}`, { method: "DELETE" }); } catch {}
  }
  matarPty(a.id); // agente Claude: encerra o PTY antes de sumir com o registro
  removerAgenteDoDisco(a.id);
  if (base && ![...agentes.values()].some((x) => x.base === base)) {
    for (const [cwd, s] of serves) if (s.base === base) { if (s.pid > 0) matarProcessoAtual(s.pid); serves.delete(cwd); }
    fecharPonte(base);
  }
}

// ---- contexto em disco: <cwd>/.orchestra/contexto/<agenteId>/ (CA-9) ----
function hashDe(s: string): string { return createHash("sha1").update(s, "utf8").digest("hex"); }

function dirContexto(a: Agente): string { return path.join(a.cwd, ".orchestra", "contexto", a.id); }

function lerManifest(a: Agente): AssinaturaArquivo[] {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(dirContexto(a), ".manifest.json"), "utf8"));
    if (Array.isArray(j)) return j.filter((x: any) => x && typeof x.nome === "string" && typeof x.assinatura === "string");
  } catch {}
  return [];
}

function gravarManifest(a: Agente, as: AssinaturaArquivo[]): void {
  try { fs.writeFileSync(path.join(dirContexto(a), ".manifest.json"), JSON.stringify(as)); } catch {}
}

// Garante `.orchestra/` no <git common dir>/info/exclude (mesmo esquema do .claude/worktrees/).
// Exportada porque o /cli/browser-shot (rotasCli, neste mesmo modulo desde a S5) tambem precisa dela.
export function garantirExclude(cwd: string): void {
  try {
    const comum = execSync("git rev-parse --path-format=absolute --git-common-dir", { cwd, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (!comum) return;
    const info = path.join(comum, "info");
    const arq = path.join(info, "exclude");
    let atual = "";
    try { atual = fs.readFileSync(arq, "utf8"); } catch {}
    if (atual.split(/\r?\n/).includes(".orchestra/")) return;
    fs.mkdirSync(info, { recursive: true });
    fs.appendFileSync(arq, (atual && !atual.endsWith("\n") ? "\n" : "") + ".orchestra/\n");
  } catch {}
}

// Caminho local da imagem referenciada por /canvas/asset/<idProjeto>/<arquivo>.
function assetLocal(url: string): string | null {
  const marca = "/canvas/asset/";
  const i = url.indexOf(marca);
  if (i < 0) return null;
  const partes = url.slice(i + marca.length).split(/[?#]/)[0].split("/").filter(Boolean);
  if (partes.length < 2) return null;
  const arquivo = partes.pop() as string;
  const id = partes.join("/");
  if (!/^[0-9a-f]+$/i.test(id) || arquivo.includes("..")) return null;
  return path.join(CANVAS_DIR, id, "assets", arquivo);
}

// Apos cada /canvas/op: sincroniza o contexto dos nos 'agente' e enfileira os avisos.
// O canvas-hub avisa por gancho (definirGanchosCanvas) que continua sendo ligado no ui.ts.
export function sincronizarContexto(snap: Snapshot): void {
  for (const no of snap.nos) {
    if (no.tipo !== "agente") continue;
    const aid = typeof no.dados.agenteId === "string" ? no.dados.agenteId : "";
    const a = aid ? agentes.get(aid) : undefined;
    if (!a || !a.cwd) continue;
    const plano = planoArquivos(itensDeContexto(snap, no.id));
    const atual: AssinaturaArquivo[] = [{ nome: "README.md", assinatura: hashDe(plano.readme) }];
    for (const f of plano.arquivos) {
      atual.push({ nome: f.nome, assinatura: f.conteudo !== undefined ? hashDe(f.conteudo) : "url:" + (f.url ?? "") });
    }
    const anterior = ctxAssinaturas.get(aid) ?? lerManifest(a);
    const d = diffContexto(atual, anterior);
    const dir = dirContexto(a);
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    garantirExclude(a.cwd);
    for (const nome of d.remover) { try { fs.unlinkSync(path.join(dir, nome)); } catch {} }
    for (const nome of d.gravar) {
      const alvo = path.join(dir, nome);
      if (nome === "README.md") { try { fs.writeFileSync(alvo, plano.readme); } catch {} continue; }
      const f = plano.arquivos.find((x) => x.nome === nome);
      if (!f) continue;
      if (f.conteudo !== undefined) { try { fs.writeFileSync(alvo, f.conteudo); } catch {} }
      else if (f.url) {
        const local = assetLocal(f.url);
        if (local) { try { fs.copyFileSync(local, alvo); } catch {} }
      }
    }
    gravarManifest(a, atual);
    ctxAssinaturas.set(aid, atual);
    // README.md NAO entra nos nomes do aviso: mudanca so do README (ou sem itens) nao avisa.
    const nomes = [...d.gravar, ...d.remover].filter((n) => n !== "README.md");
    if (nomes.length) { fila.adicionar(aid, nomes); tentarLiberarAviso(aid); }
  }
}

const LIMITE_BODY = 64 * 1024; // 64KB: teto padrao dos demais POSTs; acima disso e' abuso -> 400

// Rotas /agentes*, /arvore e /arquivo do criarServidor: true = tratou (respondeu). O ui.ts so' chama e
// retorna no mesmo lugar, como faz com o rotasCanvas.
export async function rotasAgentes(req: IncomingMessage, res: ServerResponse, caminho: string, url: string): Promise<boolean> {
  if (caminho === "/agentes/modelos") {
    const cwd = new URL(url, "http://x").searchParams.get("cwd") || "";
    // Sem serve na pasta pedida o dialog ficaria sem modelos; usa um serve/planejador conhecido
    // (a lista de providers do OpenCode e' da conta, nao da pasta).
    const base = baseParaModelos(cwd);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(base ? await listarModelos(base) : []));
    return true;
  }
  if (caminho === "/agentes" && req.method === "GET") {
    const projeto = new URL(url, "http://x").searchParams.get("projeto") || "";
    if (!projeto) { res.writeHead(400); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listarAgentes(projeto)));
    return true;
  }
  if (caminho === "/agentes") {
    // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
    const corpo = await lerCorpo(req, LIMITE_BODY);
    if (corpo === null) { res.writeHead(400); res.end(); return true; }
    if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
    let j: any = null;
    try { j = JSON.parse(corpo); } catch {}
    const projeto = j && typeof j.projeto === "string" ? j.projeto.trim() : "";
    const cwd = j && typeof j.cwd === "string" ? j.cwd.trim() : "";
    const papel = j && typeof j.papel === "string" ? j.papel : "";
    if (!projeto || !cwd || !Object.prototype.hasOwnProperty.call(PAPEIS, papel)) { res.writeHead(400); res.end(); return true; }
    const def = PAPEIS[papel as Papel];
    const nome = j && typeof j.nome === "string" && j.nome.trim() ? j.nome.trim() : def.nome;
    const instrucao = j && typeof j.instrucao === "string" ? j.instrucao : def.instrucao;
    // Agentes Claude Code (F4/S3): PTY gerenciado pelo app desktop, sem OpenCode/ponte.
    if (j && j.tipo === "claude") {
      const modelo = j && typeof j.modelo === "string" ? j.modelo.trim() : "";
      const r = criarAgenteClaude(projeto, cwd, papel as Papel, nome, modelo, instrucao);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(r.ok ? { id: r.id, status: "ok" } : { id: r.id, status: "falhou", erro: r.erro }));
      return true;
    }
    const id = "ag-" + randomUUID().slice(0, 8);
    const modelo = (j && typeof j.modelo === "string" ? j.modelo.trim() : "") || "opencode-go/glm-5.2";
    let serve = serves.get(cwd);
    let erro = "";
    if (!serve) {
      // Reaproveita o serve de um agente vivo do MESMO cwd (ex.: registros lidos do disco apos restart).
      for (const a of agentes.values()) if (a.cwd === cwd && a.base && !a.erro) { serve = { base: a.base, pid: 0 }; break; }
      if (serve) serves.set(cwd, serve);
    }
    if (!serve) {
      try { serve = await subirServeAtual(cwd, envServe()); serves.set(cwd, serve); }
      catch (e: any) { erro = String(e?.message ?? e); }
    }
    if (serve) abrirPonte(serve.base);
    let sessao = "";
    if (serve) {
      const s = await criarSessao(serve.base, nome);
      if (s) sessao = s;
      else if (!erro) erro = "nao foi possivel criar a sessao no OpenCode";
    }
    const ok = !!(serve && sessao);
    const reg: RegistroAgente = {
      id, projeto, cwd, base: serve ? serve.base : "", sessao, nome,
      papel: papel as Papel, modelo, instrucao, tipo: "opencode", origem: "canvas",
      token: novoToken(),
    };
    if (!ok) reg.erro = erro || "falha ao subir o OpenCode";
    gravarAgente(reg);
    broadcast({ agentes: listarAgentes(projeto) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(ok ? { id, status: "ok" } : { id, status: "falhou", erro: reg.erro }));
    return true;
  }
  if (caminho.startsWith("/agentes/")) {
    const partes = caminho.slice("/agentes/".length).split("/");
    let id = partes[0] || "";
    try { id = decodeURIComponent(id); } catch {}
    const acao = partes[1] || "";
    if (acao === "historico" && req.method === "GET") {
      const a = agentes.get(id);
      if (!a) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(await buscarHistorico(a)));
      return true;
    }
    if (acao === "pty" && req.method === "GET") {
      // Ultimas ~200KB de saida do PTY do agente Claude (base64), para reidratar o terminal na UI.
      const a = agentes.get(id);
      if (!a) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id, dados: Buffer.from(ptyBuffers.get(id) ?? "", "utf8").toString("base64") }));
      return true;
    }
    if (req.method === "POST") {
      // Drena o corpo ANTES de responder 400 (mesmo motivo de /canvas/op).
      const corpo = await lerCorpo(req, LIMITE_BODY);
      if (corpo === null) { res.writeHead(400); res.end(); return true; }
      if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
      const a = agentes.get(id);
      if (!a) { res.writeHead(404); res.end(); return true; }
      let j: any = null;
      try { j = JSON.parse(corpo); } catch {}
      if (acao === "teclas") {
        // Teclas do xterm (F4/S3): digitadas cruas no PTY do agente Claude.
        const dados = j && typeof j.dados === "string" ? j.dados : "";
        if (!dados) { res.writeHead(400); res.end(); return true; }
        escreverPty(a.id, dados);
        res.writeHead(204); res.end(); return true;
      }
      if (acao === "tamanho") {
        // Tamanho do xterm do card (fit): o PTY precisa saber, senao o claude quebra linhas na largura errada.
        const cols = Math.trunc(Number(j?.cols)), rows = Math.trunc(Number(j?.rows));
        if (!(cols >= 10 && cols <= 500 && rows >= 4 && rows <= 300)) { res.writeHead(400); res.end(); return true; }
        tamanhoPty.set(a.id, { cols, rows });
        ptyProcs.get(a.id)?.resize?.(cols, rows);
        res.writeHead(204); res.end(); return true;
      }
      if (acao === "mensagem") {
        const texto = j && typeof j.texto === "string" ? j.texto : "";
        if (!texto) { res.writeHead(400); res.end(); return true; }
        await enviarPrompt(a, texto);
        res.writeHead(204); res.end(); return true;
      }
      if (acao === "modelo") {
        const modelo = j && typeof j.modelo === "string" ? j.modelo.trim() : "";
        if (!modelo) { res.writeHead(400); res.end(); return true; }
        a.modelo = modelo;
        gravarAgente(a);
        res.writeHead(204); res.end(); return true;
      }
      if (acao === "abortar") { await abortarSessao(a); res.writeHead(204); res.end(); return true; }
      if (acao === "encerrar") {
        // Encerra as conversas do agente: quem perguntou a ele recebe o aviso de "sem resposta".
        const pendentes = conversas.encerrarAgente(id);
        for (const p of pendentes) void entregarColab(p.de, fmtSemResposta(a.nome, p.q));
        await encerrarAgente(a);
        if (pendentes.length) broadcastConversas();
        res.writeHead(204); res.end(); return true;
      }
      if (acao === "reiniciar") {
        // Agente Claude (F4/S3): retoma a conversa no PTY (--continue), sem OpenCode/ponte.
        if (a.tipo === "claude") {
          try {
            matarPty(a.id);
            delete a.erro;
            subirPtyClaude(a, true);
            a.status = "ok";
            gravarAgente(a);
            broadcast({ agentes: listarAgentes(a.projeto) });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: a.id, status: "ok" }));
          } catch (e: any) {
            const motivo = String(e?.message ?? e);
            a.erro = motivo;
            gravarAgente(a);
            broadcast({ agentes: listarAgentes(a.projeto) });
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ id: a.id, status: "falhou", erro: motivo }));
          }
          return true;
        }
        // Reabre a sessao do agente: reaproveita um serve VIVO da mesma cwd (o serve destacado
        // sobrevive ao hub) ou sobe um novo com subirServe(cwd), cria uma sessao limpa e reabre a
        // ponte do /event. Sucesso -> 200 {id,status:'ok'}; falha ao subir -> 200 {id,status:'falhou',erro}.
        let serve = serves.get(a.cwd);
        if (serve && !(await serveVivo(serve.base))) { serves.delete(a.cwd); serve = undefined; }
        if (!serve) {
          for (const x of agentes.values()) {
            if (x.id === a.id || x.cwd !== a.cwd || !x.base || x.erro) continue;
            if (await serveVivo(x.base)) { serve = { base: x.base, pid: x.pid ?? 0 }; break; }
          }
          if (serve) serves.set(a.cwd, serve);
        }
        let erro = "";
        if (!serve) {
          try { serve = await subirServeAtual(a.cwd, envServe()); serves.set(a.cwd, serve); }
          catch (e: any) { erro = String(e?.message ?? e); }
        }
        let sessao = "";
        if (serve) {
          const s = await criarSessao(serve.base, a.nome);
          if (s) sessao = s;
          else if (!erro) erro = "nao foi possivel criar a sessao no OpenCode";
        }
        if (serve && sessao) {
          a.base = serve.base; a.sessao = sessao; a.pid = serve.pid;
          delete a.erro; a.status = "ok";
          gravarAgente(a);              // registro atualizado em disco (base, pid, sessao, status)
          agenteLinhas.set(a.id, []);   // sessao nova: zera o chat em memoria
          basesMortas.delete(serve.base);
          abrirPonte(serve.base);       // reabre a ponte do /event da base
          broadcast({ agenteLinhas: { id: a.id, linhas: [] } });
          broadcast({ agentes: listarAgentes(a.projeto) });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ id: a.id, status: "ok" }));
          return true;
        }
        const motivo = erro || "falha ao reiniciar o OpenCode";
        a.erro = motivo;
        gravarAgente(a);
        broadcast({ agentes: listarAgentes(a.projeto) });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: a.id, status: "falhou", erro: motivo }));
        return true;
      }
      res.writeHead(404); res.end(); return true;
    }
    res.writeHead(404); res.end(); return true;
  }
  // ---- arvore e preview de arquivo do agente (F3/S2) ----
  if (caminho === "/arvore") {
    const params = new URL(url, "http://x").searchParams;
    const c = colabDe(params.get("agente") || "");
    // ./agente (comportamento de sempre) ou, na falta dele, ?projeto=<raiz> conhecido.
    const cwd = c?.cwd ?? (params.get("projeto") ? raizDeProjeto(params.get("projeto") as string) : undefined);
    if (!cwd) { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(listarArvore(cwd)));
    return true;
  }
  if (caminho === "/arquivo") {
    const params = new URL(url, "http://x").searchParams;
    const c = colabDe(params.get("agente") || "");
    // ./agente (comportamento de sempre) ou, na falta dele, ?projeto=<raiz> conhecido.
    const cwd = c?.cwd ?? (params.get("projeto") ? raizDeProjeto(params.get("projeto") as string) : undefined);
    if (!cwd) { res.writeHead(404); res.end(); return true; }
    const limpo = validarCaminho(cwd, params.get("caminho") || "");
    if (!limpo) { res.writeHead(400); res.end(); return true; }
    const raiz = path.resolve(cwd);
    const alvo = path.resolve(raiz, limpo);
    if (alvo !== raiz && !alvo.startsWith(raiz + path.sep)) { res.writeHead(400); res.end(); return true; }
    let st: fs.Stats;
    try { st = fs.statSync(alvo); } catch { res.writeHead(404); res.end(); return true; }
    if (!st.isFile()) { res.writeHead(404); res.end(); return true; }
    if (st.size > 200 * 1024) { res.writeHead(413); res.end(); return true; }
    let buf: Buffer;
    try { buf = fs.readFileSync(alvo); } catch { res.writeHead(404); res.end(); return true; }
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(buf);
    return true;
  }
  return false;
}

// ---- S5 do partir-ui: as rotas /cli/* do criarServidor viram o rotasCli (true = tratou; o ui.ts so'
// chama e retorna no mesmo lugar, como faz com o rotasAgentes/rotasCanvas). Codigo movido LITERALMENTE
// do ui.ts (CA-7), sem mudanca de comportamento: cada `return;` interno virou `return true;`.
// ---- CLI dos agentes (F3/S2): POST /cli/<cmd> com X-Dev-Orchestra e X-Eu: id:token ----
export async function rotasCli(req: IncomingMessage, res: ServerResponse, caminho: string, url: string): Promise<boolean> {
  if (!caminho.startsWith("/cli/")) return false;
  const corpo = await lerCorpo(req, LIMITE_BODY);
  if (corpo === null) { res.writeHead(400); res.end(); return true; }
  if (!acaoValida(req)) { res.writeHead(400); res.end(); return true; }
  const c = colabDoToken(String(req.headers["x-eu"] ?? ""));
  if (!c) { responderTexto(res, 403, "identidade inválida"); return true; }
  let j: any = null;
  try { j = corpo ? JSON.parse(corpo) : null; } catch {}
  const cmd = caminho.slice("/cli/".length);
  const snap = lerCanvas(idProjeto(c.projeto));
  const noAg = snap.nos.find((n) => n.id === "ag:" + c.id);
  // No' do agente no canvas do projeto; se nao existir, uma posicao padrao.
  const agNo: No = noAg ?? { id: "ag:" + c.id, tipo: "agente", x: 0, y: 0, w: 620, h: 420, dados: { agenteId: c.id }, rev: 0 };
  const refs = () => conectados(snap, c.id, agentesRefProjeto(c.projeto));
  const alvoDe = (bruto: unknown): { ok: AgenteRef } | { erro: string } => {
    const alvo = typeof bruto === "string" ? bruto : "";
    if (!alvo) return { erro: "alvo obrigatório" };
    return resolverAlvo(refs(), alvo);
  };
  if (cmd === "status") {
    // Hooks do Claude Code (F4/S3) marcam o estado do agente; estado invalido -> 400.
    const estado = typeof j?.estado === "string" ? j.estado : "";
    if (estado !== "ocupado" && estado !== "ocioso" && estado !== "aguardando") { responderTexto(res, 400, "estado inválido"); return true; }
    marcarStatusAgente(c.id, estado);
    responderTexto(res, 200, "status atualizado");
    return true;
  }
  if (cmd === "list") {
    const lista = refs();
    responderTexto(res, 200, lista.length ? lista.map((a) => `${slugNome(a.nome)} (${a.id}) — ${a.nome}, ${statusColab(a.id)}`).join("\n") : "nenhum agente conectado a você");
    return true;
  }
  if (cmd === "ask") {
    const alvo = alvoDe(j?.alvo);
    if ("erro" in alvo) { responderTexto(res, 400, alvo.erro); return true; }
    const texto = typeof j?.texto === "string" ? j.texto : "";
    const r = conversas.perguntar(c.id, alvo.ok.id, texto);
    if ("erro" in r) { responderTexto(res, 400, r.erro); return true; }
    const entregue = await entregarColab(alvo.ok.id, fmtPergunta(c.nome, r.ok.q, texto));
    broadcastConversas();
    responderTexto(res, 200, entregue ? `pergunta ${r.ok.q} enviada a ${alvo.ok.nome}` : `pergunta ${r.ok.q} enfileirada (${alvo.ok.nome} ocupado)`);
    return true;
  }
  if (cmd === "tell") {
    const alvo = alvoDe(j?.alvo);
    if ("erro" in alvo) { responderTexto(res, 400, alvo.erro); return true; }
    const texto = typeof j?.texto === "string" ? j.texto : "";
    const entregue = await entregarColab(alvo.ok.id, fmtMensagem(c.nome, texto));
    responderTexto(res, 200, entregue ? `mensagem enviada a ${alvo.ok.nome}` : `mensagem enfileirada (${alvo.ok.nome} ocupado)`);
    return true;
  }
  if (cmd === "reply") {
    const q = typeof j?.q === "string" ? j.q : "";
    const texto = typeof j?.texto === "string" ? j.texto : "";
    const r = conversas.responder(c.id, q);
    if ("erro" in r) { responderTexto(res, 400, r.erro); return true; }
    await entregarColab(r.ok.de, fmtResposta(c.nome, r.ok.q, texto));
    broadcastConversas();
    responderTexto(res, 200, `resposta enviada a ${colabDe(r.ok.de)?.nome ?? r.ok.de}`);
    return true;
  }
  if (cmd === "flow-add") {
    const r = opsFlowAdd(snap, agNo, c.nome, String(j?.chave ?? ""), String(j?.forma ?? ""), String(j?.texto ?? ""), typeof j?.cor === "string" ? j.cor : undefined, Date.now());
    if ("erro" in r) { responderTexto(res, 400, r.erro); return true; }
    aplicarOpsProjeto(c.projeto, r.ops);
    responderTexto(res, 200, "fluxo atualizado");
    return true;
  }
  if (cmd === "flow-link") {
    const r = opsFlowLink(snap, c.id, String(j?.a ?? ""), String(j?.b ?? ""), typeof j?.rotulo === "string" ? j.rotulo : undefined, Date.now());
    if ("erro" in r) { responderTexto(res, 400, r.erro); return true; }
    aplicarOpsProjeto(c.projeto, r.ops);
    responderTexto(res, 200, "fluxo atualizado");
    return true;
  }
  if (cmd === "file") {
    const limpo = validarCaminho(c.cwd, typeof j?.caminho === "string" ? j.caminho : "");
    if (!limpo) { responderTexto(res, 400, "caminho inválido"); return true; }
    aplicarOpsProjeto(c.projeto, opsFile(snap, agNo, limpo, typeof j?.status === "string" ? j.status : "", Date.now()));
    responderTexto(res, 200, "arquivo atualizado");
    return true;
  }
  if (cmd === "note") {
    aplicarOpsProjeto(c.projeto, opsNote(snap, agNo, typeof j?.titulo === "string" ? j.titulo : "", typeof j?.corpo === "string" ? j.corpo : "", Date.now()));
    responderTexto(res, 200, "nota atualizada");
    return true;
  }
  // ---- navegador (F4/S2): create/read/click/type/nav/shot ----
  if (cmd.startsWith("browser-")) {
    const drv = obterNavegador();
    if (!drv) { responderTexto(res, 400, "navegador indisponível: abra o app Dev Orchestra"); return true; }
    try { // erro do driver (webview fechada, pagina carregando...) vira 400, nunca request pendurada
    if (cmd === "browser-create") {
      const nome = typeof j?.nome === "string" ? j.nome.trim() : "";
      const url = typeof j?.url === "string" ? j.url : "";
      if (!nome) { responderTexto(res, 400, "nome obrigatório"); return true; }
      if (!urlPermitida(url)) { responderTexto(res, 400, "url inválida"); return true; }
      // no' `nav:<slugNome(nome)>`, com sufixo -2, -3... se o id ja existir no projeto.
      const base = "nav:" + slugNome(nome);
      let noId = base;
      let k = 1;
      while (snap.nos.some((n) => n.id === noId)) { k++; noId = base + "-" + k; }
      const agora = Date.now();
      const navNo: No = { id: noId, tipo: "navegador", x: agNo.x + agNo.w + 40, y: agNo.y, w: 900, h: 620, dados: { nome, url, criador: c.id }, rev: agora };
      const aresta: Aresta = { id: `${agNo.id}->${noId}`, de: agNo.id, para: noId, rev: agora };
      aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: navNo }, { op: "upsert", tipo: "aresta", item: aresta }]);
      responderTexto(res, 200, `navegador ${nome} aberto (${noId})`);
      return true;
    }
    if (cmd === "browser-read") {
      const nav = resolverNavegador(snap, c.id, j?.nav);
      if ("erro" in nav) { responderTexto(res, 400, nav.erro); return true; }
      const l = await lerNavegador(c.projeto, nav.ok.id);
      responderTexto(res, 200, formatarLeitura(l));
      return true;
    }
    if (cmd === "browser-click" || cmd === "browser-type") {
      const nav = resolverNavegador(snap, c.id, j?.nav);
      if ("erro" in nav) { responderTexto(res, 400, nav.erro); return true; }
      const alvo = typeof j?.alvo === "string" ? j.alvo : "";
      if (!alvo) { responderTexto(res, 400, "alvo obrigatório"); return true; }
      const els = await elementosDoNavegador(c.projeto, nav.ok.id);
      const el = resolverElemento(els, alvo);
      if ("erro" in el) { responderTexto(res, 400, el.erro); return true; }
      if (cmd === "browser-click") {
        await drv.clicar(nav.ok.id, el.ok.n);
        responderTexto(res, 200, `clique em [${el.ok.n}] ${el.ok.papel} "${el.ok.rotulo}"`);
      } else {
        const valor = typeof j?.valor === "string" ? j.valor : "";
        const enter = j?.enter === true;
        await drv.digitar(nav.ok.id, el.ok.n, valor, enter);
        responderTexto(res, 200, `digitação em [${el.ok.n}] ${el.ok.papel} "${el.ok.rotulo}"`);
      }
      return true;
    }
    if (cmd === "browser-nav") {
      const nav = resolverNavegador(snap, c.id, j?.nav);
      if ("erro" in nav) { responderTexto(res, 400, nav.erro); return true; }
      const acao = typeof j?.acao === "string" ? j.acao : "";
      const ehControle = acao === "back" || acao === "forward" || acao === "reload";
      if (!ehControle && !urlPermitida(acao)) { responderTexto(res, 400, "ação inválida"); return true; }
      await drv.navegar(nav.ok.id, acao);
      if (!ehControle) {
        // url nova: atualiza dados.url do no (back/forward/reload nao revelam a url resultante).
        const no = snap.nos.find((n) => n.id === nav.ok.id);
        if (no) aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: { ...no, dados: { ...no.dados, url: acao }, rev: Date.now() } }]);
      }
      responderTexto(res, 200, "navegador navegou");
      return true;
    }
    if (cmd === "browser-shot") {
      const nav = resolverNavegador(snap, c.id, j?.nav);
      if ("erro" in nav) { responderTexto(res, 400, nav.erro); return true; }
      const png = await drv.capturar(nav.ok.id);
      const nome = String(nav.ok.dados.nome ?? "");
      garantirExclude(c.cwd); // .orchestra/ no info/exclude do repo do agente
      const dir = path.join(c.cwd, ".orchestra", "shots");
      try { fs.mkdirSync(dir, { recursive: true }); } catch {}
      const destino = path.join(dir, nomeShot(nome, new Date()));
      try { fs.writeFileSync(destino, png); } catch {}
      // asset do canvas + no' imagem ligado ao navegador
      const id = idProjeto(c.projeto);
      const arq = randomUUID() + ".png";
      let url = "";
      try {
        fs.mkdirSync(path.join(CANVAS_DIR, id, "assets"), { recursive: true });
        fs.writeFileSync(path.join(CANVAS_DIR, id, "assets", arq), png);
        url = `/canvas/asset/${id}/${arq}`;
      } catch {}
      if (url) {
        const agora = Date.now();
        const imgId = `img:${nav.ok.id}:${agora}`;
        const imgNo: No = { id: imgId, tipo: "imagem", x: nav.ok.x + nav.ok.w + 40, y: nav.ok.y, w: 480, h: 360, dados: { url, nome }, rev: agora };
        const aresta: Aresta = { id: `${nav.ok.id}->${imgId}`, de: nav.ok.id, para: imgId, rev: agora };
        aplicarOpsProjeto(c.projeto, [{ op: "upsert", tipo: "no", item: imgNo }, { op: "upsert", tipo: "aresta", item: aresta }]);
      }
      responderTexto(res, 200, `captura de ${nome} salva\n${destino}`);
      return true;
    }
    } catch (e) { responderTexto(res, 400, (e as Error)?.message ?? String(e)); return true; }
    responderTexto(res, 400, "comando desconhecido: " + cmd);
    return true;
  }
  responderTexto(res, 400, "comando desconhecido: " + cmd);
  return true;
}
