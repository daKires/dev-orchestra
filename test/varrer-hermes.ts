// Varredura de "hermes" usada por rename.test.ts (backend) e rename-front.test.ts (desktop/web).
// So' a migracao do legado pode citar o nome antigo.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function arquivos(dir: string): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const p = path.join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...arquivos(p));
    else if (!/\.test\.tsx?$/.test(nome)) out.push(p);
  }
  return out;
}

function permitida(rel: string, linha: string): boolean {
  if (rel === "src/setup.ts") return /hermes-bridge|HERMES_/.test(linha);
  if (rel === "src/ui.ts") return /tmpdir\(\),\s*"hermes"/.test(linha);
  return false;
}

export function varrerHermes(dirs: string[], soltos: string[]): string[] {
  const alvos = [...dirs.flatMap((d) => arquivos(path.join(RAIZ, d))), ...soltos.map((f) => path.join(RAIZ, f))];
  const achados: string[] = [];
  for (const arq of alvos) {
    const rel = path.relative(RAIZ, arq).replace(/\\/g, "/");
    readFileSync(arq, "utf8").split(/\r?\n/).forEach((linha, i) => {
      if (/hermes/i.test(linha) && !permitida(rel, linha)) achados.push(`${rel}:${i + 1}: ${linha.trim().slice(0, 120)}`);
    });
  }
  return achados;
}
