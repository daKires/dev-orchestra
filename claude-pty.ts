// Agentes Claude Code via PTY (F4 S1): logica PURA (CA-4d, 4e, 4f).
// Roda com `node --experimental-strip-types`: apenas imports de `node:`; sem enum/namespace.

// Argumentos do processo `claude` (CA-4d, 4h)

export type ArgsClaudeOpts = {
  prompt: string;
  settingsPath: string;
  modelo?: string;
  continuar?: boolean;
};

/**
 * Monta os argumentos do Claude Code: `--continue` (se continuar), `--append-system-prompt`
 * seguido do prompt, `--settings` seguido do caminho e, so' quando informado, `--model`.
 */
export function argsClaude(o: ArgsClaudeOpts): string[] {
  const args: string[] = [];
  if (o.continuar) args.push("--continue");
  args.push("--append-system-prompt", o.prompt, "--settings", o.settingsPath);
  if (o.modelo) args.push("--model", o.modelo);
  return args;
}

// Modelos (CA-5)

/** Modelos aceitos: "" (padrao do Claude) + opus/sonnet/haiku. */
export const MODELOS_CLAUDE: readonly string[] = ["", "opus", "sonnet", "haiku"];

// Hooks de status (CA-4e)

export type HookCommand = { type: "command"; command: string };
export type HookMatcher = { matcher: string; hooks: HookCommand[] };
export type SettingsHooks = { hooks: Record<"UserPromptSubmit" | "Stop" | "Notification", HookMatcher[]> };

/**
 * Settings do Claude com hooks que chamam `canvas --eu id:token status ...`: ocupado ao enviar
 * prompt, ocioso ao parar e aguardando em Notification (CA-4e).
 */
export function settingsHooks(id: string, token: string): SettingsHooks {
  const ev = (status: string, matcher = ""): HookMatcher[] => [
    { matcher, hooks: [{ type: "command", command: `canvas --eu ${id}:${token} status ${status}` }] },
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
