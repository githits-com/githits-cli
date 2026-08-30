---
"githits": none
"@githits/mcp": none
---

- **Agent eval metrics** - Maintainer-facing local eval runs now emit schema-v2 normalized usage, cost, tool-surface, and scenario/intent identity metrics. The exact intent fragment is SHA-256 identified, neutral intent records `null`, valid schema-v1 metrics normalize deterministically without inventing intent evidence, and one-off reports expose the identity. Public package artifacts are unchanged.
