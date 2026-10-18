// Helpers da spec do partir-ui. Nunca deixa ENOENT/"Cannot find module" vazar (o doctor leria como AMBIENTE).
import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { mkdtempSync } from "node:fs";

// importar os modulos do hub cria pastas de dados: aponta tudo pra um temporario
const TMP = mkdtempSync(path.join(os.tmpdir(), "partir-ui-"));
for (const k of ["RUNS", "AGENTES", "CANVAS", "PLANEJADORES"]) process.env[`DEV_ORCHESTRA_${k}_DIR`] ??= path.join(TMP, k.toLowerCase());

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function fonte(rel: string): string {
  const p = path.join(RAIZ, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
}

export async function modulo(rel: string): Promise<Record<string, unknown>> {
  const p = path.join(RAIZ, rel);
  if (!existsSync(p)) return {};
  try { return await import(pathToFileURL(p).href); } catch { return {}; }
}

export function faltando(mod: Record<string, unknown>, nomes: string[]): string[] {
  return nomes.filter((n) => !(n in mod));
}

export function definidos(src: string, marcas: string[]): string[] {
  return marcas.filter((m) => src.includes(m));
}
