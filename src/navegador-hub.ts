// Navegador controlado por agentes: driver injetado pelo app desktop e a resolucao dos nos 'navegador'
// (acessiveis ao agente, cache de elementos). Nunca importa ./ui.js.
import { idProjeto, type No, type Snapshot } from "./canvas.js";
import { slugNome } from "./colaboracao.js";
import type { Elemento, Leitura } from "./navegador.js";

// Driver injetado pelo app desktop. Sem ele, toda rota browser-* responde 400 (abra o app Dev Orchestra).
export type Navegador = {
  ler(noId: string): Promise<Leitura>;
  clicar(noId: string, n: number): Promise<void>;
  digitar(noId: string, n: number, valor: string, enter: boolean): Promise<void>;
  navegar(noId: string, acao: string): Promise<void>;
  capturar(noId: string): Promise<Buffer>;
};

// Estado privado do modulo: o driver atual e a cache de elementos lidos por <idProjeto>\n<noId>.
let navegadorAtual: Navegador | undefined;
const browserCache = new Map<string, Elemento[]>(); // "<idProjeto>\\n<noId>" -> elementos lidos

// Define/limpa o driver do navegador (chamado no iniciarUI/pararUI do ui.ts).
export function definirNavegador(n?: Navegador): void { navegadorAtual = n; }

// Solta o driver e descarta a cache de elementos entre sessoes (usado no pararUI).
export function pararNavegador(): void { navegadorAtual = undefined; browserCache.clear(); }

// Getter do driver atual: o ui.ts so' precisa saber se ha' navegador (guarda das rotas browser-*) e usa-lo.
export function obterNavegador(): Navegador | undefined { return navegadorAtual; }

function chaveElementos(projeto: string, noId: string): string { return idProjeto(projeto) + "\\n" + noId; }

// Navegadores do projeto acessiveis ao agente: criados por ele ou ligados por aresta (qualquer direcao).
function navegadoresAcessiveis(snap: Snapshot, agenteId: string): No[] {
  const noAg = "ag:" + agenteId;
  return snap.nos.filter((n) => n.tipo === "navegador" && (
    n.dados.criador === agenteId ||
    snap.arestas.some((a) => (a.de === noAg && a.para === n.id) || (a.para === noAg && a.de === n.id))
  ));
}

// Resolve por noId exato ou pelo slug do nome (case-insensitive); o primeiro que casar.
function acharNavegador(navs: No[], alvo: string): No | undefined {
  const exato = navs.find((n) => n.id === alvo);
  if (exato) return exato;
  const slug = slugNome(alvo);
  return navs.find((n) => slugNome(String(n.dados.nome ?? "")) === slug);
}

// Sem `nav`, usa o unico acessivel; com `nav`, so' entre os acessiveis. Inacessivel -> erro do contrato.
export function resolverNavegador(snap: Snapshot, agenteId: string, bruto: unknown): { ok: No } | { erro: string } {
  const navs = navegadoresAcessiveis(snap, agenteId);
  if (bruto === undefined || bruto === null || bruto === "") {
    if (navs.length === 1) return { ok: navs[0] };
    return { erro: navs.length === 0 ? "nenhum navegador conectado a você" : "navegador não especificado (há mais de um conectado a você)" };
  }
  const s = String(bruto);
  const achado = acharNavegador(navs, s);
  if (!achado) return { erro: `navegador ${s} não está conectado a você` };
  return { ok: achado };
}

// Le e MEMORIZA os elementos do navegador; devolve a leitura inteira (usado no browser-read).
export async function lerNavegador(projeto: string, noId: string): Promise<Leitura> {
  const l = await navegadorAtual!.ler(noId);
  browserCache.set(chaveElementos(projeto, noId), l.elementos);
  return l;
}

// Elementos na cache do noId; sem cache, faz uma leitura antes (mesmo contrato do read).
export async function elementosDoNavegador(projeto: string, noId: string): Promise<Elemento[]> {
  const k = chaveElementos(projeto, noId);
  const emCache = browserCache.get(k);
  if (emCache) return emCache;
  const l = await navegadorAtual!.ler(noId);
  browserCache.set(k, l.elementos);
  return l.elementos;
}
