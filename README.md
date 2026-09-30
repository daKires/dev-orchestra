# Dev Orchestra (mcp-hermes-bridge)

## Instalar em outro PC

Precisa: Git, Node 22+, PowerShell 7 (`pwsh`), Claude Code (e OpenCode se for usar `orchestra-go`).

```powershell
git clone https://github.com/daKires/mcp-hermes-bridge.git
cd mcp-hermes-bridge
pwsh -File install.ps1
setx DEEPSEEK_API_KEY "sk-..."   # ou OPENCODE_GO_API_KEY / OPENROUTER_API_KEY
```

Reabra o terminal. Comandos: `orchestra "feature"`, `orchestra-go "feature"`, `hermes` (só o dashboard).
