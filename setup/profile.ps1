# Carregado pelo $PROFILE (linha adicionada pelo install.ps1).
$HERMES_DIR = Split-Path $PSScriptRoot -Parent

# Abre o app desktop se estiver instalado; senao abre o dashboard no navegador.
function Abrir-Hermes([int]$Porta = 4123) {
    $exe = "$env:LOCALAPPDATA\Programs\Hermes\Hermes.exe"
    if (Test-Path $exe) { Start-Process $exe }
    else { Start-Process "http://127.0.0.1:$Porta" }
}

# Planejador Claude, na pasta atual (sem worktree).
function orchestra {
    . "$HERMES_DIR\orchestra-env.ps1"
    if (-not $OrchestraEnvOk) { return }
    Abrir-Hermes $env:HERMES_UI_PORT
    Write-Host "--- ORCHESTRA ONLINE: CLAUDE PLANEJA -> HERMES IMPLEMENTA ---"
    claude "/orchestra $args"
}

# Planejador OpenCode Go num worktree novo (.claude\worktrees\<slug>) da main; chat no navegador.
function orchestra-go {
    $feature = "$args"
    if (-not $feature) { Write-Host 'Uso: orchestra-go "descricao da feature"' -ForegroundColor Yellow; return }
    Write-Host "--- criando worktree + subindo o planejador (pode levar 1-2 min instalando deps) ---"
    $json = & pwsh -NoProfile -File "$HERMES_DIR\orchestra-go.ps1" -Projeto (Get-Location).Path -Feature $feature
    if ($LASTEXITCODE -or -not $json) { return }
    $r = $json | ConvertFrom-Json
    Abrir-Hermes 4123
    Start-Process $r.url
    Write-Host "--- worktree: $($r.cwd) ---"
    Write-Host "--- chat: $($r.url) ---"
}

# Liga so o dashboard (sem Claude/OpenCode abertos).
function hermes {
    $exe = "$env:LOCALAPPDATA\Programs\Hermes\Hermes.exe"
    if (-not (Test-Path $exe)) {
        Start-Process node -ArgumentList "`"$HERMES_DIR\dist\index.js`"", '--ui' -WindowStyle Hidden
    }
    Abrir-Hermes 4123
}
