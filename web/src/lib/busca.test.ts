// Spec de runs ligadas a sessao (S3): Run.sessao/mcpRunId no reducer e filtrarRuns (busca global) (CA-1/4/5/7).
// busca.ts e' criado pela slice: import dinamico por variavel pra nao quebrar o tsc dos outros testes antes dela.
import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicar, vazio, type Msg, type Run } from "./estado.ts";

type Grupo = { cwd: string; projeto: string; runs: Run[] };
type Filtrar = (runs: Run[], consulta: string | { sessao: string }, titulos: Record<string, string>, projeto: string) => Grupo[];
async function filtrar(): Promise<Filtrar> {
  const alvo = "./busca.ts";
  let m: Record<string, unknown> = {};
  try { m = await import(alvo); } catch { /* ainda nao criado */ }
  assert.equal(typeof m.filtrarRuns, "function", "web/src/lib/busca.ts deve exportar filtrarRuns");
  return m.filtrarRuns as Filtrar;
}

const UUID = "5ed3bb76-3454-4379-82a1-9ee99f0a637a";
function estado() {
  const run = (id: string, feature: string, cwd: string, ts: number, sessao?: unknown, branch?: string): Msg[] => [
    { swarm: id, ev: { t: "run", feature, cwd, total: 1, ts, ...(sessao ? { sessao, mcpRunId: "mcp-" + id } : {}) } as any },
    ...(branch ? [{ swarm: id, ev: { t: "fase", nome: "branch", info: branch, ts: ts + 1 } } as Msg] : []),
  ];
  return aplicar(vazio, [
    ...run("ra", "Exportar PDF", "D:/Claude/Loja", 100, { planejador: "claude", id: UUID, host: "local_abc" }, "orchestra/exportar-pdf"),
    ...run("rb", "Login social", "D:/Claude/Blog", 200, { planejador: "claude", id: UUID }),
    ...run("rc", "Ajustar rodapé", "D:/Claude/Loja", 300),
    ...run("rd", "Cache de imagens", "D:/Claude/Blog", 400, { planejador: "opencode", id: "ses_x1" }),
  ]);
}
const TITULOS = { ra: "Relatórios em PDF", rb: "Relatórios em PDF", rd: "Imagens lentas" };
const ids = (gs: Grupo[]) => gs.flatMap((g) => g.runs.map((r) => r.id)).sort();

test("reducer: evento run com sessao preenche Run.sessao e Run.mcpRunId; sem sessao fica vazio (CA-1/CA-7)", () => {
  const e = estado();
  const ra = e.runs.ra as Run & { sessao?: { planejador: string; id: string; host?: string }; mcpRunId?: string };
  assert.deepEqual(ra.sessao, { planejador: "claude", id: UUID, host: "local_abc" });
  assert.equal(ra.mcpRunId, "mcp-ra");
  const rc = e.runs.rc as Run & { sessao?: unknown };
  assert.equal(rc.sessao ?? null, null);
});

test("filtrarRuns: casa feature, titulo do chat, branch e id, sem acento/caixa, em todos os projetos (CA-4)", async () => {
  const f = await filtrar();
  const runs = Object.values(estado().runs);
  assert.deepEqual(ids(f(runs, "relatorios", TITULOS, "D:/Claude/Loja")), ["ra", "rb"], "titulo, sem acento");
  assert.deepEqual(ids(f(runs, "RODAPE", TITULOS, "D:/Claude/Loja")), ["rc"], "feature, sem caixa/acento");
  assert.deepEqual(ids(f(runs, "exportar-pdf", TITULOS, "D:/Claude/Loja")), ["ra"], "branch");
  assert.deepEqual(ids(f(runs, "rd", TITULOS, "D:/Claude/Loja")), ["rd"], "id");
  assert.deepEqual(f(runs, "nada disso", TITULOS, "D:/Claude/Loja"), []);
  const g = f(runs, "relatorios", TITULOS, "D:/Claude/Loja");
  assert.equal(g.length, 2, "agrupado por projeto");
  assert.deepEqual(g.map((x) => x.projeto).sort(), ["Blog", "Loja"]);
});

test("filtrarRuns: {sessao} traz so as runs daquela sessao, de qualquer projeto (CA-5)", async () => {
  const f = await filtrar();
  const runs = Object.values(estado().runs);
  assert.deepEqual(ids(f(runs, { sessao: UUID }, TITULOS, "D:/Claude/Loja")), ["ra", "rb"]);
  assert.deepEqual(ids(f(runs, { sessao: "ses_x1" }, TITULOS, "D:/Claude/Loja")), ["rd"]);
});

test("filtrarRuns: consulta vazia = runs do projeto atual, mais nova primeiro; run sem sessao nao quebra (CA-4/CA-7)", async () => {
  const f = await filtrar();
  const runs = Object.values(estado().runs);
  const g = f(runs, "  ", {}, "D:/Claude/Loja");
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].runs.map((r) => r.id), ["rc", "ra"]);
  assert.deepEqual(ids(f(runs, "ajustar", {}, "D:/Claude/Blog")), ["rc"], "sem titulos, acha pela feature");
});
