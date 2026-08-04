---
description: Connect GitHits using your host's remote MCP authentication
---

# Login

GitHits uses a hosted remote MCP server for this plugin. If `cursor-agent` is
available, authenticate through Cursor by running:

```text
cursor-agent mcp login githits
```

Let the user complete browser OAuth. Do not ask them to paste OAuth data into
chat. Then verify the connection by running:

```text
cursor-agent mcp list
cursor-agent mcp list-tools githits
```

If those checks do not prove the authenticated connection is usable, call the
`search_language` MCP tool with the query `python`.

If `cursor-agent` is unavailable, tell the user to open a new Cursor Agent chat.
In Cursor's MCP tools UI, confirm that GitHits is enabled, complete OAuth if
prompted, and confirm its tools are listed. Require the user's confirmation or
a successful `search_language` call before reporting success.

The `githits login` CLI command and `GITHITS_API_TOKEN` authenticate local CLI
and stdio integrations. They do not authenticate Cursor's remote MCP session.
