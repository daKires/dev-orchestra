// Estado da UI derivado SO dos eventos do bridge (SSE /events). Reducer puro: toda regra de exibicao
// (status, progresso, KPIs, alerta de "sem resposta") mora aqui e e' testada em estado.test.ts.
import type { Evento, Planejador, SlicePlano } from "../../../src/ui.ts";
import type { Aresta, No, Op } from "../../../src/canvas.ts";

export type StatusSlice = "fila" | "rodando" | "ok" | "incompleta" | "pulada";
export type Metrica = Extract<Evento, { t: "metrica" }>;
export type GateItem = Extract<Evento, { t: "gate" }>;

export type SliceEstado = {
  idx: number; tarefa: string; status: StatusSlice; plano?: SlicePlano;
  escritos: string[]; comandos: string[]; motivo?: string; ms?: number; semMudancas?: boolean;
  inicioTs?: number; metrica?: Metrica; pausada?: boolean;
};
export type FeedItem = { ts: number; slice?: number; tipo: "tool" | "fase" | "slice" | "log" | "instrucao" | "pausa"; texto: string; erro: boolean; nome?: string };
export type Atividade =
  | { tipo: "gerando"; slice: number; tokens: number; ts: number }
  | { tipo: "comando"; slice: number; cmd: string; desde: number }
  | null;

export type Run = {
  id: string; feature: string; cwd: string; projeto: string; inicioTs: number; ultimoEventoTs: number;
  status: string; branch: string; baseline: string;
  plano: SlicePlano[]; cmds: string[]; gateCmds: string[];
  slices: SliceEstado[]; feed: FeedItem[]; gate: GateItem[];
  diffs: Record<string, string>; ordemDiffs: string[];
  metricas: Metrica[]; painel: string[] | null; atividade: Atividade;
};
export type Estado = { runs: Record<string, Run>; planejadores: Planejador[] };
// Lote de operacoes do canvas de um projeto (o hub emite { canvasOp: { projeto, ops } } no SSE).
export type MsgCanvasOp = { projeto: string; ops: Op[] };
// Snapshot do canvas de um projeto (o hub emite { canvas: { projeto, nos, arestas } } no SSE).
export type MsgCanvasSnapshot = { projeto: string; nos: No[]; arestas: Aresta[] };
// Ate' tres familias de mensagens do hub: eventos de uma run ({swarm, ev}); mensagens globais do hub
// ({planejadores} substitui a lista de chats); e mensagens do canvas ({canvasOp}/{canvas}), que o
// reducer de runs apenas IGNORA (outro estado as usa).
export type Msg =
  | { swarm: string; ev?: Evento; drop?: boolean }
  | { planejadores?: Planejador[] }
  | { canvasOp?: MsgCanvasOp; canvas?: MsgCanvasSnapshot };

/** true SO' para um objeto com `canvasOp` ou `canvas` (mensagem do canvas, nao' de run/hub). */
export function ehMsgCanvas(m: unknown): boolean {
  if (!m || typeof m !== "object") return false;
  const o = m as Record<string, unknown>;
  return "canvasOp" in o || "canvas" in o;
}

export const OCIOSO_MS = 60_000;         // alerta "sem resposta" (mesmo teto do timer ocioso do bridge)
export const CMD_TIMEOUT_MS = 120_000;   // comando alem disso = travado
export const INTERROMPIDA_MS = 10 * 60_000; // sem evento nem painel por 10 min = processo morreu

export const vazio: Estado = { runs: {}, planejadores: [] };

function nova(id: string): Run {
  return {
    id, feature: id, cwd: "", projeto: "", inicioTs: 0, ultimoEventoTs: 0, status: "aguardando", branch: "", baseline: "",
    plano: [], cmds: [], gateCmds: [], slices: [], feed: [], gate: [], diffs: {}, ordemDiffs: [], metricas: [], painel: null, atividade: null,
  };
}

// Copia rasa da run + dos arrays/objetos que o reducer muta (uma vez por lote).
function copiar(r: Run): Run {
  return {
    ...r, plano: r.plano, cmds: r.cmds, gateCmds: r.gateCmds, slices: r.slices.map((s) => ({ ...s })), feed: r.feed.slice(),
    gate: r.gate.slice(), diffs: { ...r.diffs }, ordemDiffs: r.ordemDiffs.slice(), metricas: r.metricas.slice(), painel: r.painel,
  };
}

// Worktree do Claude Code (<proj>/.claude/worktrees/<nome>) conta como o proprio projeto.
export function raiz(cwd: string): string {
  return cwd.replace(/[\\/]+$/, "").replace(/[\\/]\.claude[\\/]worktrees[\\/][^\\/]+$/i, "");
}

export function projetoDe(cwd: string): string {
  return raiz(cwd).split(/[\\/]/).pop() || cwd;
}

const FEED_MAX = 2000;

function mutar(r: Run, ev: Evento): void {
  const ts = ev.ts ?? Date.now();
  r.ultimoEventoTs = Math.max(r.ultimoEventoTs, ts);
  const feed = (tipo: FeedItem["tipo"], texto: string, erro = false, slice?: number, nome?: string) => {
    r.feed.push({ ts, slice, tipo, texto, erro, ...(nome !== undefined ? { nome } : {}) });
    if (r.feed.length > FEED_MAX) r.feed.splice(0, r.feed.length - FEED_MAX);
  };
  switch (ev.t) {
    case "run":
      r.feature = ev.feature; r.cwd = ev.cwd; r.projeto = projetoDe(ev.cwd); r.inicioTs = ts; r.status = "rodando";
      r.plano = ev.plano ?? []; r.cmds = ev.cmds ?? []; r.gateCmds = ev.gate ?? [];
      break;
    case "fase":
      if (ev.nome === "branch" && ev.info) r.branch = ev.info.replace(" (existente)", "");
      feed("fase", ev.nome + (ev.info ? ": " + ev.info : ""));
      break;
    case "slice": {
      let s = r.slices.find((x) => x.idx === ev.idx);
      if (!s) {
        s = { idx: ev.idx, tarefa: ev.tarefa, status: ev.status, escritos: [], comandos: [], plano: r.plano[ev.idx - 1] };
        r.slices.push(s);
        r.slices.sort((a, b) => a.idx - b.idx);
      }
      s.tarefa = ev.tarefa; s.status = ev.status;
      if (ev.escritos) s.escritos = ev.escritos;
      if (ev.comandos) s.comandos = ev.comandos;
      if (ev.motivo !== undefined) s.motivo = ev.motivo;
      if (ev.ms !== undefined) s.ms = ev.ms;
      if (ev.semMudancas) s.semMudancas = true;
      if (ev.status === "rodando") { s.inicioTs = ts; r.atividade = null; feed("slice", `Slice ${ev.idx}/${ev.total}: ${ev.tarefa}`, false, ev.idx); }
      if (ev.status === "incompleta") feed("slice", `Slice ${ev.idx} incompleta: ${ev.motivo ?? ""}`, true, ev.idx);
      if (ev.status !== "rodando" && r.atividade?.slice === ev.idx) r.atividade = null;
      break;
    }
    case "tool":
      if (r.atividade?.tipo === "comando" && ev.nome === "rodar_comando") r.atividade = null;
      feed("tool", ev.nome + (ev.alvo ? " " + ev.alvo : "") + (ev.ok ? "" : " — " + (ev.resumo || "erro")), !ev.ok, ev.slice, ev.nome);
      break;
    case "gerando":
      r.atividade = { tipo: "gerando", slice: ev.slice, tokens: ev.tokens, ts };
      break;
    case "comando":
      r.atividade = { tipo: "comando", slice: ev.slice, cmd: ev.cmd, desde: ts };
      break;
    case "gate":
      r.gate.push(ev);
      r.atividade = null;
      break;
    case "diff":
      if (!(ev.arquivo in r.diffs)) r.ordemDiffs.push(ev.arquivo);
      r.diffs[ev.arquivo] = ev.patch;
      break;
    case "metrica": {
      r.metricas.push(ev);
      const s = r.slices.find((x) => x.idx === ev.slice);
      if (s) s.metrica = ev;
      break;
    }
    case "painel":
      r.status = ev.status; r.painel = ev.linhas; r.atividade = null;
      if (ev.branch) r.branch = ev.branch;
      if (ev.baseline) r.baseline = ev.baseline;
      break;
    case "log":
      if (ev.texto) feed("log", ev.texto, /ERRO|tentativa/.test(ev.texto));
      break;
    case "instrucao":
      // Instrucao entregue a slice viva; descartada = chegou tarde (a slice ja' terminou).
      feed("instrucao", ev.descartada ? `descartada (slice terminou) · ${ev.texto}` : ev.texto, !!ev.descartada, ev.slice);
      break;
    case "pausa": {
      const s = r.slices.find((x) => x.idx === ev.slice);
      if (ev.estado === "pausada") {
        if (s) s.pausada = true;
        r.status = "pausada";
        feed("pausa", "pausada", false, ev.slice);
      } else {
        if (s) s.pausada = false;
        if (r.status === "pausada") r.status = "rodando";
        feed("pausa", ev.motivo ? `retomada: ${ev.motivo}` : "retomada", false, ev.slice);
      }
      break;
    }
  }
}

// Aplica um LOTE de mensagens (replay inicial chega em rajada) clonando cada run tocada uma vez so.
export function aplicar(e: Estado, msgs: Msg[]): Estado {
  const runs = { ...e.runs };
  const tocadas = new Set<string>();
  let planejadores = e.planejadores;
  for (const m of msgs) {
    if (ehMsgCanvas(m)) continue; // mensagens do canvas nao mexem em runs/planejadores
    if ("planejadores" in m && m.planejadores) planejadores = m.planejadores; // substitui a lista inteira
    if (!("swarm" in m)) continue;
    if (m.drop) { delete runs[m.swarm]; tocadas.delete(m.swarm); continue; }
    if (!m.ev) continue;
    if (!tocadas.has(m.swarm)) { runs[m.swarm] = runs[m.swarm] ? copiar(runs[m.swarm]) : nova(m.swarm); tocadas.add(m.swarm); }
    mutar(runs[m.swarm], m.ev);
  }
  return { runs, planejadores };
}

// ---- derivados ----

export function statusVisivel(r: Run, agora: number): string {
  if (r.status === "rodando" && r.ultimoEventoTs && agora - r.ultimoEventoTs > INTERROMPIDA_MS) return "INTERROMPIDA";
  return r.status;
}

export function rodando(r: Run, agora: number): boolean {
  return statusVisivel(r, agora) === "rodando";
}

// Alerta "sem resposta": ciente de comando longo (teste/build rodando nao e' travamento).
export function alerta(r: Run, agora: number): string | null {
  if (!rodando(r, agora)) return null;
  const a = r.atividade;
  if (a?.tipo === "comando") {
    const s = Math.round((agora - a.desde) / 1000);
    return agora - a.desde > CMD_TIMEOUT_MS ? `comando rodando há ${s}s (além do timeout)` : null;
  }
  const parado = agora - r.ultimoEventoTs;
  return parado > OCIOSO_MS ? `sem resposta há ${Math.round(parado / 1000)}s` : null;
}

export function progresso(r: Run): { feitas: number; total: number } {
  const total = r.slices.length || r.plano.length;
  const feitas = r.slices.filter((s) => s.status === "ok" || s.status === "incompleta" || s.status === "pulada").length;
  return { feitas, total };
}

export function kpis(r: Run) {
  const m = r.metricas;
  const n = m.length;
  const soma = (f: (x: Metrica) => number) => m.reduce((a, x) => a + f(x), 0);
  return {
    n,
    passouDePrimeira: n ? m.filter((x) => x.passouDePrimeira).length / n : null,
    mediaIteracoes: n ? soma((x) => x.iteracoes) / n : null,
    tocouNoTeste: n ? m.filter((x) => x.tocouNoTeste > 0).length / n : null,
    falhasAmbiente: soma((x) => x.falhasAmbiente ?? 0),
    tokensIn: soma((x) => x.tokensIn),
    tokensOut: soma((x) => x.tokensOut),
    custo: soma((x) => x.custoUSD),
  };
}

// Runs agrupadas por projeto (pasta), grupos e runs mais novos primeiro.
export function porProjeto(e: Estado): { cwd: string; projeto: string; runs: Run[] }[] {
  const g = new Map<string, Run[]>();
  for (const r of Object.values(e.runs)) {
    const k = raiz(r.cwd || "(sem pasta)").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase(); // D:\x == d:/x
    if (!g.has(k)) g.set(k, []);
    g.get(k)!.push(r);
  }
  return [...g.entries()]
    .map(([, runs]) => runs.sort((a, b) => b.inicioTs - a.inicioTs))
    .map((runs) => ({ cwd: runs[0].cwd, projeto: runs[0].projeto || projetoDe(runs[0].cwd), runs }))
    .sort((a, b) => b.runs[0].inicioTs - a.runs[0].inicioTs);
}

// Chave canonica da RAIZ de um caminho: worktree -> raiz do projeto (regra raiz()), tudo minusculo,
// separadores uniformes ('/') e sem barra final, pra comparar "D:\x" com "d:/x" e afins.
function chaveRaiz(p: string): string {
  return raiz(p).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// Runs do projeto `projeto`: mesma RAIZ do caminho pedido (worktree conta como o projeto), com a
// mesma canonizacao de chaveRaiz (grafias diferentes de "D:\x" e "d:/x" batem). Ordinal preservado.
export function runsDoProjeto(runs: Run[], projeto: string): Run[] {
  const alvo = chaveRaiz(projeto);
  return runs.filter((r) => r.cwd !== "" && chaveRaiz(r.cwd) === alvo);
}

// Linguagem do Shiki pela extensao do arquivo do diff; null = sem highlight (so cores +/-).
export function linguagemDe(arquivo: string): string | null {
  const ext = arquivo.toLowerCase().split(".").pop() ?? "";
  const mapa: Record<string, string> = {
    luau: "luau", lua: "lua", ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript",
    json: "json", html: "html", htm: "html", css: "css", md: "markdown",
  };
  return mapa[ext] ?? null;
}

export type LinhaDiff = { tipo: "add" | "rem" | "ctx" | "hunk" | "meta"; texto: string; velha?: number; nova?: number };

// Parse de um patch unificado do git em linhas com numeracao antiga/nova.
export function parseDiff(patch: string): LinhaDiff[] {
  const out: LinhaDiff[] = [];
  let velha = 0, nova = 0, emHunk = false;
  for (const l of patch.replace(/\r/g, "").split("\n")) {
    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(l);
    if (h) { velha = Number(h[1]); nova = Number(h[2]); emHunk = true; out.push({ tipo: "hunk", texto: l }); continue; }
    if (!emHunk) { if (l) out.push({ tipo: "meta", texto: l }); continue; }
    if (l.startsWith("+")) out.push({ tipo: "add", texto: l.slice(1), nova: nova++ });
    else if (l.startsWith("-")) out.push({ tipo: "rem", texto: l.slice(1), velha: velha++ });
    else if (l.startsWith("\\")) out.push({ tipo: "meta", texto: l });
    else if (l !== "" || out.length) out.push({ tipo: "ctx", texto: l.slice(1), velha: velha++, nova: nova++ });
  }
  while (out.length && out[out.length - 1].tipo === "ctx" && out[out.length - 1].texto === "") out.pop();
  return out;
}
