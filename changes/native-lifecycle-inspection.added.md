---
"githits": minor
"@githits/mcp": minor
---

- **Native lifecycle inspection** - `githits pkg info` and MCP `pkg_info` show compact native lifecycle warnings in default text and JSON, omitting empty results and repeated identity. Use `--verbose` / `verbose: true` for full lifecycle evidence, independent checks and diagnostics. Vulnerability counts and failure policy are unchanged. The target backend must serve `packageInfo.selectedVersion.lifecycle` before releasing these CLI/MCP versions.
