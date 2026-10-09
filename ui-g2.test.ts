// Spec da G2 (hub): planejador escolhido (claude|opencode + modelo) no /nova-feature, Claude como
// planejador num worktree, /cli/run pedido por um agente e o aviso de fim da run na fila (CA-G2a..d).
import { test } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function portaLivre(): Promise<number> {
  return new Promise((ok, falha) => {
    const s = net.createServer();
    s.once("error", falha);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => ok(p)); });
  });
}
const PORTA = await portaLivre();
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-g2-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_AGENTES_DIR = path.join(TMP, "agentes");
process.env.HERMES_CANVAS_DIR = path.join(TMP, "canvas");
process.env.HERMES_PLANEJADORES_DIR = path.join(TMP, "plan");
process.env.HERMES_RUNS_DIR = path.join(TMP, "runs");
const ui = await import("./ui.js");
const BASE = `http://127.0.0.1:${PORTA}`;

type Spawn = { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined> };
function ptyFalso() {
  const spawns: Spawn[] = [];
  const escritos = new Map<number, string[]>();
  return {
    spawns, escritos,
    spawn(o: Spawn) {
      const i = spawns.push(o) - 1;
      escritos.set(i, []);
      return { pid: 100 + i, write: (d: string) => { escritos.get(i)!.push(d); }, kill() {}, onData() {}, onExit() {}, resize() {} };
    },
  };
}
const post = (rota: string, corpo: unknown, extra: Record<string, string> = {}) => fetch(BASE + rota, {
  method: "POST", headers: { "Content-Type": "application/json", "X-Hermes": "1", ...extra }, body: JSON.stringify(corpo),
});
const ate = async (cond: () => boolean | Promise<boolean>, ms = 5000) => {
  for (let i = 0; i < ms / 50; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};
const registro = (id: string) => JSON.parse(readFileSync(path.join(process.env.HERMES_AGENTES_DIR!, id + ".json"), "utf8"));

test("validarPlanejador: claude com ''|opus|sonnet|haiku; opencode com provider/modelo; o resto e' null (CA-G2a)", () => {
  assert.deepEqual(ui.validarPlanejador({ planejador: "claude", modelo: "" }), { planejador: "claude", modelo: "" });
  assert.deepEqual(ui.validarPlanejador({ planejador: "claude", modelo: "opus" }), { planejador: "claude", modelo: "opus" });
  assert.deepEqual(ui.validarPlanejador({ planejador: "opencode", modelo: "opencode-go/glm-5.2" }), { planejador: "opencode", modelo: "opencode-go/glm-5.2" });
  assert.equal(ui.validarPlanejador({ planejador: "claude", modelo: "gpt-9" }), null);
  assert.equal(ui.validarPlanejador({ planejador: "claude" }), null, "modelo obrigatorio ('' tem que vir explicito)");
  assert.equal(ui.validarPlanejador({ planejador: "opencode", modelo: "glm" }), null, "opencode exige provider/modelo");
  assert.equal(ui.validarPlanejador({ planejador: "gpt", modelo: "x" }), null);
  assert.equal(ui.validarPlanejador({}), null);
});

test("/nova-feature exige planejador; claude cria o planejador Claude no worktree com /orchestra inicial (CA-G2a, a2)", async (t) => {
  const pty = ptyFalso();
  const chamadas: Array<{ projeto: string; feature: string; extras: any }> = [];
  const wt = path.join(TMP, "proj", ".claude", "worktrees", "exportar-pdf");
  mkdirSync(wt, { recursive: true });
  await ui.iniciarUI({
    pty,
    executarNovaFeature: async (projeto: string, feature: string, extras?: any) => {
      chamadas.push({ projeto, feature, extras });
      return extras?.planejador === "claude" ? { url: "", cwd: wt, slug: "exportar-pdf" } : { url: "http://x/chat" };
    },
  } as any);
  t.after(() => ui.pararUI());
  const projeto = path.join(TMP, "proj");

  assert.equal((await post("/nova-feature", { projeto, feature: "f" })).status, 400, "sem planejador");
  assert.equal((await post("/nova-feature", { projeto, feature: "f", planejador: "claude", modelo: "gpt-9" })).status, 400);

  assert.equal((await post("/nova-feature", { projeto, feature: "Exportar PDF", descricao: "com botao", planejador: "claude", modelo: "sonnet" })).status, 202);
  assert.ok(await ate(() => pty.spawns.length === 1), "planejador Claude subiu");
  assert.equal(chamadas[0].extras.planejador, "claude");
  assert.equal(chamadas[0].extras.modelo, "sonnet");
  const sp = pty.spawns[0];
  assert.equal(sp.cwd, wt, "Claude roda no worktree");
  assert.deepEqual(sp.args.slice(sp.args.indexOf("--model"), sp.args.indexOf("--model") + 2), ["--model", "sonnet"]);
  assert.match(sp.args.at(-1)!, /^\/orchestra "Exportar PDF[\s\S]*com botao/, "prompt inicial = /orchestra com a feature e a descricao");
  const lista = await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent(wt)}`)).json() as Array<{ id: string; tipo: string }>;
  const plan = lista.find((a) => a.tipo === "claude")!;
  assert.ok(plan, "planejador listado no projeto do worktree");
  assert.equal(registro(plan.id).origem, "planejador");

  await ate(async () => (await post("/nova-feature", { projeto, feature: "g", planejador: "opencode", modelo: "opencode-go/kimi-k3" })).status === 202);
  assert.ok(await ate(() => chamadas.length === 2));
  assert.deepEqual([chamadas[1].extras.planejador, chamadas[1].extras.modelo], ["opencode", "opencode-go/kimi-k3"]);
});

test("/cli/run: agente pede, nasce o planejador ligado a ele; o fim da run vira aviso na fila, uma vez (CA-G2c, d)", async (t) => {
  const pty = ptyFalso();
  const wt = path.join(TMP, "proj2", ".claude", "worktrees", "relatorio");
  mkdirSync(wt, { recursive: true });
  const chamadas: any[] = [];
  await ui.iniciarUI({
    pty,
    executarNovaFeature: async (projeto: string, feature: string, extras?: any) => { chamadas.push({ projeto, feature, extras }); return { url: "", cwd: wt, slug: "relatorio" }; },
  } as any);
  t.after(() => ui.pararUI());
  const projeto = path.join(TMP, "proj2");
  mkdirSync(projeto, { recursive: true });
  // quem pede: um agente Claude do canvas (ocioso)
  const { id: pedinte } = await (await post("/agentes", { projeto, cwd: projeto, tipo: "claude", papel: "lider", nome: "Lider" })).json() as { id: string };
  const eu = `${pedinte}:${registro(pedinte).token}`;
  const cli = (corpo: unknown) => post("/cli/run", corpo, { "X-Eu": eu });

  let r = await cli({ feature: "Relatorio", planejador: "claude" });
  assert.equal(r.status, 400, "sem modelo");
  assert.match(await r.text(), /uso/);
  r = await cli({ feature: "Relatorio", planejador: "claude", modelo: "haiku" });
  assert.equal(r.status, 200);
  assert.match(await r.text(), /planejador/i);
  assert.equal(chamadas[0].projeto, projeto, "projeto = o do agente");
  assert.ok(await ate(() => pty.spawns.length === 2), "planejador Claude subiu");
  const lista = await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent(wt)}`)).json() as Array<{ id: string }>;
  const plan = lista[0].id;
  assert.equal(registro(plan).pedidoPor, pedinte);
  const snap = await (await fetch(`${BASE}/canvas?projeto=${encodeURIComponent(projeto)}`)).json() as { arestas: Array<{ id: string; de: string; para: string }> };
  assert.ok(snap.arestas.some((a) => a.id.startsWith("pedido:") && a.de === "ag:" + pedinte && a.para === "ag:" + plan), "aresta de pedido");

  // a run do planejador termina (log no HERMES_RUNS_DIR com o cwd do worktree)
  mkdirSync(process.env.HERMES_RUNS_DIR!, { recursive: true });
  const evs = [
    { t: "run", feature: "Relatorio", cwd: wt, total: 1, ts: 1 },
    { t: "slice", idx: 1, total: 1, tarefa: "t", status: "ok", ts: 2 },
    { t: "metrica", slice: 1, iteracoes: 1, passouDePrimeira: true, tocouNoTeste: 0, tokensIn: 1, tokensOut: 1, custoUSD: 0.0123, ts: 3 },
    { t: "painel", status: "COMPLETE", branch: "orchestra/relatorio", linhas: [], ts: 4 },
  ];
  writeFileSync(path.join(process.env.HERMES_RUNS_DIR!, "run-g2-1.jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const doPedinte = () => pty.escritos.get(0)!.join("");
  assert.ok(await ate(() => /\[run run-g2-1\] COMPLETE/.test(doPedinte()), 8000), "aviso entregue ao agente que pediu");
  assert.match(doPedinte(), /\[run run-g2-1\] COMPLETE — 1\/1 slices · \$0,012 · orchestra\/relatorio/);
  await new Promise((ok) => setTimeout(ok, 2500)); // mais rescans
  assert.equal((doPedinte().match(/\[run run-g2-1\]/g) ?? []).length, 1, "uma vez so'");
  assert.ok(existsSync(path.join(process.env.HERMES_AGENTES_DIR!, plan + ".json")));
});
