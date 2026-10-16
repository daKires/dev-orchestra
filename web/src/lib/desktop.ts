// Utilitarios do front para o app desktop (F4 S6): ponte do preload, tema do xterm e particao da webview.

/** Ponte exposta pelo preload (window.devOrchestraDesktop) dentro do app Electron. */
export type PonteDesktop = {
  registrarNavegador(noId: string, webContentsId: number): void;
  desregistrarNavegador(noId: string): void;
  limparDados(particao: string): void;
};

/** Cores do xterm no canvas Castor (fundo/texto/cursor). */
export const temaXterm = {
  background: "#1c1c1c",
  foreground: "#dedee3",
  cursor: "#74aaff",
};

/** Particao persistente de sessao da webview, isolada por projeto. */
export function particaoDoProjeto(id: string): string {
  return "persist:dev-orchestra-" + id;
}

/** true somente quando a ponte do preload esta presente (rodando dentro do app Electron). */
export function emDesktop(win: unknown): boolean {
  const w = win as { devOrchestraDesktop?: Partial<PonteDesktop> } | undefined | null;
  return !!w && typeof w.devOrchestraDesktop?.registrarNavegador === "function";
}

/**
 * sha1 hex da raiz normalizada (barras '/', minusculas, sem barra final) via WebCrypto: MESMO id de
 * projeto do hub (idProjeto), mas sem node:crypto (nao existe no browser). Define a particao da
 * webview do card Navegador.
 */
export async function idProjetoFront(raiz: string): Promise<string> {
  const normalizada = String(raiz ?? "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const bytes = new TextEncoder().encode(normalizada);
  const resumo = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(resumo)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * O <webview> do Electron visto pelo TS: o elemento do JSX ja' e' tipado pelo React
 * (HTMLWebViewElement), mas os metodos que os cards chamam sao proprios do Electron.
 */
export type ElementoWebview = HTMLWebViewElement & {
  src: string;
  getWebContentsId(): number;
  getURL(): string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  stop(): void;
  loadURL(url: string): Promise<void>;
};

declare global {
  interface Window {
    /** Ponte do preload do app Dev Orchestra (so' existe dentro do Electron). */
    devOrchestraDesktop?: PonteDesktop;
  }
}
