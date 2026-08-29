---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Local Codex MCP evals now use disposable per-workload homes, validate a dedicated eval `CODEX_HOME` without rejecting Codex-managed runtime state, disable external Codex app/plugin catalogs, reject external guidance/CLI fallback traces, and keep full MCP and skills executable surfaces distinct.
