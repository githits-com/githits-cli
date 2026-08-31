---
"githits": patch
"@githits/mcp": patch
---

- **Make MCP session guidance reliable** - MCP servers built from `githits` or
  `@githits/mcp` now require one `quick_start` call per plain session while
  agents with the loaded `githits-mcp` skill skip it for every tool. GitHits
  MCP and CLI skills now use transport-specific triggers so agents load only
  the matching workflow.
