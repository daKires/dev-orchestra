# Dev Orchestra

Plan with a strong model, build with a cheap swarm. You describe a feature; a planner (Claude Code or
OpenCode) splits it into slices and writes the tests; a swarm of DeepSeek agents implements each slice,
runs a deterministic gate (typecheck/tests), and makes a **local commit** on an `orchestra/<slug>` branch.
Nothing is ever pushed.

```
orchestra "feature"  ->  planner (Claude/OpenCode)  ->  MCP tool executar_orchestra
                     ->  DeepSeek agents, one per slice  ->  gate  ->  local commit
```

Includes a live dashboard (infinite canvas with runs, agents, embedded Claude Code terminal and browser)
at `http://127.0.0.1:4123`, also packaged as an Electron desktop app.

> **Windows only** (PowerShell, `setx`, `cmd.exe` are part of the core). The UI, logs and commit messages
> are in **Brazilian Portuguese**.

## Requirements

- Windows 10/11, Git, Node 22+, PowerShell 7 (`pwsh`)
- [Claude Code](https://claude.com/claude-code) and/or [OpenCode](https://opencode.ai) as planner
- An API key for the swarm — **one** of:
  - `OPENCODE_GO_API_KEY` (OpenCode Go)
  - `DEEPSEEK_API_KEY` (native DeepSeek, Anthropic-compatible endpoint)
  - `OPENROUTER_API_KEY` (OpenRouter fallback)

## Install

```powershell
git clone https://github.com/daKires/dev-orchestra.git
cd dev-orchestra
pwsh -File install.ps1
setx DEEPSEEK_API_KEY "sk-..."   # or OPENCODE_GO_API_KEY / OPENROUTER_API_KEY
```

Reopen the terminal. `install.ps1` changes files outside the repo:

- registers the `hermes-bridge` MCP server in `~/.claude.json` (backup at `~/.claude.json.bak-hermes`);
- copies the `/orchestra` command and the `plan-sdd` skill into `~/.claude` and `~/.config/opencode`;
- sets the user env var `HERMES_REPO` and adds one line to your PowerShell 5 and 7 `$PROFILE`
  (old `orchestra`/`orchestra-go`/`hermes` functions there are removed, with a `.bak-hermes` backup).

## Usage

Inside any git project:

| Command | What it does |
|---|---|
| `orchestra "feature"` | Claude Code plans, you approve, the swarm builds |
| `orchestra-go "feature"` | Same, using OpenCode in an isolated worktree |
| `hermes` | Opens only the dashboard |

Desktop app: `npm run desktop:dist` builds `release\Hermes Setup *.exe` (unsigned; SmartScreen will warn).

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `HERMES_CMDS` | `npm run build,npm test,npx tsc --noEmit` | Allowlist of commands agents may run |
| `HERMES_GATE` | `npx tsc --noEmit,npm test` | Gate run after the agents; failure blocks the commit |
| `HERMES_REPAIR_TRIES` | `1` | Repair attempts when the gate fails |
| `HERMES_MAX_TURNS` | `25` | Turns per agent |
| `HERMES_MAX_TOKENS` | `32000` | Max output tokens per turn |
| `HERMES_MODEL` | chosen by key | Override the swarm model |
| `HERMES_UI_PORT` | `4123` | Dashboard port |

## Before you run it

- **It costs money.** Every run calls a paid API. The dashboard shows the cost per run.
- **Agents write files and run commands in your project.** Commands are limited to the allowlist, and
  destructive ones (`exec`, migrations, `db push/reset/drop`) are refused. Writes to `node_modules`,
  migrations and git-ignored files are blocked, and a baseline is snapshotted first so you can revert
  (`git checkout <baseline> -- .`). Still: review the diff before merging.
- Commits are local only. Nothing is pushed or merged without you.

## Development

```powershell
npm run build   # bridge + web dashboard
npm test        # selftest + node:test suites
```

## License

[MIT](LICENSE)
