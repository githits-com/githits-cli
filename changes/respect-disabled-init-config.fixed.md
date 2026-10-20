---
"githits": patch
"@githits/mcp": none
---

- **Respect disabled MCP configuration during init** - Config-file checks now report disabled GitHits entries before setup instead of silently replacing and re-enabling them. Malformed or unreadable configuration also blocks automatic MCP mutation.
