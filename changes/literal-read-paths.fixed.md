---
"githits": patch
"@githits/mcp": patch
---

- **Preserve literal read paths** - CLI and MCP reads retain surrounding filename whitespace. CLI `read` and `code read` accept `--literal-path` for numeric-colon filenames, and generated CLI read guidance preserves these paths alongside explicit line ranges.
