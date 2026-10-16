// Preload (F4 S5): ponte minima entre a UI (renderer) e o main.
// .cts -> CommonJS: preload em sandbox (padrao do Electron) nao roda ESM.
// A pagina usa window.devOrchestraDesktop para registrar/desregistrar webviews e limpar dados de particao.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("devOrchestraDesktop", {
  // Liga um no' do canvas ao webContents da webview correspondente (por id numerico).
  registrarNavegador: (noId: string, webContentsId: number) => ipcRenderer.invoke("registrar-navegador", noId, webContentsId),
  // Solta o no' do mapa de navegadores.
  desregistrarNavegador: (noId: string) => ipcRenderer.invoke("desregistrar-navegador", noId),
  // Limpa os dados (cookies/storage) da particao persist:dev-orchestra-*.
  limparDados: (particao: string) => ipcRenderer.invoke("limpar-dados", particao),
});
