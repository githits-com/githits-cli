# Experimental Tools

GitHits 0.10 includes two opt-in tools for local dogfooding before they are
considered for the stable surface:

| MCP tool | CLI command | Purpose |
|---|---|---|
| `resolve_target` | `githits resolve` | Rank canonical package or public GitHub repository targets for a fuzzy, misspelled, or ambiguous name. |
| `code_diff` | `githits code diff` | Compare repository trees resolved from two exact package versions or public GitHub refs. |

Experimental means the tools are disabled and hidden from CLI help by default,
their contracts may change based on dogfood evidence, and they may be revised or
removed before stable promotion. It does not weaken the privacy or output-safety
requirements applied to stable GitHits tools.

## Availability

The experimental tools are available only in the published `githits` CLI and
its local stdio MCP server. They are not registered by:

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
githits resolve --help
githits code diff --help
```

The first command should list `resolve`; `githits code --help` should list
`diff`. If an explicit experimental command is still disabled, its error names
the config path GitHits read.

The hidden `githits mcp start --experimental-tools` flag is development and
evaluation infrastructure, not the user opt-in. It affects only that process
and deliberately disables experimental issue-reporting guidance. Use
`config.toml` for normal host dogfooding.

## Use the CLI commands

Resolve a noncanonical name before calling another GitHits command:

```sh
githits resolve "testing library for react" --query "upgrade component tests"
githits resolve requests --registry pypi --prefer-kind package --json
```

Canonical targets such as `npm:express` or `github:expressjs/express` do not
need resolution.

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
`config.toml` opt-in. A restarted local server registers `resolve_target` and
`code_diff` and adds their usage guidance to the session instructions.

## Optional issue reporting

Issue reporting is off unless explicitly enabled. To let the local MCP
instructions ask the agent for one concise, redacted negative-feedback call per
distinct observed defect, add one of these values:

```toml
[experimental]
tools = true
report_tool_issues = "experimental" # only resolve_target and code_diff
```

Use `"all"` instead to cover any GitHits tool while the experimental suite is
active. This is guidance to the agent; GitHits never sends feedback
automatically. Reports must not contain credentials, personal data, private or
proprietary content, file bodies, or large outputs.

## Disable the tools

Set `tools = false` or remove the `[experimental]` section, then restart the
coding agent. The CLI commands become hidden and unavailable, and newly started
local MCP servers return to the stable tool inventory. No stored tool data or
migration is involved.
