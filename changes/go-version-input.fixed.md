---
"githits": patch
"@githits/mcp": patch
---

- **Accept canonical Go module versions** - Package dependency, vulnerability,
  changelog, and upgrade-review inputs now accept exact Go versions with or
  without `v` and send the backend the canonical `v`-prefixed form.
