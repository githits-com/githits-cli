---
"githits": minor
"@githits/mcp": minor
---

- **MCP output formats** - All format-selectable tools now expose only `text` (default) and `json`, with guidance to reserve JSON for programmatic follow-up or exact structured details. Explicit `text-v1` callers must switch to `text` or omit the format parameter; rendering and JSON payloads are unchanged.
