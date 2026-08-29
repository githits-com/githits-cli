---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Local Codex evals now use disposable per-workload homes, preserve caller HOME/USERPROFILE only for the trusted GitHits MCP child, require and validate a dedicated eval `CODEX_HOME` for every live surface without rejecting Codex-managed runtime state, redact those host paths from persisted runtime configs and command metadata, disable external Codex app/plugin catalogs, reject external guidance/CLI fallback traces while recognizing filesystem aliases, and keep full MCP and skills executable surfaces distinct. The v4 clean Luna descriptor/full canary validates MCP isolation and seeds causal baseline evidence; skills have deterministic command-path coverage but no live canary.
