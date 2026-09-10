---
"githits": patch
"@githits/mcp": patch
---

- **Classify information tools as read-only** - All remaining MCP tools advertise `readOnlyHint: true`, including local experimental Ask. The public `runMcpSmoke()` helper checks every advertised tool's annotation and rejects catalogs that retain feedback. Internal result storage and preparation retain their existing behavior. Hosted clients receive the annotations after the MCP package is adopted and deployed.
