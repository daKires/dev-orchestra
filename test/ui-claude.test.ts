// Spec da S3 (F4): agentes Claude Code via PTY (driver falso) (CA-4d..4h, 16d).
// Mesmo harness (OpenCode falso) da F2.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { execSync } from "node:child_process";
import { promises as fs, existsSync } from "node:fs";
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

type Chamada = { metodo: string; rota: string; corpo: any };
function openCodeFalso() {
  const chamadas: Chamada[] = [];
  const sse = new Set<http.ServerResponse>();
  let n = 0;
  const srv = http.createServer((req, res) => {
    let corpo = "";
    req.on("data", (d) => { corpo += d; });
    req.on("end", () => {
      const rota = (req.url || "/").split("?")[0];
      let j: any = null; try { j = corpo ? JSON.parse(corpo) : null; } catch {}
      chamadas.push({ metodo: req.method || "", rota, corpo: j });
      if (rota === "/event") {
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "server.connected", properties: {} })}\n\n`);
        sse.add(res); res.on("close", () => sse.delete(res));
        return;
      }
      if (rota === "/doc") { res.writeHead(200); res.end("{}"); return; }
      if (rota === "/config/providers") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ providers: [{ id: "opencode-go", models: { "glm-5.2": {}, "kimi-k3": {} } }], default: {} }));
        return;
      }
      if (rota === "/session" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: "ses_" + ++n, title: j?.title }));
        return;
      }
      if (/^\/session\/[^/]+\/message$/.test(rota) && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ info: { id: "m0", role: "assistant", sessionID: "ses_1" }, parts: [{ id: "h1", type: "text", text: "historico" }] }]));
        return;
      }
      if (/^\/session\/[^/]+\/(prompt_async|abort)$/.test(rota)) { res.writeHead(204); res.end(); return; }
      if (/^\/session\/[^/]+$/.test(rota) && req.method === "DELETE") { res.writeHead(200); res.end("true"); return; }
      res.writeHead(404); res.end();
    });
  });
  const emitir = (ev: unknown) => { for (const r of sse) r.write(`data: ${JSON.stringify(ev)}\n\n`); };
  return { srv, chamadas, emitir };
}

const PORTA = await portaLivre();
const TMP = await fs.mkdtemp(path.join(os.tmpdir(), "hermes-ag-"));
process.env.DEV_ORCHESTRA_UI_PORT = String(PORTA);
process.env.DEV_ORCHESTRA_PLANEJADORES_DIR = path.join(TMP, "plan");
process.env.DEV_ORCHESTRA_CANVAS_DIR = path.join(TMP, "canvas");
process.env.DEV_ORCHESTRA_AGENTES_DIR = path.join(TMP, "agentes");
const ui = await import("../dist/ui.js");

const BASE = `http://127.0.0.1:${PORTA}`;
const post = (rota: string, body: unknown, hermes = true) => fetch(BASE + rota, {
  method: "POST", headers: { "Content-Type": "application/json", ...(hermes ? { "X-Dev-Orchestra": "1" } : {}) }, body: JSON.stringify(body),
});
const ate = async (cond: () => boolean | Promise<boolean>, ms = 3000) => {
  for (let i = 0; i < ms / 50; i++) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 50)); }
  return false;
};


type Proc = { opts: any; escritos: string[]; morto: boolean; emitir: (d: string) => void; sair: (code: number) => void };
function ptyFalso(falhar = false) {
  const procs: Proc[] = [];
  return {
    procs,
    spawn(opts: { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }) {
      if (falhar) throw new Error("claude não encontrado");
      let onData: (d: string) => void = () => {};
      let onExit: (c: number) => void = () => {};
      const p: Proc = { opts, escritos: [], morto: false, emitir: (d) => onData(d), sair: (c) => onExit(c) };
      procs.push(p);
      return {
        pid: 1000 + procs.length,
        write: (d: string) => { p.escritos.push(d); },
        kill: () => { p.morto = true; },
        onData: (cb: (d: string) => void) => { onData = cb; },
        onExit: (cb: (c: number) => void) => { onExit = cb; },
      };
    },
  };
}

test("agente Claude: spawn com identidade/hooks/PATH, teclas, saida no SSE, status, fila, retomar e encerrar (CA-4d..4h)", async (t) => {
  const falso = openCodeFalso();
  await new Promise<void>((ok) => falso.srv.listen(0, "127.0.0.1", () => ok()));
  const baseFalso = `http://127.0.0.1:${(falso.srv.address() as net.AddressInfo).port}`;
  const pty = ptyFalso();
  await ui.iniciarUI({ subirServe: async () => ({ base: baseFalso, pid: 9 }), matarProcesso: () => {}, pty } as any);
  t.after(() => { ui.pararUI(); falso.srv.closeAllConnections(); falso.srv.close(); });
  const ctrl = new AbortController();
  t.after(() => ctrl.abort());
  const sse = await fetch(`${BASE}/events`, { signal: ctrl.signal });
  let texto = "";
  (async () => { const rd = sse.body!.getReader(); const dec = new TextDecoder(); for (;;) { const { done, value } = await rd.read(); if (done) return; texto += dec.decode(value, { stream: true }); } })().catch(() => {});

  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  execSync("git init -q", { cwd });
  const projeto = cwd;
  let r = await post("/agentes", { projeto, cwd, tipo: "claude", papel: "dev", nome: "Claude", modelo: "sonnet" });
  assert.equal(r.status, 200);
  const { id, status } = await r.json() as { id: string; status: string };
  assert.equal(status, "ok");
  assert.equal(pty.procs.length, 1);
  const p = pty.procs[0];
  assert.equal(p.opts.comando, "claude");
  assert.equal(p.opts.cwd, cwd);
  const pathVar = p.opts.env.PATH ?? p.opts.env.Path ?? "";
  assert.match(pathVar.split(path.delimiter)[0], /[\\/]bin$/, "bin/ no PATH do claude");
  const reg = JSON.parse(await fs.readFile(path.join(process.env.DEV_ORCHESTRA_AGENTES_DIR!, id + ".json"), "utf8"));
  assert.equal(reg.tipo, "claude");
  const tok = reg.token as string;
  const args: string[] = p.opts.args;
  const iPrompt = args.indexOf("--append-system-prompt");
  assert.ok(iPrompt >= 0);
  assert.ok(args[iPrompt + 1].includes(`canvas --eu ${id}:${tok}`), "identidade no prompt de sistema");
  assert.ok(args[iPrompt + 1].includes(`.orchestra/contexto/${id}/README.md`), "manda ler o contexto");
  assert.deepEqual(args.slice(args.indexOf("--model"), args.indexOf("--model") + 2), ["--model", "sonnet"]);
  const settings = JSON.parse(await fs.readFile(args[args.indexOf("--settings") + 1], "utf8"));
  assert.equal(settings.hooks.Stop[0].hooks[0].command, `"${process.execPath.replace(/\\/g, "/")}" "${path.resolve(process.cwd(), "bin", "canvas.mjs").replace(/\\/g, "/")}" --eu ${id}:${tok} status ocioso`, "node + canvas.mjs absolutos");

  const lista = async () => (await (await fetch(`${BASE}/agentes?projeto=${encodeURIComponent(projeto)}`)).json()) as Array<{ id: string; tipo: string; status: string; ocupado: boolean }>;
  assert.equal((await lista()).find((a) => a.id === id)!.tipo, "claude");

  // teclas do xterm -> PTY; saida do PTY -> SSE {pty}
  assert.equal((await post(`/agentes/${id}/teclas`, { dados: "ls\r" }, false)).status, 400, "teclas exigem X-Hermes");
  assert.equal((await post(`/agentes/${id}/teclas`, { dados: "ls\r" })).status, 204);
  assert.equal(p.escritos.at(-1), "ls\r");
  p.emitir("Olá do Claude");
  const b64 = Buffer.from("Olá do Claude").toString("base64");
  assert.ok(await ate(() => texto.includes(`"pty":{"id":"${id}","dados":"${b64}"}`)), "saida vai pro SSE em base64");

  // um OpenCode ligado pergunta ao Claude; fila respeita os hooks
  const lid = (await (await post("/agentes", { projeto, cwd, papel: "lider", nome: "Líder" })).json() as { id: string }).id;
  const tLid = JSON.parse(await fs.readFile(path.join(process.env.DEV_ORCHESTRA_AGENTES_DIR!, lid + ".json"), "utf8")).token;
  const no = (nid: string, dados: Record<string, unknown>, x: number) => ({ id: nid, tipo: "agente", x, y: 0, w: 620, h: 420, dados, rev: Date.now() });
  await post("/canvas/op", { projeto, ops: [
    { op: "upsert", tipo: "no", item: no("ag:" + id, { agenteId: id }, 0) },
    { op: "upsert", tipo: "no", item: no("ag:" + lid, { agenteId: lid }, 800) },
    { op: "upsert", tipo: "aresta", item: { id: "e1", de: "ag:" + lid, para: "ag:" + id, rev: Date.now() } },
  ] });
  const cli = (cmd: string, corpo: unknown, eu: string) => fetch(`${BASE}/cli/${cmd}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Dev-Orchestra": "1", "X-Eu": eu }, body: JSON.stringify(corpo) });
  const eC = `${id}:${tok}`;
  assert.equal((await cli("status", { estado: "ocupado" }, eC)).status, 200);
  assert.equal((await lista()).find((a) => a.id === id)!.ocupado, true);
  assert.equal((await cli("status", { estado: "voando" }, eC)).status, 400);
  const nEscritos = p.escritos.length;
  r = await cli("ask", { alvo: "claude", texto: "revise o README" }, `${lid}:${tLid}`);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /enfileirada \(Claude ocupado\)/);
  assert.equal(p.escritos.length, nEscritos, "nada escrito com o Claude ocupado");
  assert.equal((await cli("status", { estado: "aguardando" }, eC)).status, 200);
  assert.equal(p.escritos.length, nEscritos, "aguardando permissao tambem segura a fila");
  assert.equal((await cli("status", { estado: "ocioso" }, eC)).status, 200);
  assert.ok(await ate(() => p.escritos.length > nEscritos), "ocioso libera a fila");
  assert.equal(p.escritos.at(-1), '\x1b[200~[pergunta de Líder · q-1] revise o README -- responda com: canvas reply q-1 "<resultado>"\x1b[201~\r');

  // PTY saiu -> encerrado; retomar -> --continue; encerrar -> kill
  p.sair(0);
  assert.ok(await ate(async () => (await lista()).find((a) => a.id === id)!.status === "encerrado"));
  r = await post(`/agentes/${id}/reiniciar`, {});
  assert.equal(r.status, 200);
  assert.equal(pty.procs.length, 2);
  assert.equal(pty.procs[1].opts.args[0], "--continue");
  assert.equal((await lista()).find((a) => a.id === id)!.status, "ok");
  assert.equal((await post(`/agentes/${id}/encerrar`, {})).status, 204);
  assert.equal(pty.procs[1].morto, true);
});

test("agente Claude: claude ausente -> falhou; sem driver de PTY -> 'abra o app Dev Orchestra' (CA-4d, 16d)", async (t) => {
  await new Promise((r) => setTimeout(r, 500)); // o hub do caso anterior ainda solta a porta (close espera o SSE)
  t.after(() => ui.pararUI()); // sempre derruba o hub, mesmo se um assert falhar
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 9 }), matarProcesso: () => {}, pty: ptyFalso(true) } as any);
  const cwd = await fs.mkdtemp(path.join(TMP, "wt-"));
  let j = await (await post("/agentes", { projeto: cwd, cwd, tipo: "claude", papel: "dev" })).json() as { status: string; erro: string };
  assert.equal(j.status, "falhou");
  assert.match(j.erro, /claude não encontrado/);
  ui.pararUI();
  await ui.iniciarUI({ subirServe: async () => ({ base: "http://127.0.0.1:1", pid: 9 }), matarProcesso: () => {} } as any);
  j = await (await post("/agentes", { projeto: cwd, cwd, tipo: "claude", papel: "dev" })).json() as { status: string; erro: string };
  assert.equal(j.status, "falhou");
  assert.match(j.erro, /abra o app Dev Orchestra/);
});
