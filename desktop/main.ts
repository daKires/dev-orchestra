// Electron main (F4 S5): janela do app Hermes, ponte do preload e protecao das webviews.
// Compilado pra dist-desktop/ (ESM: o package.json do repo e' "type": "module").
import { app, BrowserWindow, dialog, type Session, type WebContents } from "electron";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarDriverCDP } from "./cdp.js";
import { criarDriverPty } from "./pty.js";

// dist-desktop/ (onde este arquivo compila) e o repo (pai de dist-desktop, ou HERMES_REPO).
const DIR_DESKTOP = path.dirname(fileURLToPath(import.meta.url));
// Empacotado, o pai de dist-desktop e' o app.asar: o repo vem do HERMES_REPO ou do dialogo (resolverRepo).
let REPO = process.env.HERMES_REPO || (app.isPackaged ? "" : path.resolve(DIR_DESKTOP, ".."));
const PORTA = process.env.HERMES_UI_PORT || "4123";

// Drives injetados no hub (dist/ui.js -> iniciarUI): navegador por CDP e PTY dos agentes Claude.
let navegador: ReturnType<typeof criarDriverCDP>; // criado depois do resolverRepo (precisa do repo)
const pty = criarDriverPty();

let janela: BrowserWindow | null = null;
let encerrando = false;
let ui: any = null; // modulo dist/ui.js (para chamar pararUI antes de sair)

// Sessoes ja' observadas (uma unica vez cada) para cancelar downloads das webviews.
const sessoesComDownload = new WeakSet<Session>();

// Sobe o hub (dist/ui.js) na porta da UI, assumindo a porta de qualquer hub Hermes anterior.
// Sem HERMES_REPO no app instalado: pede a pasta do mcp-hermes-bridge uma vez e grava (setx).
async function resolverRepo(): Promise<boolean> {
  const valido = (p: string) => !!p && fs.existsSync(path.join(p, "dist", "ui.js"));
  if (valido(REPO)) return true;
  const r = await dialog.showOpenDialog({ title: "Onde está a pasta do mcp-hermes-bridge?", properties: ["openDirectory"] });
  const p = r.filePaths[0] ?? "";
  if (r.canceled || !valido(p)) {
    dialog.showErrorBox("Hermes", "Pasta do mcp-hermes-bridge não encontrada (precisa ter dist/ui.js). Rode o install.ps1 do repositório.");
    return false;
  }
  REPO = p;
  execFile("setx", ["HERMES_REPO", p], () => {});
  return true;
}

async function subirHub(): Promise<void> {
  navegador = criarDriverCDP(REPO);
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
      if (!(await resolverRepo())) { app.quit(); return; }
      await subirHub();
      await criarJanela();
    } catch (e) {
      // Hub/janela indisponivel: nao deixa o app pendurado.
      process.stderr.write("[hermes-desktop] falha ao iniciar: " + String((e as Error)?.message ?? e) + "\n");
      app.quit();
    }
  });
}
