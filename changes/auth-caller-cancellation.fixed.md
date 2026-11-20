---
"githits": patch
"@githits/mcp": patch
---

- **Prompt request cancellation during authentication** - Canceled MCP requests stop waiting for token lookup or refresh while shared refresh work continues. CLI Research checks its deadline before starting or retrying the backend call after authentication.
