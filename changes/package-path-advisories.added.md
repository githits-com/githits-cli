---
"githits": minor
"@githits/mcp": minor
---

- **Package-path advisories** - Unified grep shows one compact warning per distinct package-path correction in CLI/MCP text and JSON, preserving results, failures and pending targets. Requires a backend exposing `GrepResult.pathWarnings`; injected grep providers must supply the warning array.
