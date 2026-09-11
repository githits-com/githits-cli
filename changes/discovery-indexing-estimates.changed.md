---
"githits": patch
"@githits/mcp": patch
---

- **Estimate-aware discovery waits** - Preserve indexing timing evidence in search/status JSON and use it for shared CLI/MCP follow-up suggestions, with discovery waits up to five minutes, matching HTTP deadlines and MCP cancellation; defaults remain unchanged when ranges are unavailable. Requires backend estimate/five-minute support on all production serving nodes and verified proxy/MCP caller timeout allowances before release/adoption.
