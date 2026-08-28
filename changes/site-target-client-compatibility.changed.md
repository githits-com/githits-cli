---
"githits": patch
"@githits/mcp": none
---

- **Recognize standalone-site resolve candidates** - `resolve` labels backend
  site candidates as `site` instead of the unknown-kind `target` fallback, and
  a `site` preferred kind is accepted by both the CLI `--prefer-kind` option
  and the experimental `resolve_target` tool. Experimental CLI/MCP guidance
  advertises site resolution and routes selected site targets into docs search.
