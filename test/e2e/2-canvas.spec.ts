// CA-1/2/3/4/6: fase 2 empilhada sem sobrepor em qualquer combinacao, slice viva aberta, titulo limpo.
import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { RUNS, RUN_A } from "./dirs.mjs";
import { abrir, abrirRun, assentar, caixas, semSobreposicao } from "./util.ts";

const worker = (page: Page, k: number) => page.locator(`.react-flow__node[data-id="worker:${RUN_A}:${k}"]`);
const aberta = async (page: Page, k: number) => (await worker(page, k).getByRole("button", { name: "Recolher" }).count()) > 0;

/** Alterna a slice k: compacta abre pelo header; aberta recolhe pelo botao Recolher. */
async function alternar(page: Page, k: number): Promise<void> {
  if (await aberta(page, k)) await worker(page, k).getByRole("button", { name: "Recolher" }).click();
  else await worker(page, k).locator("header").first().click();
  await assentar(page);
}

/** Todos os nos das 3 fases sem sobrepor; slices na mesma coluna, em ordem, com o mesmo espaco entre elas. */
async function conferirFases(page: Page, rotulo: string): Promise<void> {
  // Re-tenta ate' o render assentar (o React Flow mede grupo e filhos em quadros diferentes).
  await expect(async () => conferirFasesAgora(page, rotulo)).toPass({ timeout: 5000 });
}

async function conferirFasesAgora(page: Page, rotulo: string): Promise<void> {
  const ws = (await caixas(page, `worker:${RUN_A}:`)).sort((a, b) => a.id.localeCompare(b.id));
  expect(ws, rotulo).toHaveLength(4);
  const filhos = [...ws, ...(await caixas(page, `pedido:${RUN_A}`)), ...(await caixas(page, `gate:${RUN_A}`)), ...(await caixas(page, `diff:${RUN_A}`))];
  expect(semSobreposicao(filhos), rotulo).toEqual([]);
  expect(new Set(ws.map((w) => Math.round(w.x))).size, rotulo + ": mesma coluna").toBe(1);
  const gaps = ws.slice(1).map((w, i) => Math.round(w.y - (ws[i].y + ws[i].h)));
  expect(gaps.every((g) => g > 0), rotulo + ": em ordem, sem encostar").toBe(true);
  expect(Math.max(...gaps) - Math.min(...gaps), rotulo + ": sem buraco (gaps iguais) " + gaps.join(",")).toBeLessThanOrEqual(2);
  const fase2 = (await caixas(page, `fase2:${RUN_A}`))[0];
  for (const w of ws) expect(w.y + w.h <= fase2.y + fase2.h + 1, rotulo + ": fase 2 envolve " + w.id).toBe(true);
}

test("slice viva (S3 rodando) abre sozinha; as outras ficam compactas (CA-3)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "instalador sem path");
  await expect(worker(page, 3).getByRole("button", { name: "Recolher" })).toBeVisible();
  for (const k of [1, 2, 4]) expect(await aberta(page, k)).toBe(false);
  await conferirFases(page, "inicial");
  expect(erros).toEqual([]);
});

test("titulo da slice nao repete o prefixo S<n> (CA-4)", async ({ page }) => {
  await abrir(page);
  await abrirRun(page, "instalador sem path");
  await expect(worker(page, 1).locator("header").first()).toContainText("S1 · npm e node absolutos no setup");
  await expect(worker(page, 1).locator("header").first()).not.toContainText("S1 · S1");
  await expect(worker(page, 3).locator("header").first()).not.toContainText("S3 · S3");
  await expect(page.locator("footer").last()).toContainText("S3 Codex e Antigravity");
  await expect(page.locator("footer").last()).not.toContainText("S3 S3");
});

test("abrir/fechar cada slice em sequencia nunca sobrepoe nem deixa buraco (CA-1, CA-2, CA-6)", async ({ page }) => {
  const erros = await abrir(page);
  await abrirRun(page, "instalador sem path");
  // Sequencia dos prints: abre S1, recolhe S3, recolhe S1, abre S2, abre S4, abre todas, fecha todas.
  for (const k of [1, 3, 1, 2, 4]) { await alternar(page, k); await conferirFases(page, `depois de alternar S${k}`); }
  for (const k of [1, 2, 3, 4]) if (!(await aberta(page, k))) await alternar(page, k);
  await conferirFases(page, "todas abertas");
  for (const k of [1, 2, 3, 4]) if (await aberta(page, k)) await alternar(page, k);
  await conferirFases(page, "todas compactas");
  await page.reload();
  await abrirRun(page, "instalador sem path");
  await conferirFases(page, "depois do reload");
  expect(erros).toEqual([]);
});

test("clique vale ate' a viva trocar: S4 passa a rodar -> S4 abre, S3 recolhe (CA-3)", async ({ page }) => {
  await abrir(page);
  await abrirRun(page, "instalador sem path");
  if (!(await aberta(page, 3))) await alternar(page, 3);
  await alternar(page, 3); // usuario recolhe a viva: vale enquanto a S3 for a viva
  await page.waitForTimeout(1500);
  expect(await aberta(page, 3)).toBe(false);
  const ts = Date.now();
  const evs = [
    { t: "slice", idx: 3, total: 4, tarefa: "S3 Codex e Antigravity na config", status: "ok", ts },
    { t: "slice", idx: 4, total: 4, tarefa: "S4 dados fora do TEMP", status: "rodando", ts: ts + 1 },
    { t: "tool", slice: 4, nome: "ler_arquivo", alvo: "src/setup.ts", ok: true, resumo: "src/setup.ts", ts: ts + 2 },
  ];
  fs.appendFileSync(path.join(RUNS, RUN_A + ".jsonl"), evs.map((e) => JSON.stringify(e)).join("\n") + "\n");
  await expect(worker(page, 4).getByRole("button", { name: "Recolher" })).toBeVisible({ timeout: 15_000 });
  expect(await aberta(page, 3)).toBe(false);
  await conferirFases(page, "viva trocou");
});
