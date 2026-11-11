---
"githits": minor
"@githits/mcp": minor
---

- **Unified grep enclosing symbols** - Add explicit CLI `--symbol-field` and MCP `symbol_fields` controls with compact legacy symbol hints in text and full requested metadata in JSON, preserving exact symbol refs, ranges and cursor masks. Defaults remain lean; release requires the unified-symbol schema deployed to production before opt-in can work there. Legacy `code grep` also accepts the shared native-only masks. `file_content_hash` and `is_implementation` are accepted but return no metadata.
