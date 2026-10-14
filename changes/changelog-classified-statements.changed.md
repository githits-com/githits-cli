---
"githits": minor
"@githits/mcp": minor
---

- **Complete changelog statements** - Package changelogs now default to all parsed bullets with available agent classifications, uncertainty, coverage and nearby sources. `changes` filters actionable, important or all statements before pagination. `verbatim` shows full original notes instead; `verbose` is its deprecated alias. Timeline-only omission skips parsing/classification. Default JSON replaces raw bodies and risk-only fields with complete statement evidence; use `--verbatim --json` / `verbatim:true,format:"json"` for original bodies.
