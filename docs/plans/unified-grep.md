# Unified grep client adoption

## Status and outcome

**Status: IN PROGRESS.** Phase 1 implementation is authorized via `$orchestrate`.
The requested sequence is two increments: introduce the top-level
CLI command first, then replace the advertised MCP `code_grep` tool.

When complete, `githits grep` and MCP `grep` execute one backend `Query.grep`
page over ordered package, repository, and explicit site targets. Their shared
output preserves exact read actions, continuation, per-scope readiness and
traversal, and unavailable selected package docs. Existing `githits code grep`
remains a compatibility command with its original single-source controls.

Overall assumptions: “top level” means CLI first, following the existing
`githits list` rollout. Package targets include selected hosted docs as the
backend specifies. Removing MCP `code_grep` in Phase 2 is explicitly requested;
retaining its CLI counterpart follows unified read/list compatibility policy.
**User-confirmed 2026-09-28:** mirror normal grep/rg where supported. Both new
surfaces default to RE2 regex, case-sensitive matching and zero context, with
explicit literal/case-insensitive/context opt-ins. CLI uses familiar flag
spellings, and source targets default to `ALL` repository corpus (indexed
source and documentation), with explicit corpus narrowing. The retained legacy
CLI keeps its existing defaults and controls
for compatibility. Backend case-sensitive support was verified from the schema,
`Grep.Request`, regex-validation forwarding and `MULTI_GREP` wire encoding;
fresh matching conformance is a Phase 1 acceptance check.
Overall product decisions: none blocking the proposed design. The CLI argument
order and whole-target convenience below are design proposals, not previously
user-confirmed preferences. Production grep conformance is verified below;
that does not change backend deployment or publication authorization.
Dependencies: the checked-in backend contract, existing auth/transport helpers,
and Phase 1 before Phase 2. Completion criteria: both phases merged, their
surface-specific validation passing, and durable docs updated. Hosted adoption
is tracked separately from package/client completion.

## Verified evidence

Inspected on 2026-09-28 from client commit
`1739290b03ebcb8dee920f536c30f9ac1e0145e8` and backend checkout commit
`518e45d301d0ba3f451ff56034551addc2bfc7fe`. The schema file's SHA-256 is
`cbddb30fa7d08ac5af41799828767c607a704dc88880c33ae201e14c5d2cc672`.

Canonical local evidence:

- `~/proj/githits/pkgseer-backend/priv/graphql/schema.graphql`, `Query.grep`
  and `Grep*` definitions; its `CHANGELOG.md` records unified grep under
  Unreleased.
- Backend `lib/pkg_seer/grep/request.ex`, `lib/pkg_seer/grep.ex`, and
  `lib/pkg_seer/grep/preparation.ex` verify defaults, site-option rejection,
  scope/status indexing, terminal omissions, and error extensions.
- Backend `docs/plans/UNIFIED_GREP_GRAPHQL.md` records deployed-dev mixed-hit,
  pagination, deduplication, no-docs omission, and read-action replay evidence.
  Its deployment status says production still selects v5. This is recorded
  backend evidence, not a fresh client-side production probe.
- Client `docs/implementation/unified-read.md`,
  `docs/implementation/unified-list.md`, and `docs/plans/unified-list.md`
  establish the CLI-first service/shared-helper/MCP migration pattern. MCP
  `list` adoption remains a separate pending increment; grep must not assume it
  has merged or migrate list in this work.
- `src/commands/code/grep.ts`, `packages/mcp/src/tools/grep-repo.ts`, and
  `packages/mcp/src/shared/grep-repo-{request,response,text}.ts` own legacy grep.
  It calls `CodeNavigationService.grepRepo`, not unified `Query.grep`.
- `packages/mcp/src/tools/tool-services.ts` requires `ReadService` but has no
  unified grep service. `src/container.ts` already composes read/list services
  in both authenticated and unauthenticated paths.

The existing formatter was executed with a one-hit fixture: a summary, one file
heading, and `19: var Router = require("router");`. Preserve that concise match
presentation. The current full `code_grep` descriptor from
`getMcpToolDescriptors()` serializes to **7,161 UTF-8 bytes**. That is a
descriptor-size baseline, not a runtime performance or model-token measurement.

Verified contradiction: legacy `GREP_REPO_PATTERN_NOTE` describes ASCII-only
case folding, while the current backend `grepRepo.caseSensitive` schema
documents Unicode-aware folding. New guidance must use the backend contract.
The retained CLI help also says “Enable ASCII case-sensitive matching” in
`src/commands/code/grep.ts`. Phase 2 corrects both strings alongside guidance migration
(therefore both artifacts' documented surfaces change). This design-only
increment changes no production tool descriptions.

### Backend contract

`grep(targets:, pattern:, patternType:, caseSensitive:, contextLinesBefore:,
contextLinesAfter:, maxMatches:, cursor:, waitTimeoutMs:)` returns `GrepResult`.

| Contract | Verified behavior |
| --- | --- |
| Caller targets | 1–20 ordered objects, each with compact `target`; expanded scopes are capped at eight repositories and eight sites by the backend |
| Source controls | Per-target `corpus` (`SOURCE`, `DOCUMENTATION`, `ALL`), typed `pathSelectors` (`EXACT`, `PREFIX`, `GLOB`), and `allowUnscoped` |
| Site controls | Scope lives in `site:host[/scope]`; setting any repository-only field, even `allowUnscoped: false`, is invalid |
| Corpus and package expansion | Backend default `SOURCE` selects repository source files; new client explicitly defaults repository corpus to `ALL`; selected hosted package docs are added independently of corpus and source selectors |
| Selectors | OR within a source target; package-relative or repository-relative; package subpath is applied by the backend; explicit site targets never use these selectors |
| Pattern | Backend literal default or RE2; 1–200 UTF-8 bytes, valid Unicode, no NUL; preserve whitespace patterns; default case-insensitive matching is Unicode-aware |
| Defaults | Backend literal pattern, case-insensitive, two context lines per side, 100 matches per page, zero wait; the new client explicitly sends REGEX, caseSensitive true and zero context, omitting absent page/wait controls |
| Bounds | Context 0–10 per side; matches 1–1000 globally; wait 0–300000 ms |
| Continuation | Opaque base64url cursor; replay identical ordered targets and search controls; continuation performs no waiting or work admission |
| Hits | Repository/site union, physical scope `targetIndex`, bounded line/context slices, display/physical byte coordinates, content safety, exact `read` action |
| Scope statuses | `targetIndex`, original `requestedInputIndices`, readiness, traversal, retryability, safe message, requested/served identity, scan/skip counts and file issues |
| Omissions | Terminal selected package-doc omissions accompany source hits in `unavailableTargets`; other unready scopes fail preparation before dispatch |
| Coverage | `COMPLETE`, `RESUMABLE_LIMIT`, `NON_RESUMABLE_PARTIAL`, `FAILED`, or `CURSOR_EXPIRED`; a null cursor alone never proves completeness |

A hit's `targetIndex` indexes a dispatched physical scope, not the caller's
target list. Backend expansion and deduplication can map one input to several
scopes and several inputs to one scope. Preserve `requestedInputIndices` and
producer order; do not expand, deduplicate, sort, or merge target identities in
the client.

Repository read actions contain the exact snapshot target, repository-root
`path`, and line bounds. A displayed package-relative `filePath` is not that
path. Site actions contain the exact persisted page URL and bounds; they open
current active hosted content, without a historical snapshot guarantee. Replay
each backend action unchanged; do not construct one from display coordinates.

## Scope and compatibility

Include the new service, shared request/error/result/text helpers, top-level
CLI command, later MCP adapter/provider exports, active guidance/recovery
migration, tests, smoke coverage, targeted agent evals, docs, and per-phase
release fragments. No backend edits, deployment, publication, client target
preparation, retries, polling, pagination loops, or new infrastructure.

Unified grep does not expose legacy `extensions`, `exclude_doc_files`,
`exclude_test_files`, `max_matches_per_file`, or `symbol_fields`. Do not
simulate these with post-filtering: that would change page membership, limits,
and coverage. `corpus` is not an equivalent documentation exclusion control;
it also does not remove hosted package docs. Regex limitations remain backend
owned. `search` retains ranked/conceptual discovery; `list` retains inventory.

Phase 1 leaves the MCP catalog and legacy CLI execution unchanged. Phase 2
removes advertised MCP `code_grep` without an alias or legacy-root fallback.
Callers needing removed source controls can continue using `githits code grep`.
Document this capability change alongside the new mixed-source behavior.
Do not remove legacy helper modules needed by that CLI command.
The default preparation wait changes from legacy grep's 30 seconds to zero,
following unified list. A cold target now returns
`GREP_TARGET_PREPARATION_REQUIRED` unless the caller supplies `--wait` or
`wait_timeout_ms`; migration guidance must state this explicitly. Other changed
defaults are case-sensitive matching (legacy insensitive) and 100 matches
(legacy 50); zero context agrees with legacy grep, while overriding the new
backend's two-line default. Context above ten is rejected rather than clamped.
The new grep defaults to RE2 instead of the legacy literal mode. Metacharacters
therefore change meaning, and malformed regexes return their typed errors.
Literal migration uses CLI `-F/--fixed-strings` or MCP `pattern_type: literal`.
Do not retry an invalid or unsupported regex as a literal. Multi-file regexes
need the backend's usable literal anchor; broad patterns such as `.*` cannot be
advertised as unrestricted scans. An exact-file scope can support patterns
that the content-index route cannot. Help and errors must explain these
boundaries without claiming full ripgrep regex compatibility.
Its default source corpus is `ALL`, covering indexed repository source and
documentation files together, closer to ordinary grep/rg text search than the
backend's source-only default. Explicit `corpus: source` or `documentation`
narrows repository files; neither controls package-selected hosted docs.

## Target architecture and ownership

**Core owns the backend contract:** add
`packages/core-internal/src/services/grep-service.ts` with `GrepService`,
`GrepServiceImpl`, request/result types, GraphQL selection, Zod validation, and
grep-specific errors. Reuse `postPkgseerGraphql`, `executeWithTokenRefresh`,
existing timeout/terms/client-update conventions, injected `TokenProvider`,
fetch, client headers and `ServiceDiagnostics`. The service makes one grep
request per page apart from existing auth refresh. It discovers no diagnostics
environment or output destination and validates network settings only on use.
Extending `CodeNavigationService.grepRepo` would make a legacy source-only
contract own mixed site semantics; a separate narrow service follows list/read.

**Shared MCP helpers own surface semantics:** add `grep-request.ts`,
`grep-error-map.ts`, `grep-response.ts`, and `grep-text.ts` under
`packages/mcp/src/shared/`. CLI and MCP must use the same input builder,
allowlisted result projection, mapped errors, and formatter. This is the
existing cross-surface boundary; root CLI helpers would be unavailable to the
public MCP package. Do not introduce a generic unified-operation framework.

**Adapters own invocation only:** root CLI owns Commander flags, auth entry,
spinner, process output and exit status. MCP owns its Zod schema, cancellation
and tool result envelope. Phase 1 injects the new service through root
`src/container.ts`; Phase 2 adds required `grepService` to `McpToolServices`
and the request-scoped provider seam. Publish stable service/types/implementation
through `@githits/mcp/client` and public provider-facing types through
`@githits/mcp`. Keep root helper exports workspace-only via `internal.ts`.
Never expose private package imports or filesystem dependencies in artifacts.

Data flow: CLI flags or MCP arguments → shared request builder → `GrepService`
→ one `Query.grep` page → validated discriminated result → shared projector
→ shared text or JSON → surface output. There is no read/hydration per hit.

### Proposed caller surfaces

CLI:

```sh
githits grep 'router' npm:express
githits grep 'require' github:expressjs/express --path lib/express.js
githits grep 'middleware' hex:plug@1.18.1 site:hexdocs.pm/plug
```

Use `grep <pattern> <targets...>`: grep convention keeps one pattern before
an ordered list of scopes. Shell quoting owns regex/glob protection. Support
`-F/--fixed-strings` for literal mode, `-i/--ignore-case`,
`-s/--case-sensitive`, repeatable `--path`,
`--path-prefix`, and `--glob`, `--corpus source|documentation|all`,
`-B/--before-context`, `-A/--after-context`, `-C/--context`, `--limit`,
`--cursor`, `--wait`, and `--json`. Reuse established legacy grep flags so
users need no new vocabulary for equivalent controls. CLI context normalization
uses the explicit side value, else symmetric context, else zero. The shared
builder sends the two resolved values explicitly. Validate all supplied context
values as 0–10, without legacy clamping. The MCP schema keeps its two independent
side controls and does not gain symmetric-context/override mechanics.
The legacy `--regex` flag is unnecessary on the new command because regex is
the user-requested default; `-F` follows familiar grep literal-mode spelling.
When case flags are repeated or combined, the last `-i`/`-s` wins, following
rg. The case-sensitive `-s/--case-sensitive` spelling specifically follows rg;
grep's `-s` instead suppresses error messages, so no grep equivalence is claimed
for that flag. Short options are command-scoped: existing `list -s` means
silent and `pkg vulns -s` means severity. Accept the grep-specific meaning here
for rg compatibility; the parser never shares these command options.
`--limit` remains a global page cap: do not alias it as
`-m/--max-count`, which grep/rg define per file. Native regex syntax and scope
limits are documented differences, not claims of complete grep/rg parity.
Omitted case controls resolve to backend `caseSensitive: true`; `-i` or MCP
`ignore_case: true` resolves to false. MCP `ignore_case: false` preserves the
default. The shared caller input is `ignoreCase`, with one inversion when
building backend `GrepParams`; do not expose a second MCP case boolean.
Document `--` before a leading-dash pattern, for example
`githits grep -- '--foo' github:example/repo`; add a CLI regression case.

| Default or convention | New CLI and MCP behavior | Reason for any departure |
| --- | --- | --- |
| Pattern mode | Regex; explicit literal opt-in | RE2 is backend-supported; grep BRE and PCRE modes cannot be promised |
| Case and context | Case sensitive, zero context | Matches grep/rg; explicitly override backend defaults |
| Repository text corpus | `ALL`, source plus documentation; optional narrowing | Matches ordinary text search within the available index |
| Results per page | 100 by default, 1–1000; `--limit`, resumable cursor | Remote response bound; `-m` would falsely imply a per-file limit |
| Context ceiling | 10 lines per side | Backend contract; larger windows use exact `read` actions |
| Readiness wait | Zero; explicit `--wait` | Existing index/preparation boundary; no hidden retry or polling |
| Output | Numbered source/context lines with coverage summary and exact read actions | Remote provenance and partial coverage must remain visible |
| Search scope | Supplied indexed targets, with selected package docs | Backend target/authority contract; no local file, unindexed, hidden-file or ignore-policy parity claim |

The CLI's source flags apply uniformly to every package/repository operand.
Site operands retain their own target scope and receive no repository fields.
Explicit source flags with only site operands are an input error. Help must
state that source flags do not narrow selected hosted package docs. Different
source selectors per input are supported in the shared request model and MCP,
not by a second JSON argument syntax in this first CLI increment.

Proposed MCP arguments:

```json
{
  "targets": [
    {"target": "npm:express", "path_selectors": [{"kind": "exact", "value": "lib/express.js"}]},
    {"target": "site:expressjs.com/en/5x"}
  ],
  "pattern": "router",
  "pattern_type": "regex",
  "ignore_case": false,
  "context_lines_before": 0,
  "context_lines_after": 0,
  "max_matches": 100,
  "format": "text"
}
```

`targets` is a required array of objects with required `target`, optional
`corpus`, and optional `path_selectors` of `{kind: exact|prefix|glob, value}`.
An omitted source `corpus` resolves to `all`; explicit sites have no corpus
field at all. The builder sends the resolved source enum, without changing
target identity or performing client-side file classification.
Pattern is required. Other top-level options are optional `pattern_type`,
`ignore_case`, `context_lines_before`, `context_lines_after`, `max_matches`,
`cursor`, `wait_timeout_ms`, and `format: text|json` (text default).
Omitting `pattern_type` selects regex, `ignore_case` selects false, and either
context side selects zero. The shared request builder owns these
user-facing defaults and resolves required `GrepParams.patternType`,
`caseSensitive`, `contextLinesBefore` and `contextLinesAfter`; the service
always sends these controls, so differing backend defaults cannot change the
new tool's meaning. Explicit `pattern_type: literal`, `ignore_case: true`, and
nonzero context remain independent options. The negative case-control name
avoids an agent-facing default-true boolean. Descriptor and CLI help state
all three defaults and their opt-ins.
Avoid string/object unions, top-level source filters, and coupled booleans.

Whole-target grep remains convenient as in current `code_grep`: the builder
sends `allowUnscoped: true` for source targets, including explicit selectors.
This permits match-all globs without introducing an exposed default-true flag;
it does not remove or widen selectors or package boundaries. Never send it,
including false, for sites. This is an explicit design choice: a grep request
already expresses the intention to search the supplied scopes. Backend
authority, corpus validation and native limits remain authoritative.

### Validation and output contracts

Preserve ordered target/selector values and nonempty cursor bytes; do not parse
package/provider refs to reconstruct them. Validate empty target arrays,
blank targets, invalid Unicode/NUL patterns, byte/count/integer bounds,
blank selector entries, and repository fields on explicit sites. A whitespace
literal pattern is valid. Empty optional selector arrays mean omitted; a blank
optional cursor means page one. Preserve `false`, zero context/wait, and nullable
response fields. Do not clamp context above ten. Native expansion, site
authority, package boundaries, selector matching and cursor decoding stay in
the backend. Unknown hit union branches or malformed selected fields are
service errors, never empty results.
Normalize empty selector arrays to absence before validating site fields;
nonempty site selectors and any explicit site corpus are invalid. Send neither
the source corpus default nor `allowUnscoped` for a site.

JSON retains every selected backend field under its camelCase name, including
`__typename`, nulls, line slices, both offset coordinate systems, read actions,
statuses, file issues, omitted issue counts, omissions and cursor. Do not copy
legacy `hasMore`, filter echoes, unique-file counts, or a global-total fiction.

Text leads with page match count and traversal, then concise scope status and
match blocks. Group only consecutive compatible hits by physical scope and
locator, preserving producer order. Reuse numbered `line: content` matches,
`line- content` context, and visible slice omission markers. Escape terminal
controls and locator backslashes; preserve backend Unicode. Keep prose wrapped
to caller width, source lines intact, formatter punctuation ASCII, and meaning
independent of color. CLI and MCP use the same formatter with color/width inputs.
No new highlight-offset processing is needed in compact text.

Each block carries its backend-authored read target/path and line action(s);
identical actions may be printed once. Show warnings for stale/failed/unready
scopes, skipped/issue-bearing files, safety normalization, and unavailable docs
even when hits are empty. Say “No matches” with exhaustive meaning only for
complete traversal and no omissions, scope failures, skipped or issue-bearing
content; otherwise report zero
returned matches with the coverage reason. A nonempty cursor is emitted with
an instruction to replay the same ordered targets and controls. A partial page
may have a cursor as well as omissions: show both. Cursor expiry requires an
explicit caller restart; never auto-retry or discard successful sibling hits.

Minimal fetching is part of this contract:

| Selection | Compact text | JSON detail |
| --- | --- | --- |
| Result traversal, cursor, page count; scope indexing, input mapping, readiness/traversal/errors/retryability; omissions including progress/suggested scopes | Required | Required |
| Hit kind, scope index, repository display path or page URL, line, complete line/context slice fields, exact read action; safety `filtered` | Required | Required |
| Scope target/requested ref/served commit/corpus; scan/skip counts; file issue path/code/line, issue safety `filtered`, and omitted count | Required for provenance and coverage notes | Required |
| Duplicate hit `lineContent`, hit repo URL/commit/repository path; display/physical match offsets; hit/issue safety modifications; issue `lineBytes` and match byte coordinates; scope repo URL/canonical site/URL prefixes | Omitted | Required |

Use one document with `includeDetailedFields` directives (or equivalent
separate selections if simpler), model excluded fields as absent and selected
nullables as null. Detailed `contentSafety` selects `filtered` and
`modifications`; `modifications` is an enum list with no subfields.
Do not request redundant text or offsets just because the legacy query did.
Test actual document/variables and omitted selections; formatter mocks alone
cannot prove this. The text formatter uses slice `content` directly.

Map whole-request errors through the existing `MappedError` envelope while
preserving bounded public GraphQL extensions. Specifically retain
`GREP_TARGET_PREPARATION_REQUIRED.target_issues`, input indices, retryability,
reasons and progress references; source/file recovery must use its matching
target and path. Keep `GREP_CURSOR_INVALID`, service/protocol errors, auth,
terms, required-client-update, timeout, HTTP and malformed-response distinct.
Do not parse public messages for routing or convert successful partial results
into whole-request failures. No legacy-root schema fallback. CLI exits zero
for valid complete or partial result pages, including zero hits, and nonzero
for request/service failures; coverage is explicit in text/JSON. This follows
the existing CLI's successful-empty-result convention.

## Ordered phases

### Phase 1 — top-level CLI mixed grep (COMPLETE; PENDING MERGE)

Implementation checkpoint after the backend small-page correction and production verification (2026-09-29):

- Core query/types/runtime validation, shared request/projection/error/text,
  root command and both auth branches are implemented. Projection reuses the
  core wire allowlist. No MCP catalog/public-provider or legacy CLI changes.
- Backend PR #2832 is merged; dev includes the fix in
  `c7389fe5a2f3489902c5b8a2c20014093f6960f3`. The updated schema at
  `~/proj/githits/pkgseer-backend/priv/graphql/schema.graphql` documents
  `UNSPECIFIED`: a scope not visited before the page limit, retained with
  `RESUMABLE_LIMIT` traversal and original input attribution. The user confirmed
  production deployment on 2026-09-29; fresh production client replay passes
  the exact source repro, mixed two-page CLI continuation and compact/detailed
  service pages, retaining both scopes and source/site hits.
- Captured complete detailed package/mixed first pages reproduced the CLI's
  missing-enum parser failure, while their CURRENT continuation pages passed.
  The exact live CLI repro also reached dev and failed at this parser.
  Compact and detailed one-match parser regressions failed before the fix.
- The core type/Zod enum now explicitly accepts `UNSPECIFIED`; unknown
  readiness and other malformed fields remain rejected. All eight complete
  captured detailed pages parse with deep equality, preserving every selected
  status, attribution, hit, traversal and cursor. The four backend-only compact
  captures omit the CLI's required slices/read/status fields and are not client
  parser fixtures; fresh client compact-query replay provides that proof.
- Text explains an unvisited scope and retains continuation; JSON keeps the
  enum unchanged. CLI cursor help and durable docs explain the state. Strict
  live smoke asserts retained selected-site attribution and resumability.
- Current focused checks: 28 passed, 0 failed, 175 assertions across the
  service, projector/formatter and CLI tests. Full tests pass: 5,098 tests / 0 failures, 18,527 assertions across 222 files;
  typecheck, formatting and public-package validation pass (including builds).
  Exact live CLI repro and mixed two-page replay pass; fresh core service
  compact/detailed limit-1 replay preserves both scopes and attribution, with
  UNSPECIFIED on page one and CURRENT on page two. Authenticated dev CLI smoke passes for stable and experimental cohorts;
  built Node CLI/MCP smoke passes. Authenticated dev MCP smoke also passes.
  Correction CI and internal/external delta review are clean, including the
  external reviewer's fresh-context final check.
- Selector bounds remain 1,000 per target; native individual match/slice
  semantics and ordered output remain unchanged. Original proof files under
  `/tmp/unified-grep-*` are preserved; new evidence uses `/tmp/nuckelavee-grep-*`.

Expected outcome: users can grep ordered source/site scopes with one CLI
invocation and replay exact reads or continuation, while MCP and the legacy
CLI command retain current behavior.

Assumptions: existing read/list service wiring and transport conventions remain
applicable; the backend owns target expansion and preparation. The documented
unvisited-scope state is accepted explicitly, without changing budgets or
adding retries/fallbacks. Production grep conformance is verified; deployment
and publication remain outside this increment's authorization.
Product decisions: none blocking implementation of this proposal.
Dependencies: backend `Query.grep` and dev v6 access for mixed-source validation.

Implementation order:

1. Add core grep interfaces/implementation and tests; export them internally
   from `packages/core-internal/src/index.ts`. Follow narrow list-service
   transport/error ownership, retaining structured preparation issues.
2. Add shared request/error/projector/formatter helpers and tests, with a
   private workspace export in `packages/mcp/src/internal.ts`. Separate union
   payloads from the legacy `GrepRepoResult`/`LeanGrepRepoEnvelope`.
3. Wire `grepService` in both root container paths and add a service mock
   factory following `test-helpers.ts`. Add `src/commands/grep.ts`, its tests,
   command-index export and `src/cli.ts` registration. Network config remains
   lazy on help/local-only paths; cover malformed env regressions.
4. Add CLI smoke assertions in `scripts/cli-smoke.ts`; preserve existing MCP
   catalog assertions. Update CLI reference/help and create
   `docs/implementation/unified-grep.md` with architecture, coverage semantics,
   action replay and compatibility limits. Add a fragment declaring
   `githits: minor`, `@githits/mcp: none` because the public MCP API/catalog is
   unchanged. Reassess if implementation actually alters a public export.

Acceptance and evidence:

- Pure request tests cover ordered multi-target inputs, global CLI source
  controls, per-target selectors, sites, empty arrays/strings, whitespace
  patterns, multi-byte patterns, explicit false/zero, and numeric bounds.
  Omitted pattern mode sends `REGEX`; `-F`/explicit literal sends `LITERAL`.
  Omitted case/context send true/0/0; `-i` sends false; combined case flags
  honor last-flag precedence; `-C` sets both sides and `-A/-B` override their
  respective side. MCP `ignore_case: true` sends backend false, while omitted
  or explicit false sends true. Backend false/zero are preserved on the wire.
  Omitted source corpus sends `ALL`; explicit source/documentation narrowing
  is preserved, and sites receive neither corpus nor scan-permission fields.
  Patterns with metacharacters retain their bytes in each mode; malformed or
  anchorless regex errors are surfaced without a literal retry.
- Core service tests assert one grep operation per page, exact compact/detail
  wire variables/selections, both hit kinds, null/absence fidelity, preparation
  issues, unknown unions/malformed fields, auth refresh, terms, client-update,
  transport/deadline errors, and no call to `grepRepo` or per-hit reads.
- Projector/formatter tests cover multiple input-to-scope mappings, monorepo
  display/read path distinction, safe slices, context, producer order, no-hit
  complete vs partial pages, stale scopes, target-local failures with sibling
  hits, file issues including issue-bearing zero-hit pages, terminal omissions,
  a cursor plus omissions, and exact
  backend action/cursor preservation. Status indices must resolve each hit.
  Include a `CURSOR_EXPIRED` page with hits/omissions: preserve sibling hits
  and omissions, show explicit restart guidance, and make no automatic retry.
- CLI tests prove flags map to the shared builder, successful-empty/partial
  exit behavior, source-only flags on site-only requests fail, errors preserve
  per-input recovery, leading-dash patterns after `--` reach the service
  unchanged, and the legacy command remains unchanged.
- Run targeted `bun test` for the new modules/container/command first, then
  required `bun test`, `bun run typecheck`, `bun run build`,
  `bun run smoke:cli`, and `bun run smoke:mcp`. Smoke must pass unauthenticated
  auth handling; authenticated affected paths provide deeper evidence. Built
  smoke suites are required if launch behavior or CI validation changes.
- With `GITHITS_ENV=dev` and unintended URL overrides removed without printing
  credentials, verify: `router` in `npm:express` with exact `lib/express.js`;
  `router` in `npm:express` plus `site:expressjs.com` (both hit kinds
  and selected/explicit site deduplication); that mixed request with
  `--limit 1` over two pages; and a complete zero-hit site request.
  Replay emitted repository and hosted read actions, not guessed paths.
  Compare the same known repository literal in its actual spelling and a
  changed-case spelling with case-sensitive and `-i` requests; repeat on an
  available v6 page to establish both native hit kinds respect the flag.
  Confirm the default `ALL` source target includes a known documentation-file
  literal and an explicit `source` request narrows it, without misrepresenting
  independently selected hosted docs as filtered out.
  Native documented caps, typed preparation/terminal omission shapes, and
  package-boundary isolation remain unit/fixture cases unless fresh live
  evidence is available. Record live outcomes and endpoint readiness accurately.

No optimization is proposed and no latency claim is made. There is no existing
unified-grep runtime baseline to compare. If implementation begins optimizing
formatting, add a narrow reproducible built-output size fixture first: 100
repository hits at one served commit and 100 mixed repository/site hits with
one omission and cursor, before/after the same cases. Do not benchmark the
whole search/navigation suite or report debug-build timings.

### Phase 2 — MCP `grep` replaces `code_grep` (PENDING Phase 1)

Expected outcome: the advertised MCP catalog has one mixed-source `grep` tool;
agents receive the same reads, pagination and truthful coverage as CLI users.
Legacy source-only flags disappear from MCP, with migration documented.

Assumptions: Phase 1 semantics and shared helpers prove sufficient; required
provider service additions follow the existing read-service precedent.
Unknowns: current main's list consolidation status must be rechecked at this
boundary. Production grep v6 conformance passed on 2026-09-29; recheck the
deployed contract when Phase 2 starts. Resolve routing against whatever
inventory tool is actually advertised, without taking ownership of list work.
Product decisions: none; MCP removal is requested. Dependencies: Phase 1 merged,
public package compatibility validation, and dev access for MCP conformance.

Implementation order:

1. Add `packages/mcp/src/tools/grep.ts` with the proposed schema,
   `readOnlyHint: true` and existing open-world annotations. Inject
   `GrepService`, delegate to the Phase 1 helpers, and preserve caller
   cancellation. Required `grepService` joins `McpToolServices`; update
   providers, local server composition, descriptor-only service stubs and
   mock factories. Export stable grep service types/implementation via
   `client.ts` and necessary provider types via `index.ts`.
2. Replace `createGrepRepoTool` in the stable MCP catalog, not merely its name.
   Remove obsolete MCP-only registration/exports/tests; retain the legacy CLI
   service/request/output dependencies. Add root CLI/MCP parity tests for
   structured inputs and JSON results.
3. Update active grep-specific instructions, tool descriptions, error/recovery
   actions, quick-start guide, public skills, README/CLI and implementation
   references, smoke catalog assertions, eval expectations and current tool
   counts. Keep unrelated and historical descriptions/results intact. Where
   `code_grep` actions currently carry legacy flags, construct valid unified
   target entries or remove the unsupported action with truthful guidance;
   never mechanically rename incompatible payloads.
4. Keep `buildMcpQuickStart()` and the public skill's terminal guide in exact
   parity. Follow the documented stable-guide lifecycle exception: backing
   behavior, builder and terminal guide change in the same Phase 2 PR, accepting
   the bounded main-to-release window; do not invent a deploy-first requirement.
   Leave behavior-dependent onboarding skill updates for the release boundary.
   Follow the public Agent Skill lifecycle for behavior-dependent
   guidance: authored root `skills/` inputs only, `plugins:generate` and
   `plugins:check`, never generated-file edits. Add a migration fragment with
   explicit `githits: minor`, `@githits/mcp: minor` (current pre-1.0 MCP breaking
   provider/catalog change); confirm versions and release policy at execution.
   The fragment must call out regex replacing literal as the default, literal
   opt-in, all other changed matching/output defaults, and zero replacing the
   legacy 30-second preparation wait.
   Update durable docs with the actual final public schema and API migration.

Acceptance and evidence:

- Catalog tests advertise `grep` and exclude `code_grep` in stable descriptors
  and local server registration; all information tools remain read-only.
  First sentence: “Find regex or literal matches across source and documentation.”
  (under 79 characters, no internal periods). First-80 tests and field
  descriptions must independently explain package hosted-doc inclusion,
  all-corpus default, per-target scopes, regex/case/context defaults and opt-ins, exact
  reads and continuation.
- Handler/provider/parity tests prove the shared request/result/text/error
  semantics, structured multi-target calls, explicit false/empty arrays,
  regex/case-sensitive/zero-context/all-corpus defaults and explicit opt-ins,
  read-action fidelity and no
  legacy service execution.
- Run required unit tests, typecheck, build, plugin parity/generation checks
  and CLI/MCP smoke; run built smoke if launch/CI validation changes.
  Validate the packed public MCP package from outside root path aliases,
  including an external request-scoped provider supplying `grepService`.
- Authenticated MCP smoke repeats the Phase 1 package/mixed/two-page/read
  cases against dev and checks truthful partial/omission handling. Production
  smoke expectations must respect v5/v6 readiness rather than assume sites work.
- Run `bun run agent:e2e --agent codex --server local --guidance-profile
  descriptors --workload eval/agentic/workloads/code-grep-investigation.md`
  and the matching Claude run. Add one focused mixed-docs workload: find the
  known `middleware` literal in Plug source and hosted docs, then reopen the
  returned evidence. Run both descriptor-only agents for it; use the full
  guidance profile if broad instruction changes warrant it. Inspect
  `tool-calls.json`, `final.json`, `metrics.json`, and
  `isolation-violations.json`; report tool use, confidence and measured cost,
  not ungraded usefulness claims.
- Compare the new full `grep` descriptor's serialized UTF-8 bytes with the
  7,161-byte baseline using the same `getMcpToolDescriptors()` projection;
  explain capability/size changes without claiming a latency improvement.

Hosted clients see this replacement only after `@githits/mcp` publication,
`remote-mcp` dependency adoption/provider migration, and deployment. Those
steps require separate authorization and belong to that repository's owner;
this plan adds no hosted server implementation or third phase. Rolling back
the client/package increment restores the prior catalog; callers cannot carry
unified cursors into the legacy root.

## Phase boundary and completion

After Phase 1 merges, reorient against current `origin/main`: record actual
validation, confirm backend schema/deployment, reconcile read/list changes,
reassess Phase 2 public compatibility and instruction dependencies, and adjust
detail before implementation. Use the next-step readiness workflow if available;
do not proceed from stale assumptions or treat package release as deployment.

After Phase 2 merges, move lasting decisions and migration/operational facts to
`docs/implementation/unified-grep.md`, transfer any actual major deferred work
to the repository backlog, then delete this plan. No deferred development or
new infrastructure is proposed. The maintenance opportunity is to retire the
MCP-only legacy adapter after migration while preserving shared CLI helpers;
do not absorb a general code-navigation refactor.

## Design review

Phase 1 execution sequence (one Luna worker, sequential dispatches):

1. Coordinator: core service/types/query/validation and transport tests.
2. Luna: shared request normalization plus its isolated behavioral tests.
3. Coordinator: result projection, mapped errors and coverage-aware formatter.
4. Luna: container and central mock wiring against the settled service seam.
5. Coordinator: CLI adapter and flag/action tests; live conformance and smoke.
6. Luna: root command registration against the tested command factory.
7. Coordinator: docs, release fragment, verification, review, stable commits
   and draft PR. Phase 2 remains pending. Worker returns verified uncommitted
   slices; coordinator owns commits. The previously untracked plan is included
   with Phase 1 delivery and remains through Phase 2 review.

Internal technical pre-flight and one external Claude review are required by
the planning workflow. Internal review: clean after one minor correction;
`ContentSafety.modifications` is an enum list, so the query-selection wording
now explicitly forbids subfields. Sibling scan: the selection table, response
contract and service test criteria retain the actual schema shape; no other
modification sub-selection was proposed. Subsequent internal passes checked the
full revised defaults and closure records and were clean after simplifying one
leading-dash example. External review: **clean in round 3** after applying its
one minor acceptance-test clarification. Rejected
findings must remain rejected without new evidence.

External round 1: four accepted plan findings, no code findings. Closure:

- CLI flag inconsistency → unsupported vocabulary change → checked legacy
  Commander definitions and live `rg --help` → reuse `-A/-B/-C` and `--limit`;
  user subsequently confirmed regex default and normal grep/rg conventions,
  so literal opt-in uses standard `-F/--fixed-strings` and case flags use
  `-i/-s`. CLI-specific normalization does not enlarge the MCP schema.
- Default wait migration omitted → changed cold-target behavior undocumented
  → checked legacy defaults and all compatibility/fragment/test sections →
  record 30 seconds to zero and typed preparation failures; also state existing
  page-size differences and the user-requested regex/case/context defaults.
- ASCII help sibling omitted → stale claim in a retained surface → checked
  shared pattern note and CLI flag help → schedule both corrections together
  in Phase 2, keeping Phase 1 MCP unchanged.
- File-issue safety selection incomplete → compact output could miss path
  normalization warnings → checked backend file-issue type, complete selection
  table and formatter criteria → compact includes issue `filtered`; detailed
  includes `lineBytes`, match coordinates and enum modifications. Coordinator
  also closed the related zero-hit issue case: issue-bearing/skipped content
  cannot be called an exhaustive no-match result.

User steering resolved the matching-default preference: regex, case sensitive,
zero context; default repository corpus also uses `ALL` to honor the subsequent
directive to mirror grep/rg unless a concrete reason prevents it. The table
above records supported conventions and unavoidable departures. These and the
CLI contract revisions were material plan changes and were reviewed in round 2
on the complete revised plan.

External round 2: four accepted plan findings; no code findings or infrastructure:

- Default-true MCP case boolean → violated agent-schema convention → checked
  AGENTS.md and architectural guidelines, then all case/default/example/test
  references → rename the MCP knob to `ignore_case` with default false and
  invert once into backend `caseSensitive`. Matching remains case-sensitive
  by default as the user requested; no alias or second case knob is added.
- Leading-dash patterns omitted → Commander may parse a pattern as an option
  → checked positional syntax and CLI acceptance → document `--` and add one
  unchanged-pattern regression case, avoiding a redundant `-e` syntax now.
- Case-sensitive `-s` overlaps existing command-local meanings → checked
  list/vulnerability option definitions and grep/rg meanings → explicitly
  accept rg's grep-command meaning and document command-scoped parsing. This
  adds no cross-command parser ambiguity or shared behavior.
- Stale review status and punctuation → checked review section and complete
  prose → correct both. No contract or implementation change for this note.

External round 3: direct review found no issues. Its one permitted fresh-context
final check confirmed the backend contract and raised one accepted minor
test-criterion clarification: `CURSOR_EXPIRED` is a successful result traversal,
so the projector/formatter criteria now explicitly require preserving returned
hits/omissions and showing restart guidance without auto-retry. Verified against
`grep.ex`'s traversal mapping; sibling scan covered the response, error, output
and test contracts and found the behavior already specified, with only the
explicit acceptance example missing. The round is clean once this wording is
applied, under the repository's minor-doc finding rule.

All product steering is resolved. No rejected findings, unresolved review
items, deferred development, or new infrastructure. Phase 1 can begin from
this design; fresh authenticated conformance remains implementation acceptance.

Implementation preflight closure (2026-09-28):

- Config registration list omitted grep: accepted; added it to
  `docs/implementation/config.md`, checked the CLI reference, README and root
  registration for the same stale list.
- Package validation checkpoint was stale: accepted; recorded the completed
  public-artifact validation. Fresh dev proof remains explicitly unproven.
- Remove inspected commit/schema identifiers: rejected. They identify the
  verified evidence snapshot, not transient runtime IDs or current-HEAD claims;
  preserving reproducibility in the working plan follows the verification rule.
- Narrow raw corpus input to an enum: rejected. The CLI passes unvalidated
  option strings to the shared normalizer, which owns enum validation. An enum
  here would require a cast or duplicate validation in the adapter. Clarified the
  boundary in JSDoc; the unused input alias is already absent.

Internal code-review closure (2026-09-28):

- Repeated context flags could hide an invalid earlier value: accepted. The
  failure class was loss of raw option occurrences before validation. Scanned
  all three context flags and symmetric/side precedence. Commander now collects
  every context occurrence; CLI conversion validates each through the shared
  numeric-context helper and chooses the final valid value. No new parser
  metadata or duplicated numeric bounds. Focused tests cover invalid-first
  repetitions for -A/-B/-C and valid repeated values with side precedence.

The full revised internal code-review round is clean. The earlier context
finding is closed; no additional code findings were raised. Remaining live
small mixed-page acceptance is an external backend dependency, not a client
fallback or reduced scope. No refactor or new infrastructure was needed.

External implementation round 1 closure (2026-09-28):

- Source/context backslashes doubled: accepted medium output-fidelity finding.
  Ordinary regex/string/path lines displayed different code. Formatter content
  now escapes terminal controls only; locator/prose escaping remains explicit.
  Added a source+context regression with regex escapes, a Windows path and ESC.
- Retryable preparation had no wait recovery: accepted low CLI UX finding.
  CLI owns flag-specific recovery; append `--wait <ms>` guidance only to
  retryable INDEXING, preserving all public per-input details. Shared error
  classification remains transport-neutral. Checked nonretryable behavior.
- Shared invalid-cursor hint used CLI syntax: accepted low wording finding.
  Use neutral “without the cursor” for CLI/MCP reuse; no new syntax switch.
- Parallel selector collectors and site predicates: accepted low simplicity
  finding. CLI now has one ordered event-built selector list used by both real
  calls and direct tests. The existing shared normalizer exports its site
  predicate internally for CLI reuse. No new module or public MCP API.
- Stale MCP-smoke progress and blank lines: accepted; recorded passing current
  authenticated MCP smoke and removed repeated blank lines.

No rejected findings in this implementation round. No final subagent check
ran because round 1 had code findings. Re-review is required after focused
verification and the full revised internal pass. The backend small-page
blocker at that review checkpoint is resolved by the correction below.

Initial pre-correction revision verification: `bun test` passes 5,095 tests across 222 files
(18,512 assertions); the four changed grep modules pass 25 focused tests
(160 assertions). Typecheck, changed-file Biome, build and public-package
validation pass. The coordinator initially started built smoke concurrently
with package validation, which rebuilds `dist`; both smoke entry checks failed
while the file was absent. This was a verification sequencing error, not a
product failure. Kept those logs; built Node CLI and MCP smoke both pass when rerun after
validation completes.
The revised internal code-review round is clean. External round 2 is clean.

At the initial pre-correction delivery, the authenticated CLI text path passed for `-F 'var Router'` against the
emitted pinned Express repository and exact `lib/express.js`: one complete
match, current scope, numbered source line and exact replay action. That was
supplemental proof; the later corrected replay covers the strict package
limit-1 and small mixed-page criteria.

External implementation round 2 is clean with no findings. The reviewer
verified all round 1 closures over the full revised delta; its one permitted
fresh-context final code-reviewer check also returned no findings. Projection
using the shared schema preserves optional detailed fields and was verified
as valid. The reviewer is retained for follow-up through merge approval.

The initial delivery was blocked on backend small-page protocol validation.
Backend PR #2832 resolved that failure; the resulting unvisited-scope enum
requires the client correction recorded in the current checkpoint above.
Phase 2 remains pending Phase 1 merge. No backend worktree is changed by this
client correction, and no limits, scopes or acceptance requirements are reduced.

Orchestration delivery: eight sequential Luna dispatches covered request
normalization, DI/mock wiring, registration and bounded follow-up exports or
mechanical fixes. The per-target selector-cap correction came from the
coordinator's initial interpretation of the contract; it cost one corrective
dispatch and focused verification. During the final predicate export, the
coordinator corrected its evidence command to include the required detailed
mode flag and preserve raw target bytes. Transport, projection, formatting,
errors, CLI semantics, validation and review remained coordinator-owned.

Post-deployment contract correction (2026-09-28): accepted the verified enum
omission reported by the backend agent. Root cause was the core client's
readiness allowlist lagging the documented GraphQL enum. Core owns that wire
validation; shared text owns the unvisited-scope explanation. Scope is this
existing PR's correction, with internal delta review and the retained external
Claude session required before completion. No new infrastructure or public MCP
API/catalog/guide change. Production was blocked at this 2026-09-28 checkpoint;
no deployment was authorized by the client correction request.

Correction validation (2026-09-28): `bun test` 5,098 pass / 0 fail,
18,527 assertions in 222 files; focused grep tests 28 pass / 0 fail.
Typecheck, formatting/Biome, build/public-package validation and built Node
CLI/MCP smoke pass. Authenticated dev CLI smoke passes all 154 steps across
stable and experimental cohorts; authenticated MCP smoke passes. The exact
source repro and mixed two-page CLI/client compact+detailed replays pass.
All dev commands unset `GITHITS_API_TOKEN`, select `GITHITS_ENV=dev`, and set
`GITHITS_MCP_URL=https://mcp-dev.githits.com`,
`GITHITS_API_URL=https://api-dev.githits.com`, and
`GITHITS_CODE_NAV_URL=https://pkgseer-backend-dev.fly.dev` inline. Keychain
access worked in this lane; earlier stalled attempts from the backend lane
are not claimed as passing evidence. No credentials were printed.

The changed-delta internal review and external round 3 are clean. The retained
Claude reviewer checked `git diff efa39fd..67cb848`; its fresh-context final
code-reviewer check also found no issues. Two non-blocking observations are
closed without changes: the manual authenticated dev smoke intentionally
requires the selected hosted-doc scope, as verified in live responses; the
Coverage line preserves `retryable: false` while the unvisited-scope text and
cursor guide continuation. Retryability does not replace pagination, and
altering the backend status would violate the lossless result contract.

Correction CI is green: [Main](https://github.com/githits-com/githits-cli/actions/runs/36459079262)
passes build/checks, Linux/Windows tests, Bun and Node 20/22/24/26 compatibility;
[MCP package validation](https://github.com/githits-com/githits-cli/actions/runs/36459078714)
passes. The reviewer remains retained through merge approval. At this
2026-09-28 checkpoint, production remained blocked; no production query,
backend edit or deployment was performed. Original proof artifacts remain
unchanged; new proof is under `/tmp/nuckelavee-grep-*`.

Production verification (2026-09-29), after the user confirmed deployment:

- Replayed `bun run src/cli.ts grep router npm:express@5.2.1 --path
  lib/express.js --limit 1 --json`: one source hit, retained selected SITE
  scope with UNSPECIFIED/RESUMABLE_LIMIT, and a continuation cursor.
- Mixed CLI pages with identical ordered `npm:express` and
  `site:expressjs.com` operands and `--limit 1` returned distinct source then
  hosted-doc hits. Both scopes and site attribution `[0,1]` remain present;
  the site becomes CURRENT on page two. CLI text explains the unvisited scope
  and cursor. Compact and detailed service queries pass the same assertions.
- `bun run smoke:cli` passes all 154 steps, stable and experimental live
  cohorts; `bun run smoke:mcp` passes all 65 steps. All three verification
  processes exit zero; none skipped authenticated coverage.
- Every command uses `env -u GITHITS_API_TOKEN GITHITS_ENV=prod` with inline
  `GITHITS_MCP_URL=https://mcp.githits.com`,
  `GITHITS_API_URL=https://api.githits.com`, and
  `GITHITS_CODE_NAV_URL=https://oss.githits.dev`. No inherited URL overrides
  or API tokens were present. Production credentials stayed private.
- Evidence: `/tmp/nuckelavee-grep-prod-replay.ts`, its `.log` and
  `-results.json`, plus `/tmp/nuckelavee-grep-prod-smoke-cli.log` and
  `/tmp/nuckelavee-grep-prod-smoke-mcp.log`. Original dev proof is preserved.
  No implementation change, backend edit, merge or deployment was performed.
