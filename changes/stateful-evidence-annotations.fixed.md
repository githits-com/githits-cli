---
"githits": patch
"@githits/mcp": patch
---

- **Accurate MCP state annotations** - Classify `get_example` and `research` as non-read-only, non-idempotent operations because they consume credits and persist user-visible results or research threads. All built-in tools explicitly set all four boolean annotations; catalog and smoke checks reject stale classifications. Hosted clients receive the changes after the MCP package is adopted and deployed.
