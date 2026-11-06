---
"githits": patch
"@githits/mcp": patch
---

- **API key compatibility** - Treat `sk-githits-` personal keys and `sk-githits-proj-` project keys as non-refreshable credentials, skipping OAuth refresh attempts in the shared CLI/MCP request wrapper. Existing `ghi-` and `gh-proj-` keys continue to work.
