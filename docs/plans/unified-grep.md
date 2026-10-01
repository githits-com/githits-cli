# Unified grep client adoption

## Status and outcome

**Status: CLI AND OUTPUT FOLLOW-UP MERGED; PHASE 2 IN REVIEW.** Phase 1 and
output PR #433 merged as `45b72120d1ae2810a3370da1ecd838259ac5b576`
on 2026-09-29. The approved Sources summary, numbered copyable file/page
locators, and dim continuation footer are present. Current `origin/main`
`8ae11a4` also contains unified MCP
`list` from PR #428. Phase 2 now routes inventory through `list` and replaces
only the remaining advertised legacy grep tool.
The sequence is CLI introduction, useful and compact CLI text, then replacement
of the advertised MCP `code_grep` tool.

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
Overall product decisions: none blocking. The CLI argument order and whole-target
convenience below shipped in Phase 1. Production grep conformance is verified below;
that does not change backend deployment or publication authorization.
Dependencies: the checked-in backend contract, existing auth/transport helpers,
and CLI output refinement before Phase 2. Completion criteria: all increments merged, their
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
  established the CLI-first service/shared-helper/MCP migration pattern at the
  original 2026-09-28 inspection. MCP `list` subsequently merged in PR #428;
  the historical pending-list assumption below no longer describes main.
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
scopes and several inputs to one scope. The service and JSON preserve
`requestedInputIndices` and producer order; they do not expand, deduplicate,
sort, or merge target identities. Text groups evidence for presentation only.

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
| Output | Grouped numbered match/context rows, concise coverage and shared read recipes; exact per-hit actions in JSON | Remote provenance and partial coverage must remain visible |
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
match blocks. Group text across the complete returned page by physical scope and exact
file/page read identity. Preserve file/page first-appearance order, then
show numbered lines in source order. Backend occurrence order remains in JSON. Reuse numbered `line: content` matches,
`line- content` context, and visible slice omission markers. Preserve tabs in
source/context content; escape other C0/C1/DEL controls. Quote copyable locator
operands exactly, preserving literal backslashes.
Preserve backend Unicode. Keep prose wrapped
to caller width, source lines intact, formatter punctuation ASCII, and meaning
independent of color. CLI and MCP use the same formatter with color/width inputs.
Compact text uses backend-authored display offsets relative to normalized slice
content for highlighting; it never reruns the search regex locally. Split raw
UTF-8 content at native match boundaries, escape each resulting segment, then
add formatter ANSI. Core validates `0 <= start <= end <= byteLength(content)`
and UTF-8 boundaries; malformed coordinates are protocol errors, not render
fallbacks. Identical per-line slices coalesce, with match rows taking precedence
over context rows. Zero-context results have no gap separators; when context
rows are rendered, `--` separates non-contiguous blocks.

Text carries exact backend read targets and repository-root paths, with
numbered file/page headers and source/context rows. Use generic read templates
at the top; retain the full snapshot in each file locator. JSON retains every original read action and its exact bounds.
Templates visibly use placeholders for the chosen path/window; they are not new
read aliases or a promise that disjoint hits form one continuous read range. Show warnings for stale/failed/unready
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
| Display match byte offsets relative to normalized slice content | Required for native match highlighting | Required |
| Duplicate hit `lineContent`, hit repo URL/commit/repository path; physical match offsets; hit/issue safety modifications; issue `lineBytes` and match byte coordinates; scope repo URL/canonical site/URL prefixes | Omitted | Required |

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

### Phase 1 — top-level CLI mixed grep (MERGED)

[PR #429](https://github.com/githits-com/githits-cli/pull/429) merged on
2026-09-29 at `9f96f74319eeb718abef2969785a005ef4bef182`. Freshly fetched
`origin/main` is that same commit. Its [Main CI](https://github.com/githits-com/githits-cli/actions/runs/36549214105)
and [Agent Evals workflow](https://github.com/githits-com/githits-cli/actions/runs/36549213730)
completed successfully. The observed pre-merge validation remains recorded
below: 5,098 tests, dev and production acceptance, and 154 CLI / 65 MCP smoke
steps against production. No implementation tests were rerun for this
bookkeeping. The Phase 1 Claude reviewer was released after merge confirmation;
Orca confirmed `processAction: closed_agent_terminal`.

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

Completed Phase 1 acceptance contract:

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

Phase 1 made no optimization or latency claim. Its output-size follow-up now
has the two fixed production captures below, including continuation cursors.
They cover default zero-context pages without omissions; omission and other
coverage shapes are regression cases, not additional budget benchmarks. No
search-suite benchmark or debug-build timing is needed.

### Phase 1 follow-up — useful, compact grep text (MERGED)

Problem: the merged output treats backend occurrences as independent display
blocks and repeats read commands and routine protocol fields. User-provided
production output and the legacy `code grep` screenshot make the regression
concrete. Wire correctness and a passing smoke suite did not establish text
quality. The earlier plan's requirement to preserve producer interleaving in
text was misplaced; backend/JSON ordering belongs to the data contract, and
the formatter owns a layout useful to people and agents.

Expected outcome: readers can scan one file/page heading and numbered matching
lines, copy exact read locators from file/page headers, and reopen or continue the
evidence without per-occurrence scaffolding or a read footer. Repeated occurrences on one
physical line/window occupy one display row; the page summary distinguishes
occurrences from matching lines. Full machine evidence remains lossless JSON.

Evidence collected on 2026-09-29 from `bun run build` followed by Node
`dist/cli.js` against explicit production URLs, with `GITHITS_API_TOKEN` unset:

| Fixed captured case | Pre-refinement bytes / lines / o200k_base tokens | Grouped full-window prototype | Grouped bounded-preview prototype |
| --- | --- | --- | --- |
| `router npm:express`, default 100 | 23,509 / 413 / 8,038 | 7,175 / 112 / 2,144 | 6,687 / 112 / 2,031 |
| `router` in pinned Express repository, source corpus, limit 100 | 19,487 / 297 / 7,506 | 5,550 / 114 / 1,607 | same as full-window |

The mixed case has 100 occurrence records, 81 distinct physical lines/windows
and eight files/pages; it prints 100 read commands. Nineteen extra records
share identical rendered windows, with distinct match offsets. The pinned
repository case has 100 occurrences and four files. The prototypes are
layout studies, not production implementations or complete coverage-warning
formatters. Numbers include real continuation cursors; no latency or model
quality claim is made. Token counts use tiktoken's `o200k_base`, not a claim
about Claude's tokenizer. The earlier package-path capture named
`source-100` still includes hosted package docs and is not the source-only
benchmark; it is preserved as evidence, not discarded.

Proof: `/tmp/nuckelavee-grep-ux-{mixed-100,repository-100}.{txt,json}`,
`/tmp/nuckelavee-grep-ux-prototype-v2.py`, the `-draft-v2-full.txt` /
`-draft-v2-bounded.txt` outputs, and
`/tmp/nuckelavee-grep-ux-size-comparison-v2.json`. The original prototype, outputs
and comparison are preserved. V2 removes occurrence annotations from source
content, labels repository corpus correctly and quotes recipe operands. No grep formatter
benchmark existed; `scripts/list-text-size-benchmark.ts` is a size-measurement
convention only, not a grep baseline.

Implemented decisions and assumptions:

- Follow the supplied legacy screenshot: grouped file/page headings, aligned
  line gutters, standard `:` match / `-` context markers, and optional match
  highlighting. File grouping and identical-window coalescing affect text
  only, not page membership, budgets, JSON or backend cursor semantics.
- Retain complete backend-provided windows in this increment. Extra client
  clipping saved only 113 tokens on the mixed prototype and none on the
  repository case; it complicates evidence presentation for little measured
  gain. Existing native slice omissions stay visible. The implementation retains
  full windows and does not introduce a long-line preview control.
- No default executable command per occurrence. A reusable read recipe states
  the actual full snapshot/page target; file headers retain the actual read
  path. Row line numbers support a chosen read window. All original backend
  read actions remain in JSON. The locator-header revision below supersedes the
  original read-recipe footer and outer source grouping.
- No new verbose flag in this increment. Default text is the useful evidence
  view; existing `--json` carries full raw status/provenance/action detail.
- Keep matching controls, package-selected doc expansion, limits, default
  corpus and pagination unchanged. This increment introduces no suppression
  of hosted docs, relevance ranking, source filtering, retries or hydration.

Unknowns/product decisions: none blocking. No alternative layout or long-line
preview preference was supplied; the measured full-window layout was implemented
under the subsequent orchestrate instruction.
Dependencies: merged Phase 1 service and shared helpers, its verified native
read/match coordinate contract, and production/dev access for live acceptance.

Architecture and ownership:

- `grep-text.ts` owns presentation grouping, exact-window coalescing, gutters,
  highlights, read recipes and meaningful coverage prose. It remains one shared
  pure formatter with color/width/syntax inputs; no separate helper module,
  CLI-specific copy or general output framework was needed.
- Core owns native match coordinates and GraphQL selection. Compact text now
  selects and validates `matchStartByte`/`matchEndByte` for both hit kinds for
  highlighting. Backend code confirms
  they are UTF-8 byte offsets relative to returned normalized slice content;
  physical source offsets remain JSON-only. Both display offsets are required
  and validated for slice bounds and UTF-8 boundaries in core. The formatter
  consumes native spans; RE2 and Unicode matching remain backend-owned.
- CLI owns color detection, width and output. MCP later passes its syntax and
  color policy to the same formatter. No service-provider or public MCP
  catalog/schema migration occurs in this follow-up.
- Compact selections were checked against the final formatter, empty-result
  and warning paths. JSON-only fields remain conditional; provenance/coverage
  fields used by text remain selected. Detailed JSON remains
  strictly selected and validated; unknown malformed output stays rejected.

The initial implementation is complete. The permanent grouping, selection, escaping,
read-action and coverage contracts are in `docs/implementation/unified-grep.md`.
The exact fixture corpus, built byte/line measurement script and attribution are
checked in; token measurement stays external. One serial Luna worker owned the
fixtures, size script, one mixed-page regression and attribution. The coordinator
owned formatter/core design, remaining regressions, live verification and delivery.
All worker returns were inspected uncommitted under the full-access permission
mode; no public MCP migration, new infrastructure, release or backend edit occurred.

Acceptance and evidence:

- A captured mixed page has one heading per exact file/page identity, every
  distinct backend window once, truthful occurrence/line counts, the full
  snapshot in each repository file locator, no per-hit read commands or read footer, and no
  protocol-status dump. The legacy screenshot's readable line gutters and highlighting remain.
- Every supplied physical window and required warning survives presentation.
  JSON deep equality proves all hits, order, offsets, attribution, statuses,
  reads, omissions and cursor remain unchanged. Grouped text is explicitly
  presentation order and is never used to construct continuation operands.
- Regression cases cover alternating source/site hits, same-window multiple
  occurrences, distinct windows on one long line, overlapping/incompatible
  context and context-to-match promotion, zero-context gaps, tab indentation,
  CRLF-derived rows, monorepo display/read path differences, shell quoting and
  leading-dash read operands, multiple revisions sharing a display path,
  Unicode byte offsets and malformed bounds/boundaries, terminal controls before
  a match, no-color rendering,
  zero-width matches, no hits, unvisited scopes, terminal omissions, skipped
  files, source safety normalization, expired cursors and partial pages.
- Query/validation tests prove compact mode fetches only needed display offsets
  in addition to its real consumers; redundant lineContent, physical offsets,
  modification detail and JSON-only hit provenance remain excluded as appropriate.
  Detailed JSON strictness and field/enum rejection remain covered.
- Re-render the exact two frozen fixture cases with the built Node formatter.
  The checked-in script measures bytes and lines; temporary external tiktoken
  measures tokens with no project dependency. Target at least 65% fewer
  o200k_base tokens and UTF-8 bytes per case than the
  observed baseline, with no loss of distinct windows, canonical locators or
  meaningful coverage. Targets are an acceptance budget, not permission to
  delete evidence; explain any miss before changing scope or thresholds.
- Run focused formatter/service/CLI tests, required full `bun test`, typecheck,
  build and package validation. Run CLI and local MCP smoke; run built smoke
  if smoke product validation changes. Capture the actual built default
  `grep router npm:express` output and a source-only repository output against
  production, plus mixed limit-1 continuation/zero-hit coverage. Inspect normal
  terminal and no-color width-80 output, not just smoke success. Do not claim
  the current MCP catalog has adopted unified grep.
- Review one normal mixed page, one source-only page and one partial/no-hit
  page as user-facing text before signoff. A passing parser/test suite cannot
  substitute for assessing readable, usable output. Future MCP descriptor/agent
  evals remain in Phase 2; this increment changes no current tool discovery.

Plan review closure (2026-09-29; external round 1):

- Accepted normal tab-indentation defect and highlight-order ambiguity. Root
  cause: treating every source control as unsafe, and leaving coordinate use
  unstated. Scanned shared renderSlice/escapeControls, both core hit branches,
  GraphQL selections, backend normalization/rebasing, and native matcher/context
  projections. Plan now preserves source TAB, escapes other controls after
  splitting raw UTF-8, and validates required display offsets in core. Native
  CRLF stripping is verified; no client trim/fallback is proposed.
- Accepted grouping-role/gap and count-placement gaps. Root cause: consecutive
  blocks had no page-wide row contract. Scanned shared output paragraphs,
  follow-up steps/acceptance and prototype. Plan defines per-line slice identity,
  match-over-context promotion, preserved conflicting slices and no separators
  at zero context. V2 drops per-row counts without changing source content.
- Accepted explicit projected fixture cap and external-only token measurement.
  The script reports bytes/lines without a tokenizer dependency. Keep one Node
  bundle before measurement: it is a small command, matches the user's built
  benchmark requirement, and avoids reporting source-run results as built
  validation. No runtime performance claim or benchmark framework is added.
- Rejected omitting the independent release fragment while the feature remains
  unreleased: AGENTS.md and changes/README.md explicitly require a fresh fragment
  per notable change and prohibit editing another change's fragment. Wording
  describes grouped evidence without claiming the rejected output was released;
  the highest impact across pending fragments determines the eventual bump.
- Accepted all wording/recipe notes. Bounded sibling scan covered the overall
  dependencies/completion, backend producer-order paragraph, CLI convention
  table, shared text/selection contract, completed-phase benchmark note,
  follow-up acceptance, Phase 2 dependency and V2 prototype. Repository vs hosted
  docs, safe CLI quoting/leading-dash operands and MCP recipe syntax are explicit.
  Retain exact page-target recipes rather than add a second generic conditional
  recipe format; the projected budget already passes with those identities.

Plan review closure (2026-09-29; external round 2):

- Rejected skipping bounds validation and highlighting for every filtered hit.
  The reproduction normalized raw comment/image syntax at response time but
  omitted the mandatory pre-index full-document normalization. Grep admits only
  the hosted-document format with this export step. Running the actual normalizer
  on the cited examples shows comment/image-URL matches absent from indexed text;
  image-alt text retains a valid span in the normalized placeholder. The same
  example text is unchanged at response normalization. This does not establish
  a normally occurring invalid span and does not justify a client workaround or
  backend handoff. Required display-coordinate validation remains strict.
  Related areas checked: export format mapping, complete-page export normalization
  and its regression, both package-selected and explicit-site admission, hosted
  match projection, field-safety aggregation and actual normalization examples.
  Internal proof: `/tmp/nuckelavee-grep-ux-normalization-proof.exs`.
- Removed unnecessary native source-path detail from the CRLF implementation
  step, keeping verified behavior and internal proof references.
- Accepted fixture attribution: record canonical source URLs, capture date and
  verified upstream license notices alongside the projected evidence fixtures.
  Verified the official Express repository license and website README/license
  links; the plan records MIT for repository excerpts and CC BY 4.0 for hosted
  documentation rather than assuming one license covers both.

Review result: the internal code reviewer found no remaining findings after
both closure passes. External round 3 is clean, including its one fresh-context
final code-reviewer check. The reviewer verified and accepted the round-2
pipeline-based rejection. Its final wording note was applied; no product
question or valid in-scope finding remained open in that plan round. The
implementation and its code-review record follow below.

Implementation checkpoint, 2026-09-29:

- One Luna worker returned five serial checkpoints: exact compact fixtures,
  built size script, mixed-page grouping regression, attribution and a small
  attribution correction. The initial provenance brief omitted the literal
  capture commands; its checker was strengthened and the worker corrected two
  examples. Coordinator owns formatter/coverage, core native offsets, other
  regressions, live evidence and final docs. No worker implementation was
  silently rewritten.
- Both frozen fixtures retain all 100 occurrences, full windows, exact reads,
  scope attribution/status and cursor. Their minified sizes are 51,684 and
  49,250 bytes, below the 80 KiB cap. Four full detailed captured pagination
  responses deep-equal the parsed/projected JSON after text formatting.
- Final built, width-80, plain output measures:

  | Case | Bytes before -> after | Lines before -> after | o200k_base tokens before -> after |
  | --- | --- | --- | --- |
  | Mixed 100 | 23,509 -> 7,243 (-69.2%) | 413 -> 114 | 8,038 -> 2,156 (-73.2%) |
  | Repository 100 | 19,487 -> 5,604 (-71.2%) | 297 -> 118 | 7,506 -> 1,618 (-78.4%) |

- Fresh built Node production output exactly matches these byte/row counts:
  mixed 81 rows/eight groups, repository 99 rows/four groups. Original source
  repro and mixed two-page compact/detailed continuation retain both scopes,
  source then site hits, UNSPECIFIED then CURRENT and site attribution `[0,1]`.
  Complete no-hit production output is exactly `No matches.` with both scopes
  retained in JSON. TTY source output highlights the native router span.
  Built partial/no-hit fixture review retains stale provenance, scanned counts,
  skips, issues/omitted counts, unvisited scopes, omissions and cursor; scope
  warnings share one label instead of repeating it on each row.
- Final post-main-sync `bun test`: 5,157 pass, zero fail, 18,718 assertions
  across 225 files; `bun run typecheck`, build and public-package validation pass.
  Authenticated production CLI smoke passes 154 steps across both cohorts;
  authenticated MCP smoke passes 65 steps across both cohorts. Both built
  secret-free smoke suites and source MCP unauthenticated validation pass.
  Earlier authenticated MCP failures were caused by the separate research
  read-source contract mismatch; merged PR #431 (`eba509e`) fixed it on main.
  This branch integrated that main revision without adding a research fix.
  The earlier failed logs remain diagnostic evidence, not passing results.
- Luna preflight found no plan/documentation/interface mismatch; missing
  partial/no-hit review evidence was supplied. Internal code review closed
  the U+FEFF segment-decoding issue and encoded repository/site read-path
  contracts in core types and validation. Color/plain parity, three U+FEFF
  segment cases and malformed counterpart paths have focused regressions.
- External code round 1 found one minor dead-helper cleanup. Removed the old
  per-hit `formatReadAction`, scanned for all remaining references and moved
  its control/quoting/MCP assertions onto active shared-recipe output. Focused
  cleanup verification passes 11 tests / 76 assertions, typecheck, Biome and
  build; commit hooks pass. The full suite and live smoke precede this unused
  helper removal and remain applicable. Internal full-delta closure is clean.
- External code round 2 is clean, including its single fresh-context final
  check. Its backslash-locator note was rejected against the pre-existing,
  documented escaping contract and focused regression; exact paths remain in
  JSON. No findings or product decisions remain open. The same Claude reviewer
  is retained until merge approval.

Proof artifacts: `/tmp/nuckelavee-grep-ux-{benchmark-results,token-results}.json`,
`-rendered/*.txt`, `-live-{mixed,repository,nohit}.{txt,json}`,
`-prod-replay{.log,-results.json}`, `-partial-output.txt`, `-live-colored.txt`,
`-tests-final.log`, and the separately named smoke logs. Research diagnosis is
`-research-protocol.log`; prior captures and `/tmp/unified-grep-*` remain intact.

User-directed locator-header revision (2026-09-29; IMPLEMENTATION READY):

- User confirmed numbered file/page headers. `[1]`, `[2]` identify displayed
  evidence groups, following search's result numbering; source aliases are removed.
  Keep first-file/page appearance order, exact identity grouping, every native
  window/span and identical-window coalescing. No outer grouping by source.
- One search-style `Sources:` summary groups physical repository/site identities
  beneath their attributed target. A hosted website appears once per resolved
  scope, never once per page. Backend `canonicalSite` owns the site identity;
  backend `repoUrl`/`commitSha` own repository provenance. Select and require
  nullable scope `repoUrl` and `canonicalSite` in compact and detailed responses.
  This is the smallest added wire data needed by the summary; hit identities,
  physical coordinates and other JSON-only fields remain conditional.
- Repository file headers begin with the opaque backend read target unchanged,
  full served SHA and exact repository-root read path.
  Page headers begin with the exact backend read URL, retaining a differing display
  URL as secondary metadata. Numbering is presentation-only; never reuse it as
  targetIndex, requested input attribution or a continuation operand.
- At the top, print one generic file read structure and one page read structure
  when those hit kinds occur: `read --lines $start-$end -- $target $path` and
  `read --lines $start-$end -- $url`. MCP uses its native argument names.
  Safe ordinary locator words remain bare; quote unsafe shell operands exactly.
  Preserve line numbers for chosen windows. No per-hit command or read footer.
- Cursor/restart/incomplete guidance stays above evidence. Preserve all warnings,
  omissions and opaque cursors. Hosted mutability belongs in `--cursor` help;
  result text omits the repeated notice. Complete empty output stays concise.
- Verified schema/live grep lacks resolved package version and target-relative
  read paths. Do not invent npm:express@5.2.1 from an unversioned request or
  substitute package-relative paths for supplied repository-root read paths.
- Before rebase, this branch had the earlier search layout with copyable docs
  fragments and no per-hit commands. Main f89909f / PR434 uses backend-selected
  ReadTarget descriptors and restores per-hit commands, matching the user output.
  This supersedes that earlier observation; grep adopts the new descriptor field
  while preserving its own approved grouped layout. Search remains upstream behavior.
- Frozen two-case prototype: mixed 6,929 bytes / 2,106 tokens, repository 5,719
  bytes / 1,687 tokens, including
  all 81/99 distinct windows and the actual cursor. These are layout-study
  numbers; remeasure the exact built formatter before claiming final savings.
  Both copied prototype locators were replayed against production: pinned
  `lib/application.js` lines 24-28 and hosted 3.x application lines 106-110 pass.
- Acceptance: sequential numbered copyable headers, one website summary despite
  multiple pages, first-appearance file ordering, exact full-SHA/root-path reads,
  safe shell operands, unchanged JSON, complete/partial empty coverage and all
  native span/context/color invariants. Add compact/detail selection/strictness
  regressions and verify exact captured fixture projection with the added fields.
  Re-run both built size cases and >=65% byte/token reduction against originals,
  focused and full tests, typecheck/build/package checks, affected live CLI/MCP
  and built smoke, exact source repro/mixed two-page compact+detailed continuation,
  real printed-header reads, and one narrow agent follow-up workload.
- Mechanical dispatch sequence (serial, one concern each): existing Luna worker
  updates only the two frozen compact fixtures plus provenance README to include
  original scope identity fields, proved by exact raw projection; then updates
  the existing 100-hit mixed regression to prove numbered locator headers and
  retained rows. One correction dispatch makes its fixed header array a typed
  tuple after project typecheck caught an optional array index. Coordinator owns core selections, formatter, other regressions,
  docs, measurements, live acceptance, review and delivery. Earlier cursor-help
  dispatch remains accepted. Full-access sandbox; no backend edits or releases.


Locator-revision stable checkpoint (2026-09-29; final review pending):

- User-approved layout implemented. Fixed built width-80 cases: mixed 6,929
  bytes / 105 lines / 2,106 o200k_base tokens; repository 5,719 / 114 / 1,687.
  Reductions against original output: 70.5% / 73.8% and 70.7% / 77.5%
  bytes/tokens. All 100 occurrences and 81/99 distinct windows are retained.
- Exact compact projection checks pass for both fixtures after selecting source
  identities; all four captured detailed pages retain deep-equal JSON.
  Focused tests: 47 pass / 323 assertions. Full suite: 5,160 pass / 18,743
  assertions / 225 files. Typecheck, Biome, build and package validation pass.
- Production exact source repro passes through both source Bun and built Node.
  Mixed CLI/service compact+detailed two-page continuation retains two scopes,
  distinct repository/site hits, UNSPECIFIED then CURRENT, input indices [0,1]
  and distinct cursors. Built mixed/repository/no-hit pages and copied-header
  reads pass. User middleware repro has 13 file/page headers and one website
  identity. Partial/no-hit rendering retains every coverage fact.
- Authenticated CLI smoke: 154 steps, both cohorts; MCP: 65 steps, both cohorts.
  Built secret-free CLI/MCP smoke pass. Initial live built check overlapped
  package validation's dist rebuild and was invalidated; repeated after the
  rebuild, all live cases pass. Failed capture/log is retained separately.
- Targeted Codex skills-surface agent eval of the actual new layout made two normalized
  read-command batches (four actual CLI reads: both windows in text, then JSON), reopened the exact pinned file and hosted URL and
  reported returned ranges 22-32 and 103-113. No isolation violations were
  emitted. Tool calls/final/metrics inspected; no grading or broad model-quality
  claim is made. Prior source-alias eval is historical evidence only.
- Internal current full-delta review is clean. Existing retained external
  reviewer will inspect the updated delta after requested main rebase; round 3
  remains pending. The user explicitly requested rebase on origin/main and
  adaptation to updated unified read targets at this checkpoint.
- Coordinator owns core/formatter/read preservation; the same Luna worker made
  two accepted mechanical returns (fixture identities and mixed regression),
  plus one tuple-typing correction after typecheck. Earlier cursor-help return
  remains accepted. No backend/MCP migration/release scope added.

Proof artifacts: `/tmp/nuckelavee-grep-locator-{benchmark-results,token-results}.json`,
`-rendered/*.txt`, `-live-{mixed,repository,nohit,middleware}.*`,
`-prod-replay-results.json`, `-replay-auth.log`, `-source-repro-auth.log`,
`-json-replay.log`, `-partial-output.txt`, `-focused.log`, `-full-tests.log`,
`-cli-smoke-auth.log`, `-mcp-smoke-auth.log`, `-built-smoke.log`, and
`-agent-codex/workloads/nuckelavee-grep-locator-read-followup/`.

Requested main integration (2026-09-29; COMPLETE):

- Rebased the stable checkpoint onto origin/main f89909f, including target-relative
  site path fix PR432 and backend-owned ReadTarget adoption PR434. Rebase completed
  without conflicts; only this PR's grep delta remains against main.
- Backend schema explicitly exposes grep readTarget as the same exact one-line
  action as legacy read. Query aliases `read: readTarget` and selects only its
  four consumed fields; JSON keeps required nullable path and one-line bounds.
  Native selector is unused by this grep contract and is not fetched.
- Read locator targets are now fully opaque, printed unchanged and shell/JSON
  quoted only. Removed the private target canonicalization helper; provenance
  Sources summary still uses canonical short labels. This aligns ownership with
  unified read and removes the trimming issue at its source.
- Earlier canonicalized-header measurements remain historical. Rebuilt Node
  formatter, width 80 and no ANSI, with native windows and full cursor:

  | Fixed case | Bytes before -> after | Lines before -> after | o200k_base tokens before -> after |
  | --- | --- | --- | --- |
  | Mixed 100 | 23,509 -> 6,965 (-70.4%) | 413 -> 105 | 8,038 -> 2,115 (-73.7%) |
  | Repository 100 | 19,487 -> 5,767 (-70.4%) | 297 -> 114 | 7,506 -> 1,699 (-77.4%) |

  Both exceed the 65% byte/token reduction criterion. All 100 occurrences and
  81/99 distinct windows, hit order in JSON, exact reads and cursors remain.
- Current full suite: 5,229 pass / 0 fail, 19,528 assertions / 227 files.
  Focused five files: 47 pass / 324 assertions. Typecheck, Biome,
  build/public-package validation and built secret-free CLI/MCP smoke pass.
  Two exact compact fixture projections and all four captured detailed-page
  JSON replays pass; malformed/unknown outputs still fail strict validation.
- Authenticated production CLI smoke passes 156 steps across stable and
  experimental cohorts; MCP smoke passes 65 steps. Built secret-free CLI smoke
  passes 38 steps and MCP registration smoke passes both cohorts (9 steps).
- Fresh production verification of the new wire selection passes: source Bun
  and built Node exact package limit-1 repro; mixed CLI and service
  compact/detailed two-page continuation; both scopes, site attribution [0,1],
  UNSPECIFIED then CURRENT, distinct repository/site hits and cursors.
  Mixed/repository/complete-empty built output passes; partial/no-hit fixture
  retains all coverage facts. Printed HTTPS repository and hosted URL headers
  reopen actual content with the exact SHA/root path and requested line bounds.
  Source CLI middleware repro retains 100 matches / 93 lines / 13 sequential
  file/page groups and exactly one canonical website in Sources.
- Fresh targeted Codex skills-surface eval inspected actual tool calls, final
  response and metrics: four completed CLI reads (both windows as text and JSON),
  exact pinned file and hosted URL, returned lines 22-32 and 103-113. The agent
  used the equivalent github: alias for the repository; literal emitted HTTPS
  targets were independently replayed above. No isolation-violation file was
  emitted. No grading or general model-quality claim is made.
- The coordinator adapted wire selection/opaque target ownership; one bounded
  Luna return updated only three mixed-fixture expected headers (one focused
  case, 21 assertions). No new helper, fallback, scope/limit change or dependency.
- Rebased complete-delta internal review found no issues. External round 3
  directly reviewed the whole PR and found one cosmetic duplication: explicit
  root site targets repeated the same identity after the target label. Backend
  request normalization assigns `site:<host>` to the scope; Sources attached
  the equal canonical label without checking equality. Accepted as minor: one
  redundant label on a documented input, remedied by filtering identical
  summary identities and one site-only regression. This preserves distinct
  provenance and every read target. Bounded sibling scan covered both summary
  branches, target grouping, corpus labels, mixed fixture, rendering tests and
  search's site-only summary; no additional defect in this class was found.
  Luna applied the one-line filter and site-only regression: two tests / 27
  assertions, including unchanged mixed-case evidence. Its first return
  addressed the stale earlier URL-header slice; the coordinator reissued only
  this deduplication concern, then verified the actual diff and proof. This
  cost one correction dispatch; no product reinterpretation was delegated.
  The full revised-delta internal closure review is clean. External round 3
  was not clean and did not spawn its final-check subagent; the three-round
  limit prevents round 4. The sole finding is fixed and verified, with no
  unresolved product decision or major finding requiring escalation.
- Post-closure full suite: 5,230 pass / 0 fail, 19,534 assertions / 227 files;
  focused five files: 48 pass / 330 assertions. Typecheck, Biome and
  build/public-package validation pass. Both rebuilt fixed output cases are
  byte-identical to the measured 6,965/5,767-byte results, so the same token
  measurements apply. Fresh built Node and source Bun explicit site-only
  production output shows exactly `Sources: site:expressjs.com`.
  Fresh authenticated production CLI smoke passes all 156 steps, MCP all 65
  steps, across stable and experimental live cohorts. Both built secret-free
  smoke suites pass (38 CLI / 9 MCP registration steps).
- The user dispatched a backend agent to choose canonical repository read
  locators. CLI continues passing through the backend action, so that format
  will appear automatically without target substitution. The CLI smoke header
  assertion compares the exact action from its preceding JSON response rather
  than requiring an HTTPS spelling; target-format ownership stays in backend.
- Product decisions: none for grep. Search on main still has the redundant
  commands shown by the user: its header omits the backend selector carried by
  the separate action. That wider search presentation correction is outside
  this grep adaptation; the observation is retained for follow-up rather than
  claimed fixed.


Post-rebase proof: `/tmp/nuckelavee-grep-opaque-{local,local-followup,focused,full-tests,typecheck,packages}.log`, `-token-results.json`, `-rendered/*.txt`,
`-live-{mixed,repository,nohit,middleware}.*`, `-prod-replay-results.json`,
`-replay-auth.log`, `-source-repro-auth.log`, `-partial-output.txt`,
`-smoke-built.log` and `-agent-codex/`. Post-closure evidence uses the additional
`/tmp/nuckelavee-grep-opaque-closure-` prefix: full/focused tests, static and package
checks, size comparison, explicit site source/built output and all four smoke
logs. Original proof artifacts are preserved.

Final continuation placement (2026-09-29; VERIFIED):

- The user explicitly supersedes the earlier cursor-above-evidence choice:
  move only the More matches guidance and opaque cursor option below every
  file/page match, using the same dim styling as the header read templates.
  Keep coverage, unavailable-target and expiry/incomplete warnings above evidence.
- Shared grep presentation owns placement and styling. Reuse existing wrapping,
  quoting and dim helpers, wrapping prose before adding ANSI and leaving the
  cursor option intact. CLI and private MCP syntax both retain exact cursors;
  plain and NO_COLOR output have the same readable text. JSON is unchanged.
- Prior exact built baseline: mixed 6,965 bytes / 105 lines / 2,115 o200k_base
  tokens; repository 5,767 / 114 / 1,699. Rebuild those two fixed Node width-80
  no-color cases and compare sizes against both this baseline and the original
  captured 23,509/19,487-byte and 8,038/7,506-token output. No clipping or new data.
- One bounded Luna slice owns formatter relocation/dimming and its ordering/color
  regressions. Coordinator owns docs, measurements, live/smoke acceptance, internal
  review and routine PR delivery. Full-access permission mode, no backend edits.
- Acceptance: cursor footer after final evidence row, exact CLI/MCP quoted cursor,
  dimmed wrapped guidance and cursor when colors enabled, ANSI-stripped parity,
  unchanged complete-empty/coverage/expiry/read actions/JSON and existing evidence.
  Run focused grep tests, required build/type/package checks, affected source and
  built CLI/MCP smoke; inspect actual source/built output and one targeted agent
  read-follow-up. External round limit is already reached for this PR; no fourth
  external round is dispatched. Verify the new delta internally and report that
  review limit explicitly, retaining the existing Claude reviewer.
- Implementation: one Luna return relocated/styled continuation and updated its
  regressions. Focused worker proof: 13 tests / 95 assertions. The test table
  repeated the earlier unchecked-index typing issue; parent typecheck verified
  two TS2532 failures. Coordinator explicitly took the bounded correction inline
  (`cases` as a readonly tuple), re-read sibling table uses and verified typecheck.
  This was a worker typing error, not a reopened product decision or new scope.
- Current checks: full suite 5,231 pass / 0 fail, 19,552 assertions / 227 files;
  focused grep/CLI five files 49 pass / 348 assertions. Typecheck, Biome,
  build/public-package validation and both built smoke suites pass. Two built
  size cases retain the exact byte/line/token counts above; token savings remain
  73.7% / 77.4% against originals. No evidence is clipped or dropped.
- Production built mixed/repository/no-hit output passes, including cursor after
  final match and exact footer option. Literal file/page headers reopen correct
  content. Source Bun TTY confirms dim intro and dim intact cursor below matches.
  Package/mixed continuation and compact/detailed parsing replay pass; built
  partial/no-hit rendering retains every warning. Authenticated production
  source CLI smoke passes 156 steps and MCP smoke passes 65 steps after the
  research caller budget correction; built CLI/MCP smoke passes again.
- The targeted Codex read-follow-up inspected tool-calls/final/metrics/isolation:
  one normalized command batch containing two actual successful CLI reads, exact
  pinned repository path (20-35) and hosted page (101-115). The agent chose the
  equivalent github: repository alias; emitted HTTPS locator replay independently
  passed. No isolation-violation file was emitted; no grading claim.
- Full revised-delta internal review is clean. Existing external three-round
  result/limit remains as recorded; this footer revision has no additional
  external clean round. Current proof uses `/tmp/nuckelavee-grep-footer-`: tests,
  static/build/package/size/token logs and results, live plain/TTY output,
  replay, partial coverage, source/built smoke and agent eval artifacts. Prior
  proof files are preserved.
- Required authenticated MCP smoke's stable cohort passed, but its experimental
  research URL JSON follow-up once hit the SDK's 60-second request timeout.
  The same two-call research flow then completed in 29.1s and 43.3s in a
  bounded diagnostic, and the core service permits 210s. Root cause: the
  local smoke client's default request deadline was shorter than the service
  contract. `scripts/mcp-smoke.ts` now passes the existing exported service
  budget to its three research calls only. No product timeout, retry, polling,
  fallback or infrastructure changed. Full revised-delta internal review found
  no issue; typecheck, full tests and public-package validation pass again.
  Authenticated MCP smoke rerun passes all 65 steps, with the research URL
  JSON follow-up completing in 24.6s; both built smoke reruns pass. The
  original failed 60s request log is retained as root-cause evidence.

Phase boundary: output PR #433 merged at
`45b72120d1ae2810a3370da1ecd838259ac5b576`. Its final verification
passed 5,231 tests / 19,552 assertions across 227 files, authenticated
production CLI smoke (156 steps), authenticated MCP smoke (65 steps), and the
built smoke suites. The fixed mixed/repository captures measured 2,115/1,699
`o200k_base` tokens, 73.7%/77.4% below the original output; these are size
measurements, not agent-quality or latency claims. Main CI and agent-eval
workflows passed for the merge commit. No new CLI or MCP package release is
recorded at that merge: main was at version 0.23.0 and the newest tags predated
it. The later 0.24.0 release consumed its fragments. No hosted MCP adoption or
deployment is recorded for that output increment.
Keep the same useful formatter as the MCP output contract.

### Phase 2 — MCP `grep` replaces `code_grep` (IN REVIEW)

Expected outcome: the advertised MCP catalog has one mixed-source `grep` tool;
agents receive the same reads, pagination and truthful coverage as CLI users.
Legacy source-only flags disappear from MCP, with migration documented.

Assumptions: Phase 1 semantics and shared helpers suffice for one MCP adapter;
required provider service additions follow the existing read/list-service
precedent. Verified on refreshed `origin/main` at
`2f3d4fdc7c008623e89aa91558a690b23f0eb309`: stable MCP has `list`,
`read`, and `code_grep`, but no unified `grep`; `code_files` and `docs_list`
are retired. The active quick-start guide already routes inventory to `list`.
The public code reference still incorrectly maps CLI inventory commands to the
retired tools; update those adjacent mapping lines while changing its grep
mapping. Existing search text and read descriptions also route agents to
`code_grep`. Production unified grep conformance passed on 2026-09-29; the
backend schema documents retained `UNSPECIFIED` scopes and continuation.
The unchanged `code_grep` descriptor still serializes to 7,161 UTF-8 bytes
from `getMcpToolDescriptors()` on this main. This is a descriptor-size baseline,
not a latency or agent-quality benchmark.
Unknowns: none blocking this increment. Product decisions: none; MCP removal
and CLI legacy retention are requested. Dependencies: Phase 1 and output PR
#433 merged, the current `list`/`read` catalog, authenticated live service
access for acceptance, and public-package compatibility validation.

Ownership: MCP registration and agent guidance own tool routing; the existing
shared grep helpers own request, result, error, and text semantics; `list` owns
inventory. Keep routing changes in those existing owners rather than adding an
inventory adapter or changing the unified `list` contract.

Implementation order:

1. Add `packages/mcp/src/tools/grep.ts` with the proposed schema,
   `readOnlyHint: true` and existing open-world annotations. Inject
   `GrepService`, delegate to the Phase 1 helpers, and preserve caller
   cancellation. Append the existing `CODE_GREP_GUARDRAIL` to the new tool
   description because results still expose source comments and strings;
   update `docs/implementation/TOOL_GUARDRAILS.md` to name the replacement.
   Required `grepService` joins `McpToolServices`; update
   providers, local server composition, descriptor-only service stubs and
   mock factories. Export stable grep service types/implementation via
   `client.ts` and necessary provider types via `index.ts`.
2. Replace `createGrepRepoTool` in the stable MCP catalog, not merely its name.
   Remove obsolete MCP-only registration/exports/tests; retain the legacy CLI
   service/request/output dependencies and its behavior assertions. Convert
   `src/tools/grep-repo-parity.test.ts` cases that currently depend on the
   retired MCP tool into focused legacy CLI checks instead of deleting their
   coverage. Replace the old paired `code_grep` case in
   `scripts/cli-smoke.ts` with a unified CLI/MCP `grep` parity case and keep
   the legacy CLI clamp/default case as a CLI-only smoke assertion. Update
   public `@githits/mcp/smoke-test` catalog, guide, text/JSON and read-follow-up
   assertions for the new tool; `remote-mcp` consumes this helper after its
   separate package adoption. Add root CLI/MCP parity tests for structured
   inputs and JSON results.
3. Update active grep-specific instructions, tool descriptions, error/recovery
   actions, quick-start guide, public skills, README/CLI and implementation
   references, smoke catalog assertions, eval expectations and current tool
   counts. Route known-pattern matching to `grep`, inventory/path discovery
   to the existing `list`, and exact windows to `read`; preserve the distinct
   `search` discovery route. In
   `skills/githits-code/references/code-and-docs.md`, map new CLI `list` to
   MCP `list` and new CLI `grep` to MCP `grep`. State that the retained legacy
   CLI `code files`, `docs list`, and `code grep` commands have no exact MCP
   aliases; use the relevant new tool with its own schema and documented
   capability differences. This also corrects the adjacent stale
   `code_files`/`docs_list` mappings without changing list behavior. Update
   MCP branches of shared search pivots and read/recovery
   descriptions while preserving the legacy CLI command and its own routing
   where applicable. Keep historical eval results and migration mentions
   intact. Where `code_grep` actions currently carry legacy flags, construct
   valid unified target entries or remove the unsupported action with truthful
   guidance; never mechanically rename incompatible payloads. Correct the
   retained legacy CLI's ASCII-only case-folding claim in
   `GREP_REPO_PATTERN_NOTE` and its `--case-sensitive` help; the current backend
   `grepRepo.caseSensitive` schema explicitly documents Unicode-aware folding.
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
   legacy 30-second preparation wait. It must also mention the retired
   `code_grep` catalog name and the public smoke-helper migration used by
   `remote-mcp`. The CLI and MCP-list fragments were consumed by the 0.24.0
   release; do not rewrite those already-released changes.
   Update durable docs with the actual final public schema and API migration.

Acceptance and evidence:

- Catalog tests advertise `grep` and exclude `code_grep` in stable descriptors
  and local server registration; `list` and `read` remain advertised, and
  `code_files`/`docs_list` remain absent. All information tools remain read-only.
  The `grep` descriptor retains the existing source-comment/string guardrail.
  Its description says `Replaces code_grep.` after the first 80 characters so
  old-name tool searches can find the replacement without sacrificing its
  standalone selection sentence. First sentence: “Find regex or literal
  matches across source and documentation.”
  (under 79 characters, no internal periods). First-80 tests and field
  descriptions must independently explain package hosted-doc inclusion,
  all-corpus default, per-target scopes, regex/case/context defaults and opt-ins, exact
  reads and continuation.
- Handler/provider/parity tests prove the shared request/result/text/error
  semantics, structured multi-target calls, explicit false/empty arrays,
  regex/case-sensitive/zero-context/all-corpus defaults and explicit opt-ins,
  read-action fidelity and no
  legacy service execution.
- Active quick-start, public skill, search recovery, and read guidance send
  known patterns to `grep`, inventories to `list`, and exact locators to
  `read`. No callable action uses retired `code_files` or `docs_list`, and no
  MCP action suggests `code_grep`; the descriptor's `Replaces code_grep.`
  migration note is not an action. CLI-to-MCP guidance maps the new commands
  and does not claim exact equivalence for retained legacy commands. The
  retained `githits code grep` command still works; historical result records
  are not rewritten. Legacy CLI help no longer claims ASCII-only case folding,
  with a focused help assertion.
- Run required unit tests, typecheck, build, plugin parity/generation checks
  and CLI/MCP smoke; run built smoke if launch/CI validation changes.
  Legacy CLI behavior tests and smoke checks remain after the paired
  `code_grep` parity fixture is removed. The exported `runMcpSmoke()` helper
  exercises the new catalog and request/result contract.
  Validate the packed public MCP package from outside root path aliases,
  including an external request-scoped provider supplying `grepService`.
- Authenticated MCP smoke repeats the Phase 1 package/mixed/two-page/read
  cases against the deployed production backend and checks truthful partial,
  unvisited-scope, omission, exact-read and continuation handling. Run the
  corresponding dev cases when dev access is available; do not treat dev-only
  results as production proof.
- Run `bun run agent:e2e --agent codex --server local --guidance-profile
  descriptors --workload eval/agentic/workloads/code-grep-investigation.md`
  and the matching Claude run. Add one focused mixed-docs workload: find the
  known `middleware` literal in Express source and hosted docs, then reopen the
  returned evidence. Production `hex:plug` returned `site_v6_required` even
  with the allowed preparation wait on 2026-09-30, so the original Plug
  fixture cannot exercise this workflow; `npm:express@5.2.1` returned both
  repository and hosted-doc hits for the literal in one capped page. Run both descriptor-only agents for it; use the full
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

Phase 1 boundary reorientation was completed at `origin/main`
`9f96f74319eeb718abef2969785a005ef4bef182`. The initial next-steps verdict was
PROCEED with Phase 2. On 2026-09-29 the user required output quality before
MCP; output PR #433 fulfilled that requirement and merged. On 2026-09-30,
refreshed `origin/main` was `2f3d4fdc7c008623e89aa91558a690b23f0eb309`.
PR #428 merged unified MCP `list`, retiring `code_files` and `docs_list`.
Phase 2 keeps inventory on `list` and corrects the stale public code-reference
mappings. The MCP adapter now uses the merged core grep service and shared
request/result/error/text helpers, requires `grepService` from providers, and
exports its implementation through the public client entrypoint. It preserves
caller cancellation without assuming the core service accepts a transport
signal. The current released root and MCP versions are 0.24.0; the independent
Phase 2 fragment requests minor impact for both artifacts. No hosted-server
code, package release, or deployment is included.

The Phase 2 branch was rebased onto `origin/main` at `8ae11a4` on 2026-09-30.
Rebase conflicts in repository-target documentation and the public code
reference kept newer list/read wording while updating grep to the new MCP
tool. The first external review found missing INDEXING wait guidance, a root
CLI/MCP request-and-JSON parity test, eval mock routing, and minor
documentation errors; those are fixed. The rebased tree passes 5,134 unit
tests, typecheck, build, plugin checks, public-package validation, CLI live
smoke, and both built smoke suites. Production MCP smoke passed all unified
grep calls, but the unrelated experimental research cohort later returned
`PROTOCOL_ERROR`; a narrow replay reproduced that research error. Two prior
full MCP smoke runs failed at a different experimental research step after
the grep cohort passed. Focused production and dev two-page grep/read
acceptance passed. Codex descriptor-only source and mixed-docs evals used
grep then exact reads with high confidence. The initial Claude eval lacked an
injected credential and stopped before tool use with `authentication_failed`;
this was not evidence of token expiry. The authenticated Keychain-backed
rerun passed both workloads: source in 19.2 seconds with three MCP calls
(quick_start and two grep calls), mixed docs in 13.4 seconds with four MCP
calls (quick_start, grep, and repository/hosted-page reads). Both reported
high confidence and no isolation violations; Claude token/cost telemetry is
unavailable, and no graded answer-quality claim is made. Proof is retained at
`/tmp/unified-grep-phase2-eval-claude-authenticated`.
External review round 2 had no code findings; its two minor documentation
corrections were applied. Draft PR #439 is open with passing PR CI. The
experimental research smoke failure remains a verification limit, not deferred
grep implementation.

Copywriting follow-up requested on 2026-09-30: scope is the grep descriptor,
its field descriptions, affected quick-start/CLI guidance, and stale active
grep documentation; schemas, defaults, queries, runtime behavior, and unrelated
tool contracts stay unchanged. Unknowns and product decisions: none. The tool
schema owns call mechanics; the shared guide owns routing, evidence reuse, and
limits. Corrected stale package-artifact wording to indexed package source
trees, distinguished legacy repository-file grep from hosted docs, documented
the missing top-level CLI controls, and marked superseded checkpoints as
historical. Active canonical guides remain aligned; archived captures and
historical eval records remain evidence of their original runs.
The actual MCP listTools grep descriptor measures 4,105 to 3,522 UTF-8 bytes
and 887 to 781 `o200k_base` tokens. The quick-start guide measures 1,307 to
1,333 tokens; their combined count falls from 2,194 to 2,114. These are static
copy-size measurements, not model billing, latency, or graded answer quality.
Baseline/after messages and counts are ephemeral, uncommitted local files
under `/tmp/unified-grep-copy-`.
Acceptance is preserved first-sentence/first-80 discovery, strict schema and
guide parity tests, required smoke/build/package checks, targeted Claude/Codex
source and mixed-docs evals, and one external copywriting review.
Copy follow-up verification: full unit suite passed (5,134 tests); closure
checks passed (51 tests). Typecheck, build, plugin generation/check, and public
package validation passed. Live CLI smoke passed all stable/experimental
cohorts; MCP stable smoke passed including grep, while unchanged experimental
research text failed its success assertion. Both agents completed descriptor-only
MCP source/mixed runs with no isolation violations and inspected answers;
Claude source skipped quick-start and used two grep calls, while its mixed run
and both Codex runs used quick-start. CLI-skill runs were attempted but their
isolated homes lacked GitHits credentials: mixed answers were inconclusive,
and source answers used npm tarballs. Those runs are not authenticated GitHits
UX proof, regardless of harness success. No answer-quality grading was run.
External copy review had no code findings; minor pattern/corpus/cursor wording,
concrete target examples, and temporary-artifact wording were corrected.
Current live MCP output confirmed canonical `github:` read headers; historical
HTTPS response fixtures remain unchanged as evidence of their capture date.

After Phase 2 merges, move lasting decisions and migration/operational facts to
`docs/implementation/unified-grep.md`, transfer any actual major deferred work
to the repository backlog, then delete this plan. No deferred development or
new infrastructure is proposed. The maintenance opportunity is to retire the
MCP-only legacy adapter after migration while preserving shared CLI helpers;
do not absorb a general code-navigation refactor.

User direction on 2026-10-01: merge the reviewed unified-grep increment and
handle overall instruction optimization separately. That follow-up, including
the unresolved search-versus-grep identifier-usage comparison, is recorded in
[open-backlog.md](open-backlog.md). Unified-grep implementation has no remaining
code or copy findings.

## Design review

Completed Phase 1 execution sequence (one Luna worker, sequential dispatches):

1. Coordinator: core service/types/query/validation and transport tests.
2. Luna: shared request normalization plus its isolated behavioral tests.
3. Coordinator: result projection, mapped errors and coverage-aware formatter.
4. Luna: container and central mock wiring against the settled service seam.
5. Coordinator: CLI adapter and flag/action tests; live conformance and smoke.
6. Luna: root command registration against the tested command factory.
7. Coordinator: docs, release fragment, verification, review, stable commits
   and draft PR. At that Phase 1 delivery, Phase 2 had not started. Worker returns verified uncommitted
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
At that correction checkpoint, Phase 2 was pending the Phase 1 merge. No
backend worktree was changed by that client correction, and no limits, scopes
or acceptance requirements were reduced.

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
