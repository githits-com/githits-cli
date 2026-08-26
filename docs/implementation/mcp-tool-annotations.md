# MCP tool annotations

OpenAI marketplace validation requires every MCP tool to set
`readOnlyHint`, `openWorldHint`, and `destructiveHint` explicitly. The
annotations are owned by the public `@githits/mcp` package because that package
defines and registers the shared tool descriptors used by both the local CLI
server and the remote MCP server.

The standard MCP annotation object has boolean hints but no field for reviewer
justifications. Keep the submission rationale below aligned with the descriptor
values and observable tool behavior.

OpenAI's current guidance says `readOnlyHint` must be false when a tool can
create service-side state or start background work. `openWorldHint` and
`destructiveHint` describe the impact of writes and are not relevant when
`readOnlyHint` is true. GitHits state-changing tools have bounded, additive
service-side effects; none can publish, message external recipients, modify
external systems, delete user data, overwrite user data, or perform an
irreversible public action.

| Tool | `readOnlyHint` | `openWorldHint` | `destructiveHint` | Justification |
| --- | --- | --- | --- | --- |
| `quick_start` | `true` | `false` | `false` | Returns static GitHits-authored routing and safety guidance without inspecting or changing external evidence. |
| `get_example` | `false` | `false` | `false` | Generates a new result and may create service-side state associated with that result, so it is not strictly read-only. The effect is additive and cannot publish, modify external systems, or delete/overwrite user data. |
| `search_language` | `true` | `false` | `false` | Looks up supported language names and aliases and returns matches without creating or modifying application state. The other two hints are explicitly false because the tool performs no write. |
| `feedback` | `false` | `false` | `false` | Submits feedback and therefore creates an additive service-side entry. It cannot publish, modify external systems, delete/overwrite user data, or perform a destructive action. |
| `search` | `false` | `false` | `false` | Searches public package/repository code and docs, and may start background preparation when requested content is not immediately available. That work cannot change source repositories or user data and is non-destructive. |
| `search_status` | `true` | `false` | `false` | Polls an existing search reference and retrieves progress/results; it does not start or modify the underlying work. The other two hints are explicitly false because the tool performs no write. |
| `code_files` | `false` | `false` | `false` | Lists files for a public target and may start background preparation when the requested content is not immediately available. It cannot modify the upstream package/repository or destructively change user data. |
| `code_read` | `false` | `false` | `false` | Reads file content for a public target and may start background preparation when the requested content is not immediately available. It cannot modify the source repository, publish content, or delete/overwrite user data. |
| `code_grep` | `false` | `false` | `false` | Searches source for a public target and may start background preparation when the requested content is not immediately available. Any service-side effect is bounded and non-destructive. |
| `docs_list` | `false` | `false` | `false` | Lists public package documentation and may start background preparation when the requested documentation is not immediately available. It cannot change public sources or destructively alter user data. |
| `docs_read` | `true` | `false` | `false` | Retrieves an available documentation page identified by `page_id` and optionally slices its line range. It does not initiate content preparation or modify state; the other two hints are explicitly false because there is no write. |
| `pkg_info` | `true` | `false` | `false` | Retrieves and computes package identity, release, repository, security-summary, and changelog-summary facts. It exposes no state-changing action; the other two hints are explicitly false because there is no write. |
| `pkg_vulns` | `true` | `false` | `false` | Retrieves and filters vulnerability/advisory facts for a package version without changing packages, advisories, or user state. The other two hints are explicitly false because there is no write. |
| `pkg_deps` | `true` | `false` | `false` | Retrieves and computes direct/transitive dependency information and optional issue analysis. It does not install, upgrade, or modify dependencies; the other two hints are explicitly false because there is no write. |
| `pkg_changelog` | `true` | `false` | `false` | Retrieves and filters changelog/release-note information from package or repository sources. It cannot create releases or modify upstream content; the other two hints are explicitly false because there is no write. |
| `pkg_upgrade_review` | `true` | `false` | `false` | Computes an evidence-only comparison between current and target versions using package, vulnerability, dependency, and changelog data. It does not install, update, publish, or otherwise modify a dependency; the other two hints are explicitly false because there is no write. |

The descriptor type requires all three booleans, and the catalog regression
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
