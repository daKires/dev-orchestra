// Driver de PTY (F4 S3/S5): abre processos com um pseudo-terminal via @lydell/node-pty.
// Usado pelo hub (iniciarUI -> POST /agentes tipo 'claude') para rodar o `claude` dentro de um PTY.
import * as pty from "@lydell/node-pty";

export type PtyProc = {
  pid: number;
  write(d: string): void;
  kill(): void;
  onData(cb: (d: string) => void): void;
  onExit(cb: (c: number) => void): void;
};

export type PtyDriver = {
  spawn(opts: { comando: string; args: string[]; cwd: string; env: Record<string, string | undefined>; cols?: number; rows?: number }): PtyProc;
};

/** Cria o driver de PTY (adapta a API do node-pty a' interface esperada pelo hub). */
export function criarDriverPty(): PtyDriver {
  return {
    spawn(opts): PtyProc {
      const win = process.platform === "win32";
      // No Windows o `claude` e' um .cmd: precisa de cmd.exe /c pra ser executado.
      const arquivo = win ? "cmd.exe" : opts.comando;
      const args = win ? ["/c", opts.comando, ...opts.args] : opts.args;
      const p = pty.spawn(arquivo, args, {
        name: "xterm-256color",
        cols: opts.cols ?? 120,
        rows: opts.rows ?? 32,
        cwd: opts.cwd,
        env: opts.env,
      });
      return {
        pid: p.pid,
        write: (d) => { try { p.write(d); } catch {} },
        kill: () => { try { p.kill(); } catch {} },
        onData: (cb) => { p.onData(cb); },
        onExit: (cb) => { p.onExit((e) => cb(e.exitCode)); },
      };
    },
  };
}
