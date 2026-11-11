---
"githits": minor
"@githits/mcp": none
---

- **Choose remote or local MCP setup during init** - Interactive setup defaults to hosted remote MCP with the `githits-mcp` skill and verified host guidance; `--remote` and `--local` select explicit profiles, with local-first setup as an alternative. Fresh staged installs without a selector default to local-first, while no-selector reruns preserve the existing canonical transport. Claude Desktop receives a manual directory handoff, and remote authentication stays with the host.
