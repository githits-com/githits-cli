---
"githits": minor
"@githits/mcp": minor
---

- **Unified reading** - Replace MCP `code_read` and `docs_read` with `read`, using a compact target and optional file path; preserve documentation fragments and code indexing waits, translate Ask citations, and add `githits read` while retaining deprecated CLI aliases. MCP callers must rediscover the catalog; hosted clients receive the change after package adoption and deployment.
