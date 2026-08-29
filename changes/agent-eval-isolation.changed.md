---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Local Codex MCP evals now use disposable per-workload homes, preserve caller HOME/USERPROFILE only for the trusted GitHits MCP child, redact those host paths from persisted runtime configs and command metadata, validate a dedicated eval `CODEX_HOME` without rejecting Codex-managed runtime state, disable external Codex app/plugin catalogs, reject external guidance/CLI fallback traces while recognizing filesystem aliases, and keep full MCP and skills executable surfaces distinct. The v4 clean Luna descriptor/full canary validates this isolation and seeds causal baseline evidence.
