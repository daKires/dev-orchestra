// Spec do PR1/S2 (CA-3): asset do canvas sai com CSP sandbox — um SVG aberto direto nao roda script
// na origem do hub (onde ele poderia mandar X-Hermes e digitar no PTY dos agentes).
import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { promises as fs } from "node:fs";
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
const CANVAS = await fs.mkdtemp(path.join(os.tmpdir(), "seg-asset-"));
process.env.HERMES_UI_PORT = String(PORTA);
process.env.HERMES_RUNS_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-asset-runs-"));
process.env.HERMES_PLANEJADORES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-asset-plan-"));
process.env.HERMES_CANVAS_DIR = CANVAS;
process.env.HERMES_AGENTES_DIR = await fs.mkdtemp(path.join(os.tmpdir(), "seg-asset-ag-"));
const ui = await import("../dist/ui.js");

test("GET /canvas/asset sai com Content-Security-Policy: sandbox (CA-3)", async (t) => {
  const id = "abc123";
  await fs.mkdir(path.join(CANVAS, id, "assets"), { recursive: true });
  await fs.writeFile(path.join(CANVAS, id, "assets", "x.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  await fs.writeFile(path.join(CANVAS, id, "assets", "y.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  await ui.iniciarUI();
  t.after(() => ui.pararUI());
  for (const arq of ["x.svg", "y.png"]) {
    const r = await fetch(`http://127.0.0.1:${PORTA}/canvas/asset/${id}/${arq}`);
    assert.equal(r.status, 200, arq);
    assert.match(r.headers.get("content-security-policy") ?? "", /\bsandbox\b/, arq + " com sandbox");
  }
});
