// Spec da S2: o planejador default do servidor do OpenCode e' o GLM 5.2 (nao mais o Kimi K3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const AQUI = path.dirname(fileURLToPath(import.meta.url)); // dist/
const SCRIPT = path.join(AQUI, "..", "orchestra-go.ps1");
test("orchestra-go.ps1: planejador default e' opencode-go/glm-5.2, sem kimi (CA-7)", async () => {
    const ps1 = await readFile(SCRIPT, "utf8");
    assert.ok(ps1.includes("$MODELO = 'opencode-go/glm-5.2'"), "o default do modelo e' opencode-go/glm-5.2");
    assert.ok(!/kimi/i.test(ps1), "nenhuma mencao a kimi restou no script (nem comentario)");
});
test("orchestra-go.ps1: o POST /command continua disparando com model = $MODELO (CA-7)", async () => {
    const ps1 = await readFile(SCRIPT, "utf8");
    assert.ok(ps1.includes("model = $MODELO"), "o comando /orchestra segue disparado com o modelo default");
});
