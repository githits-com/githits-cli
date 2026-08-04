---
description: Show available GitHits commands and usage
disable-model-invocation: true
---

# GitHits Help

Display this plugin help directly to the user:

## Slash Commands

- `/githits:example <query>` — Search for canonical code examples from open source.
- `/githits:search <query>` — Legacy alias for `/githits:example`.
- `/githits:login` — Authenticate the GitHits remote server through Cursor.
- `/githits:status` — Verify Cursor's GitHits connection and tools.
- `/githits:logout` — Disconnect the remote session through Cursor's MCP settings.
- `/githits:help` — Show this help message.

## MCP Tools

This plugin connects to the GitHits MCP server and always exposes these core tools:

- **get_example** — Find code examples by describing what you need in natural
  language. Requires `query`; `language` is optional and inferred when omitted.
- **search_language** — Look up supported programming language names when you
  need to force a specific language.
- **feedback** — Submit result or session feedback to improve future quality.

Additional indexed dependency/package tools are available by default:
`search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`,
`pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`,
`code_read`, and `code_grep`.

## Authentication

This plugin uses the hosted GitHits MCP server, and Cursor owns its OAuth
session. When `cursor-agent` is available, use:

```text
cursor-agent mcp login githits
cursor-agent mcp list
cursor-agent mcp list-tools githits
```

If connection status remains uncertain, call the `search_language` MCP tool
with the query `python`. Cursor has no supported `cursor-agent mcp logout githits`
command, so logout uses Cursor's MCP settings.

If `cursor-agent` is unavailable, use a new Cursor Agent chat and Cursor's MCP
tools UI to authenticate and confirm that GitHits tools are listed.

The `githits login`, `githits logout`, and `githits auth status` CLI commands,
as well as `GITHITS_API_TOKEN`, apply to local CLI and stdio integrations. They
do not control Cursor's remote session.

If users want to verify MCP tools loaded, suggest `/mcp`.

If an MCP tool fails because authentication is required, report the error and
suggest `/githits:login`.
