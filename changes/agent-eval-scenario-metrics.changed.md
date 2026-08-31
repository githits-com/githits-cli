---
"githits": none
"@githits/mcp": none
---

- **Agent eval scenario metrics** - Maintainer-facing local eval runs now emit schema-v2 normalized usage, cost, tool-surface, and scenario/intent identity metrics. The exact intent fragment is SHA-256 identified, neutral intent records `null`, valid schema-v1 metrics normalize deterministically without inventing intent evidence, and one-off reports expose scenario/intent plus the exact selected agent CLI version (or `unknown` for legacy/missing data) in JSON and console output. Same-agent comparisons warn on version drift without suppressing compatible deltas. Public package artifacts are unchanged.
