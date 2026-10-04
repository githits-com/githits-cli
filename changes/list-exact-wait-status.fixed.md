---
"githits": patch
"@githits/mcp": patch
---

- **Exact site wait outcomes** - CLI and MCP list JSON preserve `FAILED` and `SUPERSEDED` alongside the four existing outcomes by selecting the additive backend `status` field as `outcome`; deploy that field to dev and production before publishing either client artifact, while older clients remain supported without a forced upgrade.
