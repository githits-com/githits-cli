---
"githits": patch
"@githits/mcp": patch
---

- **Prompt request cancellation during authentication** - CLI and MCP callers stop waiting for token lookup or refresh when canceled, while shared refresh work remains available to other requests.
