// Spec da S4 (F4): subcomandos browser e status da CLI canvas (CA-7b, 4e).
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
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

test("browser e status viram o POST certo; nav opcional pelo numero de argumentos (CA-7b, 4e)", async (t) => {
  const h = hubFalso((r) => ({ status: 200, texto: "ok " + r.url }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const env = { HERMES_UI_PORT: String(porta) };
  const eu = ["--eu", "ag-1:tok"];
  const casos: Array<[string[], string, unknown]> = [
    [["browser", "create", "pesquisa", "https://www.google.com"], "/cli/browser-create", { nome: "pesquisa", url: "https://www.google.com" }],
    [["browser", "read"], "/cli/browser-read", {}],
    [["browser", "read", "pesquisa"], "/cli/browser-read", { nav: "pesquisa" }],
    [["browser", "click", "16"], "/cli/browser-click", { alvo: "16" }],
    [["browser", "click", "pesquisa", "Inscrever-se"], "/cli/browser-click", { nav: "pesquisa", alvo: "Inscrever-se" }],
    [["browser", "type", "3", "agentes que colaboram"], "/cli/browser-type", { alvo: "3", valor: "agentes que colaboram" }],
    [["browser", "type", "pesquisa", "3", "castor", "--enter"], "/cli/browser-type", { nav: "pesquisa", alvo: "3", valor: "castor", enter: true }],
    [["browser", "nav", "back"], "/cli/browser-nav", { acao: "back" }],
    [["browser", "nav", "pesquisa", "https://notion.so"], "/cli/browser-nav", { nav: "pesquisa", acao: "https://notion.so" }],
    [["browser", "shot"], "/cli/browser-shot", {}],
    [["browser", "shot", "pesquisa"], "/cli/browser-shot", { nav: "pesquisa" }],
    [["status", "ocioso"], "/cli/status", { estado: "ocioso" }],
  ];
  for (const [args, url, corpo] of casos) {
    const r = await rodar([...eu, ...args], env);
    assert.equal(r.code, 0, args.join(" ") + " -> " + r.err);
    const req = h.reqs.at(-1)!;
    assert.equal(req.url, url, args.join(" "));
    assert.equal(req.eu, "ag-1:tok");
    assert.deepEqual(req.corpo, corpo, args.join(" "));
  }
});

test("browser/status com uso errado: exit 1 com uso, sem chamar o hub", async (t) => {
  const h = hubFalso(() => ({ status: 200, texto: "x" }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  for (const args of [["browser"], ["browser", "voar"], ["browser", "create", "so-nome"], ["browser", "click"], ["browser", "type", "3"], ["browser", "nav"], ["status"]]) {
    const r = await rodar(["--eu", "a:b", ...args], { HERMES_UI_PORT: String(porta) });
    assert.equal(r.code, 1, JSON.stringify(args));
    assert.match(r.out + r.err, /uso:/i, JSON.stringify(args));
  }
  assert.equal(h.reqs.length, 0);
});
