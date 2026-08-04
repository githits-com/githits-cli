---
description: Disconnect GitHits from your host-managed remote session
---

# Logout

Cursor does not have a supported `cursor-agent mcp logout githits` command. Open
Cursor's MCP settings, select GitHits, and use the available disconnect,
sign-out, or account-removal action.

Ask the user to confirm that Cursor no longer shows an authenticated GitHits
connection. If `cursor-agent` is available, `cursor-agent mcp list` may be used
to inspect the server afterward, but the server can remain registered after its
OAuth session is cleared.

The `githits logout` CLI command removes credentials for local CLI and stdio
integrations. It does not clear Cursor's remote OAuth session.
