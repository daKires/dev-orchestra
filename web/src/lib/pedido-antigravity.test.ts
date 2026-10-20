// Spec da S2 (CA-7): Pedido.tsx e App.tsx exibem "Antigravity" quando sessao.planejador === "antigravity".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

test("Pedido.tsx e App.tsx mapeiam sessao.planejador === 'antigravity' para 'Antigravity' (CA-7)", () => {
  const pedido = readFileSync(path.join(RAIZ, "web", "src", "components", "canvas", "Pedido.tsx"), "utf8");
  const app = readFileSync(path.join(RAIZ, "web", "src", "App.tsx"), "utf8");

  assert.match(pedido, /["']antigravity["']/, "Pedido.tsx trata planejador antigravity");
  assert.match(pedido, /["']Antigravity["']/, "Pedido.tsx mostra rotulo Antigravity");
  assert.match(app, /["']antigravity["']/, "App.tsx trata planejador antigravity no toast");
  assert.match(app, /["']Antigravity["']/, "App.tsx mostra Abrindo no Antigravity no toast");
});
