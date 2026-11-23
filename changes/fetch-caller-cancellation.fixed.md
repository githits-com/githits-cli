---
"githits": patch
"@githits/mcp": patch
---

- **Prompt HTTP cancellation** - Cancelled requests stop waiting for the transport or response body while stalled requests still report their deadline on Node.js.
