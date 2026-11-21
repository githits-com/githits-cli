---
"githits": patch
"@githits/mcp": patch
---

- **Recover progress relay connections** - Time out stalled WebSocket handshakes, close pending sockets during shutdown, recover from socket errors without close events, and retry failed setup or renewal while calls remain active.
