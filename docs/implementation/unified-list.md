# Unified list

## Purpose and delivery state

This document records the client implementation for the backend's unified
`Query.list` inventory. The root CLI exposes `githits list`, and the stable MCP
catalog exposes one `list` tool in place of the retired callable `code_files`
and `docs_list` tools. The replacement descriptor names both retired tools
after its intent-focused first sentence so stale full-description searches can
discover it. No callable aliases remain. Legacy `githits code files` and
`githits docs list` execution remains available for CLI compatibility. The
unified service does not route through legacy services or fall back to their
GraphQL roots.

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
read actions so it can replay backend-authored site targets and page paths.
The existing directive now selects `read: readTarget { target path }`, keeping
its response alias and structured DTO. Both values are backend-owned and equal
to the previous `read` action; no inventory variant or projection option is added.
Selected actions must be present (explicit null is valid); unselected actions
remain omitted. DIRECTORY entries stay browse-only/null, and SOURCE text retains
its generic path template without a concrete read descriptor.
`includeDetailedFields` conditionally selects entry titles, browse
actions, file metadata, detailed source resolution, available refs and versions,
and singular indexing estimates. Normal text opts into service-only
`includeTargetProvenance`; silent text opts out and omitted service callers retain
the old compact selection. Detailed mode always selects provenance. The minimal
block contains requested kind/ref, resolved-requested and served repo/ref/full SHA/
nullable `committedAt`, freshness and reason. Recovery arrays and opaque nested
indexing refs remain detailed-only. Selected nulls and omitted fields stay distinct;
JSON preserves full timestamps. It does not request content or snippets.

The service models selected nullable fields as nullable values and preserves
them in its result. Detail fields excluded by the GraphQL directive remain
absent. When `hasMore` is true, a missing or empty cursor is a malformed
response. The backend's opaque cursor is otherwise preserved exactly.

`packages/mcp/src/shared/` owns the surface-neutral caller and output helpers:

- `list-request.ts` validates and normalizes CLI/MCP inputs into `ListParams`.
  It preserves targets, source selectors, and nonblank cursors, while accepting
  one leading `/` on site selectors and removing it before `Query.list`. It
  lowercases language and file-type classifications for the backend contract,
  keeps explicit `false`, omits empty filters, and does not invent page or wait
  defaults. File types are classifications such as `source` or `doc`; extension
  selection uses path globs such as `lib/**/*.js`.
- `list-error-map.ts` maps list-owned and shared service errors into the
  existing `MappedError` envelope without interpreting backend message text.
- `list-response.ts` copies only the selected camelCase `ListResult` fields.
  It preserves meaningful `null`s and omitted conditional details, clones
  nested values, and adds no total, filter echo, or reconstructed action.
- `list-text.ts` uses shared `Sources:` rows, then separate native `Read files:`
  or `Read pages:` guidance and one path per line. Known SOURCE provenance is
  pinned and dated; its exact read recipe retains canonical/requested path base,
  which can be a package target rather than the displayed repository SHA. SITE
  rows and recipes use the shared PAGE action target or requested target, never a
  broader canonical owner. Disagreeing PAGE targets omit a generic read recipe.
  Known freshness qualifiers, preparation and recovery remain separate from paths.
  Empty inventories retain no-files/no-pages outcomes. Preparation follows paths
  and precedes continuation/retry. The opaque cursor and native wait units stay exact.
  CLI colors and width affect wrapping; MCP shares plain wording. `--silent`
  returns only paths, with no bytes for an empty inventory. PAGE read paths remain
  target-relative, `/` denotes the landing page, and DIRECTORY paths end in `/`.
  Exceptional URL-only PAGE actions stay exact. Controls/backslashes are escaped;
  printable Unicode and encoded path bytes survive.

The core service owns the network and backend contract because it is shared by
both surfaces. The MCP shared modules own input normalization, error and result
projection, and text because both callers need identical semantics. The root
CLI owns Commander parsing, authentication entry, the spinner, and `--silent`.
`packages/mcp/src/tools/list.ts` owns the ten-argument MCP schema and delegates
to the same helpers. `McpToolServices.listService` makes the dependency explicit
for local and request-scoped hosted composition. `@githits/mcp/client` exports
the public `ListService` types and `ListServiceImpl`; the package root does not
export the concrete implementation. Workspace callers can also reach the
shared helpers through `packages/mcp/src/internal.ts`.

## Actions and lifecycle

Ordinary site PAGE paths are reusable with their supplied site target.
A non-null `read` action's backend-authored `target` and nullable `path`, and a
non-null `browse` action's `target` and nullable `paths`, are authoritative. JSON preserves these values
exactly. For site text, PAGE actions using a `site:` target render their exact
target-relative `read.path`, while the header reuses their shared `read.target`.
Do not repeat the target's scope in the path. A site text row without a trailing
`/` is a PAGE, even when its source URL ended in `/`; `/` reads the site's
landing page. JSON exposes exact entry kinds and per-entry actions.
Omitted or empty list paths select the target root. A site selector with one
leading `/` stays relative to the supplied target; `/` alone selects its root.
Literal paths and quoted globs operate only under the supplied site's literal
host/scope. A root `/` selector cannot be combined with other site paths; use
separate calls when both views are needed.
The backend normally removes one non-root trailing slash when the
slashless path is unambiguous; it retains the slash when distinct slashless and
slash-terminated pages coexist. Exceptional URL-only actions render their
exact target. DIRECTORY rows remain relative and end in `/`. Explicit backend
actions remain authoritative for exceptional URL/query/encoding identities;
the client formatter does not reconstruct them from display paths.

Continuation uses the returned `nextCursor`; callers do not reuse the previous
cursor or modify its contents. Default text exposes it in a surface-native
continuation footer and tells callers to reuse the same target, paths, and
options. Lossless JSON also preserves it for programmatic consumers. Silent
CLI output remains paths-only and therefore omits the footer. The service
itself does not scan pages or reconstruct inventory client-side.

SOURCE indexing metadata (`codeIndexState`, `indexingStatus`, `indexingRef`,
and detailed resolution data) remains distinct from an empty result in JSON.
SITE `inventoryState`, `crawlStatus`, `coverageState`, `coverageReason`, and
`preparation` are also preserved there. Completed empty inventories say no files/pages and retain known source provenance. Pending empty source/
site inventories say “No files/pages available yet”, followed by compact
preparation rows. Available paths/pages and their cursor remain visible during
refresh. One native wait recommendation appears after the continuation footer;
leave-out-cursor advice appears only when the request supplied `after`. CLI
`--silent` continues emitting paths only. Zero-wait GraphQL errors retain the
existing singular duration, package and indexed alternatives instead of losing
the supplied metadata; JSON does not fabricate a uniform array for those errors. No legacy-root fallback is used
for unsupported API or pagination errors.

## Exact site wait outcomes and rollout

The core query selects `awaited { mode outcome: status }`. This GraphQL alias
keeps the client, CLI JSON, and MCP JSON key named `outcome` while consuming the
backend's exact nonnull `ListSiteWait.status` field and its separate
`ListSiteWaitStatus` enum. The closed client type and parser accept exactly
`COMPLETED`, `DISCARDED`, `CANCELLED`, `TIMEOUT`, `FAILED`, and `SUPERSEDED`.
Unknown values fail response validation. The shared projector preserves `mode`
and each exact outcome; compact text continues to show inventory paths and
keeps lifecycle detail in JSON.

The backend permanently retains its original four-value `ListSiteWait.outcome`
field and `ListSiteWaitOutcome` enum for older CLIs and the public API. Internal
`FAILED` projects to legacy `DISCARDED`, and `SUPERSEDED` to legacy `CANCELLED`;
neither becomes `COMPLETED`. Both fields resolve from the same internal outcome.
Existing clients can keep selecting the legacy field without a forced upgrade,
retirement deadline, or version negotiation. The client does not fall back to
that field when the exact field is unavailable.

Deploy the additive backend `status` field to dev and production before
publishing either updated `githits` or `@githits/mcp` artifact. Client and backend
PRs can be reviewed in parallel; client tests do not prove backend deployment.
This companion records pending patch impacts for both artifacts and leaves
package versions unchanged until separately authorized release preparation.
Hosted MCP adoption additionally requires its consumer to update the published
`@githits/mcp` dependency and deploy, as described in the package boundaries.

## Testing boundaries

Core service tests cover exact GraphQL variables and selections, compact versus
detailed fields, nullable response projection, cursor validation, error
classification, and authentication refresh. Shared request and error tests
cover normalization and mapped envelopes. MCP tests cover the exact descriptor
prefix and compatibility sentence, all ten arguments, text/JSON projection,
errors, cancellation, and package/site follow-up actions. CLI tests cover
Commander flags, package/repository/site forwarding, pagination, compact versus
detailed calls, path rendering, diagnostics, authentication, and the absence of
a legacy service fallback. Response tests cover exact actions, cursors, null
fidelity, and lifecycle combinations. Text tests cover canonical/requested source
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
| `npm:express@5.2.1 --limit 100` | 1,038 | 240 | 76.9% |
| `npm:express@5.2.1 examples/ --recursive --limit 500` | 7,399 | 2,841 | 61.6% |
| `site:react.dev react.dev/reference/ --recursive --limit 500` | 20,727 | 4,802 | 76.8% |

These are UTF-8 output sizes, not tokenizer-specific token counts. The durable
`bun run bench:list-text` fixture reports current 100-entry source and site
text sizes without requiring network access. It also compares the prior compact
entry selection (`kind`, `path`, `title`, `read`, `browse`) with the new
source `kind`/`path` entry selection; the separate minimal provenance block is now also selected for normal text. Compact site text additionally fetches exact
`read.target` and `read.path` values. Before the text continuation footer, its
100-entry source/site cases were 3,613/2,119 bytes. At continuation-footer delivery, the same cases were
3,702/2,208 bytes, an 89-byte continuation cost (2.5%/4.2%).

Authenticated live CLI conformance on 2026-09-26 verified that the hosted
endpoint exposes `Query.list` for package, repository, and site targets. The
run covered literal and union paths, `**` and character-class globs, source and
site directory recursion, combined file-type/language/intent filters,
dot-prefixed root entries, package and site pagination, cursor selection
binding, source-only filter rejection for sites, indexing wait, package-scope
failure with its explicit pinned-repository alternative, and exact emitted
read, browse, and continuation actions. It used Express and Lodash packages,
the Express, Requests, and Babel repositories, and React and Node.js
documentation sites. All 20 checks passed against the earlier exact-URL PAGE
action contract, including `?`, escaped glob
metacharacters, union deduplication, and Babel monorepo package-boundary
isolation. Backend PR #2817 changed PAGE actions to `site:` target plus
host-relative path and added matching unified reads. The client fixtures and
formatter are aligned with its schema hash
`sha256:cbddb30fa7d08ac5af41799828767c607a704dc88880c33ae201e14c5d2cc672`;
authenticated action replay against its production deployment passed on 2026-09-28
for the Express root, a normal page with and without a trailing slash, and the
same page through a nested site scope. Package and repository list-to-read
regression checks also passed against production. The permanent CLI and MCP
smoke suites cover package and site text/JSON listings, CLI paths-only output,
default-text continuation, JSON parity, and replaying exact package and site
actions through unified `read`. Descriptor-only agent workloads cover package/repository
boundaries, directory recursion versus glob depth, continuation, exact-site
browse/read, and package documentation search followed by an emitted explicit
site target.

Backend PR #2857 corrected target-relative site paths and is deployed to
production. Its earlier dev deployment and a
fresh external installation of published `githits@0.23.0` verified
Express `en/resources/community` replay (82 lines, 3324 content characters)
and scoped `site:reference.langchain.com/python/langchain` paths: `agents/`
returned 4 immediate entries and 176 recursively, and
`agents/_subagent_transformer/AsyncSubagentRunStream` read nonempty Markdown
without repeating `python/langchain`. Relative globs, emitted page literal
replay, host-qualified compatibility selectors, equivalent-selection cursor
replay, and PAGE text list/read output also passed. Those checks missed
directory text: a strict descendant target returned valid relative directory
JSON but published `0.23.0` stripped each first component and printed `/`.
The formatter now preserves those paths and their requested base; focused
formatter/CLI tests and the existing live CLI smoke cover directory text.
Built CLI dev replay on 2026-09-29 verified all four descendant directories,
corpus-relative `agents/.../` directories, and Express `en/.../` directories.
Replaying the descendant's unchanged `_subagent_transformer/` browse action
then `_subagent_transformer/AsyncSubagentRunStream` read action returned
nonempty Markdown with that same deeper target. The later production checks
below verify the deployed corrected contract.

The MCP read-path parameter now states the same target-relative contract.
Focused schema tests and built-CLI dev replay cover the separate path argument.
A targeted descriptor intent eval used scoped search followed by an emitted
exact-URL read; it did not exercise the separate path argument.

Production validation on 2026-09-29 used the built CLI from PR #432 with
production presets and keychain authentication, removing inherited endpoint
and token overrides. `resolve` supplied queryable LangChain Python, Express,
and React site targets. Six equivalent shallow-selector/deep-target pairs
matched complete immediate inventories, text/silent paths, and header bases:

| Resolved site target | Shallow selectors tested | Entries at each depth |
| --- | --- | --- |
| `site:reference.langchain.com/python/langchain` | `agents/`, `agents/_subagent_transformer/` | 4, 3 |
| `site:expressjs.com` | `en/`, `en/3x/` | 11, 1 |
| `site:react.dev` | `reference/`, `reference/dev-tools/` | 7, 1 |

For each selector, the deeper form appended that scope to the site target and
omitted the list path. Emitted browse actions and page literals replayed
unchanged, and paired shallow/deep reads returned identical nonempty content.
All three landing reads passed, including React's exceptional exact-URL action.
The installed published `githits@0.23.0` still reproduced four `/` rows for the
LangChain `/agents` target against production. These results verify the PR
build against production; the CLI fix remains unpublished.

The text inventory preserves backend-authored PAGE read paths exactly. A
trailing slash normally marks a directory, but a PAGE also retains it when the
backend reports distinct slashless and slashful pages. In that exceptional
case the path remains directly readable and JSON `kind` distinguishes the
page from a directory.

## Key reference files

| File | Responsibility |
| --- | --- |
| `packages/core-internal/src/services/list-service.ts` | Backend transport contract, selection, validation, and list errors |
| `packages/mcp/src/shared/list-request.ts` | Shared request validation and normalization |
| `packages/mcp/src/shared/list-error-map.ts` | Mapping list errors into the shared envelope |
| `packages/mcp/src/shared/list-response.ts` | Allowlisted, null-preserving JSON projection |
| `packages/mcp/src/shared/list-text.ts` | Shared inventory, provenance and native follow-up rendering |
| `packages/mcp/src/tools/list.ts` | Stable MCP descriptor, schema, and adapter |
| `packages/mcp/src/client.ts` | Public service types and concrete client export |
| `packages/mcp/src/internal.ts` | Workspace-only exports for shared helpers |
| `pkgseer-backend/priv/graphql/schema.graphql` | Backend `Query.list` schema source |

## Dated provenance rollout prerequisite

Confirm production backend schema support for `TargetResolutionIdentity.committedAt`
before releasing clients or adopting the MCP package on the hosted server. This
applies to list text and JSON, including silent/default service calls: GraphQL
validates the complete query document before evaluating field directives. Dev
verification does not establish production support. No schema fallback, extra
metadata request or runtime enrichment was added.
