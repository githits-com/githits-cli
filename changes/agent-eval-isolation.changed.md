---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Codex evals and interactive sessions now use disposable acting-agent home/config/temp roots, validate an absolute dedicated `CODEX_HOME` before live launch, preserve trusted host auth roots only for the local GitHits MCP child, and persist safe relative isolation metadata. Codex commands suppress user config and external app/plugin catalogs; interactive sessions do not use exec-only `--ignore-rules`. Claude/OpenCode session behavior remains workspace-only and non-causal for instruction-isolation evidence. Historical Luna canary and skills command-path evidence remain attributable without claiming a live skills canary.
