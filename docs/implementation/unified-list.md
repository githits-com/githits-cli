# Unified list foundation

## Purpose and delivery state

This document records the client implementation for the backend's unified
`Query.list` inventory. The root CLI now exposes `githits list`; the MCP catalog
still exposes its existing `code_files` and `docs_list` tools until Phase 2.
Legacy `githits code files` and `githits docs list` execution remains unchanged
for compatibility, with help pointing to the new target model. The new service
does not route through legacy services or fall back to their GraphQL roots.

## Contract and ownership

`Query.list` serves one target inventory at a time. Package and repository
targets list their source trees, including package-local documentation files;
hosted documentation is a separate inventory selected by an explicit `site:`
target. A result identifies `SOURCE` or `SITE` and contains `FILE`, `PAGE`, or
`DIRECTORY` entries. Search remains responsible for content discovery.

`packages/core-internal/src/services/list-service.ts` owns the transport-neutral
`ListService`, the GraphQL document and variables, Zod response validation,
authentication refresh, diagnostics, and list-specific transport and GraphQL
errors. Its compact query selects inventory identity, entries and actions,
continuation, and lifecycle fields. `includeDetailedFields` conditionally
selects entry metadata, source resolution, available refs and versions, and
indexing estimates. It does not request content or snippets.

The service models selected nullable fields as nullable values and preserves
them in its result. Detail fields excluded by the GraphQL directive remain
absent. When `hasMore` is true, a missing or empty cursor is a malformed
response. The backend's opaque cursor is otherwise preserved exactly.

`packages/mcp/src/shared/` owns the surface-neutral caller and output helpers:

- `list-request.ts` validates and normalizes CLI/MCP inputs into `ListParams`.
  It preserves target and path selector bytes, keeps explicit `false`, omits
  empty filters, and does not invent page or wait defaults.
- `list-error-map.ts` maps list-owned and shared service errors into the
  existing `MappedError` envelope without interpreting backend message text.
- `list-response.ts` copies only the selected camelCase `ListResult` fields.
  It preserves meaningful `null`s and omitted conditional details, clones
  nested values, and adds no total, filter echo, or reconstructed action.
- `list-text.ts` renders the same result for CLI and MCP text. It shows one
  inventory header, one row per entry, available backend actions, relevant
  lifecycle state, and a continuation that replays the original selection with
  the new cursor. CLI arguments are shell-quoted; MCP arguments use JSON-style
  values. Control characters are rendered visibly while Unicode and encoded
  path bytes are retained.

The core service owns the network and backend contract because it is shared by
both surfaces. The MCP shared modules own input normalization, error and result
projection, and text because both callers need identical semantics. The root
CLI owns Commander parsing, authentication entry, spinner, terminal width and
colors, while its command delegates list semantics to those shared helpers.
The MCP adapter is a later increment. `packages/mcp/src/internal.ts` exports
the helpers only through the workspace-internal boundary; they are not a public
MCP client API.

## Actions and lifecycle

The entry `path` is display identity, not a locator. A non-null `read` action's
backend-authored `target` and nullable `path`, and a non-null `browse` action's
`target` and nullable `paths`, are authoritative. JSON preserves these values
exactly. Text renders only actions that exist and never derives an action from
the displayed entry path. Repeated SOURCE FILE read targets are grouped while
each row retains its own action path.

Continuation uses the returned `nextCursor`; callers do not reuse the previous
cursor or modify its contents. The formatter repeats target, paths, recursion,
and source filters. Limit and wait may also be replayed. The service itself
does not scan pages or reconstruct inventory client-side.

SOURCE indexing metadata (`codeIndexState`, `indexingStatus`, `indexingRef`,
and detailed resolution data) remains distinct from an empty result. In
particular, text identifies an empty result whose `indexingStatus` is
`INDEXING`. SITE `inventoryState`, `crawlStatus`, `coverageState`,
`coverageReason`, and `preparation` are reported separately; an empty site
inventory does not erase running or failed crawl/preparation state. No
legacy-root fallback is used for unsupported API or pagination errors.

## Testing boundaries

Core service tests cover exact GraphQL variables and selections, compact versus
detailed fields, nullable response projection, cursor validation, error
classification, and authentication refresh. Shared request and error tests
cover normalization and mapped envelopes. CLI tests cover Commander flags,
package/repository/site forwarding, pagination, compact versus detailed calls,
action rendering, diagnostics, authentication, and the absence of a legacy
service fallback. Response and text tests compare
repository-root, package-subtree, recursive-glob, and site-subtree fixtures,
including exact actions, continuation replay, null fidelity, and lifecycle
combinations. These client tests do not claim to validate backend path/glob
matching, inventory scope, hierarchy, or site membership; those semantics are
owned by the backend contract and require backend-side or live conformance
evidence.

## Key reference files

| File | Responsibility |
| --- | --- |
| `packages/core-internal/src/services/list-service.ts` | Backend transport contract, selection, validation, and list errors |
| `packages/mcp/src/shared/list-request.ts` | Shared request validation and normalization |
| `packages/mcp/src/shared/list-error-map.ts` | Mapping list errors into the shared envelope |
| `packages/mcp/src/shared/list-response.ts` | Allowlisted, null-preserving JSON projection |
| `packages/mcp/src/shared/list-text.ts` | Shared CLI/MCP text and follow-up rendering |
| `packages/mcp/src/internal.ts` | Workspace-only exports for shared helpers |
| `pkgseer-backend/priv/graphql/schema.graphql` | Backend `Query.list` schema source |
