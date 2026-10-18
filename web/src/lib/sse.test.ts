// Guarda (CA-1): so' lib/sse.ts abre EventSource. Cada conexao a mais por aba come do limite de 6 do
// Chrome por host — com 5 por aba a 2a aba ficava em "reconectando…".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("nenhum arquivo fora de lib/sse.ts abre EventSource (use assinarEventos)", () => {
  const src = path.resolve(import.meta.dirname, "..");
  const culpados = fs.readdirSync(src, { recursive: true, encoding: "utf8" })
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== "lib/sse.ts")
    .filter((f) => fs.readFileSync(path.join(src, f), "utf8").includes("new EventSource"));
  assert.deepEqual(culpados, [], `use assinarEventos de lib/sse.ts em vez de new EventSource: ${culpados.join(", ")}`);
});
