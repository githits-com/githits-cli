---
"githits": patch
"@githits/mcp": patch
---

- **Use repository snapshots while HEAD indexes** - CLI and MCP search text shows the served commit and historical indexing ref, offers a pinned read before optional waiting for updated results, and directs ended searches to a new search instead of polling a stored reference. JSON and explicit wait options are unchanged.
