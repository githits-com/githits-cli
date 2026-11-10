---
"githits": minor
"@githits/mcp": minor
---

- **Native lifecycle inspection** - `githits pkg info` and MCP `pkg_info` now preserve native deprecation and withdrawal findings, scope, independent checks, retained legacy warnings, and content-filtering evidence in shared text/JSON output without changing vulnerability counts or failure policy. The target backend must serve `packageInfo.selectedVersion.lifecycle` before releasing these CLI/MCP versions; production availability has not been asserted.
