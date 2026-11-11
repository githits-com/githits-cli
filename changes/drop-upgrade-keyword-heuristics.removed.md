---
"githits": minor
"@githits/mcp": minor
---

- **Upgrade review keyword heuristics** - The API deprecated the keyword heuristic in favour of classified changelog statements. Upgrade reviews stop requesting and displaying entry `signals`, `keywordEntries`, `totalKeywordEntries`, `breakingSignals`, `migrationSignals`, and summary `withBreakingSignals`, including in JSON. Classified and generated statements remain available.
