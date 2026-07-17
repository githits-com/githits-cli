# MCP tool annotations

OpenAI marketplace validation requires every MCP tool to set
`readOnlyHint`, `openWorldHint`, and `destructiveHint` explicitly. The
annotations are owned by the public `@githits/mcp` package because that package
defines and registers the shared tool descriptors used by both the local CLI
server and the remote MCP server.

The standard MCP annotation object has boolean hints but no field for reviewer
justifications. Keep the submission rationale below aligned with the descriptor
values and the tools' backend behavior.

OpenAI's current guidance says `readOnlyHint` must be false when a tool can
create state or enqueue work. `openWorldHint` and `destructiveHint` describe the
impact of writes and are not relevant when `readOnlyHint` is true. All GitHits
writes are bounded to private first-party state, and none of these tools can
publish, message external recipients, delete user data, overwrite user data, or
perform an irreversible public action.

| Tool | `readOnlyHint` | `openWorldHint` | `destructiveHint` | Justification |
| --- | --- | --- | --- | --- |
| `get_example` | `false` | `false` | `false` | Generating an example creates a private GitHits solution/message record and emits first-party analytics, so it is not strictly read-only. The write is bounded to GitHits' private application state and is additive; it cannot publish externally or delete/overwrite user data. |
| `search_language` | `true` | `false` | `false` | Looks up supported language names and aliases and returns matches without creating or modifying application state. The other two hints are explicitly false because the tool performs no write. |
| `feedback` | `false` | `false` | `false` | Creates an additive feedback record tied to a solution or private GitHits session. It writes only to bounded first-party state and cannot publish externally, delete/overwrite user data, or perform a destructive action. |
| `search` | `false` | `false` | `false` | Searches package/repository code and docs, but may enqueue private indexing or stale-index repair work when requested content is not ready. Those jobs only update GitHits/PkgSeer private indexes and cannot change public repositories or user data. |
| `search_status` | `true` | `false` | `false` | Polls an existing search reference and retrieves progress/results; it does not start or modify the search or indexing job. The other two hints are explicitly false because the tool performs no write. |
| `code_files` | `false` | `false` | `false` | Lists indexed files, but target resolution may enqueue private indexing or repair work for a missing/stale target. It cannot modify the upstream package/repository or destructively change user data. |
| `code_read` | `false` | `false` | `false` | Reads file content, but resolving a missing/stale index may enqueue private indexing or repair work. It cannot modify the source repository, publish content, or delete/overwrite user data. |
| `code_grep` | `false` | `false` | `false` | Greps indexed source, but resolving a missing/stale index may enqueue private indexing or repair work. The only possible write is bounded, non-destructive first-party index maintenance. |
| `docs_list` | `false` | `false` | `false` | Lists package documentation and may enqueue a private documentation crawl or repository-indexing job when docs are missing. Crawling only reads public sources and stores a private index; it does not change those sources or destructively alter user data. |
| `docs_read` | `true` | `false` | `false` | Retrieves a documentation page already identified by `page_id` and optionally slices its line range. It does not trigger a crawl or modify state; the other two hints are explicitly false because there is no write. |
| `pkg_info` | `true` | `false` | `false` | Retrieves and computes package identity, release, repository, security-summary, and changelog-summary facts. It exposes no state-changing action; the other two hints are explicitly false because there is no write. |
| `pkg_vulns` | `true` | `false` | `false` | Retrieves and filters vulnerability/advisory facts for a package version without changing packages, advisories, or user state. The other two hints are explicitly false because there is no write. |
| `pkg_deps` | `true` | `false` | `false` | Retrieves and computes direct/transitive dependency information and optional issue analysis. It does not install, upgrade, or modify dependencies; the other two hints are explicitly false because there is no write. |
| `pkg_changelog` | `true` | `false` | `false` | Retrieves and filters changelog/release-note information from package or repository sources. It cannot create releases or modify upstream content; the other two hints are explicitly false because there is no write. |
| `pkg_upgrade_review` | `true` | `false` | `false` | Computes an evidence-only comparison between current and target versions using package, vulnerability, dependency, and changelog data. It does not install, update, publish, or otherwise modify a dependency; the other two hints are explicitly false because there is no write. |

The descriptor type requires all three booleans, and the server-level regression
test enumerates the full public tool surface so a future tool cannot silently
omit marketplace-required annotations.

## Output schemas and token efficiency

The MCP tools intentionally do not declare `outputSchema` yet. The current
handlers return unstructured `TextContent` and do not return
`structuredContent`. MCP defines `outputSchema` as optional, and requires a
successful `structuredContent` value to conform whenever one is declared.
OpenAI likewise recommends an output schema for tools that return structured
content.

Mirroring the existing JSON envelopes into `structuredContent` would make the
default compact response carry both `text-v1` and the full structured payload.
That would increase model context use, especially for code reads, grep matches,
documentation, changelog bodies, and dependency graphs. A published user trace
already showed the practical cost of large structured responses: the agent
explicitly selected JSON in 86 of 91 GitHits calls.

For that reason, every format-selectable MCP tool now advertises `text-v1` as
both the first enum value and the explicit schema default. JSON remains an
opt-in compatibility mode. If structured output is added later, it should use a
small per-tool control-plane contract (status, IDs, cursors, counts,
truncation, and next actions) rather than duplicate code, docs, examples, or
other large result bodies.
