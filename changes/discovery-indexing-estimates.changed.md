---
"githits": patch
"@githits/mcp": patch
---

- **Estimate-aware discovery waits** - Preserve indexing timing evidence in search/status JSON and use it for shared CLI/MCP follow-up suggestions, capped at 60 seconds with unchanged defaults when ranges are unavailable. Requires backend discovery estimate support on all production serving nodes before client release/adoption.
