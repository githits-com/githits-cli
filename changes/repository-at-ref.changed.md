---
"githits": minor
"@githits/mcp": minor
---

- **Separate repository revisions from fragments** - Repository targets now use `provider:path@ref`, preserve later `@` characters inside refs, and reject legacy `#ref` input with the exact canonical replacement. Package `registry:name@version` targets and documentation fragments remain unchanged.
