---
"githits": patch
"@githits/mcp": patch
---

- **Grep oversized context without a retry** - Clamp nonnegative integer context requests to 10 lines per side, preserve asymmetric overrides, and return requested/effective values in JSON with an actionable text notice. Direct larger source windows to code_read instead of repeating grep.
