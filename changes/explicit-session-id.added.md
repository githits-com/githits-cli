---
"githits": minor
"@githits/mcp": minor
---

- **Explicit request session identifiers** - Set `GITHITS_SESSION_ID` to an identifier matching `[A-Za-z0-9_-]{1,64}` to override terminal detection in CLI and MCP client request headers. Valid identifiers are forwarded unchanged without hashing; invalid values fail local MCP startup and CLI requests with a configuration error. Unset the variable to retain hashed automatic detection.
