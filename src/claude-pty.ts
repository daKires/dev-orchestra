// Agentes Claude Code via PTY (F4 S1): logica PURA (CA-4d, 4e, 4f).
// Roda com `node --experimental-strip-types`: apenas imports de `node:`; sem enum/namespace.
import path from "node:path";

/**
 * `claude` a partir da saida do `where`, sem shell que reinterprete `& | > ^ % "`: o .exe nativo vence;
 * senao o shim .cmd do npm vira node + cli.js do pacote; nada -> null.
 */
export function resolverClaude(
  saidaWhere: string,
  existe: (p: string) => boolean,
  execPath: string,
): { comando: string; args: string[] } | null {
  const linhas = saidaWhere.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  const exe = linhas.find((l) => /\.exe$/i.test(l));
  if (exe) return { comando: exe, args: [] };
  const shim = linhas.find((l) => /\.cmd$/i.test(l));
  if (shim) {
    // path.dirname e' platform-specific; a pasta do shim sai cortando o ultimo separador (\ ou /).
    const pasta = shim.replace(/[\\/][^\\/]*$/, "");
    const cli = path.join(pasta, "node_modules", "@anthropic-ai", "claude-code", "cli.js");
    if (existe(cli)) return { comando: execPath, args: [cli] };
  }
  return null;
}

// Argumentos do processo `claude` (CA-4d, 4h)

export type ArgsClaudeOpts = {
  prompt: string;
  settingsPath: string;
  modelo?: string;
  continuar?: boolean;
  inicial?: string;
};

/**
 * Monta os argumentos do Claude Code: `--continue` (se continuar), `--append-system-prompt`
 * seguido do prompt, `--settings` seguido do caminho e, so' quando informado, `--model`.
 * `inicial` (G2) vai como ULTIMO argumento posicional (prompt inicial do Claude, ex.: `/orchestra "..."`).
 */
export function argsClaude(o: ArgsClaudeOpts): string[] {
  const args: string[] = [];
  if (o.continuar) args.push("--continue");
  args.push("--append-system-prompt", o.prompt, "--settings", o.settingsPath);
  if (o.modelo) args.push("--model", o.modelo);
  if (o.inicial) args.push(o.inicial);
  return args;
}

// Hooks de status (CA-4e)

export type HookCommand = { type: "command"; command: string };
export type HookMatcher = { matcher: string; hooks: HookCommand[] };
export type SettingsHooks = { hooks: Record<"UserPromptSubmit" | "Stop" | "Notification", HookMatcher[]> };

/**
 * Hooks de status (ocupado/ocioso/aguardando) chamando node + canvas.mjs absolutos: o hook nao herda o
 * PATH. Barras '/' entre aspas funcionam no bash e no cmd.
 */
export function settingsHooks(id: string, token: string, node: string, canvasMjs: string): SettingsHooks {
  const citar = (p: string) => `"${p.replace(/\\/g, "/")}"`;
  const ev = (status: string, matcher = ""): HookMatcher[] => [
    { matcher, hooks: [{ type: "command", command: `${citar(node)} ${citar(canvasMjs)} --eu ${id}:${token} status ${status}` }] },
  ];
  return {
    hooks: {
      UserPromptSubmit: ev("ocupado"),
      Stop: ev("ocioso"),
      // So' o prompt de permissao: aviso de inatividade/login tambem e' Notification e travaria a fila.
      Notification: ev("aguardando", "permission_prompt"),
    },
  };
}

// Escrita no PTY (CA-4f)

/** Envia texto ao PTY como colagem entre colchetes (bracketed paste) seguida de Enter. */
export function textoParaPty(msg: string): string {
  return "\x1b[200~" + msg + "\x1b[201~\r";
}
