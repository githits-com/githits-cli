---
"githits": patch
"@githits/mcp": patch
---

- **Recognize standalone-site resolve candidates** - `resolve` labels backend
  site candidates as `site` instead of the unknown-kind `target` fallback, and
  a `site` preferred kind is accepted by both the CLI `--prefer-kind` option
  and the experimental `resolve_target` tool. Experimental CLI/MCP guidance
  advertises site resolution and routes selected site targets into docs search.
  Stable MCP guidance now distinguishes package-only `docs_list` from the
  standalone-site search and `docs_read` flow.
