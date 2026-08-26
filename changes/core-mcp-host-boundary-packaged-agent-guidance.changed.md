---
"githits": patch
"@githits/mcp": none
---

- **Clarify packaged ownership guidance** - Agent guidance now assigns diagnostics lifecycle and output destinations to the CLI host while core and MCP remain host-neutral; MCP error classifiers no longer emit CLI debug lines, while core service diagnostics can still emit when the CLI container injects them.
