// Electron main (F4 S5): janela do app Hermes, ponte do preload e protecao das webviews.
// Compilado pra dist-desktop/ (ESM: o package.json do repo e' "type": "module").
import { app, BrowserWindow, type Session, type WebContents } from "electron";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarDriverCDP } from "./cdp.js";
import { criarDriverPty } from "./pty.js";

// dist-desktop/ (onde este arquivo compila) e o repo (pai de dist-desktop, ou HERMES_REPO).
const DIR_DESKTOP = path.dirname(fileURLToPath(import.meta.url));
const REPO = process.env.HERMES_REPO || path.resolve(DIR_DESKTOP, "..");
const PORTA = process.env.HERMES_UI_PORT || "4123";

// Drives injetados no hub (dist/ui.js -> iniciarUI): navegador por CDP e PTY dos agentes Claude.
const navegador = criarDriverCDP(REPO);
const pty = criarDriverPty();

let janela: BrowserWindow | null = null;
let encerrando = false;
let ui: any = null; // modulo dist/ui.js (para chamar pararUI antes de sair)

// Sessoes ja' observadas (uma unica vez cada) para cancelar downloads das webviews.
const sessoesComDownload = new WeakSet<Session>();

// Sobe o hub (dist/ui.js) na porta da UI, assumindo a porta de qualquer hub Hermes anterior.
async function subirHub(): Promise<void> {
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
      preload: path.join(DIR_DESKTOP, "preload.js"),
      webviewTag: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // 'will-attach-webview': toda webview nasce sem node e sem preload; so' particoes persist:hermes-.
  janela.webContents.on("will-attach-webview", (event, webPreferences, params) => {
    webPreferences.nodeIntegration = false;
    delete webPreferences.preload;
    const particao = String((params as Record<string, string>).partition ?? "");
    if (!particao.startsWith("persist:hermes-")) event.preventDefault();
  });
  // Fechar a janela = sair do app.
  janela.on("closed", () => {
    janela = null;
    if (!encerrando) app.quit();
  });
  await janela.loadURL(`http://127.0.0.1:${PORTA}`);
}

// Segunda instancia: foca a janela ja' aberta em vez de abrir outra.
function focarJanela(): void {
  if (!janela) return;
  if (janela.isMinimized()) janela.restore();
  janela.focus();
}

// Instancia unica: a segunda invocacao sai (e foca a janela da primeira).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => focarJanela());
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
    try {
      await subirHub();
      await criarJanela();
    } catch (e) {
      // Hub/janela indisponivel: nao deixa o app pendurado.
      process.stderr.write("[hermes-desktop] falha ao iniciar: " + String((e as Error)?.message ?? e) + "\n");
      app.quit();
    }
  });
}
