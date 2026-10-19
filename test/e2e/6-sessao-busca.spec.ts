// Runs ligadas a sessao (S4): busca global na sidebar, ?run= e Ctrl+K pelo titulo do chat (CA-4/CA-6).
import { test, expect } from "@playwright/test";
import { abrir } from "./util.ts";
import { TITULO } from "./dirs.mjs";

test("busca da sidebar acha runs de todos os projetos pelo titulo do chat, agrupadas (CA-4)", async ({ page }) => {
  const erros = await abrir(page);
  await expect(page.locator("header").filter({ hasText: "instalador sem path" }).first()).toBeVisible();
  const busca = page.getByPlaceholder("Buscar runs…");
  await busca.fill("relatorios");
  await expect(page.getByRole("button", { name: /feature b/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /relatorio do outro projeto/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /instalador sem path/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /feature c/ })).toHaveCount(0);
  await expect(page.getByText("outro", { exact: true }).first()).toBeVisible(); // cabecalho do grupo do 2o projeto

  await page.getByRole("button", { name: /relatorio do outro projeto/ }).click();
  await expect(page.getByText("Explorador · outro")).toBeVisible();
  await expect(page.locator('.react-flow__node[data-id="run:e2e-d"]')).toBeVisible();

  await busca.fill("nada parecido com isso");
  await expect(page.getByText("Nenhuma run encontrada.")).toBeVisible();
  await busca.fill("");
  await expect(page.getByRole("button", { name: /relatorio do outro projeto/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature b/ })).toHaveCount(0); // volta ao projeto atual (outro)
  expect(erros).toEqual([]);
});

test("busca casa feature/branch sem acento nem caixa (CA-4)", async ({ page }) => {
  await abrir(page);
  const busca = page.getByPlaceholder("Buscar runs…");
  await busca.fill("FEATURE C");
  await expect(page.getByRole("button", { name: /feature c/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /feature b/ })).toHaveCount(0);
  await busca.fill("orchestra/b");
  await expect(page.getByRole("button", { name: /feature b/ })).toBeVisible();
});

test("/?run=<runId do MCP> abre o dashboard focado naquela run (CA-6)", async ({ page }) => {
  const erros: string[] = [];
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto("/?run=mcp-e2e-d");
  await expect(page.getByText("Explorador · outro")).toBeVisible();
  await expect(page.locator("header").filter({ hasText: "relatorio do outro projeto" }).first()).toBeVisible();
  await page.goto("/?run=nao-existe");
  await expect(page.locator("header").filter({ hasText: "instalador sem path" }).first()).toBeVisible();
  expect(erros).toEqual([]);
});

test("Ctrl+K acha a run pelo titulo do chat (CA-4)", async ({ page }) => {
  await abrir(page);
  await expect(page.locator("header").filter({ hasText: "instalador sem path" }).first()).toBeVisible();
  await page.keyboard.press("Control+k");
  await page.getByPlaceholder("Ir para run, slice ou arquivo…").fill(TITULO);
  await expect(page.getByRole("option", { name: /feature b/ })).toBeVisible();
  await expect(page.getByRole("option", { name: /feature c/ })).toHaveCount(0);
});
