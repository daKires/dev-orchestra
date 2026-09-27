# Envs comuns do orchestra (planejador Claude ou OpenCode). Dot-source: `. orchestra-env.ps1`.
# Deixa $OrchestraEnvOk = $false se faltar chave do swarm.
# Chave do swarm: OpenCode Go OU DeepSeek nativa OU OpenRouter. Defina UMA, persistente, fora daqui:
#   setx OPENCODE_GO_API_KEY "..."  OU  setx DEEPSEEK_API_KEY "sk-..."  OU  setx OPENROUTER_API_KEY "sk-or-v1-..."
$OrchestraEnvOk = [bool]($env:OPENCODE_GO_API_KEY -or $env:DEEPSEEK_API_KEY -or $env:OPENROUTER_API_KEY)
if (-not $OrchestraEnvOk) {
    Write-Host 'Nenhuma chave do swarm (OPENCODE_GO_API_KEY, DEEPSEEK_API_KEY, OPENROUTER_API_KEY). Rode setx com uma delas e reabra o terminal.' -ForegroundColor Red
}
# HERMES_MODEL: nao seta de proposito -- o deepseek.ts escolhe o default conforme a chave presente.
# Allowlist de comandos que os agentes podem rodar pra se verificar (o planejador costuma mandar override).
if (-not $env:HERMES_CMDS) { $env:HERMES_CMDS = "npm run build,npm test,npx tsc --noEmit" }
# Gate deterministico (fail-closed): roda apos os agentes; se falhar, tenta reparo e so entao bloqueia o commit.
if (-not $env:HERMES_GATE) { $env:HERMES_GATE = "npx tsc --noEmit,npm test" }
if (-not $env:HERMES_REPAIR_TRIES) { $env:HERMES_REPAIR_TRIES = "1" }
$env:HERMES_UI_PORT = "4123"
$env:HERMES_LOG = "$env:TEMP\hermes-run.log"
if (-not (Test-Path $env:HERMES_LOG)) { New-Item -ItemType File -Path $env:HERMES_LOG | Out-Null }
