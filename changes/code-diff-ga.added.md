---
"githits": minor
"@githits/mcp": major
---

- **Stable source diff** - Make `githits code diff` and public MCP `code_diff` available by default, with repository-wide scope guidance, stable smoke/eval coverage, and bounded patch evidence. Custom MCP service providers must implement `codeDiff` on `codeNavigationService`; the built-in client already does. Hosted availability follows adoption and deployment of the released MCP package.
