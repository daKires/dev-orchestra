// Layout automatico de runs e agentes no canvas (F2 S4; Run B: run expandida em 3 fases).
// PURO: sem React, sem DOM. Tipos do hub e do modelo entram so' como `import type` (apagados na
// compilacao, nao vao pro bundle).
import type { No, Snapshot } from "../../../canvas.ts";
import type { Run, SliceEstado } from "./estado.ts";

// Layout das runs (CA-4b, 13a, 15 a 18): coluna de cards + as 3 fases da run expandida

export type ArestaLayout = { id: string; de: string; para: string };
/** Posicao do card de um planejador na fase 1 da run do cwd dele (card 620x420). */
export type AgenteLayout = { id: string; x: number; y: number; pai: string };
export type LayoutRuns = { nos: No[]; arestas: ArestaLayout[]; agentes: AgenteLayout[] };

const CARD_W = 280;
const CARD_H = 170;           // o card da run tem status e o pipeline das fases
const COLUNA_X = 40;
const COLUNA_Y = 40;
const ESPACO_VERTICAL = 40;   // espaco entre duas runs empilhadas na coluna

const PAD = 24;               // margem interna das fases
const GAP = 32;               // espaco vertical entre cards da MESMA fase
const FASE_GAP = 40;          // espaco horizontal entre as 3 fases
const REG_GAP = 40;           // distancia do card da run ate' a fase 1
const MARGEM_CONTEUDO = 80;   // folga minima entre a coluna de runs e o conteudo do usuario
const ESPACO_REGIAO = 40;     // folga extra reservada pras fases nao invadirem o conteudo
const RUN_PARADA_MS = 10 * 60_000; // sem evento nem painel por 10 min: run "parada" (processo morreu)

// Fase 1: pedido + (abaixo) o card do planejador. Fase 3: gate + (abaixo) o diff.
const PEDIDO_W = 300;
const PEDIDO_H = 170;
const GATE_W = 420;
const GATE_H = 220;
const DIFF_W = 620;
const DIFF_H = 380;
const AGENTE_W = 620;         // card do planejador (mesmo tamanho do no' de agente)
const AGENTE_H = 420;
const AGENTE_GAP = 40;

// Fase 2: slices compactas (260x64) e abertas/ao vivo (620x380), como na arvore do G1.
const SLICE_W_COMPACTA = 260;
const SLICE_H_COMPACTA = 64;
const SLICE_W_ABERTA = 620;
const SLICE_H_ABERTA = 380;

// Largura reservada por fase (a maior possivel): pedido/planejador, slice aberta, diff.
const FASE1_W = PAD + Math.max(PEDIDO_W, AGENTE_W) + PAD;
const FASE2_W = PAD + SLICE_W_ABERTA + PAD;
const FASE3_W = PAD + Math.max(GATE_W, DIFF_W) + PAD;
// Reserva horizontal da coluna de runs: card + folga + as 3 fases lado a lado (com os gaps).
const LARGURA_FASES = FASE1_W + FASE_GAP + FASE2_W + FASE_GAP + FASE3_W;

// Titulos das fases, na ordem (fase 1 = indice 0).
const TITULOS_FASE = ["FASE 1 · PLANEJAMENTO", "FASE 2 · EXECUÇÃO DO SWARM", "FASE 3 · GATE E ENTREGA"] as const;

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
 * Mescla os nos SALVOS (snapshot) com os GERADOS pelo layout automatico (runs + agentes) numa unica
 * lista, sem duplicar ids:
 * - nos salvos com `dados.oculto === true` (e os gerados com o mesmo id) ficam de fora;
 * - para cada salvo visivel: se `dados.auto === true` e existe um gerado com o mesmo id, usa o GERADO
 *   (o layout ja' mescla do salvo o que importa via comSalvo); senao usa o salvo (conteudo do usuario);
 * - acrescenta os gerados cujo id NAO estava entre os salvos.
 */
export function mesclarComLayout(salvos: No[], gerados: No[]): No[] {
  const ocultos = new Set(salvos.filter((n) => n.dados?.oculto === true).map((n) => n.id));
  const idsSalvos = new Set(salvos.map((n) => n.id));
  const porId = new Map(gerados.filter((n) => !ocultos.has(n.id)).map((n) => [n.id, n]));
  const out: No[] = [];
  for (const s of salvos) {
    if (ocultos.has(s.id)) continue;
    const g = porId.get(s.id);
    out.push(s.dados?.auto === true && g ? g : s);
  }
  for (const g of gerados) {
    if (ocultos.has(g.id) || idsSalvos.has(g.id)) continue;
    out.push(g);
  }
  return out;
}

/**
 * Largura/altura de uma fase (grupo): a maior entre o minimo e o bounding box dos filhos + margem.
 * As posicoes salvas dos filhos vencem, entao a fase cresce pra conter o filho onde ele estiver.
 */
function caixaDoGrupo(x: number, y: number, minW: number, minH: number, filhos: No[]): { w: number; h: number } {
  return {
    w: Math.max(minW, ...filhos.map((f) => f.x + f.w - x + PAD)),
    h: Math.max(minH, ...filhos.map((f) => f.y + f.h - y + PAD)),
  };
}

/**
 * Coluna de cards de run (280x170), mais recente em cima, empilhados sem sobrepor: cada run fica num
 * cursor `y` e, depois de montada, o cursor avanca pro fundo real (fundo do card OU das fases, o maior)
 * + ESPACO_VERTICAL. Uma run expandida ganha a direita, lado a lado e na MESMA altura do card, as 3
 * fases (`dados.expandida` salvo no card vence; sem valor salvo, a run ATIVA — rodando/aguardando —
 * abre sozinha e a terminada fica recolhida). Quando `agora` vem, uma run ativa cujo `ultimoEventoTs`
 * e' anterior a `agora - 10 min` conta como PARADA (processo morreu) e NAO abre sozinha (o salvo
 * continua vencendo); sem `agora`, nao checa. As fases sao:
 * - `fase1:<id>`: card `pedido:<id>` (300x170) e, havendo planejador do cwd, os slots 620x420 abaixo;
 * - `fase2:<id>`: os `worker:<id>:<k>` em coluna (compacta 260x64 / aberta 620x380 pelo `dados.aberta`
 *   salvo ou pela slice rodando);
 * - `fase3:<id>`: `gate:<id>` (420x220) e `diff:<id>` (620x380) abaixo.
 * Arestas: pedido -> run, run -> cada worker, ultimo worker -> gate (sem slices: run -> gate) e
 * gate -> diff. A coluna fica a ESQUERDA de todo o conteudo do usuario (nos sem dados.auto e que nao
 * sao 'agente'), reservando espaco pra largura das 3 fases; sem conteudo do usuario, mantem a coluna
 * padrao (COLUNA_X). A posicao salva (comSalvo) vence apenas pro CARD da run e pros cards das fases
 * (filhos), nunca pro empilhamento nem pro tamanho das fases.
 *
 * Planejadores: cada um vai pra fase 1 da run MAIS RECENTE do cwd dele (normalizado por cwdChave),
 * abaixo do pedido, e so' quando essa run esta' expandida — devolvidos em `agentes`.
 */
export function layoutRuns(
  runs: Run[], snap: Snapshot, agora?: number, planejadores: { agId: string; cwd: string }[] = [],
): LayoutRuns {
  const salvos = indexarSalvos(snap);
  const ordenadas = [...runs].sort((a, b) => b.inicioTs - a.inicioTs);
  const nos: No[] = [];
  const arestas: ArestaLayout[] = [];
  const agentes: AgenteLayout[] = [];

  // Conteudo criado a mao pelo usuario (notas/imagens/formas/regioes/textos): a coluna de runs
  // precisa caber inteira (card + as 3 fases) a esquerda de tudo isso.
  const doUsuario = snap.nos.filter((n) => n.dados?.auto !== true && n.tipo !== "agente");
  const minX = doUsuario.length ? Math.min(...doUsuario.map((n) => n.x)) : undefined;
  const colunaX = minX === undefined
    ? COLUNA_X
    : minX - MARGEM_CONTEUDO - CARD_W - ESPACO_REGIAO - LARGURA_FASES;

  // Planejador -> run MAIS RECENTE do mesmo cwd (normalizado): cada um ganha um slot na fase 1 dela.
  const runDoCwd = new Map<string, string>();
  for (const run of ordenadas) {
    const k = cwdChave(run.cwd);
    if (k && !runDoCwd.has(k)) runDoCwd.set(k, run.id);
  }
  const planosDoRun = new Map<string, string[]>();
  for (const p of planejadores) {
    const runId = runDoCwd.get(cwdChave(p.cwd));
    if (!runId) continue;
    const lista = planosDoRun.get(runId);
    if (lista) { if (!lista.includes(p.agId)) lista.push(p.agId); }
    else planosDoRun.set(runId, [p.agId]);
  }

  const fases1 = new Map<string, No>(); // geometria final de cada fase 1 (pros slots dos planejadores)

  let cursorY = COLUNA_Y; // topo da proxima run (empilha sem sobrepor, mais nova em cima)
  ordenadas.forEach((run) => {
    const cardId = `run:${run.id}`;
    // A posicao salva (x,y) so' vale quando o usuario ARRASTOU o card (`dados.movido === true`); senao
    // o card segue o empilhamento (cursor y, coluna). Os demais dados salvos (expandida, ...) continuam
    // sendo mesclados e o tamanho e' SEMPRE o atual: o card tem status e pipeline, uma altura antiga
    // salva nao pode voltar a valer.
    const salvoCard = salvos.get(cardId);
    const movido = salvoCard?.dados?.movido === true;
    const card = {
      ...comSalvo({
        id: cardId, tipo: "run", x: colunaX, y: cursorY,
        w: CARD_W, h: CARD_H, dados: { auto: true, runId: run.id }, rev: 0,
      }, salvos),
      x: movido ? salvoCard!.x : colunaX,
      y: movido ? salvoCard!.y : cursorY,
      w: CARD_W, h: CARD_H,
    };
    nos.push(card);

    // Expandida: o boolean salvo no card vence; sem valor salvo, a run ATIVA (ainda sem o painel final
    // — inclui a 'pausada' da G3, que nao e' fim) abre sozinha e a terminada fica recolhida. Com `agora`,
    // uma run ativa PARADA (sem evento ha mais de 10 min) nao abre sozinha.
    const ativa = !temPainel(run)
      && !(agora !== undefined && run.ultimoEventoTs < agora - RUN_PARADA_MS);
    const expandida = typeof salvoCard?.dados?.expandida === "boolean"
      ? salvoCard.dados.expandida === true
      : ativa;
    // Fundo real desta run: o card; sobe pro fundo das fases se elas existirem (o cursor segue ele).
    let fundo = card.y + card.h;
    if (!expandida) { cursorY = fundo + ESPACO_VERTICAL; return; } // recolhida: so' o card

    const planos = planosDoRun.get(run.id) ?? [];
    const fase1Id = `fase1:${run.id}`;
    const fase2Id = `fase2:${run.id}`;
    const fase3Id = `fase3:${run.id}`;
    const faseX = card.x + card.w + REG_GAP;
    const faseY = card.y; // as 3 fases comecam na mesma altura do card

    // ---- FASE 1: o pedido e, abaixo dele, um slot 620x420 por planejador daquele cwd ----
    const pedidoId = `pedido:${run.id}`;
    const filhos1: No[] = [comSalvo({
      id: pedidoId, tipo: "pedido", x: faseX + PAD, y: faseY + PAD, w: PEDIDO_W, h: PEDIDO_H,
      pai: fase1Id, dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos)];
    const alturaPlanos = planos.length ? planos.length * (AGENTE_H + GAP) : 0;
    const caixa1 = caixaDoGrupo(
      faseX, faseY,
      PAD + Math.max(PEDIDO_W, planos.length ? AGENTE_W : 0) + PAD,
      PAD + PEDIDO_H + alturaPlanos + PAD,
      filhos1,
    );
    const fase1: No = {
      id: fase1Id, tipo: "grupo", x: faseX, y: faseY, w: caixa1.w, h: caixa1.h,
      dados: { auto: true, runId: run.id, fase: 1, titulo: TITULOS_FASE[0] }, rev: 0,
    };
    nos.push(fase1, ...filhos1);
    fases1.set(run.id, fase1);
    arestas.push({ id: `${pedidoId}->${cardId}`, de: pedidoId, para: cardId });

    // ---- FASE 2: os workers (slices) em coluna, com as regras compacta/aberta da arvore ----
    const n = Math.max(run.plano.length, run.slices.length);
    const fase2X = faseX + fase1.w + FASE_GAP;
    const filhos2: No[] = [];
    let colunaY = faseY + PAD; // cursor dos workers, abaixo da anterior
    let somaAlturas = 0;       // altura total da coluna (com os gaps), sem posicoes salvas
    let maiorLargura = SLICE_W_COMPACTA;
    for (let idx = 1; idx <= n; idx++) {
      const slice: SliceEstado | undefined = run.slices.find((s) => s.idx === idx);
      const salvaAberta = salvos.get(`worker:${run.id}:${idx}`)?.dados?.aberta;
      const aberta = typeof salvaAberta === "boolean" ? salvaAberta : slice?.status === "rodando";
      const w = aberta ? SLICE_W_ABERTA : SLICE_W_COMPACTA;
      const h = aberta ? SLICE_H_ABERTA : SLICE_H_COMPACTA;
      const worker = comSalvo({
        id: `worker:${run.id}:${idx}`, tipo: "worker", x: fase2X + PAD, y: colunaY, w, h,
        pai: fase2Id, dados: { auto: true, runId: run.id, idx, aberta }, rev: 0,
      }, salvos);
      // w/h da slice seguem compacta/aberta (e `dados.aberta` e' sempre devolvido), mesmo com posicao salva.
      worker.w = w; worker.h = h; worker.dados = { ...worker.dados, aberta };
      filhos2.push(worker);
      arestas.push({ id: `${cardId}->${worker.id}`, de: cardId, para: worker.id });
      maiorLargura = Math.max(maiorLargura, w);
      if (idx > 1) somaAlturas += GAP;
      somaAlturas += h;
      colunaY += h + GAP;
    }
    const caixa2 = caixaDoGrupo(
      fase2X, faseY,
      PAD + maiorLargura + PAD,
      PAD + (n ? somaAlturas : SLICE_H_COMPACTA) + PAD,
      filhos2,
    );
    const fase2: No = {
      id: fase2Id, tipo: "grupo", x: fase2X, y: faseY, w: caixa2.w, h: caixa2.h,
      dados: { auto: true, runId: run.id, fase: 2, titulo: TITULOS_FASE[1] }, rev: 0,
    };
    nos.push(fase2, ...filhos2);

    // ---- FASE 3: o gate no topo e o diff abaixo ----
    const fase3X = fase2X + fase2.w + FASE_GAP;
    const gate = comSalvo({
      id: `gate:${run.id}`, tipo: "gate", x: fase3X + PAD, y: faseY + PAD, w: GATE_W, h: GATE_H,
      pai: fase3Id, dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos);
    const diff = comSalvo({
      id: `diff:${run.id}`, tipo: "diff", x: fase3X + PAD, y: faseY + PAD + GATE_H + GAP, w: DIFF_W, h: DIFF_H,
      pai: fase3Id, dados: { auto: true, runId: run.id }, rev: 0,
    }, salvos);
    const caixa3 = caixaDoGrupo(
      fase3X, faseY,
      PAD + Math.max(GATE_W, DIFF_W) + PAD,
      PAD + GATE_H + GAP + DIFF_H + PAD,
      [gate, diff],
    );
    const fase3: No = {
      id: fase3Id, tipo: "grupo", x: fase3X, y: faseY, w: caixa3.w, h: caixa3.h,
      dados: { auto: true, runId: run.id, fase: 3, titulo: TITULOS_FASE[2] }, rev: 0,
    };
    nos.push(fase3, gate, diff);

    // Aresta de entrada do gate: a ultima slice (sem slices, a propria run).
    const antesDoGate = n ? `worker:${run.id}:${n}` : cardId;
    arestas.push({ id: `${antesDoGate}->gate:${run.id}`, de: antesDoGate, para: `gate:${run.id}` });
    arestas.push({ id: `gate:${run.id}->diff:${run.id}`, de: `gate:${run.id}`, para: `diff:${run.id}` });

    fundo = Math.max(fundo, fase1.y + fase1.h, fase2.y + fase2.h, fase3.y + fase3.h);
    cursorY = fundo + ESPACO_VERTICAL;
  });

  // Planejadores: cada um abaixo do pedido da fase 1 da run mais recente do cwd dele (so' quando essa
  // run esta' expandida — recolhida, o planejador fica onde ja' estava).
  for (const p of planejadores) {
    const runId = runDoCwd.get(cwdChave(p.cwd));
    const fase1 = runId ? fases1.get(runId) : undefined;
    if (!runId || !fase1) continue;
    const k = (planosDoRun.get(runId) ?? []).indexOf(p.agId);
    agentes.push({
      id: p.agId, pai: `fase1:${runId}`, x: fase1.x + PAD,
      y: fase1.y + PAD + PEDIDO_H + GAP + Math.max(0, k) * (AGENTE_H + GAP),
    });
  }

  return { nos, arestas, agentes };
}

// Layout dos agentes (CA-5b): planejadores ainda sem no' no canvas

// Ligacao planejador -> run e pedido em andamento (G2/S3)

// Chave canonica do cwd de uma run/planejador: separadores uniformes ('/'), sem barra final e caixa
// baixa (no Windows 'D:\x' e 'd:/x' apontam pro mesmo lugar).
function cwdChave(cwd: string): string {
  return cwd.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// Uma run "tem painel" quando ja' recebeu o evento final: o evento 'painel' preenche Run.painel (que
// nasce null; ver mutar() em estado.ts). NAO usar o status: 'pausada' (G3) nao e' fim de run.
function temPainel(r: Run): boolean {
  return r.painel !== null;
}

/**
 * Arestas planejador -> run (CA-G2b): cada run cujo cwd (normalizado) e' o cwd de um planejador ganha
 * uma aresta `ag:<planejador> -> run:<id>` (o planejador Claude roda no worktree e dispara a run ali).
 * Run de outro cwd (ou sem planejador correspondente) fica de fora; cwd diferente que normaliza igual
 * ("D:\\x\\" == "d:/x") casa.
 */
export function arestasPlanejadorRun(plans: { agId: string; cwd: string }[], runs: Run[]): ArestaLayout[] {
  const porCwd = new Map<string, string[]>();
  for (const p of plans) {
    const k = cwdChave(p.cwd);
    if (!k) continue;
    const lista = porCwd.get(k);
    if (lista) lista.push(p.agId); else porCwd.set(k, [p.agId]);
  }
  const out: ArestaLayout[] = [];
  for (const run of runs) {
    const donos = porCwd.get(cwdChave(run.cwd));
    if (!donos) continue;
    for (const agId of donos) out.push({ id: `${agId}->run:${run.id}`, de: agId, para: `run:${run.id}` });
  }
  return out;
}

/**
 * O pedido feito por um agente ainda esta' em andamento? true enquanto o planejador planeja (nenhuma
 * run naquele cwd ainda) ou a run daquele cwd esta' rodando; false assim que existe uma run naquele
 * cwd que ja' recebeu o painel (status final). Run de outro cwd nao conta (CA-G2e).
 */
export function pedidoAtivo(cwd: string, runs: Run[]): boolean {
  const k = cwdChave(cwd);
  return !runs.some((r) => cwdChave(r.cwd) === k && temPainel(r));
}

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
 * Ultimas 200 linhas de uma slice (tipos tool/slice/log/instrucao/pausa), em ordem cronologica.
 * `ferramenta` e' o nome da ferramenta (tool), 'instrução'/'pausa' para os eventos da G3, ou o proprio tipo;
 * `texto` e' o resto (para tool, sem o nome no inicio).
 */
export function feedDaSlice(run: Run, idx: number): LinhaFeed[] {
  const itens = run.feed.filter((f) => f.slice === idx &&
    (f.tipo === "tool" || f.tipo === "slice" || f.tipo === "log" || f.tipo === "instrucao" || f.tipo === "pausa"));
  return itens.slice(-200).map((f) => {
    const ferramenta = f.tipo === "tool" ? f.nome ?? "tool" : f.tipo === "instrucao" ? "instrução" : f.tipo;
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

// Pipeline do card da run (CA-19) e resumo do gate (CA-18)

export type StatusPipeline = "fila" | "rodando" | "ok" | "falha" | "pausada";
export type NoPipeline = { id: string; rotulo: string; status: StatusPipeline };
export type ResumoGate = {
  comandos: { cmd: string; status: "fila" | "rodando" | "ok" | "falha"; saida: string }[];
  reparo: number | null;
  final: "ok" | "falha" | "rodando" | "aguardando";
};

/** Status de uma slice no pipeline: pausada vence o rodando; incompleta/pulada = falha. */
function statusDaSlice(slice: SliceEstado | undefined): StatusPipeline {
  if (!slice || slice.status === "fila") return "fila";
  if (slice.status === "incompleta" || slice.status === "pulada") return "falha";
  if (slice.pausada) return "pausada";
  return slice.status; // rodando | ok
}

/**
 * Pipeline do card da run (CA-19): Pedido (ok), Plano (ok quando o plano chegou; senao rodando), uma
 * entrada S1..Sn por slice (n = max(plano, slices); fila/rodando/ok; incompleta|pulada = falha;
 * pausada = pausada), Gate (de resumoGate: 'aguardando' vira fila, senao o proprio final) e Commit
 * (painel COMPLETE = ok; outro status com painel = falha; sem painel = fila).
 */
export function pipelineDaRun(run: Run): NoPipeline[] {
  const out: NoPipeline[] = [
    { id: "pedido", rotulo: "Pedido", status: "ok" },
    { id: "plano", rotulo: "Plano", status: run.plano.length ? "ok" : "rodando" },
  ];
  const n = Math.max(run.plano.length, run.slices.length);
  for (let idx = 1; idx <= n; idx++) {
    out.push({ id: `s${idx}`, rotulo: `S${idx}`, status: statusDaSlice(run.slices.find((s) => s.idx === idx)) });
  }
  const gate = resumoGate(run);
  out.push({ id: "gate", rotulo: "Gate", status: gate.final === "aguardando" ? "fila" : gate.final });
  out.push({
    id: "commit", rotulo: "Commit",
    status: !temPainel(run) ? "fila" : run.status === "COMPLETE" ? "ok" : "falha",
  });
  return out;
}

/**
 * Resumo do gate (CA-18): so' a TENTATIVA mais alta (k = maior `tentativa` de run.gate; ausente = 0).
 * Os comandos saem na ordem de run.gateCmds (se vazio, na ordem de aparicao na tentativa k; cmd que
 * rodou e nao estava na lista entra no fim) e cada um fica com o ULTIMO evento dele na tentativa k
 * (sem evento: 'fila' e saida ''). `reparo` = k (null quando k = 0). `final`: 'aguardando' sem eventos,
 * 'falha' se algum falhou, 'ok' se todos ok, senao 'rodando'.
 */
export function resumoGate(run: Run): ResumoGate {
  const k = run.gate.reduce((m, g) => Math.max(m, g.tentativa ?? 0), 0);
  const daTentativa = run.gate.filter((g) => (g.tentativa ?? 0) === k);
  const cmds: string[] = [...run.gateCmds];
  for (const g of daTentativa) if (!cmds.includes(g.cmd)) cmds.push(g.cmd);
  const comandos = cmds.map((cmd) => {
    const ultimo = [...daTentativa].reverse().find((g) => g.cmd === cmd);
    return { cmd, status: (ultimo?.status ?? "fila") as ResumoGate["comandos"][number]["status"], saida: ultimo?.saida ?? "" };
  });
  const final: ResumoGate["final"] = !run.gate.length ? "aguardando"
    : comandos.some((c) => c.status === "falha") ? "falha"
      : comandos.length && comandos.every((c) => c.status === "ok") ? "ok"
        : "rodando";
  return { comandos, reparo: k > 0 ? k : null, final };
}
