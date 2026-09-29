---
"githits": patch
"@githits/mcp": patch
---

- **Backend-owned read actions** - Search/status and docs lists emit canonical read commands using backend-selected targets, paths, selectors and bounds, preserving producer attribution and existing JSON shapes and caps. Capped MCP continuations retain the whole remaining selection and served revision; CLI commands safely handle dash-leading filenames. Additive SDK metadata preserves custom-provider compatibility, and agent guidance tells callers to replay complete actions. Production descriptor support gates publication; the stable MCP guide and exact public skill copy ship in the next applicable CLI/MCP releases.
