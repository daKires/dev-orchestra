// Driver do navegador embutido (F4 S2/S5): controla as webviews via CDP (debugger dos webContents).
// Mapa noId -> webContents alimentado pelo ipc do preload; as rotas /cli/browser-* do hub usam
// ler/clicar/digitar/navegar/capturar.
import { ipcMain, session, webContents, type WebContents } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Mesma forma do tipo Leitura/Elemento de navegador.ts (compilado em dist/ e carregado em runtime).
export type Elemento = { n: number; papel: string; rotulo: string };
export type Leitura = { titulo: string; url: string; texto: string; elementos: Elemento[] };

export type DriverCDP = {
  ler(noId: string): Promise<Leitura>;
  clicar(noId: string, n: number): Promise<void>;
  digitar(noId: string, n: number, valor: string, enter: boolean): Promise<void>;
  navegar(noId: string, acao: string): Promise<void>;
  capturar(noId: string): Promise<Buffer>;
};

const ESPERA_CARREGAR_MS = 10_000;

/**
 * Cria o driver CDP. `repo` e' a raiz do dev-orchestra (de onde sai o dist/navegador.js com o
 * SCRIPT_LEITURA). Registra os handlers ipc usados pelo preload.
 */
export function criarDriverCDP(repo: string): DriverCDP {
  const mapa = new Map<string, WebContents>(); // noId -> webContents da webview
  let leituraPromise: Promise<string> | null = null;

  // SCRIPT_LEITURA vem de dist/navegador.js (import dinamico; dependencia so' em runtime).
  function scriptLeitura(): Promise<string> {
    if (!leituraPromise) {
      leituraPromise = import(pathToFileURL(path.join(repo, "dist", "navegador.js")).href)
        .then((m: any) => String(m.SCRIPT_LEITURA));
    }
    return leituraPromise;
  }

  ipcMain.handle("registrar-navegador", (_ev, noId: string, webContentsId: number) => {
    if (typeof noId !== "string" || !noId || typeof webContentsId !== "number") return;
    const wc = webContents.fromId(webContentsId);
    if (wc) mapa.set(noId, wc);
  });

  ipcMain.handle("desregistrar-navegador", (_ev, noId: string) => {
    if (typeof noId === "string") mapa.delete(noId);
  });

  ipcMain.handle("limpar-dados", async (_ev, particao: string) => {
    if (typeof particao !== "string" || !particao) return;
    await session.fromPartition(particao).clearStorageData();
  });

  // webContents de um noId; ausente/derrubado -> erro do contrato.
  function wcDe(noId: string): WebContents {
    const wc = mapa.get(noId);
    if (!wc || wc.isDestroyed()) throw new Error(`navegador ${noId} não está aberto no app`);
    return wc;
  }

  // Anexa o debugger (CDP 1.3) uma vez por webContents.
  async function anexar(wc: WebContents): Promise<void> {
    if (wc.debugger.isAttached()) return;
    wc.debugger.attach("1.3");
  }

  // Runtime.evaluate com returnByValue; exceptionDetails vira erro do Node.
  async function avaliar(wc: WebContents, expressao: string): Promise<any> {
    const r = await wc.debugger.sendCommand("Runtime.evaluate", { expression: expressao, returnByValue: true });
    if (r && r.exceptionDetails) {
      const texto = r.exceptionDetails?.exception?.description ?? r.exceptionDetails?.text ?? "erro ao avaliar na página";
      throw new Error(String(texto));
    }
    return r?.result?.value;
  }

  // Espera o 'did-stop-loading' da webview ate' `ms`; false se estourou o tempo.
  function esperarParar(wc: WebContents, ms: number): Promise<boolean> {
    return new Promise((ok) => {
      let resolvido = false;
      const fim = setTimeout(() => { if (!resolvido) { resolvido = true; ok(false); } }, ms);
      const ouvir = () => {
        if (resolvido) return;
        resolvido = true;
        clearTimeout(fim);
        ok(true);
      };
      wc.once("did-stop-loading", ouvir);
      if (!wc.isLoading()) ouvir();
    });
  }

  async function ler(noId: string): Promise<Leitura> {
    const wc = wcDe(noId);
    await anexar(wc);
    if (wc.isLoading()) {
      const parou = await esperarParar(wc, ESPERA_CARREGAR_MS);
      if (!parou) throw new Error("página ainda carregando");
    }
    const valor = await avaliar(wc, await scriptLeitura());
    return JSON.parse(String(valor)) as Leitura;
  }

  async function clicar(noId: string, n: number): Promise<void> {
    const wc = wcDe(noId);
    await anexar(wc);
    const expr =
      `(()=>{const e=document.querySelector('[data-orchestra-n="${n}"]');` +
      ` if(!e) throw new Error('elemento ${n} não encontrado');` +
      ` e.scrollIntoView({block:'center'}); e.click(); return true})()`;
    await avaliar(wc, expr);
  }

  async function digitar(noId: string, n: number, valor: string, enter: boolean): Promise<void> {
    const wc = wcDe(noId);
    await anexar(wc);
    // Input.* do CDP nao chega numa <webview> dentro do canvas; execCommand('insertText') gera os
    // eventos de input reais (React/contenteditable ok). Enter: eventos de tecla + submit do form.
    const expr =
      `(()=>{const e=document.querySelector('[data-orchestra-n="${n}"]');` +
      ` if(!e) throw new Error('elemento ${n} não encontrado');` +
      ` e.scrollIntoView({block:'center'}); e.focus();` +
      ` if(typeof e.select==='function') e.select(); else document.execCommand('selectAll');` +
      ` document.execCommand('insertText', false, ${JSON.stringify(valor)});` +
      ` if(${enter}){const o={key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true,cancelable:true};` +
      ` const livre=e.dispatchEvent(new KeyboardEvent('keydown',o)); e.dispatchEvent(new KeyboardEvent('keypress',o)); e.dispatchEvent(new KeyboardEvent('keyup',o));` +
      ` if(livre && e.form) e.form.requestSubmit();}` +
      ` return true})()`;
    await avaliar(wc, expr);
  }

  async function navegar(noId: string, acao: string): Promise<void> {
    const wc = wcDe(noId);
    if (acao === "back") { wc.goBack(); return; }
    if (acao === "forward") { wc.goForward(); return; }
    if (acao === "reload") { wc.reload(); return; }
    await wc.loadURL(acao);
  }

  async function capturar(noId: string): Promise<Buffer> {
    const wc = wcDe(noId);
    // capturePage (nativo) em vez do Page.captureScreenshot do CDP, que trava esperando um frame
    // quando a webview nao esta pintando; o teto de 10s vira erro em vez de request pendurada.
    const img = await Promise.race([
      wc.capturePage(),
      new Promise<never>((_, nao) => setTimeout(() => nao(new Error("captura não respondeu (o card está visível no canvas?)")), ESPERA_CARREGAR_MS)),
    ]);
    return img.toPNG();
  }

  return { ler, clicar, digitar, navegar, capturar };
}
