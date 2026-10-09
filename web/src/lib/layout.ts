// Layout automatico de runs e agentes no canvas (F2 S4). PURO: sem React, sem DOM.
// Tipos do hub e do modelo entram so' como `import type` (apagados na compilacao, nao vao pro bundle).
import type { No, Snapshot } from "../../../canvas.ts";
import type { Run, SliceEstado, StatusSlice } from "./estado.ts";

// Fluxo do plano (CA-11b): Inicio -> slices -> Gate -> Pronto

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

// Layout das runs (CA-4b, 13a, 15): coluna de cards + regiao expandida

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
const MARGEM_CONTEUDO = 80;   // folga minima entre a coluna de runs e o conteudo do usuario
const ESPACO_REGIAO = 40;     // folga extra reservada pra regiao da run nao invadir o conteudo

// Vista Arvore (G1): coluna de slices + arquivos na mesma linha
const SLICE_W_COMPACTA = 260;
const SLICE_H_COMPACTA = 64;
const SLICE_W_ABERTA = 620;
const SLICE_H_ABERTA = 380;
const SLICE_ARQ_GAP = 48;     // distancia da coluna de slices ate' os arquivos
const ARQ_COLUNAS = 3;        // arquivos lado a lado antes de descer uma linha dentro da linha da slice
// Reserva horizontal da arvore: PAD + slice aberta + folga + 3 arquivos + PAD.
const LARGURA_ARVORE = PAD + SLICE_W_ABERTA + SLICE_ARQ_GAP + ARQ_COLUNAS * (ARQ_W + GAP_ARQ) + PAD;

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
 * Largura que a regiao de uma run TERIA (a maior regiao possivel), ignorando posicoes salvas: so'
 * depende do numero de slices (cadeia do fluxo) e dos arquivos. Usada pra reservar espaco a esquerda
 * do conteudo do usuario sem a regiao nunca invadir nada.
 */
function larguraRegiao(run: Run): number {
  const n = Math.max(run.plano.length, run.slices.length);
  let fim = FLOW_W; // forma "Início" (pos 0); o fluxo sempre tem essa largura minima
  for (let pos = 0; pos <= n + 2; pos++) fim = Math.max(fim, PAD + pos * STEP + FLOW_W);
  for (let idx = 1; idx <= n; idx++) fim = Math.max(fim, PAD + idx * STEP + WORKER_W);
  if (run.ordemDiffs.length) fim = Math.max(fim, PAD + ARQ_W);
  return Math.max(fim + PAD, LARGURA_ARVORE);
}

/**
 * Coluna de cards de run (280x110), mais recente em cima. Uma run expandida ganha a direita um grupo
 * `reg:<id>` (nomeado pela feature da run): `dados.expandida` salvo no card vence; sem valor salvo, a
 * run ATIVA (rodando/aguardando) abre sozinha e a terminada fica recolhida. A vista segue `dados.vista`
 * do card: 'fluxo' desenha o fluxograma + workers + arquivos; ausente/'arvore' (padrao) desenha a arvore
 * (coluna de slices 260x64, aberta 620x380, com os arquivos na mesma linha). A coluna fica a ESQUERDA de
 * todo o conteudo do usuario (nos sem dados.auto e que nao sao 'agente'), reservando espaco pra maior
 * regiao possivel; sem conteudo do usuario, mantem a coluna padrao (COLUNA_X).
 */
export function layoutRuns(runs: Run[], snap: Snapshot): LayoutRuns {
  const salvos = indexarSalvos(snap);
  const ordenadas = [...runs].sort((a, b) => b.inicioTs - a.inicioTs);
  const nos: No[] = [];
  const arestas: ArestaLayout[] = [];

  // Conteudo criado a mao pelo usuario (notas/imagens/formas/regioes/textos): a coluna de runs
  // precisa caber inteira (card + regiao) a esquerda de tudo isso.
  const doUsuario = snap.nos.filter((n) => n.dados?.auto !== true && n.tipo !== "agente");
  const minX = doUsuario.length ? Math.min(...doUsuario.map((n) => n.x)) : undefined;
  const larguraRegiaoMax = ordenadas.reduce((m, r) => Math.max(m, larguraRegiao(r)), FLOW_W);
  const colunaX = minX === undefined
    ? COLUNA_X
    : minX - MARGEM_CONTEUDO - CARD_W - ESPACO_REGIAO - larguraRegiaoMax;

  ordenadas.forEach((run, i) => {
    const cardId = `run:${run.id}`;
    const card = comSalvo({
      id: cardId, tipo: "run", x: colunaX, y: COLUNA_Y + i * (CARD_H + ESPACO_VERTICAL),
      w: CARD_W, h: CARD_H, dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos);
    nos.push(card);

    // Expandida: o boolean salvo no card vence; sem valor salvo, a run ATIVA (rodando/aguardando =
    // sem evento painel) abre sozinha e a terminada fica recolhida.
    const ativa = run.status === "rodando" || run.status === "aguardando";
    const expandida = typeof salvos.get(cardId)?.dados?.expandida === "boolean"
      ? salvos.get(cardId)!.dados!.expandida === true
      : ativa;
    if (!expandida) return; // recolhida: so' o card

    const regId = `reg:${run.id}`;
    const regX = card.x + card.w + REG_GAP;
    const regY = card.y;
    const filhos: No[] = [];
    let minLargura = FLOW_W; // largura minima da regiao conforme a vista
    let minAltura = FLOW_H;

    if (salvos.get(cardId)?.dados?.vista === "fluxo") {
      // ---- vista Fluxo (comportamento historico): fluxograma + workers + arquivos ----
      const fluxo = fluxoDoPlano(run);
      const linhasY = regY + PAD + FLOW_H + GAP; // topo da faixa de workers
      const arqsY = linhasY + WORKER_H + GAP;    // topo da faixa de arquivos

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
    } else {
      // ---- vista Arvore (padrao): coluna de slices + arquivos na mesma linha ----
      minLargura = SLICE_W_COMPACTA;
      minAltura = SLICE_H_COMPACTA;
      const n = Math.max(run.plano.length, run.slices.length);
      const colunaSlicesX = regX + PAD;

      // Dono de cada arquivo: a primeira slice cujo `escritos` o inclui.
      const dono = new Map<string, number>();
      for (const s of run.slices) for (const a of s.escritos) if (!dono.has(a)) dono.set(a, s.idx);
      const porSlice = new Map<number, string[]>();
      const semDono: string[] = [];
      for (const arquivo of run.ordemDiffs) {
        const idx = dono.get(arquivo);
        if (idx !== undefined && idx >= 1 && idx <= n) {
          const lista = porSlice.get(idx);
          if (lista) lista.push(arquivo); else porSlice.set(idx, [arquivo]);
        } else semDono.push(arquivo);
      }

      let y = regY + PAD;
      for (let idx = 1; idx <= n; idx++) {
        const slice = run.slices.find((s) => s.idx === idx);
        const salvaAberta = salvos.get(`worker:${run.id}:${idx}`)?.dados?.aberta;
        const aberta = typeof salvaAberta === "boolean" ? salvaAberta : slice?.status === "rodando";
        const w = aberta ? SLICE_W_ABERTA : SLICE_W_COMPACTA;
        const h = aberta ? SLICE_H_ABERTA : SLICE_H_COMPACTA;
        const arquivos = porSlice.get(idx) ?? [];
        const linhasArqs = Math.ceil(arquivos.length / ARQ_COLUNAS);
        const alturaArqs = linhasArqs ? linhasArqs * ARQ_H + (linhasArqs - 1) * GAP_ARQ : 0;
        const alturaLinha = Math.max(h, alturaArqs);

        filhos.push({
          id: `worker:${run.id}:${idx}`, tipo: "worker", x: colunaSlicesX, y, w, h, pai: regId,
          dados: { auto: true, runId: run.id, idx, aberta }, rev: 0,
        });
        arestas.push({ id: `${cardId}->worker:${run.id}:${idx}`, de: cardId, para: `worker:${run.id}:${idx}` });

        const arqX = colunaSlicesX + w + SLICE_ARQ_GAP;
        arquivos.forEach((arquivo, k) => {
          const col = k % ARQ_COLUNAS, lin = Math.floor(k / ARQ_COLUNAS);
          filhos.push({
            id: `arq:${run.id}:${arquivo}`, tipo: "arquivo",
            x: arqX + col * (ARQ_W + GAP_ARQ), y: y + lin * (ARQ_H + GAP_ARQ),
            w: ARQ_W, h: ARQ_H, pai: regId, dados: { auto: true, runId: run.id, arquivo }, rev: 0,
          });
          arestas.push({ id: `worker:${run.id}:${idx}->arq:${run.id}:${arquivo}`, de: `worker:${run.id}:${idx}`, para: `arq:${run.id}:${arquivo}` });
        });

        y += alturaLinha + GAP;
      }

      // Arquivos sem dono: abaixo da ultima linha, ligados direto na run.
      semDono.forEach((arquivo, k) => {
        const col = k % ARQ_COLUNAS, lin = Math.floor(k / ARQ_COLUNAS);
        filhos.push({
          id: `arq:${run.id}:${arquivo}`, tipo: "arquivo",
          x: colunaSlicesX + col * (ARQ_W + GAP_ARQ), y: y + lin * (ARQ_H + GAP_ARQ),
          w: ARQ_W, h: ARQ_H, pai: regId, dados: { auto: true, runId: run.id, arquivo }, rev: 0,
        });
        arestas.push({ id: `${cardId}->arq:${run.id}:${arquivo}`, de: cardId, para: `arq:${run.id}:${arquivo}` });
      });
    }

    // Posicoes salvas vencem (comSalvo); mas w/h da slice seguem compacta/aberta e `dados.aberta` e'
    // sempre devolvido no no' da slice.
    const resolvidos = filhos.map((f) => {
      const r = comSalvo(f, salvos);
      if (f.tipo === "worker" && f.dados.aberta !== undefined) {
        r.w = f.w; r.h = f.h; r.dados = { ...r.dados, aberta: f.dados.aberta };
      }
      return r;
    });

    const largura = Math.max(minLargura, ...resolvidos.map((f) => f.x + f.w - regX)) + PAD;
    const altura = Math.max(minAltura, ...resolvidos.map((f) => f.y + f.h - regY)) + PAD;
    nos.push(comSalvo({
      id: regId, tipo: "grupo", x: regX, y: regY, w: largura, h: altura,
      dados: { auto: true, runId: run.id, titulo: run.feature }, rev: 0,
    }, salvos));
    nos.push(...resolvidos);
  });

  return { nos, arestas };
}

// Layout dos agentes (CA-5b): planejadores ainda sem no' no canvas

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

// Feed da slice viva (CA-G1d) e painel de runs (CA-G1g)

export type LinhaFeed = { ts: number; ferramenta: string; texto: string; erro: boolean };
export type LinhaResumo = {
  id: string; feature: string; status: string; slicesOk: number; slicesTotal: number; custo: number; ms: number;
};
export type ResumoPainel = {
  total: number; completas: number; primeiraTentativa: number | null; custo: number; falhasAmbiente: number;
  linhas: LinhaResumo[];
};

/**
 * Ultimas 200 linhas de uma slice (tipos tool/slice/log), em ordem cronologica. `ferramenta` e' o nome
 * da ferramenta (tool) ou o proprio tipo; `texto` e' o resto (para tool, sem o nome no inicio).
 */
export function feedDaSlice(run: Run, idx: number): LinhaFeed[] {
  const itens = run.feed.filter((f) => f.slice === idx && (f.tipo === "tool" || f.tipo === "slice" || f.tipo === "log"));
  return itens.slice(-200).map((f) => {
    const ferramenta = f.tipo === "tool" ? f.nome ?? "tool" : f.tipo;
    let texto = f.texto;
    if (f.tipo === "tool" && f.nome && texto.startsWith(f.nome)) texto = texto.slice(f.nome.length).trim();
    return { ts: f.ts, ferramenta, texto, erro: f.erro };
  });
}

const SETE_DIAS_MS = 7 * 24 * 3600 * 1000;
const custoDaRun = (r: Run): number => r.metricas.reduce((a, m) => a + m.custoUSD, 0);

/** Painel de runs (CA-G1g): so' os ultimos 7 dias, KPIs agregados e linhas mais novas primeiro. */
export function resumoPainel(runs: Run[], agora: number): ResumoPainel {
  const recentes = runs.filter((r) => r.inicioTs >= agora - SETE_DIAS_MS);
  const metricas = recentes.flatMap((r) => r.metricas);
  const linhas = [...recentes]
    .sort((a, b) => b.inicioTs - a.inicioTs)
    .map((r) => ({
      id: r.id, feature: r.feature, status: r.status,
      slicesOk: r.slices.filter((s) => s.status === "ok").length,
      slicesTotal: Math.max(r.plano.length, r.slices.length),
      custo: custoDaRun(r),
      ms: r.ultimoEventoTs - r.inicioTs,
    }));
  return {
    total: recentes.length,
    completas: recentes.filter((r) => r.status === "COMPLETE").length,
    primeiraTentativa: metricas.length ? metricas.filter((m) => m.passouDePrimeira).length / metricas.length : null,
    custo: recentes.reduce((a, r) => a + custoDaRun(r), 0),
    falhasAmbiente: recentes.reduce((a, r) => a + r.metricas.reduce((b, m) => b + (m.falhasAmbiente ?? 0), 0), 0),
    linhas,
  };
}

// Linhas do worker (CA-4b): feed da slice + atividade atual

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
