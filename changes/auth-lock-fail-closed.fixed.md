---
"githits": patch
"@githits/mcp": none
---

- **Reliable concurrent CLI authentication** - Preserve live per-user auth locks when process or lock-owner metadata inspection is temporarily unavailable, preventing parallel local CLI and MCP processes from reusing rotating refresh tokens.
