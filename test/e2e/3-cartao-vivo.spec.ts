// CA-7: Instruir agora e Pausar/Retomar no card da slice viva gravam no RUNS_DIR isolado.
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { RUNS, RUN_A } from "./dirs.mjs";
import { abrir, abrirRun } from "./util.ts";

test("Instruir agora grava a instrucao e mostra pendente (CA-7)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "instalador sem path");
  const card = page.locator(".react-flow__node").filter({ has: page.getByRole("button", { name: "Instruir agora" }) }).first();
  await card.getByPlaceholder("Instrua o agente desta slice…").fill("use path absoluto");
  await card.getByRole("button", { name: "Instruir agora" }).click();
  const arq = path.join(RUNS, RUN_A + ".instrucao.jsonl");
  await expect.poll(() => fs.existsSync(arq) && fs.readFileSync(arq, "utf8")).toContain("use path absoluto");
  await expect(card.getByText("use path absoluto")).toBeVisible();
  expect(erros).toEqual([]);
});

test("Pausar grava <run>.pausa; com a pausa confirmada, Retomar apaga (CA-7)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "instalador sem path");
  const card = page.locator(".react-flow__node").filter({ has: page.getByRole("button", { name: "Pausar" }) }).first();
  const id = await card.getAttribute("data-id");
  const idx = Number(id!.split(":")[2]);
  await card.getByRole("button", { name: "Pausar" }).click();
  const arq = path.join(RUNS, RUN_A + ".pausa");
  await expect.poll(() => fs.existsSync(arq) && fs.readFileSync(arq, "utf8")).toBe(String(idx));
  // O bridge confirmaria a pausa com um evento; aqui a fixture faz esse papel.
  fs.appendFileSync(path.join(RUNS, RUN_A + ".jsonl"), JSON.stringify({ t: "pausa", slice: idx, estado: "pausada", ts: Date.now() }) + "\n");
  const retomar = page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("button", { name: "Retomar" });
  await expect(retomar).toBeVisible({ timeout: 15_000 });
  await retomar.click();
  await expect.poll(() => fs.existsSync(arq)).toBe(false);
  fs.appendFileSync(path.join(RUNS, RUN_A + ".jsonl"), JSON.stringify({ t: "pausa", slice: idx, estado: "retomada", ts: Date.now() }) + "\n");
  await expect(page.locator(`.react-flow__node[data-id="${id}"]`).getByRole("button", { name: "Pausar" })).toBeVisible();
  expect(erros).toEqual([]);
});
