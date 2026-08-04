---
description: Show the host-managed GitHits connection status
---

# Status

If `cursor-agent` is available, inspect the GitHits connection by running:

```text
cursor-agent mcp list
cursor-agent mcp list-tools githits
```

Report whether GitHits is missing or disabled, requires authentication, is
connected without tools, or has discovered tools. If authentication is
required, suggest `/githits:login`.

If the CLI output does not prove that the authenticated connection is usable,
call the `search_language` MCP tool with the query `python`. Do not report
GitHits as ready until Cursor shows its tools or that call succeeds.

If `cursor-agent` is unavailable, tell the user to open a new Cursor Agent chat
and inspect Cursor's MCP tools UI. Confirm that GitHits is enabled and its tools
are listed, and complete OAuth if prompted.

The `githits auth status` CLI command reports credentials for local CLI and
stdio integrations. It cannot inspect Cursor's remote OAuth session.
