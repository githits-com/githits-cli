# MCP tool annotations

All current GitHits MCP tools advertise `readOnlyHint: true`. The annotation
classifies their information-retrieval or computation purpose, including internal
result storage, caching, background preparation, and research-thread state.
It does not assert that the backend performs no database writes.

The canonical factories in `@githits/mcp` own these annotations. The stable
catalog contains 15 tools; local experimental mode adds `ask`, `resolve_target`,
and `code_diff`, all with the same annotations. Existing `openWorldHint: false`
and `destructiveHint: false` values are unchanged; no `idempotentHint` is added.

| Tools | Purpose |
| --- | --- |
| `quick_start` | Return GitHits usage guidance. |
| `get_example`, `search_language` | Find canonical examples and supported languages. |
| `search`, `search_status` | Discover indexed evidence and retrieve search progress/results. |
| `code_files`, `code_grep`, `read` | Navigate and read public source. |
| `docs_list`, `read` | Discover and retrieve public documentation. |
| `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review` | Retrieve and compute package facts and upgrade evidence. |
| Local experimental `ask`, `resolve_target`, `code_diff` | Generate cited answers, resolve targets, and compare source versions. |

Feedback is retired from MCP and CLI, including `GitHitsService.submitFeedback`
and the concrete `/client` methods. Old invocations fail through the normal
unknown-tool/command path. The old `experimental.report_tool_issues` config key
is ignored; it generates no instructions or requests. Existing result and thread
identifiers remain available. Regular diagnostics and evaluation reports remain.

This is GitHits' product interpretation, not an OpenAI review approval or a
measured concurrency improvement. Catalog tests and registration smoke enforce
it. A future user-facing write operation must be classified separately; the
annotation type continues to support both boolean values.

Hosted clients receive the change after a package release, dependency adoption
in `remote-mcp`, and deployment. Restart or refresh clients' tool discovery after
updating. Public CLI/onboarding skill cleanup follows the release boundary;
the stable MCP guide and its skill copy change together under their parity rule.

## Output schemas and token efficiency

The MCP tools intentionally do not declare `outputSchema` yet. The current
handlers return unstructured `TextContent` and do not return
`structuredContent`. MCP defines `outputSchema` as optional, and requires a
successful `structuredContent` value to conform whenever one is declared.
OpenAI likewise recommends an output schema for tools that return structured
content.

Mirroring the existing JSON envelopes into `structuredContent` would make the
default compact response carry both text and the full structured payload.
That would increase model context use, especially for code reads, grep matches,
documentation, changelog bodies, and dependency graphs. A published user trace
already showed the practical cost of large structured responses: the agent
explicitly selected JSON in 86 of 91 GitHits calls.

For that reason, every format-selectable MCP tool now advertises `text` as
both the first enum value and the explicit schema default. The only public values are `text` and `json`; the format description reserves
JSON for parsing responses in code or obtaining fields absent from text. If structured output is added later, it should use a
small per-tool control-plane contract (status, IDs, cursors, counts,
truncation, and next actions) rather than duplicate code, docs, examples, or
other large result bodies.
