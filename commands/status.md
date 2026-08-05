---
description: Show the host-managed GitHits connection status
---

# Status

Call the `search_language` MCP tool with the query `python` to check whether the
current host's GitHits remote connection is usable.

Report only what the result establishes:

- A successful call means the remote MCP connection is usable.
- An authentication-required error means the current host needs OAuth; suggest
  `/githits:login`.
- An unavailable tool means GitHits may be disabled, disconnected, or not yet
  discovered. Direct the user to the current host's MCP or server settings.
- For any other failure, report the exact error without guessing its cause.

The `githits auth status` CLI command reports credentials for local CLI and
stdio integrations. It cannot inspect the current host's remote OAuth session.
