// Runs ligadas a sessao (S5): linha Planejador do card Pedido abre o chat (toast + copiar) e filtra por sessao (CA-2/CA-5/CA-7).
import { test, expect } from "@playwright/test";
import fs from "node:fs";
import { abrir, abrirRun } from "./util.ts";
import { ABRIR_LOG, TITULO } from "./dirs.mjs";

const pedido = (page: import("@playwright/test").Page, run: string) => page.locator(`.react-flow__node[data-id="pedido:${run}"]`);

test("Pedido mostra Claude Code · titulo; clicar abre o chat e mostra o toast com o comando (CA-2)", async ({ page }) => {
  fs.rmSync(ABRIR_LOG, { force: true });
  const erros = await abrir(page);
  await abrirRun(page, "feature b");
  const p = pedido(page, "e2e-b");
  await expect(p).toContainText("Claude Code");
  await expect(p).toContainText(TITULO);
  await p.getByRole("button", { name: new RegExp(TITULO) }).click();
  await expect(page.getByText("Abrindo no Claude…")).toBeVisible();
  await expect(page.getByRole("button", { name: "Copiar comando" })).toBeVisible();
  await expect.poll(() => fs.existsSync(ABRIR_LOG) ? fs.readFileSync(ABRIR_LOG, "utf8") : "").toMatch(/claude:\/\/code\/continue\?session=local_e2e-1/);
  await expect(page.getByText("Abrindo no Claude…")).toHaveCount(0, { timeout: 9000 }); // some sozinho (~6s)
  expect(erros).toEqual([]);
});

test("funil do Pedido vira o chip da sessao e lista so as runs dela; o ✕ limpa (CA-5)", async ({ page }) => {
  await abrir(page);
  await abrirRun(page, "feature b");
  await pedido(page, "e2e-b").getByRole("button", { name: "Ver runs desta sessão" }).click();
  await expect(page.getByText(`Sessão: ${TITULO}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /relatorio do outro projeto/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /instalador sem path/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /feature c/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Limpar filtro de sessão" }).click();
  await expect(page.getByText(`Sessão: ${TITULO}`)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /feature c/ })).toBeVisible();
});

test("run sem sessao: Planejador mostra — sem botao de abrir nem funil (CA-7)", async ({ page }) => {
  await abrir(page);
  await abrirRun(page, "feature c");
  const p = pedido(page, "e2e-c");
  await expect(p).toBeVisible();
  await expect(p).not.toContainText("Claude Code");
  await expect(p.getByRole("button", { name: "Ver runs desta sessão" })).toHaveCount(0);
});
