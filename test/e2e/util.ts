// Helpers das specs E2E: abrir o dashboard sem erro de console e ler a geometria dos nos do canvas.
import { expect, type Page } from "@playwright/test";

export type Caixa = { id: string; x: number; y: number; w: number; h: number };

/** Abre o dashboard e devolve a lista de erros de console/pagina (a spec confere no fim). */
export async function abrir(page: Page): Promise<string[]> {
  const erros: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") erros.push(m.text()); });
  page.on("pageerror", (e) => erros.push(String(e)));
  await page.goto("/");
  return erros;
}

/** Seleciona a run pela sidebar (botao com a feature) e espera o painel mostrar a feature. */
export async function abrirRun(page: Page, feature: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(feature) }).first().click();
  await expect(page.locator("header").filter({ hasText: feature }).first()).toBeVisible();
}

/** Caixas (coordenadas de tela) dos nos do canvas cujo data-id comeca com `prefixo`. */
export async function caixas(page: Page, prefixo: string): Promise<Caixa[]> {
  return page.$$eval(`.react-flow__node[data-id^="${prefixo}"]`, (ns) => ns.map((n) => {
    const r = n.getBoundingClientRect();
    return { id: (n as HTMLElement).dataset.id!, x: r.x, y: r.y, w: r.width, h: r.height };
  }));
}

/** Nenhum par de caixas se sobrepoe (tolerancia de 1px pelo arredondamento do zoom). */
export function semSobreposicao(cs: Caixa[]): string[] {
  const ruins: string[] = [];
  for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) {
    const a = cs[i], b = cs[j];
    const sobrepoe = a.x + 1 < b.x + b.w && b.x + 1 < a.x + a.w && a.y + 1 < b.y + b.h && b.y + 1 < a.y + a.h;
    if (sobrepoe) ruins.push(`${a.id} x ${b.id}`);
  }
  return ruins;
}

/** Espera o layout assentar depois de um clique (upsert -> snapshot -> render). */
export async function assentar(page: Page): Promise<void> {
  await page.waitForTimeout(600);
}
