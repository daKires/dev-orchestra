# Dev Orchestra

Plan with a strong model, build with a cheap swarm. **Your tool plans and reviews; the swarm implements
and commits locally.** You describe a feature; your assistant splits it into slices and writes the tests;
a swarm of agents implements each slice, runs a deterministic gate (typecheck/tests) and makes a **local
commit** on an `orchestra/<slug>` branch. The swarm only commits locally; push and PR happen only from
the dashboard button, when you ask for them.

```
you: "use o orchestra"  ->  your tool plans slices and writes the tests
                        ->  MCP tool executar_orchestra  ->  swarm, one agent per slice
                        ->  gate  ->  local commit
```

Includes a live dashboard (infinite canvas with runs, agents and a diff growing as they work), also
packaged as an optional Electron desktop app.

## Install

```bash
npx github:daKires/dev-orchestra
```

The package is not published on npm yet, so plain `npx dev-orchestra` will not work — use the GitHub
form above. The first use builds the app (and installs its production dependencies) before opening the
screen.

This opens a screen where you pick:

- the **provider, model and API key** of the implementers;
- which tools to connect, among **Claude Code, OpenCode, Codex, Cursor and Antigravity (experimental)**.

The installer registers the `dev-orchestra` MCP server and installs the `orchestra` and `plan-sdd`
skills into the tools you selected. Reopen the tool afterwards.

## Usage

In any git project, just say **"use o orchestra"** in the conversation and describe the feature. Your
tool reads the `orchestra` skill, plans the feature in slices (you approve the plan first), writes the
tests, and calls the swarm through the `dev-orchestra` MCP server.

The dashboard opens by itself on the first run, so you can watch every slice, tool call, the gate and
the diff grow live.

Every run is tied to the planner session that asked for it (Claude Code or OpenCode): the **Pedido**
card opens that chat, and the sidebar finds runs from all your projects by the chat title.

## Cost and safety

- **It costs money.** Every run calls a paid API; the dashboard shows the cost per run.
- **Agents write files and run commands in your project.** Commands are limited to an allowlist, and
  destructive ones (migrations, `db push/reset/drop`) are refused. A baseline is snapshotted first, so
  you can revert with `git checkout <baseline> -- .` — still, review the diff.
- Commits are **local only**. Nothing is pushed or merged without you.

## Change the configuration

Run `npx github:daKires/dev-orchestra` again: change provider, model, key or which tools are connected
whenever you want.

Some limits can be tuned with environment variables:

| Variable | Default | What it does |
| --- | --- | --- |
| `DEV_ORCHESTRA_GATE_TIMEOUT_MS` | `900000` (15 min) | Timeout of the **gate** commands (typecheck/test). A full test suite can take more than 2 min, so the gate has its own timeout. |
| `DEV_ORCHESTRA_CMD_TIMEOUT_MS` | `120000` (120s) | Timeout of the **agents' verification commands** (`rodar_comando`) and of the allowlist commands in the preflight. |

## Development

```bash
git clone https://github.com/daKires/dev-orchestra.git
cd dev-orchestra
npm install
npm run build
node bin/dev-orchestra.mjs   # setup screen (first time)
```

The tools never run the MCP from the clone: the installer copies the app to `~/.dev-orchestra/app`,
so `git` and builds in the clone don't affect what is running. After changing the code, publish it to
your tools with `npm run instalar` (build + copy + re-point the configured tools, keeping provider,
model and key) and restart them.

## Desktop app (optional)

```bash
npm run desktop:dist
```

## License

[MIT](LICENSE)
