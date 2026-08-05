---
description: Disconnect GitHits from your host-managed remote session
---

# Logout

The current host owns the remote OAuth session, and MCP provides no portable
logout operation. Open the current host's MCP, connection, or account settings,
select GitHits, and use the available disconnect, sign-out, or account-removal
action.

Ask the user to confirm that the host no longer reports an authenticated GitHits
connection. Do not call a GitHits MCP tool afterward because that could trigger
authentication again.

The `githits logout` CLI command removes credentials for local CLI and stdio
integrations. It does not clear the current host's remote OAuth session.
