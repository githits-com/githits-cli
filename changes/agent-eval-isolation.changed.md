---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Codex evals and interactive sessions now use disposable acting-agent home/config/temp roots, validate an absolute dedicated `CODEX_HOME` before live launch, preserve trusted host auth roots only for the local GitHits MCP child, and persist safe relative isolation metadata. Non-interactive Codex commands retain supported user-config suppression and external app/plugin disables; interactive sessions omit exec-only flags, enforce the dedicated-home skills/config contract, and keep only the intended GitHits MCP target. Claude/OpenCode session behavior remains workspace-only and non-causal for instruction-isolation evidence.
