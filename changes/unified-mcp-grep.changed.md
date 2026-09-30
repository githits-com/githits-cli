---
"githits": minor
"@githits/mcp": minor
---

- **Unified MCP grep** - Replace `code_grep` with mixed source-and-documentation
  `grep`. New requests use ordered `targets: [{ target, corpus?,
  path_selectors? }]` and a required `pattern` instead of one `target` and an
  optional `pattern`. Per-target `exact`/`prefix`/`glob` selectors replace
  legacy `path`, `path_prefix`, `globs`, and `extensions` arguments.
  Defaults change from literal to RE2 regex, case-insensitive to case-sensitive
  (`ignore_case: true` opts in), and 50 to 100 matches per page. Replace
  `case_sensitive` with inverse `ignore_case`; `pattern_type: "literal"` opts
  into literal matching. Grep now covers all indexed repository files and
  package-selected hosted docs by default; context remains zero, and
  preparation wait changes from 30 seconds to zero. `context_lines` becomes
  independent `context_lines_before` and `context_lines_after` controls, and
  context above 10 is rejected instead of clamped. To replace
  `exclude_doc_files`, set a target's `corpus` to `source` for repository files;
  package-selected hosted docs remain included independently.
  `wait_timeout_ms` remains available for explicit preparation waits. MCP no
  longer accepts per-file limits, test exclusions, or symbol
  fields. The legacy `githits code grep` CLI remains available.
  The public smoke helper now exercises `grep`, and request-scoped MCP providers
  must supply `grepService`; `remote-mcp` must migrate its provider and helper
  use before adopting this package version.
