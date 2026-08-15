---
"githits": patch
"@githits/mcp": patch
---

- **Explain unavailable exact paths** - CLI and MCP now return `FILE_PATH_EXCLUDED` for excluded files and `SOURCE_FILE_INVENTORY_UNKNOWN` when the index cannot verify a path, with actionable path and resolution details.
