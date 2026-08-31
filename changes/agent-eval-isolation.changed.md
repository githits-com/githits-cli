---
"githits": none
"@githits/mcp": none
---

- **Agent eval isolation** - Codex evals and interactive sessions now use disposable acting-agent home/config/temp roots, validate an absolute dedicated `CODEX_HOME` before live launch, reject direct home skills other than `.system`, preserve trusted host auth roots only for the local GitHits MCP child, and persist safe relative isolation metadata. Non-interactive Codex commands retain supported `--ignore-user-config` (config.toml/user configuration suppression) and external app/plugin disables while still enforcing the explicit skills preflight; interactive sessions omit exec-only flags, enforce the dedicated-home skills/config contract, and keep only the intended GitHits MCP target. Claude/OpenCode session behavior remains workspace-only and non-causal for instruction-isolation evidence.
