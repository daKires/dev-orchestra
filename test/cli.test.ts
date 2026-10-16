// Spec da S3 (F3): CLI `canvas` (bin/canvas.mjs) contra um hub falso (CA-F3-2, CA-6*).
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
      const r: Req = { metodo: req.method || "", url: req.url || "", eu: String(req.headers["x-eu"] ?? ""), hermes: String(req.headers["x-dev-orchestra"] ?? ""), corpo: j };
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
    const p = spawn(process.execPath, [CLI, ...args], { env: { ...process.env, DEV_ORCHESTRA_EU: "", ...env } });
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

test("cada comando vira o POST certo, com X-Eu e X-Hermes, e imprime a resposta (CA-F3-2, 6*)", async (t) => {
  const h = hubFalso((r) => ({ status: 200, texto: "ok " + r.url }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const env = { DEV_ORCHESTRA_UI_PORT: String(porta) };
  const eu = ["--eu", "ag-1:tok123"];
  const casos: Array<[string[], string, unknown]> = [
    [["list"], "/cli/list", {}],
    [["ask", "designer", "Proponha um título"], "/cli/ask", { alvo: "designer", texto: "Proponha um título" }],
    [["tell", "ag-2", "faça X"], "/cli/tell", { alvo: "ag-2", texto: "faça X" }],
    [["reply", "q-3", "Título X"], "/cli/reply", { q: "q-3", texto: "Título X" }],
    [["flow", "add", "ideia", "elipse", "Ideia"], "/cli/flow-add", { chave: "ideia", forma: "elipse", texto: "Ideia" }],
    [["flow", "add", "fim", "retangulo", "Pronto", "--cor", "verde"], "/cli/flow-add", { chave: "fim", forma: "retangulo", texto: "Pronto", cor: "verde" }],
    [["flow", "link", "ideia", "fim"], "/cli/flow-link", { a: "ideia", b: "fim" }],
    [["flow", "link", "ideia", "fim", "Sim"], "/cli/flow-link", { a: "ideia", b: "fim", rotulo: "Sim" }],
    [["file", "src/a.ts", "pronta para revisar"], "/cli/file", { caminho: "src/a.ts", status: "pronta para revisar" }],
    [["note", "Decisões", "usar azul"], "/cli/note", { titulo: "Decisões", corpo: "usar azul" }],
  ];
  for (const [args, url, corpo] of casos) {
    const r = await rodar([...eu, ...args], env);
    assert.equal(r.code, 0, args.join(" ") + " -> " + r.err);
    const req = h.reqs.at(-1)!;
    assert.equal(req.metodo, "POST");
    assert.equal(req.url, url);
    assert.equal(req.eu, "ag-1:tok123");
    assert.equal(req.hermes, "1");
    assert.deepEqual(req.corpo, corpo, args.join(" "));
    assert.equal(r.out.trim(), "ok " + url);
  }
  // identidade tambem pela env DEV_ORCHESTRA_EU (e --eu depois do comando)
  const r2 = await rodar(["list"], { ...env, DEV_ORCHESTRA_EU: "ag-9:zzz" });
  assert.equal(r2.code, 0);
  assert.equal(h.reqs.at(-1)!.eu, "ag-9:zzz");
  const r3 = await rodar(["ask", "x", "y", "--eu", "ag-7:k"], env);
  assert.equal(r3.code, 0);
  assert.equal(h.reqs.at(-1)!.eu, "ag-7:k");
  assert.deepEqual(h.reqs.at(-1)!.corpo, { alvo: "x", texto: "y" });
});

test("erro do hub: exit 1 e mensagem no stderr (CA-6c)", async (t) => {
  const h = hubFalso(() => ({ status: 400, texto: "agente revisor não está conectado a você" }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const r = await rodar(["--eu", "ag-1:t", "ask", "revisor", "oi"], { DEV_ORCHESTRA_UI_PORT: String(porta) });
  assert.equal(r.code, 1);
  assert.match(r.err, /não está conectado a você/);
  const h2 = hubFalso(() => ({ status: 403, texto: "identidade inválida" }));
  const p2 = await subir(h2);
  t.after(() => h2.srv.close());
  const r2 = await rodar(["--eu", "ag-1:t", "list"], { DEV_ORCHESTRA_UI_PORT: String(p2) });
  assert.equal(r2.code, 1);
  assert.match(r2.err, /identidade inválida/);
});

test("uso errado e sem identidade: exit 1 com uso em PT-BR, sem chamar o hub", async (t) => {
  const h = hubFalso(() => ({ status: 200, texto: "x" }));
  const porta = await subir(h);
  t.after(() => h.srv.close());
  const env = { DEV_ORCHESTRA_UI_PORT: String(porta) };
  for (const args of [[], ["--eu", "a:b"], ["--eu", "a:b", "voar"], ["--eu", "a:b", "ask", "so-alvo"], ["--eu", "a:b", "flow", "pular"], ["--eu", "a:b", "reply"]]) {
    const r = await rodar(args, env);
    assert.equal(r.code, 1, JSON.stringify(args));
    assert.match(r.out + r.err, /uso:/i, JSON.stringify(args));
  }
  const semEu = await rodar(["list"], env);
  assert.equal(semEu.code, 1);
  assert.match(semEu.err, /identidade/i);
  assert.equal(h.reqs.length, 0, "nenhuma chamada ao hub");
});

test("hub fora do ar: exit 2 com mensagem PT-BR", async () => {
  const s = net.createServer();
  await new Promise<void>((ok) => s.listen(0, "127.0.0.1", () => ok()));
  const porta = (s.address() as net.AddressInfo).port;
  await new Promise((ok) => s.close(ok));
  const r = await rodar(["--eu", "a:b", "list"], { DEV_ORCHESTRA_UI_PORT: String(porta) });
  assert.equal(r.code, 2);
  assert.match(r.err, new RegExp(`hub Dev Orchestra inacessível em 127\\.0\\.0\\.1:${porta}`));
});
