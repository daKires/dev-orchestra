// CA-8: sidebar, painel direito, Ctrl+K, seletor de projeto, status bar, paineis persistidos, console limpo.
import { test, expect } from "@playwright/test";
import { abrir, abrirRun } from "./util.ts";

test("1a carga sem nada salvo: a run ativa abre sozinha (CA-8)", async ({ page }) => {
  const erros = await abrir(page);
  await expect(page.getByText("Nenhuma run aberta")).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator("header").filter({ hasText: "instalador sem path" }).first()).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="run:e2e-a"]')).toBeVisible();
  expect(erros).toEqual([]);
});

test("progresso conta as slices do plano ainda sem evento: run A = 2/4 (CA-8)", async ({ page }) => {
  await abrir(page);
  await expect(page.getByRole("button", { name: /instalador sem path/ }).first()).toContainText("2/4 slices");
  await expect(page.locator("footer").getByText("2/4 slices").first()).toBeVisible();
});

test("sidebar: Runs troca a run; Explorador abre/fecha pasta (CA-8)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "feature b");
  await expect(page.locator('.react-flow__node[data-id="run:e2e-b"]')).toBeVisible();
  await abrirRun(page, "instalador sem path");
  const arq = page.getByText("setup.ts", { exact: true });
  await expect(arq).toBeVisible();
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(arq).toHaveCount(0);
  await page.getByRole("button", { name: "src", exact: true }).click();
  await expect(arq).toBeVisible();
  expect(erros).toEqual([]);
});

test("painel direito: abas Feed/Diff/Gate/Detalhes mostram o conteudo da run (CA-8)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "feature b");
  await page.getByRole("tab", { name: "Diff" }).click();
  await expect(page.getByRole("tabpanel").getByText("b.txt").first()).toBeVisible();
  await page.getByRole("tab", { name: "Gate" }).click();
  await expect(page.getByRole("tabpanel").getByText("npm run typecheck").first()).toBeVisible();
  await page.getByRole("tab", { name: "Detalhes" }).click();
  await expect(page.getByRole("tabpanel")).toBeVisible();
  await page.getByRole("tab", { name: "Feed" }).click();
  await expect(page.getByPlaceholder("Buscar no feed…")).toBeVisible();
  expect(erros).toEqual([]);
});

test("Ctrl+K: vai pra run pelo nome (CA-8)", async ({ page }) => {
  const erros = await abrir(page);
  await expect(page.locator("header").filter({ hasText: "instalador sem path" }).first()).toBeVisible();
  await page.keyboard.press("Control+k");
  const campo = page.getByPlaceholder("Ir para run, slice ou arquivo…");
  await expect(campo).toBeVisible();
  await campo.fill("feature c");
  await page.keyboard.press("Enter");
  await expect(campo).toHaveCount(0);
  await expect(page.locator("header").filter({ hasText: "feature c" }).first()).toBeVisible();
  expect(erros).toEqual([]);
});

test("seletor de projeto lista o projeto da fixture (CA-8)", async ({ page }) => {
  const erros = await abrir(page);
  await page.getByRole("button", { name: "Escolher projeto" }).click();
  await expect(page.getByRole("option", { name: /repo/ }).or(page.getByRole("menuitem", { name: /repo/ })).first()).toBeVisible();
  await page.keyboard.press("Escape");
  expect(erros).toEqual([]);
});

test("paineis redimensionados persistem apos reload (CA-8)", async ({ page }) => {
  await abrir(page);
  // Divisoria vertical entre o canvas e o painel direito (a ultima vertical da tela).
  const sep = page.locator('[role="separator"][aria-orientation="vertical"]').last();
  await expect(sep).toBeVisible();
  const antes = (await sep.boundingBox())!;
  await page.mouse.move(antes.x + antes.width / 2, antes.y + antes.height / 2);
  await page.mouse.down();
  await page.mouse.move(antes.x + 120, antes.y + antes.height / 2, { steps: 8 });
  await page.mouse.up();
  const depois = (await sep.boundingBox())!;
  expect(Math.abs(depois.x - antes.x)).toBeGreaterThan(50);
  await page.reload();
  await expect(sep).toBeVisible();
  expect(Math.abs((await sep.boundingBox())!.x - depois.x)).toBeLessThan(3);
});
