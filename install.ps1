# Instala o Dev Orchestra neste PC: deps + build, MCP no Claude Code, comandos /orchestra, skill plan-sdd e funcoes no $PROFILE.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

npm ci; if ($LASTEXITCODE) { throw 'npm ci falhou' }
npm --prefix web ci; if ($LASTEXITCODE) { throw 'npm ci (web) falhou' }
npm run build; if ($LASTEXITCODE) { throw 'build falhou' }
node register.mjs

$claude = "$HOME\.claude"
New-Item -ItemType Directory -Force "$claude\commands", "$claude\skills", "$HOME\.config\opencode\commands" | Out-Null
Copy-Item setup\claude-commands\* "$claude\commands" -Force
Copy-Item setup\skills\* "$claude\skills" -Recurse -Force
(Get-Content setup\opencode-commands\orchestra.md -Raw).Replace('{{HOME}}', $HOME) |
    Set-Content "$HOME\.config\opencode\commands\orchestra.md" -NoNewline

$linha = ". `"$PSScriptRoot\setup\profile.ps1`""
if (-not (Test-Path $PROFILE)) { New-Item -ItemType File -Force $PROFILE | Out-Null }
if (-not (Select-String -Path $PROFILE -SimpleMatch $linha -Quiet)) { Add-Content $PROFILE "`n$linha" }

Write-Host "`nPronto. Falta so a chave do swarm (uma delas), depois reabra o terminal:" -ForegroundColor Green
Write-Host '  setx OPENCODE_GO_API_KEY "..."   |   setx DEEPSEEK_API_KEY "sk-..."   |   setx OPENROUTER_API_KEY "sk-or-v1-..."'
