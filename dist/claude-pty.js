// Agentes Claude Code via PTY (F4 S1): logica PURA (CA-4d, 4e, 4f).
// Roda com `node --experimental-strip-types`: apenas imports de `node:`; sem enum/namespace.
/**
 * Monta os argumentos do Claude Code: `--continue` (se continuar), `--append-system-prompt`
 * seguido do prompt, `--settings` seguido do caminho e, so' quando informado, `--model`.
 * `inicial` (G2) vai como ULTIMO argumento posicional (prompt inicial do Claude, ex.: `/orchestra "..."`).
 */
export function argsClaude(o) {
    const args = [];
    if (o.continuar)
        args.push("--continue");
    args.push("--append-system-prompt", o.prompt, "--settings", o.settingsPath);
    if (o.modelo)
        args.push("--model", o.modelo);
    if (o.inicial)
        args.push(o.inicial);
    return args;
}
// Modelos (CA-5)
/** Modelos aceitos: "" (padrao do Claude) + opus/sonnet/haiku. */
export const MODELOS_CLAUDE = ["", "opus", "sonnet", "haiku"];
/**
 * Settings do Claude com hooks que chamam `canvas --eu id:token status ...`: ocupado ao enviar
 * prompt, ocioso ao parar e aguardando em Notification (CA-4e).
 */
export function settingsHooks(id, token) {
    const ev = (status, matcher = "") => [
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
export function textoParaPty(msg) {
    return "\x1b[200~" + msg + "\x1b[201~\r";
}
