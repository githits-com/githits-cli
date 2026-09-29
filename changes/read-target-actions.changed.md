---
"githits": patch
"@githits/mcp": patch
---

- **Backend-owned read actions** - Search/status text emits one explicit read action per hit and JSON follow-ups retain their existing schema and caps while consuming backend-selected target/path/selector/bounds. Headings use selectors instead of reconstructed fragments, concrete continuations retain the served SHA instead of the requested ref, no-SHA repository hits report an unavailable exact revision, and docs lists emit one canonical action per page. Optional additive search/read SDK metadata preserves custom-provider compatibility; production descriptor support gates publication.
