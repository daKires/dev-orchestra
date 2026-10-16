// CA-9: Merge, Descartar e Cancelar de verdade, no repo git temporario e no RUNS_DIR isolado.
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { REPO, RUNS, RUN_A } from "./dirs.mjs";
import { abrir, abrirRun } from "./util.ts";

const git = (...args: string[]) => execFileSync("git", args, { cwd: REPO, encoding: "utf8" });

async function confirmarAcao(page: Page, botao: string): Promise<void> {
  await page.getByRole("button", { name: botao, exact: true }).first().click();
  const dialogo = page.getByRole("dialog");
  await expect(dialogo).toBeVisible();
  await dialogo.getByRole("button", { name: "Confirmar" }).click();
  await expect(dialogo).toHaveCount(0);
}

test("Merge (--no-ff) da run B leva o branch pra master e apaga o branch (CA-9)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "feature b");
  await confirmarAcao(page, "Merge (--no-ff)");
  await expect.poll(() => git("log", "--oneline", "master")).toContain("Merge orchestra/b");
  await expect.poll(() => git("branch", "--list", "orchestra/b").trim()).toBe("");
  expect(fs.existsSync(path.join(REPO, "b.txt"))).toBe(true);
  expect(erros).toEqual([]);
});

test("Descartar a run C apaga o branch sem mexer na master (CA-9)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "feature c");
  const antes = git("rev-parse", "master").trim();
  await confirmarAcao(page, "Descartar");
  await expect.poll(() => git("branch", "--list", "orchestra/c").trim()).toBe("");
  expect(git("rev-parse", "master").trim()).toBe(antes);
  expect(erros).toEqual([]);
});

test("Cancelar run grava <run>.cancel; Cancelar no dialogo nao grava (CA-9)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "instalador sem path");
  const arq = path.join(RUNS, RUN_A + ".cancel");
  await page.getByRole("button", { name: "Cancelar run" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancelar", exact: true }).click();
  expect(fs.existsSync(arq)).toBe(false);
  await confirmarAcao(page, "Cancelar run");
  await expect.poll(() => fs.existsSync(arq)).toBe(true);
  expect(erros).toEqual([]);
});
