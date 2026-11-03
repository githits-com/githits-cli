---
"githits": patch
"@githits/mcp": none
---

- **Compact advisory lookup** - Give CLI `vulns` package links, normalized affected ranges and explicit truncation, shared source attribution and prominent recovery/trust markers. Replace its unreleased raw JSON envelope with actionable package/source/coverage/diagnostic fields; original source detail now requires `--verbose`, including with `--json`. Lead with reported CVSS, label alias relationships explicitly, omit synthetic scores and remove routine success footer noise.
