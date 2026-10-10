# Inicia (ou reabre) uma feature do orchestra com o GLM 5.2 (OpenCode Go) como planejador:
# worktree <raiz>\.claude\worktrees\<slug> a partir da main -> deps + .env* -> `opencode serve` no worktree
# -> sessao rodando /orchestra <feature (+ descricao + caminhos dos anexos)> -> registro
# %TEMP%\hermes\planejadores\<projeto>--<slug>.json. Imprime esse registro (JSON, 1 linha) no stdout.
# Usado pelo $PROFILE (orchestra-go) e pelo dashboard (que passa -Descricao/-AnexosDir quando o pedido tem).
param(
    [Parameter(Mandatory)][string]$Projeto,
    [Parameter(Mandatory)][string]$Feature,
    [ValidateSet('opencode','claude')][string]$Planejador = 'opencode',
    # ATENCAO: PowerShell e' case-insensitive -> o parametro nao pode se chamar $Modelo (colidiria com
    # $MODELO). O nome real e' $ModeloEscolhido; o alias 'Modelo' aceita o argumento -Modelo do hub.
    [Alias('Modelo')][string]$ModeloEscolhido,
    [string]$Descricao,
    [string]$AnexosDir
)
$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\orchestra-env.ps1"
if (-not $OrchestraEnvOk) { exit 1 }
$MODELO = 'opencode-go/glm-5.2'
if ($ModeloEscolhido) { $MODELO = $ModeloEscolhido }

function Falha([string]$msg) { [Console]::Error.WriteLine("orchestra-go: $msg"); exit 1 }
function Rodar-Git([string[]]$a) { $o = & git -C $script:raiz @a 2>&1; if ($LASTEXITCODE) { Falha "git $($a -join ' ') falhou: $o" }; $o }
# Mesma regra do slug() do bridge (hermes.ts): o branch do worktree bate com o que o bridge usa.
function Slug([string]$s) {
    $s = $s.ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD) -replace '\p{Mn}', ''
    $s = ($s -replace '[^a-z0-9]+', '-').Trim('-')
    if ($s.Length -gt 40) { $s = $s.Substring(0, 40) }
    if ($s) { $s } else { 'feature' }
}
function Vivo($r) {
    if (-not ($r.pid -and (Get-Process -Id $r.pid -ErrorAction SilentlyContinue))) { return $false }
    try { Invoke-WebRequest "$($r.base)/doc" -UseBasicParsing -TimeoutSec 3 | Out-Null; $true } catch { $false }
}

if (-not (Test-Path $Projeto)) { Falha "pasta nao existe: $Projeto" }
if ($Descricao) { $Descricao = $Descricao.Trim() }
if ($AnexosDir -and -not (Test-Path $AnexosDir)) { $AnexosDir = $null }
# Raiz = worktree PRINCIPAL (funciona mesmo chamando de dentro de outro worktree).
$comum = & git -C $Projeto rev-parse --path-format=absolute --git-common-dir 2>$null
if ($LASTEXITCODE -or -not $comum) { Falha "nao e' um repositorio git: $Projeto" }
$raiz = [IO.Path]::GetFullPath((Split-Path $comum -Parent))
$slug = Slug $Feature
$projetoNome = Split-Path $raiz -Leaf
$wt = Join-Path $raiz ".claude\worktrees\$slug"
$branch = "orchestra/$slug"
$regDir = Join-Path $env:TEMP 'hermes\planejadores'
$reg = Join-Path $regDir "$projetoNome--$slug.json"
New-Item -ItemType Directory -Force $regDir | Out-Null

# Mesma feature com chat vivo: so devolve o registro (CA-4).
if (Test-Path $reg) {
    $r = Get-Content $reg -Raw | ConvertFrom-Json
    if ((Test-Path $r.cwd) -and (Vivo $r)) { $r | ConvertTo-Json -Compress; exit 0 }
}

if (-not (Test-Path $wt)) {
    $base = if (& git -C $raiz rev-parse --verify --quiet refs/heads/main) { 'main' } else { 'master' }
    if (& git -C $raiz status --porcelain --untracked-files=no) {
        Falha "a pasta principal ($raiz) tem mudancas nao commitadas. Commite ou descarte antes (elas nao iriam pro worktree)."
    }
    # worktrees fora do status da main, sem mexer no .gitignore versionado
    $exclude = Join-Path $comum 'info\exclude'
    if (-not (Select-String -Path $exclude -SimpleMatch '.claude/worktrees/' -Quiet -ErrorAction SilentlyContinue)) {
        New-Item -ItemType Directory -Force (Split-Path $exclude) | Out-Null
        Add-Content $exclude '.claude/worktrees/'
    }
    # contexto dos agentes (.orchestra/) tambem fora do status da main
    if (-not (Select-String -Path $exclude -SimpleMatch '.orchestra/' -Quiet -ErrorAction SilentlyContinue)) {
        New-Item -ItemType Directory -Force (Split-Path $exclude) | Out-Null
        Add-Content $exclude '.orchestra/'
    }
    if (& git -C $raiz rev-parse --verify --quiet "refs/heads/$branch") { Rodar-Git @('worktree', 'add', $wt, $branch) | Out-Null }
    else { Rodar-Git @('worktree', 'add', '-b', $branch, $wt, $base) | Out-Null }
    Get-ChildItem $raiz -Filter '.env*' -File -Force | Copy-Item -Destination $wt
    # deps: raiz + subpastas de 1 nivel com package.json; gerenciador pelo lockfile
    $pastas = @($wt) + @(Get-ChildItem $wt -Directory | Where-Object { $_.Name -ne 'node_modules' -and (Test-Path (Join-Path $_.FullName 'package.json')) } | ForEach-Object FullName)
    foreach ($p in $pastas) {
        if (-not (Test-Path (Join-Path $p 'package.json'))) { continue }
        $cmd = if (Test-Path (Join-Path $p 'pnpm-lock.yaml')) { 'pnpm install' } elseif (Test-Path (Join-Path $p 'yarn.lock')) { 'yarn install' } else { 'npm install' }
        [Console]::Error.WriteLine("orchestra-go: $cmd em $p")
        Push-Location $p
        try { $saida = cmd /c "$cmd 2>&1"; $rc = $LASTEXITCODE } finally { Pop-Location }
        if ($rc) { Falha "'$cmd' falhou em $p (worktree mantido pra tentar de novo):`n$($saida | Select-Object -Last 20 | Out-String)" }
    }
}

# Anexos do pedido (quando houver): copiados pro worktree e fora do git status do planejador.
$anexosCaminhos = @()
if ($AnexosDir) {
    $arquivosAnexo = @(Get-ChildItem $AnexosDir -File -Force -ErrorAction SilentlyContinue)
    if ($arquivosAnexo.Count) {
        $destAnexos = Join-Path $wt ".claude\anexos\$slug"
        New-Item -ItemType Directory -Force $destAnexos | Out-Null
        # '.claude/anexos/' fora do status da main, mesmo esquema do '.claude/worktrees/'
        $exclude = Join-Path $comum 'info\exclude'
        if (-not (Select-String -Path $exclude -SimpleMatch '.claude/anexos/' -Quiet -ErrorAction SilentlyContinue)) {
            New-Item -ItemType Directory -Force (Split-Path $exclude) | Out-Null
            Add-Content $exclude '.claude/anexos/'
        }
        foreach ($f in $arquivosAnexo) {
            Copy-Item $f.FullName -Destination $destAnexos -Force
            $anexosCaminhos += (Join-Path $destAnexos $f.Name)
        }
    }
}

# Texto disparado no /orchestra: a feature e' o titulo; descricao e caminhos dos anexos entram depois (quando houver).
$texto = $Feature
if ($Descricao) { $texto += "`n`n$Descricao" }
if ($anexosCaminhos.Count) {
    $texto += "`n`nAnexos enviados (leia os arquivos):`n" + (($anexosCaminhos | ForEach-Object { "- $_" }) -join "`n")
}
# Contexto do planejador (S3): manda ler o README de contexto do worktree, quando existir.
$texto += "`n`nAntes de responder, leia .orchestra/contexto/plan-$slug/README.md se existir."

# Modo claude: o planejador e' o Claude Code rodando NO worktree (o hub sobe o PTY). O worktree ja' foi
# criado/reusado com deps e .env* acima; NAO sobe o servidor do OpenCode nem grava registro em
# planejadores\ (nao ha' chat pra reabrir). Devolve so' o worktree pro hub (url vazia) e sai 0.
if ($Planejador -eq 'claude') {
    [ordered]@{ slug = $slug; cwd = $wt; branch = $branch; url = '' } | ConvertTo-Json -Compress
    exit 0
}

# Sobe o servidor do OpenCode no worktree (exe direto: o shim .ps1/.cmd nao sobrevive ao Start-Process hidden).
$exe = Join-Path (Split-Path (Get-Command opencode.cmd).Source) 'node_modules\opencode-ai\bin\opencode.exe'
if (-not (Test-Path $exe)) { Falha "opencode nao encontrado ($exe). Rode: npm i -g opencode-ai" }
$l = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0); $l.Start(); $porta = $l.LocalEndpoint.Port; $l.Stop()
# PATH do serve com a pasta bin/ do hermes-bridge na frente (o CLI `canvas` dos agentes fica la).
$env:PATH = "$PSScriptRoot\bin$([IO.Path]::PathSeparator)$env:PATH"
$proc = Start-Process $exe -ArgumentList 'serve', '--port', $porta -WorkingDirectory $wt -WindowStyle Hidden -PassThru
$baseUrl = "http://127.0.0.1:$porta"
$ok = $false
for ($i = 0; $i -lt 60 -and -not $ok; $i++) {
    Start-Sleep -Milliseconds 500
    try { Invoke-WebRequest "$baseUrl/doc" -UseBasicParsing -TimeoutSec 2 | Out-Null; $ok = $true } catch {}
}
if (-not $ok) { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue; Falha "o servidor do OpenCode nao subiu na porta $porta" }

$dir = [uri]::EscapeDataString($wt)
# Continua a ultima sessao do worktree (reabrir) ou cria uma nova ja disparando /orchestra.
$sessao = @(Invoke-RestMethod "$baseUrl/session?directory=$dir&limit=1" -TimeoutSec 10) | Select-Object -First 1
if (-not $sessao) {
    $sessao = Invoke-RestMethod "$baseUrl/session?directory=$dir" -Method Post -ContentType 'application/json' -TimeoutSec 10 `
        -Body (@{ title = $Feature } | ConvertTo-Json -Compress)
    # POST /command so volta quando o GLM termina o turno; a execucao segue no servidor mesmo desconectando.
    $corpo = @{ command = 'orchestra'; arguments = $texto; model = $MODELO } | ConvertTo-Json -Compress
    try { Invoke-RestMethod "$baseUrl/session/$($sessao.id)/command?directory=$dir" -Method Post -ContentType 'application/json; charset=utf-8' -TimeoutSec 3 -Body ([Text.Encoding]::UTF8.GetBytes($corpo)) | Out-Null } catch {}
}
# URL da UI web numa sessao: /<base64url(pasta da sessao)>/session/<id> (mesma regra do app do OpenCode)
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($sessao.directory)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$r = [ordered]@{
    slug = $slug; projeto = $projetoNome; raiz = $raiz; cwd = $wt; feature = $Feature
    url = "$baseUrl/$b64/session/$($sessao.id)"; base = $baseUrl; pid = $proc.Id; ts = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
}
$json = $r | ConvertTo-Json -Compress
Set-Content $reg $json -Encoding utf8
$json
