---
"githits": patch
"@githits/mcp": minor
---

- **Replayable resolver targets** - Use the backend's required `searchTarget` for CLI/MCP follow-ups and retain a differing `canonicalKey` in candidate JSON. Googlesource HTTPS and scoped site addresses now replay correctly; custom resolver service implementations must supply `searchTarget` on results and references.
