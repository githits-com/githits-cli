---
description: Show available GitHits commands and usage
disable-model-invocation: true
---

# GitHits Help

Display this plugin help directly to the user:

## Slash Commands

- `/githits:example <query>` — Search for canonical code examples from open source.
- `/githits:search <query>` — Legacy alias for `/githits:example`.
- `/githits:login` — Authenticate the current host's GitHits remote server.
- `/githits:status` — Verify the current host's GitHits connection.
- `/githits:logout` — Disconnect GitHits through the current host's settings.
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

This plugin uses the hosted GitHits MCP server, and the current host owns its
OAuth session. Login and status use the `search_language` MCP tool with the
query `python` to start or verify authentication. Complete the host's OAuth flow
if prompted, then retry the tool call.

MCP provides no portable logout operation. Disconnect or revoke GitHits through
the current host's MCP, connection, or account settings.

The `githits login`, `githits logout`, and `githits auth status` CLI commands,
as well as `GITHITS_API_TOKEN`, apply to local CLI and stdio integrations. They
do not control the current host's remote session.

If an MCP tool fails because authentication is required, report the error and
suggest `/githits:login`.
