# MCP tool annotations

The canonical factories in `@githits/mcp` classify all 15 built-in tools with
explicit boolean annotations. Credit consumption, persisted example results,
and saved research threads are user-visible state changes.

| Tools | readOnlyHint | idempotentHint | destructiveHint | openWorldHint |
| --- | --- | --- | --- | --- |
| `get_example`, `research` | false | false | false | true |
| `quick_start` | true | true | false | false |
| All other built-in evidence tools | true | true | false | true |

Example generation and research are additive stateful operations: another call
can consume more credits and create another result or research step. They do
not delete or overwrite user artifacts. Retrieval and internal evidence caching
remain read-only. `idempotentHint` describes additional state effects, not
whether the response bytes stay identical as public evidence changes.

The constants in `tools/types.ts` distinguish closed-domain reads, public
evidence reads, and stateful evidence jobs. Catalog tests and registration
smoke verify all four annotations, including rejection of stale read-only
descriptors for either stateful tool. Custom public tool definitions retain
the optional idempotency field for source compatibility.

These annotation changes do not alter handlers, request schemas, or results.

| Tools | Purpose |
| --- | --- |
| `quick_start` | Return GitHits usage guidance. |
| `get_example` | Find code examples from projects across open source. |
| `search`, `search_status` | Discover indexed evidence and retrieve search progress/results. |
| `list`, `grep`, `read` | Browse, search, and read public source or documentation inventories. |
| `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review` | Retrieve and compute package facts and upgrade evidence. |
| `code_diff` | Compare exact source versions or repository refs. |
| `resolve_target` | Rank canonical public package, repository and documentation-site targets. |
| `research` | Generate cited answers. |

Feedback is retired from MCP and CLI, including `GitHitsService.submitFeedback`
and the concrete `/client` methods. Old invocations fail through the normal
unknown-tool/command path. The old `experimental.report_tool_issues` config key
is ignored; it generates no instructions or requests. Existing result and thread
identifiers remain available. Regular diagnostics and evaluation reports remain.

[OpenAI annotation guidance](https://developers.openai.com/plugins/plugin-guidelines#correct-annotation)
requires writes to be classified by their actual effects, including persisting
artifacts and starting stateful workflows. Plugin review approval remains an
external decision; local contract validation does not establish approval.

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
