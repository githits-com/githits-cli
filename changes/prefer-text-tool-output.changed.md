---
"githits": patch
"@githits/mcp": patch
---

- **Prefer token-efficient MCP text output** - Keep model-visible results in text and reserve JSON for direct host-side field handling or fields absent from text, not ordinary MCP or TypeScript invocation.
