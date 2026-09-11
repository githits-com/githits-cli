---
"githits": patch
"@githits/mcp": patch
---

- **Longer default indexing wait** - Increase the shared CLI and MCP search, search-status, and code-navigation wait from 20 to 30 seconds to allow more time for indexing and metadata fetches before returning progress. Explicit wait overrides and the 60-second maximum remain unchanged.
