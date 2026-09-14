# MCP tool annotations

All current GitHits MCP tools advertise `readOnlyHint: true`. The annotation
classifies their information-retrieval or computation purpose, including internal
result storage, caching, background preparation, and research-thread state.
It does not assert that the backend performs no database writes.

The canonical factories in `@githits/mcp` own these annotations. The stable
catalog contains 14 tools; local experimental mode adds `ask`, `resolve_target`,
and `code_diff`. All tools remain non-destructive and omit `idempotentHint`.

`openWorldHint` describes the domain of interaction independently of writes,
authentication, and evidence quality. Twelve stable public-evidence tools and
all three experimental tools advertise `openWorldHint: true`. This includes
`search_status`: retrieving an existing search still returns public evidence.
Only `quick_start` and `search_language` advertise `openWorldHint: false`, since
they return bundled guidance or the fixed supported-language catalog.

The two read-only constants in `tools/types.ts` distinguish these domains;
factories select the appropriate constant. Catalog tests cover both exceptions
and all evidence tools, and registration smoke verifies the wire annotations.
No handler, schema, description, output, or authentication behavior changes.

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

[OpenAI review guidance](https://developers.openai.com/plugins/deploy/app-review#review-and-approval-faqs)
classifies public-internet retrieval as open-world even when read-only. Its
read-only wording is broader about internal state changes than GitHits' chosen
policy above; changing the open-world hint does not resolve that review ambiguity.

Public Codex source inspected at `5b1d656` shows that normal `Auto` approval
checks return early for read-only tools unless explicitly destructive, before
checking the open-world hint. Read-only annotations independently permit
parallel calls. Explicit approval modes and strict review can override the
normal approval path. Codex Apps' `open_world_enabled` setting defaults to true;
when disabled it can filter open-world tools, including read-only tools,
subject to explicit app/tool overrides. Directly configured MCP servers do not
use that app-specific filter. Guardian receives annotations as review context;
ordinary model-facing tool definitions omit them. These are observations of
that public revision, not guarantees about ChatGPT's private implementation.
See [approval checks](https://github.com/openai/codex/blob/5b1d656/codex-rs/core/src/mcp_tool_call.rs#L2322),
[app policy](https://github.com/openai/codex/blob/5b1d656/codex-rs/connectors/src/app_tool_policy.rs#L205),
and [parallel calls](https://github.com/openai/codex/blob/5b1d656/codex-rs/core/src/tools/handlers/mcp.rs#L128).

Hosted clients receive the change after a package release, dependency adoption
in `remote-mcp`, and deployment. Restart or refresh clients' tool discovery after
updating. Public CLI/onboarding skill cleanup follows the release boundary;
the stable MCP guide and its skill copy change together under their parity rule.
For OpenAI resubmission, verify production `tools/list` after deployment and
re-scan the production server in the portal. A locally refreshed review JSON
is a candidate until that production catalog matches it; keep credential-bearing
submission exports outside version control.

The published `@githits/mcp/smoke-test` helper validates these domain and
non-destructive annotations alongside read-only status, so hosted deployment
checks reject stale or incomplete catalogs before making evidence calls.

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
