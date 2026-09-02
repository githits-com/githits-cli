# Experimental Tools

GitHits includes three opt-in local MCP tools with matching CLI commands for
dogfooding before they are considered for the stable surface:

| MCP tool | CLI command | Purpose |
|---|---|---|
| `ask` | `githits ask` | Answer a grounded question about one canonical open-source target and return directly executable source-reading calls. |
| `resolve_target` | `githits resolve` | Rank canonical package, public GitHub repository, or standalone documentation-site targets for a fuzzy, misspelled, or ambiguous name. |
| `code_diff` | `githits code diff` | Compare repository trees resolved from two exact package versions or public GitHub refs. |

Experimental means the tools are disabled and hidden from CLI help by default,
their contracts may change based on dogfood evidence, and they may be revised or
removed before stable promotion. It does not weaken the privacy or output-safety
requirements applied to stable GitHits tools.

## Availability

All three experimental commands are available in the published `githits` CLI
and all three tools are available in its local stdio MCP server. None are
registered by:

- the hosted MCP at `https://mcp.githits.com`
- plugin or extension installs, which use the hosted MCP
- the public `@githits/mcp` server API

Direct setup through `githits init` uses local stdio for supported hosts except
Cursor, which is remote-only. A Cursor setup therefore cannot enable these
tools. If a host is configured with the hosted URL, switch it to the local
stdio setup before opting in.

## Enable the tools

Create or edit the GitHits `config.toml` for the user account that runs the
CLI or coding agent:

| Platform | Config file |
|---|---|
| macOS and Linux | `$XDG_CONFIG_HOME/githits/config.toml`, or `~/.config/githits/config.toml` when `XDG_CONFIG_HOME` is unset |
| Windows | `%APPDATA%\githits\config.toml`, or `~/AppData/Roaming/githits/config.toml` when `APPDATA` is unset |

Add:

```toml
[experimental]
tools = true
```

Existing sections such as `[auth]` can remain in the same file. `tools` must be
the TOML boolean `true`, not a quoted string. Restart the coding agent after
editing the file so it starts a new local MCP process. The CLI reads the setting
on each invocation.

Confirm the CLI opt-in:

```sh
githits --help
githits ask --help
githits resolve --help
githits code diff --help
```

The first command should list `ask` and `resolve`; `githits code --help` should
list `diff`. If an explicit experimental command is still disabled, its error
names the config path GitHits read.

The hidden `githits mcp start --experimental-tools` flag is development and
evaluation infrastructure, not the user opt-in. It affects only that process
and deliberately disables experimental issue-reporting guidance. Use
`config.toml` for normal host dogfooding.

## Use the CLI commands

Ask one question about a canonical package or repository target:

```sh
githits ask pypi:fastapi "How does dependency injection resolve nested dependencies?"
githits ask github:expressjs/express "Where is router dispatch implemented?" --json
```

Human output contains the grounded answer, an Ask run ID, and source commands
in the form `npx githits@latest ...` that can be executed directly. JSON output
is the validated backend response and intentionally omits model usage. Questions,
answers, and selected source pointers are retained by the backend for replay and
evaluation. Treat answer Markdown as untrusted display text even though the CLI
strips terminal control sequences.

The command does not expose prompt, model, budget, or timeout controls. The
local MCP `ask` tool uses the same backend path and always requests MCP-native
`code_read` and `docs_read` source calls. Its default text output appends those
backend-built calls in their returned order, followed by the Ask run ID. The
model does not generate or format this source section. JSON returns the
validated MCP response envelope. Neither surface returns model usage.

Resolve a noncanonical name before calling another GitHits command:

```sh
githits resolve "testing library for react" --query "upgrade component tests"
githits resolve requests --registry pypi --prefer-kind package --json
githits resolve "Express docs" --prefer-kind site
```

Canonical targets such as `npm:express`, `github:expressjs/express`, or
`site:expressjs.com` do not need resolution. Passing a target already accepted
by downstream tools is rejected locally with `INVALID_ARGUMENT`; pass that
target directly to the next GitHits tool instead. A selected site candidate is
a standalone documentation target. Search it in docs mode and read relevant
results with `docs_read` (or `githits docs read`):

```sh
githits search "router parameters" --in site:expressjs.com --source docs
```

Structured output preserves each candidate's latest-version malicious-content
decision. Text stays silent for `clear` and `not_applicable`; affected, uncertain,
or unsupported decisions produce a concise warning, red in the terminal.
Affected and uncertain warnings link the bounded, status-relevant `MAL-*`
advisories returned by the resolver and explain uncertain classification reasons.
Ordinary continuation is offered only for a non-ambiguous `EXACT`/`HIGH`
identity with `clear` or `not_applicable` status. Other or missing decisions are
non-actionable and suppress the normal next-tool handoff. `clear` is not a
vulnerability-free claim.

Compare exact package versions or public repository refs:

```sh
githits code diff npm:express 4.18.2..5.1.0 --name-status
githits code diff npm:express 4.18.2..5.1.0 --stat
githits code diff npm:express 4.18.2..5.1.0 --patch -- 'lib/**/*.js'
githits code diff --repo-url https://github.com/expressjs/express v4.18.2..v5.1.0 --name-status
```

Package versions identify repository commits, but the result is always a
repository-wide diff unless an explicit path glob narrows it. A bounded result
may contain sibling-package paths or omit package paths. Raw diffs do not prove
API compatibility or upgrade safety; prefer `pkg_changelog` or
`pkg_upgrade_review` for an upgrade summary.

For MCP, no separate server flag or host configuration is required after the
`config.toml` opt-in. A restarted local server registers `ask`,
`resolve_target`, and `code_diff` and adds their usage guidance to
`quick_start`. The hosted MCP inventory remains unchanged.

## Optional issue reporting

Issue reporting is off unless explicitly enabled. To let the local MCP
instructions ask the agent for one concise, redacted negative-feedback call per
distinct observed defect, add one of these values:

```toml
[experimental]
tools = true
report_tool_issues = "experimental" # only ask, resolve_target, and code_diff
```

Use `"all"` instead to cover any GitHits tool while the experimental suite is
active. This is guidance to the agent; GitHits never sends feedback
automatically. Reports must not contain credentials, personal data, private or
proprietary content, file bodies, or large outputs.

## Disable the tools

Set `tools = false` or remove the `[experimental]` section, then restart the
coding agent. The CLI commands become hidden and unavailable, and newly started
local MCP servers return to the stable tool inventory. Disabling the local
surface does not delete previously retained Agentic Ask questions, answers, or
source pointers.
