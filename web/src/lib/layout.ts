// Layout automatico de runs e agentes no canvas (F2 S4). PURO: sem React, sem DOM.
// Tipos do hub e do modelo entram so' como `import type` (apagados na compilacao, nao vao pro bundle).
import type { No, Snapshot } from "../../../canvas.ts";
import type { Run, SliceEstado, StatusSlice } from "./estado.ts";

// ---------------------------------------------------------------------------
// Fluxo do plano (CA-11b): Inicio -> slices -> Gate -> Pronto
// ---------------------------------------------------------------------------

export type FormaFluxo = "elipse" | "retangulo" | "losango";
export type NoFluxo = { id: string; forma: FormaFluxo; texto: string; cor: string };
export type ArestaFluxo = { de: string; para: string };
export type Fluxo = { nos: NoFluxo[]; arestas: ArestaFluxo[] };

/** Cor (nome do token de forma) de uma slice pelo status: fila cinza, rodando azul, ok verde, ruim vermelho. */
function corDaSlice(status: StatusSlice): string {
  switch (status) {
    case "rodando": return "azul";
    case "ok": return "verde";
    case "incompleta":
    case "pulada": return "vermelho";
    default: return "cinza"; // fila
  }
}

/**
 * Fluxo linear do plano de uma run: elipse 'Início' verde, uma forma retangular por slice (texto =
 * tarefa, cor pelo status), losango 'Gate' e elipse 'Pronto'. Numero de slices = max(plano, eventos).
 */
export function fluxoDoPlano(run: Run): Fluxo {
  const id = run.id;
  const n = Math.max(run.plano.length, run.slices.length);
  const nos: NoFluxo[] = [{ id: `flow:${id}:inicio`, forma: "elipse", texto: "Início", cor: "verde" }];
  for (let i = 1; i <= n; i++) {
    const s: SliceEstado | undefined = run.slices.find((x) => x.idx === i);
    const tarefa = s?.tarefa ?? run.plano[i - 1]?.tarefa ?? "";
    nos.push({ id: `flow:${id}:${i}`, forma: "retangulo", texto: tarefa, cor: corDaSlice(s?.status ?? "fila") });
  }
  const ultimoGate = run.gate.length ? run.gate[run.gate.length - 1] : undefined;
  const corGate = !ultimoGate || ultimoGate.status === "rodando" ? "amarelo"
    : ultimoGate.status === "ok" ? "verde" : "vermelho";
  nos.push({ id: `flow:${id}:gate`, forma: "losango", texto: "Gate", cor: corGate });
  nos.push({ id: `flow:${id}:fim`, forma: "elipse", texto: "Pronto", cor: run.status === "COMPLETE" ? "verde" : "cinza" });
  const arestas: ArestaFluxo[] = [];
  for (let i = 0; i < nos.length - 1; i++) arestas.push({ de: nos[i].id, para: nos[i + 1].id });
  return { nos, arestas };
}

// ---------------------------------------------------------------------------
// Layout das runs (CA-4b, 13a, 15): coluna de cards + regiao expandida
// ---------------------------------------------------------------------------

export type ArestaLayout = { id: string; de: string; para: string };
export type LayoutRuns = { nos: No[]; arestas: ArestaLayout[] };

const CARD_W = 280;
const CARD_H = 110;
const COLUNA_X = 40;
const COLUNA_Y = 40;
const ESPACO_VERTICAL = 40;

const PAD = 24;               // margem interna da regiao
const GAP = 32;               // espaco entre linhas dentro da regiao
const STEP = 240;             // passo horizontal entre os nos do fluxo
const FLOW_W = 160;
const FLOW_H = 80;
const WORKER_W = 200;
const WORKER_H = 140;
const ARQ_W = 240;
const ARQ_H = 40;
const GAP_ARQ = 12;
const REG_GAP = 40;           // distancia do card ate' a regiao

/** Ids salvos do snapshot (para reusar posicao/dados dos nos ja' existentes). */
function indexarSalvos(snap: Snapshot): Map<string, No> {
  return new Map(snap.nos.map((n) => [n.id, n]));
}

/** No' com id salvo no snapshot: usa x,y,w,h e (mescla) os dados salvos; senao devolve o proprio no'. */
function comSalvo(no: No, salvos: Map<string, No>): No {
  const s = salvos.get(no.id);
  if (!s) return no;
  return { ...no, x: s.x, y: s.y, w: s.w, h: s.h, dados: { ...no.dados, ...s.dados }, rev: s.rev };
}

/**
 * Coluna de cards de run (280x110), mais recente em cima; a run com o no' salvo marcado
 * `dados.expandida` ganha a direita um grupo `reg:<id>` com o fluxo, os workers e os arquivos.
 */
export function layoutRuns(runs: Run[], snap: Snapshot): LayoutRuns {
  const salvos = indexarSalvos(snap);
  const ordenadas = [...runs].sort((a, b) => b.inicioTs - a.inicioTs);
  const nos: No[] = [];
  const arestas: ArestaLayout[] = [];

  ordenadas.forEach((run, i) => {
    const cardId = `run:${run.id}`;
    const card = comSalvo({
      id: cardId, tipo: "run", x: COLUNA_X, y: COLUNA_Y + i * (CARD_H + ESPACO_VERTICAL),
      w: CARD_W, h: CARD_H, dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos);
    nos.push(card);

    if (salvos.get(cardId)?.dados?.expandida !== true) return; // recolhida: so' o card

    const regId = `reg:${run.id}`;
    const fluxo = fluxoDoPlano(run);
    const regX = card.x + card.w + REG_GAP;
    const regY = card.y;
    const linhasY = regY + PAD + FLOW_H + GAP; // topo da faixa de workers
    const arqsY = linhasY + WORKER_H + GAP;    // topo da faixa de arquivos
    const filhos: No[] = [];

    // Fluxo: inicio(pos 0), slice idx(pos idx), gate(pos n+1), fim(pos n+2), em cadeia horizontal.
    fluxo.nos.forEach((fn, pos) => {
      filhos.push({
        id: fn.id, tipo: "forma", x: regX + PAD + pos * STEP, y: regY + PAD, w: FLOW_W, h: FLOW_H,
        pai: regId, dados: { auto: true, forma: fn.forma, texto: fn.texto, cor: fn.cor }, rev: 0,
      });
    });

    // Um worker por slice do fluxo (mesmo sem evento ainda), alinhado sob a forma da slice.
    const n = Math.max(run.plano.length, run.slices.length);
    for (let idx = 1; idx <= n; idx++) {
      filhos.push({
        id: `worker:${run.id}:${idx}`, tipo: "worker", x: regX + PAD + idx * STEP, y: linhasY,
        w: WORKER_W, h: WORKER_H, pai: regId, dados: { auto: true, runId: run.id, idx }, rev: 0,
      });
    }

    // Um arquivo por diff da run, empilhados abaixo dos workers.
    run.ordemDiffs.forEach((arquivo, k) => {
      filhos.push({
        id: `arq:${run.id}:${arquivo}`, tipo: "arquivo", x: regX + PAD, y: arqsY + k * (ARQ_H + GAP_ARQ),
        w: ARQ_W, h: ARQ_H, pai: regId, dados: { auto: true, runId: run.id, arquivo }, rev: 0,
      });
    });

    const resolvidos = filhos.map((f) => comSalvo(f, salvos));
    const largura = Math.max(FLOW_W, ...resolvidos.map((f) => f.x + f.w - regX)) + PAD;
    const altura = Math.max(FLOW_H, ...resolvidos.map((f) => f.y + f.h - regY)) + PAD;
    nos.push(comSalvo({
      id: regId, tipo: "grupo", x: regX, y: regY, w: largura, h: altura,
      dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos));
    nos.push(...resolvidos);

    // Arestas: run -> inicio, a cadeia do fluxo, slice -> worker e worker/run -> arquivo.
    arestas.push({ id: `${cardId}->flow:${run.id}:inicio`, de: cardId, para: `flow:${run.id}:inicio` });
    for (const a of fluxo.arestas) arestas.push({ id: `${a.de}->${a.para}`, de: a.de, para: a.para });
    for (let idx = 1; idx <= n; idx++) {
      arestas.push({ id: `flow:${run.id}:${idx}->worker:${run.id}:${idx}`, de: `flow:${run.id}:${idx}`, para: `worker:${run.id}:${idx}` });
    }
    for (const arquivo of run.ordemDiffs) {
      const arqId = `arq:${run.id}:${arquivo}`;
      const dono = run.slices.find((s) => s.escritos.includes(arquivo));
      arestas.push(dono
        ? { id: `worker:${run.id}:${dono.idx}->${arqId}`, de: `worker:${run.id}:${dono.idx}`, para: arqId }
        : { id: `${cardId}->${arqId}`, de: cardId, para: arqId });
    }
  });

  return { nos, arestas };
}

// ---------------------------------------------------------------------------
// Layout dos agentes (CA-5b): planejadores ainda sem no' no canvas
// ---------------------------------------------------------------------------

const AGENTE_W = 620;
const AGENTE_H = 420;
const AGENTE_GAP = 40;

/**
 * Nos 'agente' para os planejadores que ainda NAO tem no' `ag:<id>` no snapshot (um no' oculto conta
 * como existente). Mesma coluna, empilhados sem sobrepor. Agentes de origem 'canvas' ficam de fora.
 */
export function layoutAgentes(agentes: { id: string; origem: string }[], snap: Snapshot): No[] {
  const existentes = new Set(snap.nos.map((n) => n.id));
  const out: No[] = [];
  for (const a of agentes) {
    if (a.origem !== "planejador") continue;
    if (existentes.has(`ag:${a.id}`)) continue;
    out.push({
      id: `ag:${a.id}`, tipo: "agente", x: COLUNA_X, y: COLUNA_Y + out.length * (AGENTE_H + AGENTE_GAP),
      w: AGENTE_W, h: AGENTE_H, dados: { agenteId: a.id }, rev: 0,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linhas do worker (CA-4b): feed da slice + atividade atual
// ---------------------------------------------------------------------------

export type LinhaWorker = { texto: string; erro: boolean };

/** Linhas de uma slice no painel do worker: feed (slice/tool/log) + a atividade corrente, se for dela. */
export function linhasDoWorker(run: Run, idx: number): LinhaWorker[] {
  const out: LinhaWorker[] = run.feed
    .filter((f) => f.slice === idx && (f.tipo === "slice" || f.tipo === "tool" || f.tipo === "log"))
    .map((f) => ({ texto: f.texto, erro: f.erro }));
  const a = run.atividade;
  if (a && a.slice === idx) {
    out.push(a.tipo === "gerando"
      ? { texto: `→ gerando ${a.tokens} tokens…`, erro: false }
      : { texto: `→ ${a.cmd}`, erro: false });
  }
  return out;
}
