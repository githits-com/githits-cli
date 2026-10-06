# Experimental Tools

GitHits includes one opt-in local MCP tool with matching CLI commands for
dogfooding before they are considered for the stable surface:

| MCP tool | CLI command | Purpose |
|---|---|---|
| `research` | `githits research` (`githits ask` alias) | Research a grounded question about one canonical open-source target and return executable source-reading calls or original upstream URLs. |

Experimental means the tools are disabled and hidden from CLI help by default,
their contracts may change based on dogfood evidence, and they may be revised or
removed before stable promotion. It does not weaken the privacy or output-safety
requirements applied to stable GitHits tools.

## Availability

The research command and ask alias are available in the published `githits` CLI
and the research tool is available in its local stdio MCP server. Research is not
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
githits research --help
```

The first command should list `research|ask`. If an explicit experimental command is still disabled, its error
names the config path GitHits read.

The hidden `githits mcp start --experimental-tools` flag is development and
evaluation infrastructure, not the user opt-in. It affects only that process. Use
`config.toml` for normal host dogfooding.

## Use the CLI commands

Research a public package or repository by asking a question, optionally
supplying a canonical target:

```sh
githits research "How does FastAPI dependency injection resolve nested dependencies?"
githits research pypi:fastapi "How does dependency injection resolve nested dependencies?"
githits research github:expressjs/express "Where is router dispatch implemented?" --json
githits research npm:express "Where is router dispatch implemented?" --source-format url
githits research --thread 019c4f26-79b2-7bcb-b729-f9e39043a94b "How does that interact with route parameters?"
```

With one positional argument, GitHits uses the question to identify a public
package or repository. With two positional arguments, the first is an explicit
target and the second is the question. Quote multi-word questions.

`githits ask` remains an alias with the same options, opt-in policy, and output.

By default, human output contains the grounded answer, a Research run ID, the
thread ID, and source commands in the form `npx githits@latest ...` that can be
executed directly. Pass the returned thread ID to `--thread` for a follow-up.
Name a new project, version, or topic in the question to change scope; threads
support up to ten turns. JSON output contains `display_markdown` and optional
`tool_call_id`/`thread_id` metadata. The backend supplies all display text, so
sections can evolve without a client update.
Treat answer Markdown as untrusted display text even though the CLI strips
terminal control sequences.

Use `--source-format url` to return the original upstream HTTP URLs instead of
CLI source commands. This changes only source presentation.

The local MCP `research` tool also accepts a question alone. Omit both `target` and
`thread_id` to identify the target from the question, supply `target` to choose
one explicitly, or use `thread_id` for a needed follow-up. Do not combine them.
It defaults to MCP-native `read` source calls, projected from the backend pointers. Set
`source_format` to `url` for original upstream HTTP URLs. Answer text includes
source pointers, the Research run ID, thread ID, and conditional follow-up guidance.
JSON returns the same minimal display envelope; the source format controls
citations inside its Markdown.

When Research cannot confidently select a target, both CLI and local MCP return a
clarification with resolver candidates in `display_markdown`, omitting run/thread
IDs. There is no separate JSON outcome variant. Repeat the question with a selected
target; do not infer identity from popularity or silently pick an ambiguous hit.

`resolve_target` and `githits resolve` are stable and do not require this
setting; see [target resolution](implementation/resolve-target.md).
`code_diff` is also stable; see [source diff](implementation/code-diff.md).
Hosted availability follows adoption/deployment of the released MCP package.

## Disable the tools

Set `tools = false` or remove the `[experimental]` section, then restart the
coding agent. The CLI commands become hidden and unavailable, and newly started
local MCP servers return to the stable tool inventory.
