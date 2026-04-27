---
description: Legacy alias for GitHits example search
---

# Search (Legacy Alias)

Use GitHits example search for the query: "$ARGUMENTS"

This slash command is the older alias for `/githits:example`.

Use the GitHits MCP `get_example` tool with the user's query.

Required parameter:

- **query**: The user's search query, formulated in natural language.

Optional parameters:

- **language**: The programming language. Omit it to let GitHits infer the
  language from the query. If you need to force a specific language and the
  exact name is uncertain, use the `search_language` tool first.
- **license_mode**: `"strict"` (default, excludes copyleft), `"yolo"` (all
  licenses), or `"custom"` (user's blocklist).

Present the results clearly. After the user has reviewed the result, use the
`feedback` tool to report whether the example was helpful.
