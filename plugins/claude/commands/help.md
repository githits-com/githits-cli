---
description: Show available GitHits commands and usage
disable-model-invocation: true
---

# GitHits Help

Run the GitHits CLI help command in the terminal:

```
npx -y githits help
```

Then display the command output clearly to the user, followed by this plugin
context summary:

## Slash Commands

- `/githits:search <query>` — Search for code examples from open source.
- `/githits:login` — Authenticate with your GitHits account.
- `/githits:status` — Show your current authentication status.
- `/githits:logout` — Remove stored credentials.
- `/githits:help` — Show this help message.

## MCP Tools

This plugin connects to the GitHits MCP server and exposes three tools:

- **search** — Find code examples by describing what you need in natural
  language. Requires `query` and `language` parameters.
- **search_language** — Look up supported programming language names before
  searching.
- **feedback** — Rate a search result to improve future quality.

## Authentication

Run `npx -y githits login` to authenticate via browser, or set the
`GITHITS_API_TOKEN` environment variable for headless environments.

If users want to verify MCP tools loaded, suggest `/mcp`.

If the command fails, report the error and suggest running:

```
npx -y githits login
```
