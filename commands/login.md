---
description: Connect GitHits using your host's remote MCP authentication
---

# Login

GitHits uses a hosted remote MCP server for this plugin, and the current host
owns its OAuth session. Call the `search_language` MCP tool with the query
`python` to start or verify authentication.

If the call requires authentication, let the current host present its OAuth
flow. Ask the user to complete it without pasting OAuth data into chat, then
retry `search_language`.

If the tool is unavailable or disabled, direct the user to the current host's
MCP or server settings to enable or reconnect GitHits, then retry. For any other
error, report the error without claiming authentication succeeded.

The `githits login` CLI command and `GITHITS_API_TOKEN` authenticate local CLI
and stdio integrations. They do not authenticate the current host's remote MCP
session.
