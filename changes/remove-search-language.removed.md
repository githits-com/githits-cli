---
"githits": minor
"@githits/mcp": minor
---

- **Remove language discovery** - MCP `search_language` and `githits languages` are gone. Pass a language to `get_example` / `githits example --lang`, or omit it to infer. If GitHits cannot match the language, the error lists alternatives to retry with. Callers of `GitHitsService.getLanguages` / `searchLanguages` must migrate.
