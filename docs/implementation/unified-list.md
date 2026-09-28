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
errors. Its compact query selects inventory identity, entry kinds and paths,
continuation, and lifecycle fields. Compact site text also selects exact entry
read actions so it can expose valid hosted-page follow-ups without constructing
URLs. `includeDetailedFields` conditionally selects entry titles, browse
actions, file metadata, source resolution, available refs and versions, and
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
- `list-text.ts` defines the one token-efficient format that CLI uses now and
  the Phase 2 MCP tool must reuse: `# source <canonical-target>` followed by one
  path per line. The requested target is the fallback when canonical identity
  is unavailable, and ` | more` means another page exists. CLI dims this line
  when color is enabled; MCP emits the same plain text without ANSI. When
  every returned site page has an exact read target on one origin, the header
  adds `follow up with "read <origin>/$path"` and page/directory rows use paths
  relative to that origin. A root page retains its exact URL because its
  relative path is empty; the header marks URL rows to be read as-is. If one
  origin cannot represent every page, page rows use their exact backend-authored
  read targets. Directory paths end in `/`.
  Controls and backslashes are escaped to keep every entry on one unambiguous
  line, while quotes, ordinary Unicode, spaces, and encoded path bytes are
  retained.

The core service owns the network and backend contract because it is shared by
both surfaces. The MCP shared modules own input normalization, error and result
projection, and text because both callers need identical semantics. The root
CLI owns Commander parsing, authentication entry, and the spinner, while its
command delegates list semantics to those shared helpers.
The MCP adapter is a later increment, so current runtime use is CLI-only.
`packages/mcp/src/internal.ts` exports the helpers only through the
workspace-internal boundary; they are not a public MCP client API.

## Actions and lifecycle

The entry `path` is display identity, not a locator. A non-null `read` action's
backend-authored `target` and nullable `path`, and a non-null `browse` action's
`target` and nullable `paths`, are authoritative. JSON preserves these values
exactly. For site text, page rows use the exact read target when present and the
returned pages span origins; a page without one retains its display path. When
every returned page shares one origin, the header provides the exact
`read <origin>/$path` template and rows omit that repeated origin. A site
display path without either form is not a read locator.

Continuation uses the returned `nextCursor`; callers do not reuse the previous
cursor or modify its contents. Lossless JSON exposes the cursor, while the
original request supplies the selection that must be replayed. Compact text
does not add a continuation footer. The service itself does not scan pages or
reconstruct inventory client-side.

SOURCE indexing metadata (`codeIndexState`, `indexingStatus`, `indexingRef`,
and detailed resolution data) remains distinct from an empty result in JSON.
SITE `inventoryState`, `crawlStatus`, `coverageState`, `coverageReason`, and
`preparation` are also preserved there. Compact text represents an empty
inventory with its zero-entry header alone. No legacy-root fallback is used
for unsupported API or pagination errors.

## Testing boundaries

Core service tests cover exact GraphQL variables and selections, compact versus
detailed fields, nullable response projection, cursor validation, error
classification, and authentication refresh. Shared request and error tests
cover normalization and mapped envelopes. CLI tests cover Commander flags,
package/repository/site forwarding, pagination, compact versus detailed calls,
path rendering, diagnostics, authentication, and the absence of a legacy
service fallback. Response tests cover exact actions, cursors, null fidelity,
and lifecycle combinations. Text tests cover canonical/requested source
identity, pagination, dim CLI presentation, path-only rows, directory
suffixes, empty results, and control-character escaping. These client tests do
not claim to validate backend path/glob
matching, inventory scope, hierarchy, or site membership; those semantics are
owned by the backend contract and require backend-side or live conformance
evidence.

The path-only formatter was measured against the same authenticated built-CLI
queries before and after the output change:

| Query | Previous bytes | Path-only bytes | Reduction |
| --- | ---: | ---: | ---: |
| `npm:express@5.2.1 --limit 100` | 1,038 | 192 | 81.5% |
| `npm:express@5.2.1 examples/ --recursive --limit 500` | 7,399 | 2,793 | 62.3% |
| `site:react.dev react.dev/reference/ --recursive --limit 500` | 20,727 | 4,675 | 77.4% |

These are UTF-8 output sizes, not tokenizer-specific token counts. The durable
`bun run bench:list-text` fixture reports current 100-entry source and site
text sizes without requiring network access. It also compares the prior compact
entry selection (`kind`, `path`, `title`, `read`, `browse`) with the new
source `kind`/`path` selection. Compact site text additionally fetches exact
`read.target` values.

Authenticated live CLI conformance on 2026-09-26 verified that the hosted
endpoint exposes `Query.list` for package, repository, and site targets. The
run covered literal and union paths, `**` and character-class globs, source and
site directory recursion, combined file-type/language/intent filters,
dot-prefixed root entries, package and site pagination, cursor selection
binding, source-only filter rejection for sites, indexing wait, package-scope
failure with its explicit pinned-repository alternative, and exact emitted
read, browse, and continuation actions. It used Express and Lodash packages,
the Express, Requests, and Babel repositories, and React and Node.js
documentation sites. All 20 checks passed, including `?`, escaped glob
metacharacters, union deduplication, and Babel monorepo package-boundary
isolation. Phase 2 retains MCP/agent and package-to-site discovery validation.

## Key reference files

| File | Responsibility |
| --- | --- |
| `packages/core-internal/src/services/list-service.ts` | Backend transport contract, selection, validation, and list errors |
| `packages/mcp/src/shared/list-request.ts` | Shared request validation and normalization |
| `packages/mcp/src/shared/list-error-map.ts` | Mapping list errors into the shared envelope |
| `packages/mcp/src/shared/list-response.ts` | Allowlisted, null-preserving JSON projection |
| `packages/mcp/src/shared/list-text.ts` | Shared path-only CLI/MCP text rendering |
| `packages/mcp/src/internal.ts` | Workspace-only exports for shared helpers |
| `pkgseer-backend/priv/graphql/schema.graphql` | Backend `Query.list` schema source |
