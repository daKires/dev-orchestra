// Driver de PTY (F4 S3/S5): abre processos com um pseudo-terminal via @lydell/node-pty.
// Usado pelo hub (iniciarUI -> POST /agentes tipo 'claude') para rodar o `claude` dentro de um PTY.
import * as pty from "@lydell/node-pty";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export type PtyProc = {
  pid: number;
  write(d: string): void;
  kill(): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (c: number) => void): void;
  resize(cols: number, rows: number): void;
};

export type PtyDriver = {
  spawn(opts: { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }): PtyProc;
  /** Resolve quando o modulo dist/claude-pty.js (resolverClaude) ja' esta' carregado. */
  carregar(): Promise<void>;
};

// Forma de resolverClaude de src/claude-pty.ts (compilado em dist/ e carregado em runtime).
type ResolverClaude = (
  saidaWhere: string,
  existe: (p: string) => boolean,
  execPath: string,
) => { comando: string; args: string[] } | null;

/**
 * Cria o driver de PTY (adapta a API do node-pty a' interface esperada pelo hub). `repo` e' a raiz
 * do hermes-bridge, de onde sai o dist/claude-pty.js com o resolverClaude. Como o spawn e' sincrono,
 * o modulo e' carregado uma vez na criacao: aguarde `carregar()` antes de usar o driver.
 */
export function criarDriverPty(repo: string): PtyDriver {
  let mod: { resolverClaude: ResolverClaude } | null = null;
  const carregando = import(pathToFileURL(path.join(repo, "dist", "claude-pty.js")).href).then((m: any) => {
    mod = m as { resolverClaude: ResolverClaude };
  });

  return {
    carregar: () => carregando,
    spawn(opts): PtyProc {
      let arquivo = opts.comando;
      let args = opts.args;
      let env = opts.env;
      if (process.platform === "win32") {
        // `where` acha o claude real sem passar por um shell que reinterprete & | > ^ % ".
        let saida = "";
        try {
          saida = execFileSync("where", [opts.comando], { encoding: "utf8", windowsHide: true });
        } catch {
          saida = "";
        }
        const r = mod ? mod.resolverClaude(saida, fs.existsSync, process.execPath) : null;
        if (!r) throw new Error("claude não encontrado no PATH");
        arquivo = r.comando;
        args = [...r.args, ...opts.args];
        // No Electron, process.execPath e' o executavel do app, nao o node. Quando o resolver devolve
        // o shim .cmd do npm (execPath + cli.js), ligue ELECTRON_RUN_AS_NODE pro Electron rodar como node.
        if (r.comando === process.execPath) env = { ...opts.env, ELECTRON_RUN_AS_NODE: "1" };
      }
      const p = pty.spawn(arquivo, args, {
        name: "xterm-256color",
        cols: opts.cols ?? 120,
        rows: opts.rows ?? 32,
        cwd: opts.cwd,
        env,
      });
      return {
        pid: p.pid,
        write: (d) => { try { p.write(d); } catch {} },
        kill: () => { try { p.kill(); } catch {} },
        onData: (cb) => { p.onData(cb); },
        onExit: (cb) => { p.onExit((e) => cb(e.exitCode)); },
        resize: (cols, rows) => { try { p.resize(cols, rows); } catch {} },
      };
    },
  };
}
