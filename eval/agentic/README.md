# Agentic Eval Harness

This harness runs real coding agents against the real GitHits MCP server and
records whether the agent can use GitHits tools effectively from the MCP
server's own instructions and tool descriptions.

It is not a smoke test. Smoke tests exercise CLI and MCP contracts directly.
Agentic evals exercise agent behavior end-to-end.

## What Is Under Test

- Local mode starts the MCP server from this checkout with
  `bun run --cwd <repo> dev mcp start`.
- Published mode starts the MCP server with `npx -y githits@latest mcp start`
  by default.
- To evaluate MCP instruction changes, change branch/source and run local mode.

The harness must not add GitHits usage guidance through agent system prompts,
append prompts, alternate MCP instruction files, project instructions, or plugin
commands. Workload prompts may ask the agent to report what happened, but must
not tell the agent how to use GitHits.

## Isolation

Runs execute agents from an empty temporary workspace so repository-local files
such as `AGENTS.md`, `.mcp.json`, commands, skills, and plugin payloads do not
contaminate results. The harness keeps the user's normal Claude/GitHits auth
environment so human-driven keychain/OAuth sessions continue to work.

GitHits authentication follows normal local behavior. Keychain-backed human
login should work by default. Automation can use `GITHITS_API_TOKEN`.

## Usage

```bash
bun run agent:e2e --server local --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --server published --workload eval/agentic/workloads/express-router.md
bun run agent:e2e --agent codex --server local --workload eval/agentic/workloads/express-router.md
```

Useful options:

```bash
--agent <claude|codex>          Agent to run, default `claude`
--dry-run                       Generate artifacts without invoking the agent
--out <dir>                     Output directory, default `.agent-eval/runs/<timestamp>`
--timeout <seconds>             Per-workload timeout, default 300
--published-package <spec>      Published package spec, default `githits@latest`
--workload <path>               Repeatable workload path
```

Normal GitHits backend overrides are passed through when set:

- `GITHITS_API_URL`
- `GITHITS_MCP_URL`
- `GITHITS_CODE_NAV_URL`
- `PKGSEER_URL`
- `GITHITS_API_TOKEN`
- `GITHITS_AUTH_STORAGE`

Secret-like values are redacted in run metadata.

## Workloads

Workloads are Markdown prompts. They should contain:

- The task.
- A reporting contract requiring the final answer, GitHits tools used, failed or
  unclear tool calls, unclear or missing MCP guidance, usefulness, and
  confidence.

They should not contain instructions such as "call `search` first" or "use
`code_read` after `search`". That guidance must come from the MCP server.

## Artifacts

Each run writes:

- `run.json` with command, git, environment, and timing metadata.
- One workload directory per workload with `prompt.md`, `mcp.json`,
  `stdout.json`, `stderr.txt`, and `final.json` when parsing succeeds.

Claude is launched with `--permission-mode bypassPermissions` so non-interactive
evals can exercise configured MCP tools without a human approval prompt. Codex is
launched with per-run `-c` MCP config overrides, `--ignore-rules`, and a
read-only sandbox so it can use normal human auth without mutating global MCP
configuration.

Malformed final JSON, schema mismatches, Claude failures, and timeouts are
harness failures. Raw stdout and stderr are preserved for diagnosis with known
secret values redacted.
