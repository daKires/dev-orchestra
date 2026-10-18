// CA-2: duas abas ao mesmo tempo ficam conectadas (1 EventSource por aba; o Chrome so' da' 6 por host).
import { test, expect } from "@playwright/test";
import { abrir } from "./util.ts";

test("2 abas abertas: as duas com hub conectado e a lista de runs (CA-2)", async ({ context }) => {
  const abas = [await context.newPage(), await context.newPage()];
  for (const aba of abas) await abrir(aba);
  for (const aba of abas) {
    await expect(aba.getByText("hub conectado").first()).toBeVisible({ timeout: 5000 });
    await expect(aba.getByRole("button", { name: /instalador sem path/ }).first()).toBeVisible();
  }
});
