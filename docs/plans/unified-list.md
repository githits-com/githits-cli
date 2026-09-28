# Unified list client adoption

## Status and expected outcome

**Status: IN PROGRESS.** Phase 1A and Phase 1B merged in PR #421 at
`5e541604935f1d7bb030742e2602356b9ef1e88c` on 2026-09-28. PR #422
previously merged the CLI increment into its stacked base. Phase 2 has not
started; Phase 1 is complete.

The rebased Phase 1 branch passed 5,044 tests, typecheck, formatting, build,
149-step live CLI smoke, 65-step live MCP smoke, 36-step built CLI smoke, and
9-step built MCP registration smoke against production. Authenticated
package, repository, and site list/read follow-ups passed. Backend
PR #2817 merged as `518e45d301d0ba3f451ff56034551addc2bfc7fe` and its
`site:` target plus host-relative page path shape is deployed to production.
Live CLI replay passes for the Express site root, a normal page with and
without its trailing slash, and the same page through a nested site scope. The
client work is on `main`; package publication remains pending. The 0.23.0
release preparation includes Phase 1 CLI listing and shared site-page reads.
It does not claim Phase 2 MCP catalog consolidation or Phase 3 hosted adoption.

Replace the advertised MCP `code_files` and `docs_list` tools with one `list`
tool, and add the matching top-level `githits list` command. The new surface
browses exactly one package source tree, repository snapshot, or hosted
documentation site, follows familiar path/glob semantics, and paginates with
an opaque cursor. Compact text is a path inventory; lossless JSON retains
backend-authored actions that feed directly into `read` or another `list` call.

Package and repository inventories contain source files and documentation
files together. Hosted pages remain a separate inventory selected by an
explicit `site:` target. Content search remains the job of `search`; `list`
enumerates known inventory.

## Verified current state

### Backend contract

The target backend schema is PR #2817 commit
`d7837a6c2506395ce7a17ea0b9467b831e0bb0b0`, with full schema hash
`sha256:cbddb30fa7d08ac5af41799828767c607a704dc88880c33ae201e14c5d2cc672`.
Its `priv/graphql/CHANGELOG.md` entry records the matching
`sha256:cbddb30fa7d0` prefix. The already-deployed base contract adds:

```graphql
list(
  target: String!
  paths: [String!]
  recursive: Boolean
  fileTypes: [String!]
  languages: [String!]
  intents: [FileIntent!]
  limit: Int
  after: String
  waitTimeoutMs: Int
): ListResult!
```

`ListResult` identifies a `SOURCE` or `SITE` inventory, returns bounded
`FILE`, `PAGE`, and `DIRECTORY` entries, exposes source or site lifecycle
metadata, and supplies `hasMore` plus `nextCursor` without claiming a total.
Each entry contains exact nullable `read` and `browse` actions. The action
target/path/paths are authoritative; `ListEntry.path` is display identity and
must not be reconstructed into a locator.

The permanent backend documentation establishes these semantics:

- A package target covers the manifest-owned source tree at the served commit,
  excluding sibling and independently owned nested packages. It does not claim
  exact registry-artifact contents. A repository target covers the whole served
  snapshot. A site target covers one registered, authorized site owner and never
  discovers or creates a site.
- Omitted paths browse immediate roots. Literal paths and globs form a union.
  `*`, `?`, character classes, backslash escaping, and whole-component `**` are
  supported. Dot-prefixed paths are ordinary inventory entries.
- Source paths are package- or repository-relative. Site paths are logical,
  host-qualified paths such as `expressjs.com/en/5x/api/`; emitted browse paths
  are the safest selectors and must be replayed unchanged.
- Glob depth is independent of recursion. With recursion off, selected
  directories expose immediate children. With recursion on, selected
  directories expand to descendant leaves and no directory rows are emitted.
- Source-only `fileTypes`, `languages`, and `intents` filters run before
  hierarchy and pagination. Nonempty source filters are invalid for sites.
- The default page size is 100 and the maximum is 500. At most 1,000 nonempty
  path operands of at most 2,048 UTF-8 bytes each are accepted. Wait is
  0-300000 milliseconds and defaults to zero.
- Continuation requires the same target, paths, recursion, and source filters.
  Limit and wait may change. A changed selection, source snapshot, site
  membership, or emitted site metadata returns `VALIDATION_ERROR`; callers
  restart from page one.
- Source file reads are pinned to a repository commit and exact
  repository-relative path. Package directory browsing stays package-scoped
  and version-pinned; it is unavailable when the backend cannot form a
  versioned package target. Hosted PAGE actions use the requested `site:`
  target plus a host-relative path when that pair resolves the stored URL.
  `/` addresses the root. A single non-root trailing slash is omitted when no
  active slashless counterpart exists; distinct slash variants remain exact.
  Exceptional origins retain exact-URL actions.
- An unprepared source at zero wait returns its typed indexing error. Positive
  wait can return an `INDEXING` result with empty entries. Sites return active
  pages during refresh and report inventory, crawl, coverage, and preparation
  states separately.
- `SOURCE_INVENTORY_SCOPE_UNAVAILABLE` fails package scope closed and includes
  an explicit repository/commit alternative. `LIST_UNSUPPORTED_API` and
  `LIST_PAGE_TOO_LARGE` must not fall back to `listRepoFiles`.

Evidence:

- `~/proj/githits/pkgseer-backend/priv/graphql/schema.graphql`
- `~/proj/githits/pkgseer-backend/priv/graphql/CHANGELOG.md`
- `~/proj/githits/pkgseer-backend/graphql-docs/docs/list.md`
- `~/proj/githits/pkgseer-backend/docs/implementation/UNIFIED_LIST.md`

The site-read changelog section merged in backend PR #2817 and is the client
implementation contract. Authenticated live CLI conformance on
2026-09-26 verified that the hosted endpoint exposes the base `Query.list` for
package, repository, and site targets; the covered semantics and remaining
Phase 2 cases are recorded in `docs/implementation/unified-list.md`. On
2026-09-28, the production endpoint emitted the new logical PAGE actions and
accepted their `site:` target plus host-relative path for root, normal,
trailing-slash, and nested-scope reads.

### Current GitHits client surface

`code_files` calls `CodeNavigationService.listFiles` / `Query.listRepoFiles`.
It has sixteen MCP arguments, offset-like bounded results without a continuation
cursor, source-only output, and older path-prefix/selector/hidden semantics.
`docs_list` calls `PackageIntelligenceService.listPackageDocs`; it addresses a
package rather than an exact site and mixes hosted and repository-backed pages.
Its output does have cursor pagination.

The stable MCP catalog registers both tools in
`packages/mcp/src/mcp/server.ts`. `McpToolServices` currently injects
`CodeNavigationService`, `PackageIntelligenceService`, and the already unified
`ReadService`. CLI equivalents live at `githits code files` and
`githits docs list`; `githits read` demonstrates the intended migration pattern:
the compact top-level command uses a dedicated transport-neutral service while
legacy grouped commands remain on their legacy roots.

The current implementation and active documentation contain recovery hints,
quick-start routing, smoke assertions, catalog contracts, parity tests, and
agent workloads that name `code_files` or `docs_list`. Historical eval reports
remain historical evidence and are not rewritten.

The pre-change descriptor measurement at `175c15c` is 3,659 UTF-8 bytes for
`code_files`, 1,526 for `docs_list`, and 5,188 for their serialized pair
(`name`, description, input schema). This is a payload baseline, not a runtime
or token-latency claim.

## Scope and non-goals

Phases 1-2 include the transport service, shared
request/result/error/formatter layers, MCP tool, top-level CLI command, service
composition, migration of active guidance and recovery actions, tests, public
documentation, eval workloads, and release fragments.

It does not change backend inventory behavior, merge source and site storage,
discover documentation sites, add content search, redesign `code_grep`, remove
legacy CLI commands, deploy `pkgseer-backend` or `remote-mcp`, or publish a
release. It does not add a hidden-entry flag, prefix mode, client-side full
inventory scan, fallback to legacy GraphQL roots, fabricated total, or client
snapshot/cache infrastructure.

## Target contract

### Canonical surfaces

The MCP tool is named `list`. Its first description sentence is:

> List files or documentation pages in a package, repository, or site.

This sentence is under 80 characters and distinguishes enumeration from
content search. The MCP arguments map directly to `Query.list`:

| MCP argument | Backend argument | Contract |
| --- | --- | --- |
| `target` | `target` | Required compact package/repository target or explicit `site:` target |
| `paths` | `paths` | Optional literal/glob union; omitted or empty browses roots |
| `recursive` | `recursive` | Optional boolean; preserve explicit `false` |
| `file_types` | `fileTypes` | Optional source-only raw labels |
| `languages` | `languages` | Optional source-only raw labels |
| `intents` | `intents` | Optional source-only `FileIntent` values |
| `limit` | `limit` | Optional integer, 1-500 |
| `after` | `after` | Optional opaque cursor |
| `wait_timeout_ms` | `waitTimeoutMs` | Optional integer, 0-300000 |
| `format` | client-only | `text` by default; `json` for structured consumers |

Validation accepts empty arrays as omitted filters, rejects blank array
members, preserves explicit false values, and treats an empty cursor as
omitted. It enforces documented array/count/integer bounds before transport but
does not parse or rewrite emitted action values. Source filter names and values
remain visible in the schema instead of being encoded into path globs.

The CLI is:

```text
githits list <target> [paths...]
  -R, --recursive
  --file-type <type>   (repeatable)
  --language <name>    (repeatable)
  --intent <intent>    (repeatable)
  --limit <n>
  --after <cursor>
  --wait <ms>
  --json
```

Paths are variadic positional operands so calls read like `ls` while retaining
the backend's single `paths` union. Help tells shell users to quote globs.
CLI and MCP text use one compact path-only format. JSON uses the detailed
GraphQL projection and carries complete selected metadata, actions, and paging
state.
`--after` deliberately matches `Query.list` and the existing docs-list cursor
flag; `--wait <ms>` matches `githits read` and code navigation commands. This
command does not adopt the search commands' seconds unit or grep's `--cursor`
spelling.

Examples:

```text
githits list npm:express@5.2.1
githits list npm:express@5.2.1 lib/ -R
githits list github:expressjs/express@v5.2.1 '**/*.md'
githits list site:expressjs.com 'expressjs.com/en/5x/api/'
```

### Result and output behavior

One shared projection and formatter serve MCP and CLI. JSON preserves the
selected backend contract in camelCase: inventory identity, requested and
canonical targets, entries and exact actions, continuation, source resolution
and indexing fields, and site inventory/crawl/coverage/preparation fields.
Nullable fields stay nullable where absence is meaningful; no synthetic total
or reconstructed action is added.

Text output starts with `# source <canonical-target>` followed by one unquoted
path per line. When the backend has another page, the header adds
` | more results available`.
If no canonical target is available, the header uses the requested target.
CLI dims the header when color is enabled; MCP uses the same text without ANSI.
CLI `-s, --silent` omits the header and progress display so stdout contains
only path lines for piping; an empty inventory emits no bytes. JSON is
unchanged.
Source inventories add `follow up with "read <canonical-target> $path"` so a
returned file can be read without reconstructing its source identity.
Directory paths end in `/`; source files have no prefix. Paths escape
controls and backslashes so the line-oriented format stays unambiguous; quotes,
spaces, and ordinary Unicode remain literal. The text surface omits titles,
entry kinds, counts, per-entry commands, lifecycle diagnostics, and continuation
commands. For sites, compact projection includes exact `read.target` and
`read.path` values. The header reuses a shared site action target, and PAGE
rows render the corresponding host-relative path; `/` is the root. DIRECTORY
rows remain relative and end in `/`. A meaningful PAGE trailing slash is
preserved when the backend must distinguish coexisting slash variants.
Exceptional URL-only PAGE actions render their exact target. If logical PAGE
actions disagree on the site target, the header omits follow-up guidance.
The formatter never derives an action from a site display path. Callers that
need the opaque cursor, structured actions,
lifecycle, or metadata use JSON. This keeps one token-efficient text contract
for CLI and MCP.

### Errors and continuation

The client preserves backend error codes, retryability, and safe extension
metadata in the existing mapped-error envelope. List-specific recovery is:

- `SOURCE_INVENTORY_SCOPE_UNAVAILABLE`: show the backend repository/commit
  alternative from typed `extensions.repo_url` and `extensions.commit_sha`,
  while stating that accepting it broadens scope;
- `VALIDATION_ERROR` on a call with `after`: because the backend does not expose
  a cursor-specific reason, advise restarting once without `after` and, if the
  error recurs, correcting the request; without `after`, advise correcting the
  request;
- site `NOT_FOUND`: resolve/register an explicit site target;
- indexing: retry the same call with bounded wait or inspect the emitted
  progress reference; and
- `LIST_UNSUPPORTED_API` / `LIST_PAGE_TOO_LARGE`: report the producer
  incompatibility without legacy fallback.

Transport, HTTP, authentication, terms, client-update, and malformed-response
behavior follows existing core service conventions. Unknown codes remain
visible rather than being misclassified from message text.

The scope-unavailable alternative is the one sanctioned client-composed
locator: only when both extension values are nonempty strings, form
`<repo_url>@<commit_sha>`, which `Query.list` and `read` accept as a pinned
repository target. If either field is absent, preserve the backend error without
inventing an action. This does not generalize into reconstructing entry actions.

## Target architecture and ownership

`packages/core-internal` naturally owns a new `ListService` because `Query.list`
is transport-neutral and crosses source/site domains. It owns request/result
types, minimal GraphQL selection, runtime validation, transport, token refresh,
and a dedicated list error family. That family reuses shared auth, terms,
client-update, HTTP, and transport primitives while owning list-specific
GraphQL codes and extension fields; it does not classify the target into the
older code-navigation/package-intelligence error families. Putting it into
`CodeNavigationService` would be a
smaller edit but would make hosted-site inventory depend on a source-only
abstraction; that ownership is wrong.

`packages/mcp/src/shared` owns caller normalization, JSON projection, error
mapping, and the shared text formatter. `packages/mcp/src/tools/list.ts` owns
the MCP descriptor and handler. `src/commands/list.ts` owns Commander syntax
and terminal invocation. `src/container.ts` and `McpToolServices` inject the
service; hosts continue to own endpoint, token/header/fetch, diagnostics, and
request scope.

```mermaid
flowchart LR
  A[MCP list / githits list] --> B[shared request builder]
  B --> C[ListService]
  C --> D[backend Query.list]
  D --> C
  C --> E[shared result + error projection]
  E --> F[text formatter or JSON]
  F --> G[path inventory or structured follow-up]
```

`ListService` is exported by `packages/core-internal/src/index.ts`. Phase 2
exports it through the public `@githits/mcp/client` entrypoint and makes
`McpToolServices.listService` a required host integration field, following
`readService`. Its request has an internal compact/detailed projection choice.
The compact query fetches the base shared result: identity, entry kinds and
paths, cursor, and bounded lifecycle fields, including coverage reason and site
preparation. Site text also fetches exact read actions; source text does not.
The text formatter emits only the header and paths. JSON additionally selects
entry titles/browse actions, file metadata, full resolution, availability, and
indexing estimates through GraphQL `@include` variables. Response schemas
accept omitted detail fields.
Wire tests assert variables and selections for both projections, including that
neither fetches bodies, snippets, or section trees.

## Cross-cutting constraints

- **Compatibility:** remove `code_files` and `docs_list` from the advertised
  MCP catalog when `list` lands. Keep `githits code files` and
  `githits docs list` on their unchanged legacy services as compatibility
  cohorts, but add a concise deprecation pointer to `githits list` in their help
  text. Their execution behavior, scope, and pagination remain unchanged; they
  are not aliases for `githits list`.
- **Custom endpoints:** compact `list` requires `Query.list`. Do not silently
  call deprecated roots when the endpoint lacks it.
- **Migration/rollback:** the client package can be rolled back to restore the
  old advertised MCP catalog. Backend legacy roots remain intact. No data
  migration or feature flag is needed.
- **Security:** all surfaces remain read-only information tools. Treat external
  titles and paths as data, never commands. Preserve action strings exactly in
  structured output and quote them safely in terminal follow-ups. Never log
  cursors or user tokens through diagnostics beyond existing request metadata
  policy.
- **Performance:** the service requests only bounded metadata. Paging and
  filtering remain backend-owned; no client-side materialization is allowed.
  Descriptor bytes are measured before/after with the same serializer. Runtime
  optimization requires a demonstrated client regression; backend query
  performance is outside this repository.
- **Documentation:** create `docs/implementation/unified-list.md`; update active
  tool, CLI, parity, config, and annotation documentation. Update canonical
  skills/instructions through the plugin-maintenance workflow and regenerate
  generated assets. Historical observations stay unchanged.
- **Release impact:** each increment adds its own fragment. The CLI increment
  marks `githits: minor`, `@githits/mcp: none`; the MCP consolidation marks both
  artifacts `minor`, matching the unified-read precedent and the public surface
  changes. Release preparation can reassess only if the repository's 0.x policy
  changes before merge.

## Assumptions and unknowns

Overall assumptions:

- Backend PR #2817's committed SDL and permanent list/read documentation are
  the client contract for site actions.
- `Query.read` continues to accept the exact list actions preserved in JSON.
- Hosted MCP continues to consume the published `@githits/mcp` package and
  compose services per request.

Overall unknowns:

- Final released package versions and remote deployment timing are unknown and
  are chosen during authorized release/adoption work.

Open product decisions for Phases 1-3: **none**. The user chose one paths/glob
input, separate target inventories, combined files/docs within source targets,
and `ls`-like query ergonomics. The backend contract resolves glob,
hidden-path, recursion, filter, paging, action, and lifecycle details. Backend
PR #2817 resolves site addressing, including `/` for the root.

## Phase map

| Phase | Status | Outcome |
| --- | --- | --- |
| 1. Add the shared contract and CLI | **COMPLETE; PR #421 MERGED** | `githits list` browses the backend contract through the tested transport-neutral service and shared formatter. Backend #2817 production conformance and live site action replay pass. |
| 2. Consolidate the MCP surface | **PLANNED; merge dependency satisfied** | The advertised catalog contains `list` instead of `code_files` and `docs_list`, and agent guidance routes package/repository/site browsing and follow-up actions correctly. |
| 3. Release and hosted adoption | **PLANNED; authorization/deployment dependent** | Published CLI and hosted MCP expose the same unified list contract, and live list-to-read/list-to-list paths pass against the deployed backend. |

## Phase 1 detailed plan — shared contract and CLI

**Status:** COMPLETE; increments 1A and 1B merged through PR #421. Backend
PR #2817 is deployed to production and live site action replay passes.

**Expected outcome:** the root CLI implements the committed backend contract
through a transport-neutral `ListService`. `githits list` can browse all three
target kinds, continue pages, render a path-only text inventory, and preserve
exact read/browse actions in JSON. Existing
grouped CLI commands keep their legacy execution paths and point users toward
the new command.

**Assumptions:** backend PR #2817's SDL is stable for this increment; existing
endpoint, token refresh, headers, diagnostics, error envelopes, and formatter
conventions remain reusable.

**Unknowns or product decisions:** none.

**Dependencies:** backend PR #2817 with schema hash
`sha256:cbddb30fa7d0`; current unified `read` implementation.

**Delivery split:** implementation reached about 1,700 changed non-test lines
after the transport and shared-contract work, before CLI wiring. Per the
repository size rule and the split point below, Phase 1 is delivered as two
stacked review increments: **1A** owns the private core transport plus shared
request/result/error/formatter contract; **1B** owns the top-level CLI,
container/help/smoke integration, user-facing documentation, and release
fragment. This is a review boundary only: Phase 1 is complete only after both
increments pass their acceptance checks and merge.

### Ordered implementation

1. **Increment 1A:** add `packages/core-internal/src/services/list-service.ts` with explicit
   request/result/action/lifecycle interfaces, Zod response validation, the
   conditional compact/detailed `Query.list` document, variable omission rules,
   token refresh, diagnostics, and typed transport/HTTP/GraphQL/malformed
   errors. Model `SOURCE_INVENTORY_SCOPE_UNAVAILABLE` extension `repo_url` and
   `commit_sha` as optional typed recovery fields. Define a list-specific error
   family that reuses existing common service primitives. Reuse
   existing navigation selection fragments only for fields consumed by list
   output/recovery. Export it from the private core index for root CLI use.
2. **Increment 1A:** add shared list modules under `packages/mcp/src/shared/` for request
   validation, result projection, mapped errors/recovery actions, and text
   formatting, and export those CLI-facing helpers through the workspace-only
   `packages/mcp/src/internal.ts` (`@githits/mcp/internal`) boundary. Cover
   explicit false, empty arrays/cursors, UTF-8 path byte bounds, action
   preservation, nullable package canonical/browse values,
   the sanctioned pinned `repo_url@commit_sha` alternative only when both
   values exist, cursor/request validation guidance based on presence of
   `after`, and a shared path-only text format without branching on backend
   message text.
3. **Increment 1B:** add `src/commands/list.ts`, export/register it eagerly, construct
   `ListService` in both container auth paths, and use the shared formatter.
   Add deprecation pointers to the old grouped command help while leaving their
   actions, services, flags, and output untouched. `code files` points to
   `githits list`; `docs list` states that hosted-page browsing now requires
   `githits list site:<host[/path]>`, while package-local documentation files
   remain available from the package target.
4. **Across 1A and 1B:** add focused core-service, shared-builder/formatter/error, CLI action,
   container, registration, and CLI smoke coverage. Admit emitted site target
   plus page path actions through the existing unified CLI and MCP read adapters.
   Start
   `docs/implementation/unified-list.md`, update the active CLI/tools/config
   documentation, and add a `githits: minor`, `@githits/mcp: minor` fragment.

### Required Phase 1 coverage

- Wire tests prove literal/glob path arrays, ordered unions, explicit
  `recursive: false`, source filters, `after`, and bounds pass through exactly;
  empty arrays/cursors are omitted. They do not re-test backend matching.
- Package, repository, and site response fixtures prove projection of exact
  read/browse actions, nullable canonical/browse values, and simultaneous
  landing-page actions. Text fixtures prove path-only rendering of
  package-relative source paths, backend-authored host-relative site read
  paths, exceptional URL actions, and relative site directories. They do not
  claim to prove backend scope or hierarchy.
- Pagination projection requires a nonempty cursor with `hasMore: true`, never
  infers a total, and preserves opaque cursor bytes. Any `VALIDATION_ERROR` on a
  request with `after` renders the two-step restart/correct guidance; the same
  code without `after` renders input-correction guidance.
- Source `INDEXING` empty results and site EMPTY/PARTIAL/CAPPED/RUNNING/FAILED
  combinations remain distinguishable. Scope-unavailable and unsupported API
  errors never invoke legacy list services. Scope-unavailable forms the exact
  `<repo_url>@<commit_sha>` alternative only when both typed extensions exist;
  missing-field fixtures retain the backend message without an action.
- Text and JSON preserve Unicode and encoded paths; text escapes line-breaking
  and terminal control characters and appends `/` to directory rows.
- GraphQL wire tests assert exact variables and selected fields for compact and
  detailed projections across target/lifecycle fixtures and prove
  bodies/content are absent.

### Verification and acceptance

Run the affected tests during development, then complete:

```text
bun test
bun run typecheck
bun run build
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

The CLI smoke suites remain useful unauthenticated by verifying auth handling.
Phase 1 is accepted when these checks pass; `githits list` text and JSON match
the shared contract; exact JSON actions and all error/lifecycle shapes work in
fixtures; legacy grouped command execution remains covered; and implementation
code stays below the repository threshold. If implementation approaches 2,000
changed non-test/documentation lines, stop and split core service/request
projection from CLI/formatter wiring rather than adding mechanism.

The 2026-09-28 descriptor-only `docs-fragment-read` eval completed with both
Codex and Claude. In neutral discovery both answered without tools. With the
GitHits intent profile, both used `read` and returned the requested section;
Claude also exercised the new `site:` target plus page-path shape while
recovering from a Flask site target that the dev backend did not recognize.
No isolation violations were reported.

## Phase 2 detailed plan — consolidate the MCP surface

**Status:** PLANNED; PR #421 has merged to `main`, satisfying the recorded
merge dependency. Reorient before implementation. No further product decision
is recorded.

**Expected outcome:** stdio MCP and the public MCP package advertise one `list`
tool in place of `code_files` and `docs_list`. Its request, output, errors, and
path-only text remain identical to the Phase 1 shared contract. Quick-start and
public skills teach package/repository browsing, explicit site browsing, and
package-to-site discovery.

**Assumptions:** Phase 1's service/formatter API remains adequate; lossless JSON
is the follow-up surface for exact actions and opaque cursors; the hosted
endpoint continues to implement the verified SDL; docs search can expose
related explicit `site:` targets, while locally enabled `resolve_target`
remains an additional route for fuzzy or natural names.

**Unknowns or product decisions:** none. Base endpoint availability was verified
on 2026-09-26; the deployed #2817 site-read shape passed Phase 1 live replay on
2026-09-28. No product decision is open.

**Dependencies:** Phase 1 merged; the plugin-maintenance workflow for public
guidance.

### Ordered implementation

1. Export `ListService` types/implementation through `@githits/mcp/client`, add
   required `McpToolServices.listService`, descriptor mocks, request-scoped host
   contract coverage, and outside-root public-package validation.
2. Add `packages/mcp/src/tools/list.ts` with the reviewed ten-argument schema
   and read-only annotations. Replace `code_files`/`docs_list` factories in the
   stable catalog. Lock the first sentence and first 80 raw characters.
3. Update canonical MCP recovery hints from `code_files` to `list` while
   retaining CLI-native legacy rewrites. Replace the two quick-start rows with
   one list row. State that a package/repository lists its own source tree,
   while hosted docs require an explicit `site:`. Teach callers to search a
   package's docs and reuse an emitted site target before browsing; update the
   local experimental `resolve_target` guidance to send selected sites to
   `list` as well as `search`.
4. Update `packages/mcp/src/mcp/instructions.ts` and
   `skills/githits-mcp/SKILL.md` together, then update the canonical
   `githits-code` skill/reference and implementation docs. Run the plugin
   generator/checker. Reconcile Phase 4 of
   `docs/plans/mcp-tool-surface-simplification.md` so it does not independently
   expand `code_files`.
5. Update catalog, local server, public surface, parity, smoke, and package
   tests. Add agent workloads for package/repository enumeration, recursion
   versus `**`, exact-site browse/read, continuation, and package docs search ->
   emitted explicit site -> site listing. Cover the enabled `resolve_target` ->
   site-list route in its focused guidance tests. Add a separate `minor`
   fragment for both public artifacts.

### Verification and acceptance

Run Phase 1's full deterministic commands plus:

```text
bun run plugins:generate
bun run plugins:check
bun run validate:packages
bun run smoke:mcp
bun run smoke:mcp:built
```

Measure the replacement descriptor and stable catalog with the same serializer
as the 5,188-byte baseline; report bytes without claiming model-token or latency
improvement. Run targeted descriptor-only `bun run agent:e2e` workloads named
above with Claude and Codex where practical. Inspect `tool-calls.json`,
`final.json`, `metrics.json`, and `isolation-violations.json`; harness completion
alone is not quality evidence.

Backend semantic conformance was established with authenticated CLI calls on
2026-09-26: literals, all supported glob forms, union/deduplication, recursion
on selected directories, source filters before hierarchy, package boundary
isolation, dot-prefixed source paths, host-qualified site inventory paths,
continuation, and the earlier URL-based list-to-read actions all passed. Client
unit tests assert only wire replay and projection. Phase 1 repeated site action
replay after #2817 deployed because that schema behavior changed. Phase 2 uses
the same endpoint to verify the MCP projection and agent routing, and repeats
other backend cases only if the schema or endpoint changes.

Phase 2 is accepted when deterministic and targeted live/eval checks pass; the
catalog advertises `list` and no longer advertises `code_files`/`docs_list`;
active recovery/guidance names the canonical tool and package-to-site route;
public exports and request-scoped host construction validate outside root
aliases; and docs, skills, generated assets, and release fragment match the
final surface. If the increment approaches the implementation-size threshold,
split public service/provider wiring from catalog/guidance adoption.

## Phase 3 — release and hosted adoption

**Status:** PLANNED; requires phase-boundary reorientation and separate
release/deployment authorization.

**Expected outcome:** published `githits` and `@githits/mcp`, then `remote-mcp`,
serve the same unified list contract against the hosted backend.

**Assumptions:** remote MCP still composes the published public client API per
request; the backend deploy contains the verified SDL or a compatible successor.

**Unknowns or product decisions:** exact package versions, deployment order/date,
and whether endpoint evidence requires a compatible client adjustment. Resolve
these after Phase 2 merges and before release preparation. No product behavior
is intentionally deferred.

**Dependencies:** Phases 1-2 merged; `Query.list` deployed; explicit
authorization for release, remote dependency update, and deployment at each
protected step.

**Acceptance criteria:** outside-workspace packed CLI and public MCP imports
construct `ListService`; published CLI and hosted MCP catalogs expose `list`;
live package, repository, and site list calls continue and follow emitted
read/browse actions; source indexing and site lifecycle behavior match the
documented contract; no hosted fallback reaches deprecated roots; and release
and permanent implementation documentation record actual versions and rollout
evidence. Tactical steps are added after Phase 2 reorientation.

## Phase boundaries and completion

After each increment merges, run `$next-steps` against current `origin/main`,
the backend schema/endpoint, and relevant package/remote host state. Update the
next phase assumptions and detail only then. Do not continue from this plan if
that check reports `REPLAN` or `PRODUCT INPUT NEEDED`.

The effort is complete when Phase 3 acceptance passes and permanent
documentation contains the final contract, architecture, compatibility policy,
and rollout evidence. Keep this plan through the last implementation review;
then transfer any remaining durable facts to `docs/implementation/` and delete
the plan after the final increment merges.

## Review history

Internal review found and closed compact/detailed selection over-fetch,
scope-alternative typing, and the missing workspace-internal shared-helper
export. External Claude review ran two rounds. Round 1 raised six accepted
contract/readiness findings: validation-error ambiguity, pinned scope target
construction, client-versus-backend test ownership, list error ownership,
package-to-site discovery, and compatibility/size wording. The plan now uses a
safe two-step cursor recovery, typed optional `repo_url@commit_sha`, separate
client/live evidence, a dedicated error family, explicit discovery guidance,
and two implementation increments. Round 2 was clean after three wording fixes
covering Phase 2 public exports, the legacy docs-list pointer, and this history.
No finding was rejected and no test was run for the plan-only change.
