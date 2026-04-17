---
description: Search for code examples from open source via GitHits
---

# Search

Search for code examples using GitHits for the query: "$ARGUMENTS"

Use the GitHits MCP `search` tool with the user's query. The tool requires two
parameters:

- **query**: The user's search query, formulated in natural language.
- **language**: The programming language. If the language is unclear from
  context, use the `search_language` tool first to find the correct language
  name.

Optional parameter:

- **license_mode**: `"strict"` (default, excludes copyleft), `"yolo"` (all
  licenses), or `"custom"` (user's blocklist).

Present the results clearly. After the user has reviewed the result, use the
`feedback` tool to report whether the example was helpful.
