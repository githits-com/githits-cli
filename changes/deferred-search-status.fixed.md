---
"githits": patch
"@githits/mcp": patch
---

- **Accept evolving search-session statuses** - Preserve available search evidence when the backend adds a status instead of rejecting the response. CLI and MCP recognize terminal `DEFERRED` progress, while unrecognized future statuses remain uninterpreted and never trigger same-reference polling.
