# Carregado pelo $PROFILE (linha adicionada pelo install.ps1).
$HERMES_DIR = Split-Path $PSScriptRoot -Parent

# Abre o app desktop se estiver instalado; senao abre o dashboard no navegador.
# App ja' aberto: ativa a janela DAQUI (o terminal em primeiro plano tem o direito de foco que o
# Windows nega ao proprio app) e ainda chama o exe, que avisa o app (retoma a porta, foco de reserva).
function Abrir-Hermes([int]$Porta = 4123) {
    $exe = "$env:LOCALAPPDATA\Programs\Hermes\Hermes.exe"
    if (-not (Test-Path $exe)) { Start-Process "http://127.0.0.1:$Porta"; return }
    $janela = Get-Process Hermes -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
    if ($janela) {
        if (-not ('HermesJanela' -as [type])) {
            Add-Type -Namespace '' -Name HermesJanela -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(System.IntPtr h);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h);
'@
        }
        if ([HermesJanela]::IsIconic($janela.MainWindowHandle)) { [void][HermesJanela]::ShowWindow($janela.MainWindowHandle, 9) }
        [void][HermesJanela]::SetForegroundWindow($janela.MainWindowHandle)
    }
    Start-Process $exe
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
