// Spec da G2 (CA-G2f): `canvas run` pede uma feature com planejador + modelo obrigatorios.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(RAIZ, "bin", "canvas.mjs");

type Req = { metodo: string; url: string; eu: string; hermes: string; corpo: any };

function hubFalso(resposta: (r: Req) => { status: number; texto: string }) {
  const reqs: Req[] = [];
  const srv = http.createServer((req, res) => {
    let c = "";
    req.on("data", (d) => { c += d; });
    req.on("end", () => {
      let j: any = null; try { j = c ? JSON.parse(c) : null; } catch {}
      const r: Req = { metodo: req.method || "", url: req.url || "", eu: String(req.headers["x-eu"] ?? ""), hermes: String(req.headers["x-hermes"] ?? ""), corpo: j };
      reqs.push(r);
      const out = resposta(r);
      res.writeHead(out.status, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(out.texto);
    });
  });
  return { srv, reqs };
}

function rodar(args: string[], env: Record<string, string> = {}): Promise<{ code: number; out: string; err: string }> {
  return new Promise((ok) => {
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, HERMES_EU: "", ...env } });
    let out = ""; let err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (code) => ok({ code: code ?? -1, out, err }));
  });
}

async function subir(h: ReturnType<typeof hubFalso>): Promise<number> {
  await new Promise<void>((ok) => h.srv.listen(0, "127.0.0.1", () => ok()));
  return (h.srv.address() as net.AddressInfo).port;
}


const EU = "ag-1:tok";

test("canvas run: --claude <modelo> ou --opencode <modelo> viram POST /cli/run com o corpo exato (CA-G2f)", async (t) => {
  const h = hubFalso(() => ({ status: 200, texto: "planejador criado" }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const env = { HERMES_UI_PORT: String(porta) };
  let r = await rodar(["--eu", EU, "run", "Exportar PDF", "--claude", "sonnet"], env);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /planejador criado/);
  assert.deepEqual(h.reqs.at(-1)!.corpo, { feature: "Exportar PDF", planejador: "claude", modelo: "sonnet" });
  assert.equal(h.reqs.at(-1)!.url, "/cli/run");
  assert.equal(h.reqs.at(-1)!.eu, EU);
  r = await rodar(["--eu", EU, "run", "x", "--claude", "padrao"], env);
  assert.deepEqual(h.reqs.at(-1)!.corpo, { feature: "x", planejador: "claude", modelo: "" }, "padrao = modelo vazio (padrao da conta)");
  r = await rodar(["--eu", EU, "run", "y", "--opencode", "opencode-go/glm-5.2"], env);
  assert.deepEqual(h.reqs.at(-1)!.corpo, { feature: "y", planejador: "opencode", modelo: "opencode-go/glm-5.2" });
});

test("canvas run sem planejador/modelo, modelo claude invalido ou os dois: uso e exit 1 sem chamar o hub (CA-G2f)", async (t) => {
  const h = hubFalso(() => ({ status: 200, texto: "x" }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const env = { HERMES_UI_PORT: String(porta) };
  for (const args of [
    ["run", "f"],
    ["run", "f", "--claude"],
    ["run", "f", "--claude", "gpt-9"],
    ["run", "f", "--opencode"],
    ["run", "f", "--claude", "opus", "--opencode", "opencode-go/glm-5.2"],
    ["run", "--claude", "opus"],
  ]) {
    const r = await rodar(["--eu", EU, ...args], env);
    assert.equal(r.code, 1, args.join(" "));
    assert.match(r.err + r.out, /uso:[\s\S]*run "<feature>" \(--claude <padrao\|opus\|sonnet\|haiku> \| --opencode <modelo>\)/);
  }
  assert.equal(h.reqs.length, 0);
});
