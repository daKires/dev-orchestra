// Spec da G1: run em arvore (planejador/run -> slices -> arquivos), slice viva e painel de runs (CA-G1a,d,e,g).
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";
import { layoutRuns, resumoPainel, feedDaSlice } from "./layout.ts";
import type { No, Snapshot } from "../../../canvas.ts";

const T = 1_000_000;
function runDe(id: string, extra: Msg[] = [], ts = T, n = 3): Run {
  const plano = Array.from({ length: n }, (_, i) => ({ tarefa: "t" + (i + 1), arquivos_alvo: [], descricao: "" }));
  return aplicar(vazio, [{ swarm: id, ev: { t: "run", feature: "f-" + id, cwd: "D:/p", total: n, ts, plano } }, ...extra]).runs[id];
}
const fim = (id: string, status = "COMPLETE"): Msg => ({ swarm: id, ev: { t: "painel", status, branch: "orchestra/x", linhas: [], ts: T + 50 } });
const vazioS: Snapshot = { nos: [], arestas: [] };
const salvoCard = (id: string, dados: Record<string, unknown>): No =>
  ({ id: "run:" + id, tipo: "run", x: 0, y: 0, w: 280, h: 110, dados: { auto: true, runId: id, ...dados }, rev: 1 });

test("a run ativa abre sozinha; terminadas ficam recolhidas; fechar a ativa a mantem fechada (CA-G1a)", () => {
  const ativa = runDe("ra");
  const pronta = runDe("rp", [fim("rp")], T - 1000);
  const l = layoutRuns([ativa, pronta], vazioS);
  assert.ok(l.nos.some((n) => n.id === "reg:ra"), "ativa expandida sem precisar clicar");
  assert.ok(!l.nos.some((n) => n.id === "reg:rp"), "terminada recolhida");
  const fechada = layoutRuns([ativa], { nos: [salvoCard("ra", { expandida: false })], arestas: [] });
  assert.ok(!fechada.nos.some((n) => n.id === "reg:ra"), "voce fechou: continua fechada");
  const aberta = layoutRuns([pronta], { nos: [salvoCard("rp", { expandida: true })], arestas: [] });
  assert.ok(aberta.nos.some((n) => n.id === "reg:rp"), "terminada abre no clique");
});

test("vista Arvore (padrao): slices em coluna, arquivos na linha da slice, conectores run->slice->arquivo (CA-G1a, G1e)", () => {
  const r = runDe("rx", [
    { swarm: "rx", ev: { t: "slice", idx: 1, total: 3, tarefa: "t1", status: "ok", escritos: ["a.ts", "a.test.ts"], ts: T + 1 } },
    { swarm: "rx", ev: { t: "slice", idx: 2, total: 3, tarefa: "t2", status: "ok", escritos: ["b.ts"], ts: T + 2 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "a.ts", patch: "@@", ts: T + 3 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "a.test.ts", patch: "@@", ts: T + 3 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "b.ts", patch: "@@", ts: T + 4 } },
    { swarm: "rx", ev: { t: "diff", arquivo: "README.md", patch: "@@", ts: T + 5 } },
  ]);
  const l = layoutRuns([r], vazioS);
  const no = (id: string) => l.nos.find((n) => n.id === id)!;
  assert.ok(!l.nos.some((n) => n.id.startsWith("flow:")), "arvore nao desenha o fluxograma");
  const s = [1, 2, 3].map((i) => no("worker:rx:" + i));
  assert.ok(s.every((x) => x && x.tipo === "worker" && x.pai === "reg:rx"));
  assert.ok(s[0].x === s[1].x && s[1].x === s[2].x, "slices na mesma coluna");
  assert.ok(s[0].y < s[1].y && s[1].y < s[2].y, "slices em ordem, de cima pra baixo");
  for (let i = 0; i < 2; i++) assert.ok(s[i].y + s[i].h <= s[i + 1].y, "slices nao se sobrepoem");
  const liga = (de: string, para: string) => l.arestas.some((e) => e.de === de && e.para === para);
  for (let i = 1; i <= 3; i++) assert.ok(liga("run:rx", "worker:rx:" + i), "run liga em cada slice");
  for (const [arq, dono] of [["a.ts", 1], ["a.test.ts", 1], ["b.ts", 2]] as const) {
    const a = no("arq:rx:" + arq), w = no("worker:rx:" + dono);
    assert.ok(a.x >= w.x + w.w, `${arq} a direita da slice`);
    assert.ok(a.y >= w.y && a.y < w.y + Math.max(w.h, 64), `${arq} na linha da slice ${dono}`);
    assert.ok(liga("worker:rx:" + dono, "arq:rx:" + arq), `slice ${dono} liga em ${arq}`);
  }
  const solto = no("arq:rx:README.md");
  assert.ok(solto.y >= s[2].y + s[2].h, "arquivo sem slice abaixo da ultima slice");
  assert.ok(liga("run:rx", "arq:rx:README.md"));
  assert.equal(no("reg:rx").dados.titulo, "f-rx");
});

test("slice viva: a rodando abre larga; clique abre/fecha (dados.aberta salvo); arquivos andam pra direita (CA-G1d)", () => {
  const r = runDe("rv", [
    { swarm: "rv", ev: { t: "slice", idx: 1, total: 3, tarefa: "t1", status: "ok", escritos: ["a.ts"], ts: T + 1 } },
    { swarm: "rv", ev: { t: "slice", idx: 2, total: 3, tarefa: "t2", status: "rodando", ts: T + 2 } },
    { swarm: "rv", ev: { t: "diff", arquivo: "a.ts", patch: "@@", ts: T + 3 } },
  ]);
  const l = layoutRuns([r], vazioS);
  const no = (lay: typeof l, id: string) => lay.nos.find((n) => n.id === id)!;
  const fechada = no(l, "worker:rv:1"), viva = no(l, "worker:rv:2");
  assert.ok(viva.w > fechada.w * 1.8 && viva.h > fechada.h * 2, "a rodando abre larga e alta (card ao vivo)");
  assert.equal(viva.dados.aberta, true);
  const s1Aberta = layoutRuns([r], { nos: [{ ...fechada, dados: { ...fechada.dados, aberta: true }, rev: 2 }], arestas: [] });
  const w1 = no(s1Aberta, "worker:rv:1");
  assert.ok(w1.w > fechada.w * 1.8, "clique abre a slice terminada");
  assert.ok(no(s1Aberta, "arq:rv:a.ts").x >= w1.x + w1.w, "arquivo continua a direita da slice aberta");
  const fechouViva = layoutRuns([r], { nos: [{ ...viva, dados: { ...viva.dados, aberta: false }, rev: 2 }], arestas: [] });
  assert.ok(no(fechouViva, "worker:rv:2").w <= fechada.w, "voce fechou a viva: fica compacta");
});

test("vista Fluxo: card salvo com vista 'fluxo' volta ao fluxograma Inicio->Gate (CA-G1e)", () => {
  const r = runDe("rf");
  const l = layoutRuns([r], { nos: [salvoCard("rf", { vista: "fluxo" })], arestas: [] });
  for (const id of ["flow:rf:inicio", "flow:rf:1", "flow:rf:gate", "flow:rf:fim"]) assert.ok(l.nos.some((n) => n.id === id), id);
});

test("feedDaSlice: ultimas 200 linhas da slice com hora, ferramenta e texto; erro marcado (CA-G1d)", () => {
  const evs: Msg[] = [{ swarm: "rd", ev: { t: "slice", idx: 1, total: 3, tarefa: "t1", status: "rodando", ts: T + 1 } }];
  for (let i = 0; i < 250; i++) evs.push({ swarm: "rd", ev: { t: "tool", slice: 1, nome: "ler_arquivo", alvo: "f" + i + ".ts", ok: i !== 249, resumo: "falhou", ts: T + 10 + i } });
  evs.push({ swarm: "rd", ev: { t: "tool", slice: 2, nome: "listar", alvo: ".", ok: true, ts: T + 999 } });
  const r = runDe("rd", evs);
  const f = feedDaSlice(r, 1);
  assert.equal(f.length, 200);
  assert.equal(f[0].ts < f[199].ts, true, "ordem cronologica");
  const ult = f[199];
  assert.equal(ult.ferramenta, "ler_arquivo");
  assert.match(ult.texto, /f249\.ts/);
  assert.equal(ult.erro, true);
  assert.ok(!f.some((x) => /^\.$/.test(x.texto)), "so' a slice pedida");
});

test("resumoPainel: ultimos 7 dias, KPIs e linhas mais novas primeiro (CA-G1g)", () => {
  const dia = 24 * 3600 * 1000, agora = T + 10 * dia;
  const met = (id: string, primeira: boolean, custo: number, amb = 0): Msg =>
    ({ swarm: id, ev: { t: "metrica", slice: 1, iteracoes: 1, passouDePrimeira: primeira, tocouNoTeste: 0, falhasAmbiente: amb, tokensIn: 1, tokensOut: 1, custoUSD: custo, ts: T } });
  const velha = runDe("rold", [fim("rold")], agora - 8 * dia);
  const a = runDe("ra", [met("ra", true, 0.02), met("ra", false, 0.03), fim("ra")], agora - 2 * dia);
  const b = runDe("rb", [met("rb", true, 0.01, 1)], agora - 1 * dia);
  const p = resumoPainel([velha, a, b], agora);
  assert.equal(p.total, 2, "fora dos 7 dias nao conta");
  assert.equal(p.completas, 1);
  assert.ok(Math.abs(p.primeiraTentativa! - 2 / 3) < 1e-9, "2 de 3 slices de primeira");
  assert.ok(Math.abs(p.custo - 0.06) < 1e-9);
  assert.equal(p.falhasAmbiente, 1);
  assert.deepEqual(p.linhas.map((x) => x.id), ["rb", "ra"]);
  assert.deepEqual(Object.keys(p.linhas[0]).sort(), ["custo", "feature", "id", "ms", "slicesOk", "slicesTotal", "status"].sort());
  assert.equal(resumoPainel([], agora).primeiraTentativa, null);
});

test("runs empilhadas nao se sobrepoem: cada run comeca abaixo da regiao/card da anterior (G1 fix)", () => {
  const evs = (id: string): Msg[] => [1, 2, 3].map((i) => ({ swarm: id, ev: { t: "slice", idx: i, total: 3, tarefa: "t" + i, status: "ok", escritos: [`f${i}.ts`], ts: T + i } } as Msg));
  const a = runDe("ka", evs("ka"), T + 2000), b = runDe("kb", evs("kb"), T + 1000), c = runDe("kc", [], T);
  const l = layoutRuns([a, b, c], vazioS, T + 3000); // as tres ativas e recentes: todas abertas
  assert.ok(["ka", "kb", "kc"].every((id) => l.nos.some((n) => n.id === "reg:" + id)), "todas expandidas");
  const caixa = (id: string) => {
    const nos = l.nos.filter((n) => n.id === "run:" + id || n.id === "reg:" + id);
    return { y1: Math.min(...nos.map((n) => n.y)), y2: Math.max(...nos.map((n) => n.y + n.h)) };
  };
  const ordem = ["ka", "kb", "kc"].map(caixa);
  for (let i = 0; i < 2; i++) assert.ok(ordem[i].y2 <= ordem[i + 1].y1, `run ${i} termina antes da proxima comecar`);
});

test("card da run comporta status, Arvore|Fluxo e acoes (altura >= 170) (G1 fix)", () => {
  const l = layoutRuns([runDe("kh", [fim("kh")])], vazioS);
  assert.ok(l.nos.find((n) => n.id === "run:kh")!.h >= 170);
});

test("run 'rodando' sem evento ha mais de 10 min (processo morreu) nao abre sozinha (G1 fix)", () => {
  const r = runDe("kz", [{ swarm: "kz", ev: { t: "slice", idx: 1, total: 3, tarefa: "t1", status: "rodando", ts: T + 5 } }]);
  const viva = layoutRuns([r], vazioS, r.ultimoEventoTs + 60_000);
  assert.ok(viva.nos.some((n) => n.id === "reg:kz"), "ativa recente abre");
  const morta = layoutRuns([r], vazioS, r.ultimoEventoTs + 11 * 60_000);
  assert.ok(!morta.nos.some((n) => n.id === "reg:kz"), "parada ha 11 min: recolhida");
  assert.equal(morta.nos.find((n) => n.id === "worker:kz:1"), undefined);
});

test("card de run salvo com altura antiga usa a altura atual (G1 fix)", () => {
  const l = layoutRuns([runDe("ks", [fim("ks")])], { nos: [{ ...salvoCard("ks", { movido: true }), x: 40, y: 900, h: 110 }], arestas: [] });
  const c = l.nos.find((n) => n.id === "run:ks")!;
  assert.deepEqual([c.x, c.y], [40, 900], "posicao salva continua valendo");
  assert.ok(c.h >= 170, "altura nao vem do salvo");
});

test("card de run so' fica onde foi salvo se voce o arrastou (dados.movido); senao segue o empilhamento (G1 fix)", () => {
  const evs = (id: string): Msg[] => [1, 2, 3].map((i) => ({ swarm: id, ev: { t: "slice", idx: i, total: 3, tarefa: "t" + i, status: "ok", escritos: [`f${i}.ts`], ts: T + i } } as Msg));
  const a = runDe("ma", [...evs("ma"), fim("ma")], T + 2000), b = runDe("mb", [...evs("mb"), fim("mb")], T + 1000);
  // salvos pelo clique em Expandir, com a posicao que tinham quando ainda estavam recolhidos
  const nos = [{ ...salvoCard("ma", { expandida: true }), x: 0, y: 40 }, { ...salvoCard("mb", { expandida: true }), x: 0, y: 250 }];
  const l = layoutRuns([a, b], { nos, arestas: [] });
  const regA = l.nos.find((n) => n.id === "reg:ma")!, cardB = l.nos.find((n) => n.id === "run:mb")!;
  assert.ok(cardB.y >= regA.y + regA.h, "a run de baixo desce quando a de cima abre");
  const movido = layoutRuns([a, b], { nos: [nos[0], { ...nos[1], dados: { ...nos[1].dados, movido: true } }], arestas: [] });
  assert.equal(movido.nos.find((n) => n.id === "run:mb")!.y, 250, "arrastado por voce: fica onde voce pos");
});

test("mesclarComLayout: no automatico salvo usa a versao do layout; os do usuario e os ocultos seguem a regra atual (G1 fix)", async () => {
  const { mesclarComLayout } = await import("./layout.ts");
  const salvos: No[] = [
    { id: "run:r1", tipo: "run", x: 0, y: 40, w: 280, h: 110, dados: { auto: true, runId: "r1", expandida: true }, rev: 1 },
    { id: "n1", tipo: "nota", x: 5, y: 5, w: 100, h: 100, dados: {}, rev: 1 },
    { id: "run:r9", tipo: "run", x: 0, y: 0, w: 280, h: 110, dados: { auto: true, oculto: true }, rev: 1 },
  ];
  const gerados: No[] = [
    { id: "run:r1", tipo: "run", x: 0, y: 900, w: 280, h: 170, dados: { auto: true, runId: "r1", expandida: true }, rev: 1 },
    { id: "reg:r1", tipo: "grupo", x: 320, y: 900, w: 500, h: 300, dados: { auto: true }, rev: 0 },
    { id: "n1", tipo: "nota", x: 999, y: 999, w: 1, h: 1, dados: {}, rev: 0 },
  ];
  const m = mesclarComLayout(salvos, gerados);
  const por = new Map(m.map((n) => [n.id, n]));
  assert.deepEqual([por.get("run:r1")!.y, por.get("run:r1")!.h], [900, 170], "automatico: layout vence");
  assert.deepEqual([por.get("n1")!.x, por.get("n1")!.y], [5, 5], "do usuario: salvo vence");
  assert.ok(por.has("reg:r1"), "novos do layout entram");
  assert.ok(!por.has("run:r9"), "oculto nao aparece");
  assert.equal(m.filter((n) => n.id === "run:r1").length, 1, "sem duplicar");
});
