---
"githits": patch
"@githits/mcp": none
---

- **Reliable concurrent CLI authentication** - Preserve live per-user auth locks when process or lock-owner metadata inspection is temporarily unavailable, and serialize stale-owner cleanup so parallel local CLI and MCP processes cannot reuse rotating refresh tokens. Restart long-running local MCP processes after upgrading so every process uses the hardened lock protocol.
