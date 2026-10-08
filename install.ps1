# Instala o Dev Orchestra neste PC: deps + build, MCP no Claude Code, comandos /orchestra, skill plan-sdd e funcoes no $PROFILE.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

[Environment]::SetEnvironmentVariable('HERMES_REPO', $PSScriptRoot, 'User')

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

# PowerShell 7 e 5 carregam o mesmo setup\profile.ps1. Copias antigas de orchestra/orchestra-go/hermes
# coladas no profile sao removidas (backup .bak-hermes), senao elas venceriam as do repo.
$linha = ". `"$PSScriptRoot\setup\profile.ps1`""
$docs = [Environment]::GetFolderPath('MyDocuments')
foreach ($perfil in "$docs\PowerShell\Microsoft.PowerShell_profile.ps1", "$docs\WindowsPowerShell\Microsoft.PowerShell_profile.ps1") {
    if (-not (Test-Path $perfil)) { New-Item -ItemType File -Force $perfil | Out-Null }
    $antes = @(Get-Content $perfil)
    $depois = @(); $pulando = $false
    foreach ($l in $antes) {
        if (-not $pulando -and $l -match '^function (orchestra|orchestra-go|hermes)\s*\{') { $pulando = $true; continue }
        if ($pulando) { if ($l -match '^\}\s*$') { $pulando = $false }; continue }
        $depois += $l
    }
    if ($depois.Count -ne $antes.Count) { Copy-Item $perfil "$perfil.bak-hermes" -Force; Set-Content $perfil $depois }
    if (-not (Select-String -Path $perfil -SimpleMatch $linha -Quiet)) { Add-Content $perfil "`n$linha" }
}

Write-Host "`nPronto. Falta so a chave do swarm (uma delas), depois reabra o terminal:" -ForegroundColor Green
Write-Host '  setx OPENCODE_GO_API_KEY "..."   |   setx DEEPSEEK_API_KEY "sk-..."   |   setx OPENROUTER_API_KEY "sk-or-v1-..."'

Write-Host "`nPra gerar o instalador do app desktop rode:" -ForegroundColor Green
Write-Host '  npm run desktop:dist'
Write-Host '  (gera release\Hermes Setup *.exe)'
