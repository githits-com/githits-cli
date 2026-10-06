---
"githits": minor
"@githits/mcp": minor
---

- **Shared source and preparation rows** - Search/status, grep, list and annotated reads use consistent pinned source and actual-work identities, independently known dates and compact timing. List adds selected nullable commit timestamps without fetching detailed metadata for text. Confirm production backend schema support before client release or hosted adoption: GraphQL validates the complete list/read query even when directives skip fields. Search now defaults to partial results so ready sources contribute while others prepare; opt out with CLI --no-allow-partial or MCP allow_partial_results: false. Indexed alternatives stay with their preparation target. Grep hides backend input numbers in human text and puts read guidance after matches. Raw content, silent paths, JSON actions and native continuations remain unchanged.
