// Electron main (F4 S5): janela do app Dev Orchestra, ponte do preload e protecao das webviews.
// Compilado pra dist-desktop/ (ESM: o package.json do repo e' "type": "module").
import { app, BrowserWindow, dialog, type Session, type WebContents } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarDriverCDP } from "./cdp.js";
import { criarDriverPty } from "./pty.js";

// dist-desktop/ (onde este arquivo compila) e o repo (pai de dist-desktop, ou DEV_ORCHESTRA_REPO).
const DIR_DESKTOP = path.dirname(fileURLToPath(import.meta.url));
// Empacotado, o pai de dist-desktop e' o app.asar: roda do app instalado (~/.dev-orchestra/app), igual ao MCP.
let REPO = process.env.DEV_ORCHESTRA_REPO || (app.isPackaged ? path.join(os.homedir(), ".dev-orchestra", "app") : path.resolve(DIR_DESKTOP, ".."));
const PORTA = process.env.DEV_ORCHESTRA_UI_PORT || "4123";

// Drives injetados no hub (dist/ui.js -> iniciarUI): navegador por CDP e PTY dos agentes Claude.
let navegador: ReturnType<typeof criarDriverCDP>; // criado depois do resolverRepo (precisa do repo)
let pty: ReturnType<typeof criarDriverPty>; // criado depois do resolverRepo (precisa do repo)

let janela: BrowserWindow | null = null;
let focarAoCriar = false; // 2a instancia chegou antes da janela existir

// Log do app instalado (sem console): %TEMP%/dev-orchestra-desktop.log, rotaciona em ~1MB.
const ARQ_LOG = path.join(os.tmpdir(), "dev-orchestra-desktop.log");
function log(msg: string): void {
  try {
    if (fs.existsSync(ARQ_LOG) && fs.statSync(ARQ_LOG).size > 1024 * 1024) fs.renameSync(ARQ_LOG, ARQ_LOG + ".1");
    fs.appendFileSync(ARQ_LOG, new Date().toISOString() + " " + msg + "\n");
  } catch {}
}
let encerrando = false;
let ui: any = null; // modulo dist/ui.js (para chamar pararUI antes de sair)

// Sessoes ja' observadas (uma unica vez cada) para cancelar downloads das webviews.
const sessoesComDownload = new WeakSet<Session>();

// Sobe o hub (dist/ui.js) na porta da UI, assumindo a porta de qualquer hub Dev Orchestra anterior.
// Sem dist/ui.js no repo/local: o app nao tem o que rodar; avisa e sai (o usuario instala pelo npx).
async function resolverRepo(): Promise<boolean> {
  if (fs.existsSync(path.join(REPO, "dist", "ui.js"))) return true;
  log("dist/ui.js ausente em: " + REPO);
  dialog.showErrorBox("Dev Orchestra", "App do Dev Orchestra não encontrado. Rode npx github:daKires/dev-orchestra para instalar.");
  return false;
}

async function subirHub(): Promise<void> {
  navegador = criarDriverCDP(REPO);
  pty = criarDriverPty(REPO);
  // O resolverClaude (dist/claude-pty.js) precisa estar carregado antes de qualquer spawn (sincrono).
  await pty.carregar();
  ui = await import(pathToFileURL(path.join(REPO, "dist", "ui.js")).href);
  await ui.iniciarUI({ sempreAssumir: true, navegador, pty });
}

// So' http(s) pode navegar dentro das webviews (bloqueia file:, data:, etc.).
function ehHttp(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

// Regras de seguranca das webviews: sem novos processos/renderers e sem downloads.
function protegerWebview(contents: WebContents): void {
  // window.open / target=_blank: abre na MESMA webview.
  contents.setWindowOpenHandler(({ url }) => {
    if (ehHttp(url)) void contents.loadURL(url).catch(() => {});
    return { action: "deny" };
  });
  // Navegacao so' http/https.
  contents.on("will-navigate", (event, url) => {
    if (!ehHttp(url)) event.preventDefault();
  });
  // Downloads das webviews sao sempre cancelados (uma vez por sessao).
  const s = contents.session;
  if (!sessoesComDownload.has(s)) {
    sessoesComDownload.add(s);
    s.on("will-download", (event) => { event.preventDefault(); });
  }
}

// Cria a janela principal (1400x900, fundo #111111) e carrega o dashboard local.
async function criarJanela(): Promise<void> {
  janela = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: "#111111",
    webPreferences: {
      preload: path.join(DIR_DESKTOP, "preload.cjs"),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'will-attach-webview': toda webview nasce sem node e sem preload; so' particoes persist:dev-orchestra-.
  janela.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    delete webPreferences.preload;
    const particao = String((params as Record<string, string>).partition ?? "");
    if (!particao.startsWith("persist:dev-orchestra-")) event.preventDefault();
  });
  // Fechar a janela = sair do app.
  janela.on("closed", () => {
    janela = null;
    if (!encerrando) app.quit();
  });
  await janela.loadURL(`http://127.0.0.1:${PORTA}`);
  if (focarAoCriar) focarJanela();
}

// Segunda instancia: foca a janela ja' aberta em vez de abrir outra.
// O Windows bloqueia focus() vindo de processo em segundo plano (so' pisca na barra): o topo
// temporario resolve na maioria dos casos; se ainda nao focou, minimizar+restaurar ativa a janela.
function focarJanela(): void {
  if (!janela) { focarAoCriar = true; return; }
  focarAoCriar = false;
  if (janela.isMinimized()) janela.restore();
  janela.show();
  janela.setAlwaysOnTop(true);
  janela.focus();
  janela.setAlwaysOnTop(false);
  // focus() e' assincrono: so' confere depois de um instante (senao o fallback piscaria sempre).
  setTimeout(() => {
    if (!janela) return;
    if (!janela.isFocused()) { janela.minimize(); janela.restore(); janela.focus(); }
    setTimeout(() => log("foco: " + (janela?.isFocused() ? "ok" : "falhou")), 150);
  }, 150);
}

// Instancia unica: a segunda invocacao sai (e foca a janela da primeira).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    log("second-instance");
    focarJanela();
    void ui?.assumirPorta?.().catch((e: Error) => log("assumirPorta: " + e.message));
  });
  // Antes de sair: para o hub (fecha o servidor/watcher/PTYs).
  app.on("before-quit", () => {
    encerrando = true;
    try { ui?.pararUI?.(); } catch {}
  });
  app.on("window-all-closed", () => app.quit());
  app.on("web-contents-created", (_ev, contents) => {
    if (contents.getType() === "webview") protegerWebview(contents);
  });
  app.whenReady().then(async () => {
    log("inicio (repo: " + (REPO || "?") + ")");
    try {
      if (!(await resolverRepo())) { app.quit(); return; }
      await subirHub();
      await criarJanela();
    } catch (e) {
      // Hub/janela indisponivel: nao deixa o app pendurado.
      log("falha ao iniciar: " + String((e as Error)?.message ?? e));
      process.stderr.write("[dev-orchestra-desktop] falha ao iniciar: " + String((e as Error)?.message ?? e) + "\n");
      app.quit();
    }
  });
}
