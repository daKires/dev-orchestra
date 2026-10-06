// Spec da S1 (F3): colaboracao entre agentes, logica pura (CA-6a..6f, 11c, 13b, 13d).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slugNome, conectados, resolverAlvo, Conversas, FilaEntregas,
  fmtPergunta, fmtResposta, fmtMensagem, fmtSemResposta, linhaIdentidade,
  opsFlowAdd, opsFlowLink, opsFile, opsNote, validarCaminho,
} from "./colaboracao.ts";
import { aplicarOps, type No, type Snapshot } from "./canvas.ts";

const ag = (id: string, x = 0, y = 0): No => ({ id: "ag:" + id, tipo: "agente", x, y, w: 620, h: 420, dados: { agenteId: id }, rev: 1 });
const A = (id: string, nome: string) => ({ id, nome });

test("slugNome: minusculas, sem acento, separador '-' (CA-6b)", () => {
  assert.equal(slugNome("Líder do Projeto"), "lider-do-projeto");
  assert.equal(slugNome("  Designer!! "), "designer");
});

test("conectados: agentes ligados por aresta em qualquer direcao, sem o proprio (CA-6a)", () => {
  const snap: Snapshot = {
    nos: [ag("lid"), ag("des"), ag("dev"), ag("solto"), { id: "n1", tipo: "nota", x: 0, y: 0, w: 1, h: 1, dados: {}, rev: 1 }],
    arestas: [
      { id: "e1", de: "ag:lid", para: "ag:des", rev: 1 },
      { id: "e2", de: "ag:dev", para: "ag:lid", rev: 1 },
      { id: "e3", de: "ag:lid", para: "n1", rev: 1 },
      { id: "e4", de: "ag:des", para: "ag:solto", rev: 1 },
    ],
  };
  const todos = [A("lid", "Líder"), A("des", "Designer"), A("dev", "Dev"), A("solto", "Solto")];
  assert.deepEqual(conectados(snap, "lid", todos).map((a) => a.id), ["des", "dev"]);
  assert.deepEqual(conectados(snap, "solto", todos).map((a) => a.id), ["des"]);
  assert.deepEqual(conectados(snap, "naoexiste", todos), []);
});

test("resolverAlvo: id, slug do nome, ambiguo e desconectado (CA-6b, 6c)", () => {
  const c = [A("ag-1", "Designer"), A("ag-2", "Dev"), A("ag-3", "Dev")];
  assert.deepEqual(resolverAlvo(c, "ag-1"), { ok: c[0] });
  assert.deepEqual(resolverAlvo(c, "designer"), { ok: c[0] });
  assert.deepEqual(resolverAlvo(c, "DESIGNER"), { ok: c[0] });
  const amb = resolverAlvo(c, "dev") as { erro: string };
  assert.match(amb.erro, /amb[ií]guo/);
  assert.match(amb.erro, /ag-2/);
  assert.equal((resolverAlvo(c, "revisor") as { erro: string }).erro, "agente revisor não está conectado a você");
});

test("Conversas: q-N, reply so do alvo, duplicado, si mesmo (CA-6b, 6b2, 6c)", () => {
  const c = new Conversas(() => 1000);
  const r1 = c.perguntar("lid", "des", "Proponha um título") as { ok: { q: string; profundidade: number } };
  assert.equal(r1.ok.q, "q-1");
  assert.equal(r1.ok.profundidade, 1);
  assert.match((c.perguntar("lid", "lid", "x") as { erro: string }).erro, /si mesmo/);
  assert.match((c.responder("lid", "q-1") as { erro: string }).erro, /só/);
  const ok = c.responder("des", "q-1") as { ok: { de: string } };
  assert.equal(ok.ok.de, "lid");
  assert.match((c.responder("des", "q-1") as { erro: string }).erro, /q-1 já respondida/);
  assert.match((c.responder("des", "q-99") as { erro: string }).erro, /q-99 não existe/);
  assert.equal(c.pendentes().length, 0);
});

test("Conversas: limite de 3 pendentes por origem e profundidade 4 (CA-6f)", () => {
  const c = new Conversas(() => 0);
  for (let i = 0; i < 3; i++) assert.ok("ok" in c.perguntar("a", "b" + i, "x"));
  assert.match((c.perguntar("a", "z", "x") as { erro: string }).erro, /limite/);
  const d = new Conversas(() => 0);
  d.perguntar("p1", "p2", "x");                                   // prof 1
  d.perguntar("p2", "p3", "x");                                   // p2 respondendo -> prof 2
  d.perguntar("p3", "p4", "x");                                   // prof 3
  const q4 = d.perguntar("p4", "p5", "x") as { ok: { profundidade: number } };
  assert.equal(q4.ok.profundidade, 4);
  assert.match((d.perguntar("p5", "p6", "x") as { erro: string }).erro, /limite/);
});

test("Conversas: expira em 30 min e encerrar o alvo devolve as pendentes dele (CA-6e)", () => {
  let agora = 0;
  const c = new Conversas(() => agora);
  c.perguntar("a", "b", "x");
  agora = 29 * 60_000;
  assert.deepEqual(c.expirar(), []);
  agora = 30 * 60_000;
  assert.deepEqual(c.expirar().map((p) => p.q), ["q-1"]);
  assert.equal(c.pendentes().length, 0);
  c.perguntar("a", "b", "y");
  c.perguntar("b", "a", "z");
  assert.deepEqual(c.encerrarAgente("b").map((p) => p.q), ["q-2"], "so as perguntas PARA o encerrado voltam");
  assert.equal(c.pendentes().length, 0, "as perguntas DO encerrado tambem somem");
});

test("FilaEntregas: entrega em ordem, segura enquanto ocupado (CA-6e)", () => {
  const f = new FilaEntregas();
  f.enfileirar("x", "1");
  f.enfileirar("x", "2");
  f.marcarOcupado("x");
  assert.deepEqual(f.liberar("x"), []);
  f.marcarOcioso("x");
  assert.deepEqual(f.liberar("x"), ["1", "2"]);
  assert.deepEqual(f.liberar("x"), []);
  f.enfileirar("novo", "a");
  assert.deepEqual(f.liberar("novo"), ["a"], "desconhecido conta como ocioso");
});

test("formatadores e linha de identidade (CA-6b, 6b2, 6b3, 6e, F3-1)", () => {
  assert.equal(fmtPergunta("Líder", "q-3", "Proponha"), '[pergunta de Líder · q-3] Proponha -- responda com: canvas reply q-3 "<resultado>"');
  assert.equal(fmtResposta("Designer", "q-3", "Título X"), "[resposta de Designer · q-3] Título X");
  assert.equal(fmtMensagem("Líder", "faça Y"), "[mensagem de Líder] faça Y");
  assert.equal(fmtSemResposta("Designer", "q-3"), "[sem resposta de Designer para q-3]");
  const l = linhaIdentidade("Designer", "ag-1", "tok123");
  assert.match(l, /Designer \(ag-1\)/);
  assert.match(l, /canvas --eu ag-1:tok123/);
});

test("opsFlowAdd/opsFlowLink: regiao 'Fluxo de X' acima do agente, formas em linha (CA-11c)", () => {
  const agNo = ag("lid", 1000, 1000);
  let s: Snapshot = { nos: [agNo], arestas: [] };
  const r1 = opsFlowAdd(s, agNo, "Líder", "ideia", "elipse", "Ideia", undefined, 10) as { ops: any[] };
  s = aplicarOps(s, r1.ops);
  const reg = s.nos.find((n) => n.id === "flowreg:lid")!;
  assert.equal(reg.tipo, "grupo");
  assert.equal(reg.dados.titulo, "Fluxo de Líder");
  assert.ok(reg.y + reg.h <= agNo.y - 40, "regiao acima do agente");
  const f1 = s.nos.find((n) => n.id === "flow:lid:ideia")!;
  assert.equal(f1.pai, "flowreg:lid");
  assert.deepEqual(f1.dados, { forma: "elipse", texto: "Ideia", cor: "verde" });
  s = aplicarOps(s, (opsFlowAdd(s, agNo, "Líder", "validar", "losango", "Validar", undefined, 11) as { ops: any[] }).ops);
  const f2 = s.nos.find((n) => n.id === "flow:lid:validar")!;
  assert.equal(f2.dados.cor, "amarelo");
  assert.ok(f2.x > f1.x && f2.y === f1.y, "em linha, da esquerda para a direita");
  const regDepois = s.nos.find((n) => n.id === "flowreg:lid")!;
  assert.ok(f2.x + f2.w <= regDepois.x + regDepois.w, "regiao cresce para caber");
  // atualizar mantem a posicao
  s = aplicarOps(s, (opsFlowAdd(s, agNo, "Líder", "ideia", "elipse", "Ideia 2", "lilas", 12) as { ops: any[] }).ops);
  const f1b = s.nos.find((n) => n.id === "flow:lid:ideia")!;
  assert.deepEqual([f1b.x, f1b.y, f1b.dados.texto, f1b.dados.cor], [f1.x, f1.y, "Ideia 2", "lilas"]);
  assert.match((opsFlowAdd(s, agNo, "Líder", "x", "estrela", "x", undefined, 13) as { erro: string }).erro, /forma/);
  assert.match((opsFlowAdd(s, agNo, "Líder", "x", "elipse", "x", "rosa-choque", 13) as { erro: string }).erro, /cor/);

  s = aplicarOps(s, (opsFlowLink(s, "lid", "ideia", "validar", "Sim", 14) as { ops: any[] }).ops);
  const e = s.arestas.find((a) => a.de === "flow:lid:ideia" && a.para === "flow:lid:validar")!;
  assert.equal(e.rotulo, "Sim");
  assert.match((opsFlowLink(s, "lid", "ideia", "nada", undefined, 15) as { erro: string }).erro, /nada/);
});

test("opsFile/opsNote: a direita do agente, empilhados, ligados; nota faz upsert pelo titulo (CA-13b, 13d)", () => {
  const agNo = ag("des", 0, 0);
  let s: Snapshot = { nos: [agNo], arestas: [] };
  s = aplicarOps(s, opsFile(s, agNo, "src/landing-page.tsx", "pronta para revisar", 1));
  const f = s.nos.find((n) => n.id === "arq-ag:des:src/landing-page.tsx")!;
  assert.equal(f.tipo, "arquivo");
  assert.deepEqual(f.dados, { agenteId: "des", caminho: "src/landing-page.tsx", status: "pronta para revisar" });
  assert.ok(f.x >= agNo.x + agNo.w);
  assert.ok(s.arestas.some((a) => a.de === "ag:des" && a.para === f.id));
  s = aplicarOps(s, opsNote(s, agNo, "Decisões", "usar azul", 2));
  const n = s.nos.find((x) => x.id === "nota-ag:des:decisoes")!;
  assert.deepEqual(n.dados, { titulo: "Decisões", corpo: "usar azul", cor: "amarelo" });
  assert.ok(n.y > f.y, "empilhado abaixo do arquivo");
  assert.ok(s.arestas.some((a) => a.de === "ag:des" && a.para === n.id));
  s = aplicarOps(s, opsNote(s, agNo, "Decisões", "usar verde", 3));
  assert.equal(s.nos.filter((x) => x.id.startsWith("nota-ag:des:")).length, 1, "mesmo titulo = mesma nota");
  assert.equal(s.nos.find((x) => x.id === "nota-ag:des:decisoes")!.dados.corpo, "usar verde");
  assert.equal(s.nos.find((x) => x.id === "nota-ag:des:decisoes")!.y, n.y, "update mantem a posicao");
});

test("validarCaminho: relativo, sem '..', barras normalizadas", () => {
  assert.equal(validarCaminho("D:\\wt", "src\\a.ts"), "src/a.ts");
  assert.equal(validarCaminho("D:\\wt", "./src/a.ts"), "src/a.ts");
  assert.equal(validarCaminho("D:\\wt", "../x"), null);
  assert.equal(validarCaminho("D:\\wt", "src/../../x"), null);
  assert.equal(validarCaminho("D:\\wt", "C:\\Windows\\x"), null);
  assert.equal(validarCaminho("D:\\wt", "/etc/passwd"), null);
  assert.equal(validarCaminho("D:\\wt", ""), null);
});
