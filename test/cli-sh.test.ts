// Regressao (F3.1): no Windows a tool bash do OpenCode (e o Bash do Claude) roda em git-bash; o CLI
// e' o bin/canvas (script sh), que precisa funcionar pelo nome `canvas`. Nao ha mais canvas.cmd.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(RAIZ, "bin");
const temBash = spawnSync("bash", ["-c", "echo ok"], { encoding: "utf8" }).stdout?.trim() === "ok";

test("bin/canvas existe, e' sh e chama o canvas.mjs vizinho", () => {
  const arq = path.join(BIN, "canvas");
  assert.ok(existsSync(arq), "bin/canvas (sem extensao) existe");
  const txt = readFileSync(arq, "utf8");
  assert.match(txt, /^#!\/bin\/sh/, "shebang sh");
  assert.match(txt, /canvas\.mjs/);
  assert.ok(!txt.includes("\r\n"), "fim de linha LF (bash nao aceita CRLF no shebang)");
});

test("pelo bash, `canvas --eu ... ask ...` chega no hub com os argumentos intactos", { skip: !temBash && "bash indisponivel" }, async (t) => {
  const reqs: any[] = [];
  const srv = http.createServer((req, res) => {
    let c = ""; req.on("data", (d) => { c += d; });
    req.on("end", () => { reqs.push({ url: req.url, eu: req.headers["x-eu"], corpo: JSON.parse(c || "{}") }); res.writeHead(200); res.end("ok via bash"); });
  });
  await new Promise<void>((ok) => srv.listen(0, "127.0.0.1", () => ok()));
  t.after(() => srv.close());
  const porta = (srv.address() as net.AddressInfo).port;
  const out = await new Promise<{ code: number; out: string; err: string }>((ok) => {
    const p = spawn("bash", ["-c", `canvas --eu ag-1:tok ask designer "Proponha um título curto, por favor"`], {
      env: { ...process.env, PATH: BIN + path.delimiter + (process.env.PATH ?? process.env.Path ?? ""), HERMES_UI_PORT: String(porta) },
    });
    let o = ""; let e = "";
    p.stdout.on("data", (d) => { o += d; });
    p.stderr.on("data", (d) => { e += d; });
    p.on("close", (code) => ok({ code: code ?? -1, out: o, err: e }));
  });
  assert.equal(out.code, 0, out.err);
  assert.match(out.out, /ok via bash/);
  assert.equal(reqs[0].url, "/cli/ask");
  assert.equal(reqs[0].eu, "ag-1:tok");
  assert.deepEqual(reqs[0].corpo, { alvo: "designer", texto: "Proponha um título curto, por favor" });
});
