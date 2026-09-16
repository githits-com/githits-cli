---
"githits": minor
"@githits/mcp": minor
---

- **Remove language discovery** - MCP `search_language`, `githits languages`, and `GitHitsService.getLanguages`/`searchLanguages` are gone; resolve example languages from `get_example`/`example --lang` 400 retry names or omit language. Remote MCP hosts implementing those service methods must drop them.
