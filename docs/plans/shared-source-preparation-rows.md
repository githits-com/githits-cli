# Shared source and preparation rows

## Status and outcome

- Overall: **IN PROGRESS — reviewed plan, implementation authorized**.
- Phase 1: **IN PROGRESS** — search/status, grep, annotated read and
  list use the same compact source and preparation wording in CLI and MCP.
- Product decisions: **none open**. On 2026-10-06 the user selected the shape
  below, canonical `github:` targets, `observed HEAD`, and shared strings with
  caller-specific placement, indentation and width.
- Dependencies: the existing commit-date increment in draft PR #454, rebased
  onto `origin/main` at `d425bb4`; existing backend provenance and preparation
  contracts; existing per-tool projections and actions.

When complete, a reader can identify the exact served snapshot and distinguish
it from the commit being prepared without decoding internal field labels.
Useful results stay usable immediately. Multiple sources repeat compact rows.
Known dates are optional facts, never freshness or wait decisions.

```text
Sources:
  - github:anomalyco/opencode@bbd72fb8 (committed 2026-09-01, indexed from ref HEAD)

Preparing:
  - github:anomalyco/opencode@0112a92c (indexing, estimated total: 100-120s, observed HEAD)
```

This is an unwrapped example; at ordinary widths, continuation lines hang under
the row text. The preparing SHA is illustrative, not a new live observation.

## Verified evidence and scope boundaries

Evidence was collected from this checkout on 2026-10-06:

- `unified-search-presentation.ts` owns search evidence, source readiness,
  full-SHA comparisons, prior-HEAD qualification, lifecycle and continuations.
  `unified-search-text.ts` owns shared CLI/MCP copy. Current healthy output is
  `Sources: <requested identity> - code`; exceptional snapshots use target
  groups with `commit: ...`, requested-commit prose and separate searched lanes.
  Dates currently appear only on exceptional repository snapshot clauses.
- `grep-text.ts` already emits `Sources:` bullets, deduplicated by resolved
  repository/full SHA/corpus or canonical site. It separately emits coverage,
  omissions and exact read operands. A stale fixture renders the same served
  commit twice: a source row, then `Served <full SHA>; requested HEAD.`
- `read-file-text.ts` and verbose `read-file-response.ts` call
  `buildTargetResolutionNotes`. Its prose uses `served=`, `fresh=` and
  `indexingRef=`. Its display-string comparison strips commit suffixes, so two
  different commits both labelled HEAD suppress the requested identity. A
  dated read fixture reproduced that omission. Human provenance must compare
  full identities, not formatted strings.
- `list-text.ts` uses `# source ...` plus paths and exact follow-up guidance.
  The compact `ListService` query omits target resolution; JSON fetches the
  detailed block. `list-response.ts` has its own nullable identity projection.
  Adding dated source rows needs a minimal compact provenance selection and
  date preservation, not enabling the entire detailed query.
- Main's `indexing-estimates-text.ts` already owns preparation rows, total-time
  wording and native retry copy. `terminal-text.ts` owns safe prose wrapping.
  Search currently overrides repository state to `preparing source`; other
  tools use `indexing`. Grep embeds timing in `Omitted:` rows instead.
- `DiscoveryIndexingEstimate` already supplies `repositoryUrl`, full
  `commitSha`, requested aliases and timing. The backend explicitly permits a
  missing SHA while resolution is pending. `resolvedRequested` can differ from
  the active same-ref job's SHA; it does not identify work by itself.
- The backend schema at verified merge
  `1dc93a09b5d2ffb0e291e22f005df75c165a83e8` confirms nullable
  `TargetResolutionIdentity.committedAt`, `ListResult.targetResolution` using
  that type, and the preparation identity fields. The local backend checkout's
  working schema was older and omitted `committedAt`; the merge object and
  supplied dev verification resolve that contradiction. No backend files were
  changed. Public `GrepTargetStatus` has neither dates nor resolved-requested
  provenance; grep cannot independently prove observed HEAD.
- Supplied upstream dev search/status/read records prove independent nullable
  dates and exact read-now behavior. This worktree's prior live runs were
  unauthenticated; they do not establish live business-query behavior. Production
  schema deployment remains unverified and required before release/adoption.
- Post-rebase focused tests: 266 pass, 0 fail, 1,898 expectations across nine
  files. Scratch search/date captures: 24 pass, 0 fail, 48 expectations.
  Representative grep/read captures are in
  `/tmp/commit-date-main-output-comparison.json`; search captures are in
  `/tmp/commit-date-exact-outputs.txt`. These are fixture renders, not live runs.

This plan owns only the shared provenance/preparation boundary selected by the
user. `search-output-ux.md` remains the broader per-tool information-hierarchy
plan; its unrelated package formatter work is not absorbed here. The earlier
one-tool-at-a-time constraint there does not govern this explicitly selected
cross-tool metadata increment. The completed original commit-date plan was
removed after review; permanent context lives in
`docs/implementation/search-snapshot-presentation.md`.

### Scope

Canonical `search` / `search_status`, `grep`, `list`, MCP code read and verbose
CLI code read; legacy CLI annotated consumers of the same preparation/provenance
helpers, including `code files`, `code grep` and code-context reads. Existing
mapped indexing errors reuse the preparation-row renderer automatically.
Hosted documentation source/preparation rows use the same grammar with their
own identities; they do not acquire repository provenance.

Raw CLI reads, non-annotated legacy inventories and `list --silent` preserve
their pipe-friendly bytes. JSON keeps all existing fields, null/omission
semantics and exact actions, with additive selected list timestamps. Tool
descriptors, user-facing input schemas, authentication, backend indexing policy, and published
agent guidance do not change.

No backend or remote-mcp edits, enrichment calls, age arithmetic, extra polling,
new retry behavior, cache, layout framework, flag or dependency. Full date/HEAD
metadata for public grep would require a separate backend contract extension;
it is not required for common wording from the facts grep has today.

## Ownership and architecture

**Shared MCP presentation naturally owns source/preparation strings because CLI
and MCP consume the same neutral facts.** Core services own wire selections and
decoding. Per-tool projections own evidence attribution, coverage and actions.
Putting copy in Commander or individual MCP handlers would duplicate it; putting
it in core would mix presentation into transport.

Add one small pure module, provisionally
`packages/mcp/src/shared/source-provenance-text.ts`, with typed source-row facts
and reusable identity/date/provenance clause rendering. Extend the existing
`indexing-estimates-text.ts` for preparing identities and the same row grammar.
Reuse `formatRepositoryTarget`, `formatIndexingEstimate` and
`wrapTerminalProse`; do not create a query builder or generic rendering DSL.

Data flow:

```text
existing service response
  -> per-tool evidence projection / small adapter
  -> shared source and preparation row wording
  -> existing tool formatter (placement, width, color, native actions)
```

The shared row helpers accept verified facts and rendering options; they do not
decide whether a source was searched, a job is alive, a request should wait or a
read pointer should change. Keep one formatter per tool and share the recurring
rows within those formatters. No new container dependency is required.

### Source rows

- Prefer `github:owner/repo@<8-character SHA>` when repository/full SHA are
  known. Preserve the full SHA internally for matching and deduplication.
  Use the existing supported repository-target formatter for other hosts.
  Otherwise retain the supplied source identity; never fabricate a SHA.
- Append independent known served date as `committed YYYY-MM-DD`, then known
  historical named ref as `indexed from ref <ref>`. A SHA-valued ref adds no
  redundant clause. Keep unknown clauses absent. Full timestamps remain JSON.
- The selected source-row shape applies to healthy current snapshots too;
  this replaces the earlier current-search one-line presentation. A current
  old/future-dated commit stays current and offers no freshness wait.
- Preserve source/corpus distinctions, package alias attribution, provisional
  qualifiers, and `no results` versus `no results on this page` where needed.
  Short rows omit redundant corpus detail; mixed/limited scopes retain it.
  Deduplicate only equivalent evidence. Different full SHAs, corpora, readiness
  or coverage cannot be collapsed because short labels happen to agree.
- Searched zero-hit sources disclose the searched snapshot. Unvisited/withheld
  scopes stay explicitly unsearched; do not present their identity as evidence
  that the requested snapshot was searched. Site rows preserve exact scope and
  hosted-documentation attribution.

### Preparing rows and requested provenance

- Use the actual preparation entry's repository/full SHA for a pinned row.
  Missing identity falls back to its supplied requested target labels. Hosted
  docs retain their target and `preparing documentation` state.
- Use common repository state `indexing`, compact advisory total bounds,
  elapsed execution and existing unavailable-estimate wording. Bounds are not
  remaining time, queue delay or a search ETA. Missing timing does not imply
  readiness or justify a lookup.
- Add `observed HEAD` only for a verified HEAD/default-branch intent whose
  resolved-requested repository and full SHA match that preparation entry.
  Merely seeing the literal ref HEAD, a matching SHA prefix, an estimate label,
  a served historical ref or a commit date is insufficient. It means HEAD at
  resolution time, not a continuing claim about the remote branch tip.
- Matching uses the supplied repository URL strings and full SHA strings with
  exact equality, before display formatting. URL spelling differences fail
  closed: omit the HEAD/date join and retain separate requested provenance.
  No new URL normalization layer is introduced. Test both repository mismatch
  with an equal SHA and same-display-prefix/different-full-SHA identities.
- Date the preparing commit only from independently dated `resolvedRequested`
  metadata matching its repository/full SHA. Never transfer a served date or a
  date from another identity, even for a same-ref/same-SHA job. Requested metadata
  cannot repair missing served metadata.
- When resolved requested provenance differs from both served and actual
  preparation work, retain a compact `Requested:` fact using the shared identity
  clauses, rather than falsely putting that SHA under `Preparing:`. The same
  applies when useful requested-date evidence exists without a preparation
  identity. Omit that extra fact when the preparation row already conveys it.
- Retained ended-search timing is historical evidence: qualify its state
  `indexing when observed`, retain useful requested-date facts and the existing
  fresh-search action. Never make its stored search reference pollable. A
  provisional result with empty estimates retains its provisional qualifier;
  do not synthesize active work or timing from it. The backend investigation
  recorded in `docs/backlog.md` remains separate.
- Each actual preparation entry stays associated with its own aliases and
  estimate. Do not merge jobs by mutable ref or sum durations. For grep, pending
  work moves to `Preparing:`; non-preparation omissions remain `Omitted:`.
  Preserve duplicate-input attribution and suggested-site recovery. A pending
  omitted input without an estimate still has its verified reason, no invented
  SHA/time. One omitted input must not erase a different usable scope.

### Recovery and state notes retained from legacy provenance

Replacing human `buildTargetResolutionNotes` calls replaces identity serialization,
not their recovery information. The disposition is explicit:

- `served=`, `fresh=` and `requested=` become source/requested rows. Opaque
  `indexingRef` stays JSON-only; no progress action is invented for it.
- Verified fallback freshness remains visible as `older snapshot` on the source
  row. This describes artifact freshness; only a full-SHA difference establishes
  a different commit or prior-HEAD evidence. A deferred branch resolution keeps
  its explanation; it does not become
  an observed HEAD or preparing-job claim. Preserve `requested_ref_indexing`
  and `no_current_fallback` explanations when the rows do not already convey
  them, qualified as historical for ended searches.
- `unavailable` with no served artifact retains `Target unavailable` and the
  requested identity. It must not disappear because `Sources:` is empty.
- Provisional sources retain `provisional`; do not infer active work from that
  qualifier alone. Unknown state/reason facts retain a compact labelled note
  (`Resolution state: ...; reason: ...`) where the existing helper emitted a
  resolution diagnostic, not a promoted ready/pending state. Authoritative
  `current` keeps its existing suppression of obsolete diagnostics.
- Existing `queryable now:` version/ref candidates and `suggested refs (may
  need indexing):` lines remain unchanged where those facts were already
  available to a human consumer. Preserve their distinction and current-state
  suppression; do not revive obsolete alternatives after readiness. Compact
  list need not fetch new retry arrays solely for parity with legacy commands.

Apply this disposition to both read text renderers, legacy grep text/terminal
renderers and legacy file-list verbose/empty paths. Search keeps its established
recovery projection. JSON warning generation stays untouched.

### Concrete per-tool placement

These examples resolve layout within the user-approved common rows. They do not
add new response fields, states or actions. Dates and timing are illustrative.
Native action syntax still differs between CLI and MCP.

**Search/status and grep:** outcome first; `Sources:` then `Preparing:` before
ranked hits/match snippets. Non-preparation omissions and coverage/recovery stay
attached to their scopes. Existing per-hit reads and pagination remain in place.

**List SOURCE (MCP):** replace the metadata-only `# source` header with a source
block, preserve the exact path base in a separate read-guidance line, then paths.
Preparation remains after paths and before continuation/retry, as on main.

```text
Sources:
  - github:expressjs/express@dbac741a (committed 2026-09-01)
Read files: read target="npm:express@5.2.1" path=$path
lib/application.js
lib/express.js

More results: repeat this list, adding:
  after="opaque-cursor"
```

**List SITE (MCP):** the source row uses the shared PAGE action target, not a
broader canonical owner, and the read-guidance line retains that same base.
If PAGE actions disagree, preserve the existing omission of a generic read
recipe. Empty inventories still use the existing no-files/no-pages outcome.

```text
Sources:
  - site:docs.example.test/api (hosted documentation)
Read pages: read target="site:docs.example.test/api" path=$path
/
client
reference/
```

**Annotated read:** existing contextual header, source block, then content.
Healthy current reads gain the known served row too. A fallback adds its
`older snapshot` qualifier; preparation/requested facts and recovery follow the
content. Raw CLI read still contains only content. For example:

```text
read | src/index.ts

Sources:
  - github:owner/repo@aaaaaaaa (committed 2026-09-01, indexed from ref HEAD, older snapshot)

1  const value = 1;

Preparing:
  - github:owner/repo@bbbbbbbb (indexing, estimated total: 100-120s, observed HEAD)
queryable now: refs=main
```

A healthy version of this annotated read omits `older snapshot`, preparing and
obsolete recovery; it keeps the known source row. Binary/no-content annotated
paths keep their existing outcome and do not lose available provenance/recovery.

**Grep pending duplicate inputs:** one preparing parent row per actual estimate
entry, never one copy of its duration per omitted input. Attach omitted-input
alias/index records under that parent when needed for package/multiple/duplicate
input attribution. Distinct input-specific suggestions stay under their input.
Pending inputs without a matching estimate get label-only preparation rows with
their verified reason; non-preparation omissions remain under `Omitted:`.

```text
Preparing:
  - github:owner/repo@bbbbbbbb (indexing, estimated total: 100-120s)
    Requested: npm:cold (input 0)
    Requested: npm:cold (input 2)
      Suggested site: site:docs.example.test
```

An ordinary single repository input that the row already identifies needs no
redundant requested subline. Keep source/job aliases whenever omitting them would
lose request-to-result attribution. Grep has no independent HEAD proof, so this
example correctly omits that label.

Legacy annotated `code files` uses the same 8-character source-row SHA as every
other new source row. Remove its old `indexed at ... / commit <7 characters>`
resolution line only when the source row conveys those facts. If a row cannot be
formed, preserve the existing resolution line, including its 7-character label,
as a separate diagnostic. Non-annotated modes are unchanged.

### Wrapping, actions and JSON

Shared strings and clause order are identical for identical facts. Callers supply
width, indentation and ANSI preference. Wrap prose with hanging indentation;
keep backend Unicode, ASCII-authored punctuation, and safe terminal metadata.
Source content and copyable action operands bypass prose rewriting.

Preserve exact backend `readTarget`, selectors, paths and ranges. Display labels
are not action operands. In particular, list's package/site path base and exact
read guidance survive changing its metadata header. Keep result order, cursors,
pagination, omissions, partial/completeness signals and no-hit lifecycle copy.
Read-now advice still precedes optional wait. Search CLI wait uses seconds;
grep/list/read CLI and MCP retain their existing millisecond units/caps.

Do not globally rewrite `buildTargetResolutionNotes` into text rows: it also
feeds structured search projections/warnings. Replace its human rendering uses
with the new fact renderer, preserving JSON projections and legacy machine
warnings. Compare full SHA facts in the human adapter to fix the verified
same-ref/different-commit omission.

## Phase 1 — uniform rows in one bounded increment

- Status: **IN PROGRESS**.
- Expected outcome: canonical tools and their annotated legacy consumers render
  the approved row shape with identical wording, accurate identities, compact
  wrapping, and unchanged action/coverage semantics.
- Assumptions: existing nullable provenance and preparation contracts are
  authoritative; missing public grep dates/HEAD proof are intentionally omitted;
  the existing list GraphQL identity type supports the documented date field.
  These are verified above, not inferred from dates or backend message prose.
- Unknowns/product decisions: **none for implementation**. New authenticated
  CLI/MCP dev behavior and agent-eval availability are validation outcomes to
  report during delivery; production rollout confirmation is a release gate.
- Dependencies: rebased PR #454 and main's existing row/wrapping helpers. No
  other lane's changes or backend development are needed.

### Ordered work

1. Add source-row and preparation-row behavior tests using existing fixtures and
   the supplied dev response identities. Build the small pure shared renderer.
2. Adapt search's existing semantic projection so both current and exceptional
   served sources expose row facts; keep prior-HEAD and next-action decisions
   intact. Integrate initial and retained status rendering together. Replace
   repeated commit/target prose with rows without losing unrelated warnings,
   alternatives, attribution or coverage.
3. Integrate grep source rows and preparation omissions. Reuse its exact-source
   grouping, visit/traversal truth, file snippets and read/cursor syntax. Remove
   the redundant served-SHA coverage sentence only when the source row conveys
   that same fact; retain requested-ref and coverage information.
4. Integrate annotated read and legacy text provenance through the shared row
   renderer. Preserve content, raw modes and JSON. Render same-ref/different-SHA
   requested facts correctly without reclassifying backend provisional state.
5. Select minimal list provenance for normal text and preserve it through schema,
   types and `list-response.ts`. Keep detailed JSON selections and existing
   compact site read actions. Add optional `ListParams.includeTargetProvenance`
   as a service-only selection option: true for normal text, false for silent
   text, and detailed mode always selects provenance. Existing callers that
   omit it retain their current selection. Do not expose a user/MCP flag. Use
   GraphQL field-selection variables and directives to keep
   per-entry metadata, browse actions, retry arrays and opaque indexing refs
   detailed-only. The text subset is requested kind/ref, resolved-requested and
   served repository/ref/full SHA/date, plus freshness/reason. The schema must
   accept omitted conditional fields while preserving returned nulls. Add the
   date only to served/resolved-requested identities; original request is undated.
   Update SOURCE/SITE list metadata placement without changing path bases or
   continuation/read guidance. `--silent` still emits only paths.
6. Extend mapped errors/other direct preparation consumers only through the
   common row helper; retain error classification and native remediation. Run a
   bounded sibling scan of `renderPreparationSection` and human
   `buildTargetResolutionNotes` consumers for duplicated old wording or lost
   facts. No unrelated package-tool redesign.
7. Update permanent search-snapshot, indexing-estimate, unified-list and parity
   docs; add an independent `changes/shared-source-preparation-rows.changed.md`
   fragment with **minor** pending impact for `githits` and `@githits/mcp`
   (additive public list timestamp/selection contract plus shared behavior).
   Keep the existing commit-date fragment and historical changelog intact.
   Explicitly name list text and JSON in the production schema gate: adding
   `committedAt` to its query document requires production support even when a
   directive skips the field, because GraphQL validates the whole document.
8. Verify, internal pre-flight, and resume the retained PR #454 Claude reviewer
   for implementation rounds (the fresh plan reviewer is separate and closes
   after plan review). Then stable commits and update draft PR #454/title/body
   to describe the combined final increment. No merge, release, tag, publish or
   deploy.

### Verification and acceptance

Focused tests must establish the following observable outcomes, not mirror the
helper's implementation:

- All date cases from the original increment still pass: both/one/neither known,
  null/absent, same/different full SHA, future/reversed chronology, current,
  provisional, searched zero-hit, withheld and retained terminal results.
- Same facts yield the same source/preparation words in CLI and MCP across
  search, grep, list and annotated read. Narrow/80/wide widths wrap without
  losing words, facts, Unicode, qualifiers or safe control handling; ANSI-free
  content has the same meaning. Long opaque actions remain exact.
- HEAD annotation requires full repository/SHA equality and verified request
  kind. Cover mismatched coalesced work, missing identities, equal SHA prefixes,
  explicit branch/tag/SHA/package requests, and historical served HEAD.
- Multiple targets/jobs, source/docs corpus splits, aliases, duplicate inputs,
  zero results on a page, unvisited scopes, omissions, unavailable docs and
  current usable content with pending refresh keep their separate truth.
- Legacy human replacement preserves verified fallback/deferred explanations,
  unavailable-without-source outcomes, provisional and unknown-state qualifiers,
  queryable alternatives and separately labelled suggested refs. Healthy current
  results suppress obsolete recovery. Cover both verbose/empty legacy paths and
  the concrete healthy/fallback read, SOURCE/SITE list and duplicate-input grep
  layouts above.
- Raw CLI reads, silent lists, content bytes, exact action operands, cursors,
  native wait units, read-before-wait and terminal fresh-search guidance remain.
- Service wire tests assert compact versus detailed/silent list selections,
  required provenance, omitted unrelated fields and full JSON timestamp/null
  parity. Other services make no extra metadata requests or selections.

Run the existing affected suites (plus the new shared-row tests):

```bash
bun test packages/core-internal/src/services/list-service.test.ts packages/core-internal/src/services/discovery-indexing-estimates.test.ts packages/mcp/src/shared/target-resolution.test.ts packages/mcp/src/shared/indexing-estimates.test.ts packages/mcp/src/shared/unified-search-presentation.test.ts packages/mcp/src/shared/unified-search-text.test.ts packages/mcp/src/shared/unified-search-status-text.test.ts packages/mcp/src/shared/unified-search-snapshot-text.test.ts packages/mcp/src/shared/grep-text.test.ts packages/mcp/src/shared/list-text.test.ts packages/mcp/src/shared/list-response.test.ts packages/mcp/src/shared/read-file-response.test.ts packages/mcp/src/shared/read-result-response.test.ts packages/mcp/src/shared/grep-repo-text.test.ts packages/mcp/src/shared/list-files-response.test.ts src/tools/search-parity.test.ts src/tools/grep-parity.test.ts src/tools/read-file-parity.test.ts packages/mcp/src/tools/list.test.ts src/commands/list.test.ts packages/mcp/src/tools/read.test.ts src/commands/read.test.ts src/tools/discovery-indexing-estimates-parity.test.ts packages/mcp/src/shared/mapped-error-text.test.ts packages/mcp/src/shared/list-package-docs-response.test.ts packages/mcp/src/shared/grep-repo-response.test.ts packages/mcp/src/shared/source-provenance-text.test.ts packages/mcp/src/shared/list-request.test.ts packages/mcp/src/smoke-test.test.ts
bun run typecheck
bun run build
bun run --cwd packages/mcp build
bun run validate:packages
git diff --check
```

Run scoped Biome checks on changed files. Extend affected smoke UX assertions and
run `bun run smoke:cli` and `bun run smoke:mcp` with `GITHITS_ENV=dev`, removing
unintended endpoint overrides without printing credential values. When safely
available, use authenticated affected tool calls for the changed list selection
and source/preparation cases. Authentication-only smoke is reported as such;
never claim it verified business output. Built smoke is required if smoke launch
behavior or CI product validation changes, not merely for prose edits.

Run targeted local Claude agent evals for
`eval/agentic/workloads/unified-search-investigation.md` and
`eval/agentic/workloads/grep-mixed-docs.md` via `bun run agent:e2e --agent claude
--server local --intent-profile githits --workload <path> --timeout 180` with dev
configuration. Inspect raw tool calls, final answer/confidence, metrics and
isolation violations. Report unavailable auth/model execution honestly; do not
infer usefulness from a harness pass. No performance optimization is claimed,
so no new benchmark harness or runtime performance comparison is warranted.

Completion acceptance: the approved shape is used by every scoped annotated
surface; all verified source/request/preparation facts survive; machine/raw
contracts and action semantics hold; focused checks and required smoke pass;
review findings are adjudicated; any missing live/eval evidence is explicit.

## Delivery, reorientation and plan cleanup

This is one delivery phase, extending the same draft PR; no merge boundary is
planned between helper creation and integration. If implementation would exceed
roughly 1.5-2k changed implementation lines, or repeated fixes expose misplaced
ownership, stop and propose the smaller boundary before adding machinery.
If another phase becomes necessary, reorient against current main and new
evidence before detailing it; do not fabricate a backend phase for unknown data.

Retain this plan through implementation review. After the final increment's
review is clean, transfer durable row/evidence contracts and verification to
`docs/implementation/`; record any genuinely open work in the existing backlog;
delete this plan in a final commit inside that PR. The production schema gate
and remote-mcp release/adoption/deployment boundary remain documented in the
permanent search-snapshot documentation. User authorization stops at draft PR
delivery; no merge/release/deployment is authorized.

## Plan review record

- Internal technical pre-flight: **clean**, direction sound, no findings. Verified
  backend types, compact list feasibility, preparation SHA ownership, grep
  metadata limits and raw/JSON/action preservation.
- Fresh Claude Opus 5.5 plan review: **clean in round 2**, including its one
  fresh-context final check. Direction sound; no code/design findings remain.
- Round 1: direction sound; accepted F1-F5 (recovery/state disposition, concrete
  layouts, list rollout gate, explicit raw-identity matching and legacy SHA
  display). Root cause: the plan specified shared rows but left the disposition
  of surrounding information implicit. Sibling scan covered every human
  `buildTargetResolutionNotes` consumer, existing retry/suggestion builders,
  read raw/verbose/binary/empty branches, list SOURCE/SITE/silent/action bases,
  grep omitted-input/estimate grouping, legacy resolution lines and GraphQL
  whole-document validation. Plan now specifies those outcomes and acceptance
  cases. No production changes or new product decision; the user already
  approved shared rows with per-tool placement. Closure confirmed in round 2.
- Internal closure pre-flight: **clean**, all F1-F5 addressed; no new findings
  after rereading the full revised plan and the directly affected boundaries.
- Round 2 minor note: accepted and added the existing mapped-error, legacy
  package-doc-list and legacy grep-response test files to the command. Verified
  every listed path exists; no new acceptance criterion or design change.
- Final-check suggestions adjudicated on 2026-10-06: rejected making scratch
  `/tmp` captures a separate durable prerequisite, because step 1 already
  requires repository fixture/behavior tests and the scratch captures are
  explicitly baseline evidence; rejected DRAFT/READY-subject status ambiguity
  as not a readiness defect during review (now both are READY after closure).
- Planning delivery check: `bun run build` passed. No production code changed
  for this plan. Implementation verification commands above are prospective.

## Orchestration slices

Coordinator owns shared source/request/preparation facts, search semantics and
grep attribution. One Luna worker receives only one mechanical concern at a time,
returns uncommitted deltas, and never edits coordinator files. Effective sandbox
is full access; ownership boundaries remain mandatory. No builds/tests run while
a worker is active. Sequence (each slice may be re-sliced after its return):

1. List service minimal provenance selections, decoding and wire-contract tests.
2. List JSON projection preserves selected partial identities and independent dates.
3. List request/caller selection plumbing for normal text versus silent mode.
4. List text placement using the coordinator's finished shared renderer.
5. Annotated read placement using the finished renderer, raw/content unchanged.
6. Coordinator: legacy grep substitution and comparison of preserved resolution facts.
7. Coordinator: legacy file-list substitution and exact suppression of covered facts.
8. Mechanical expectation/smoke updates for decided output, if needed.

Coordinator verifies every returned slice, integrates judgment-heavy logic, updates
permanent docs/release fragment, runs required validation, then Luna pre-flight,
internal technical review and the retained PR reviewer. Implementation completes
inside PR #454; this is not a separate plan-only PR.

### Implementation checkpoints

- Slice 1 (list wire): accepted after full hunk inspection and independent named
  `list provenance wire` proof: 3 pass, 0 fail, 21 assertions. Worker full service
  suite: 25 pass, 0 fail, 184 assertions.
- Slice 2 (list projection): accepted after full hunk inspection and independent
  named `list provenance projection` proof: 4 pass, 0 fail. Worker full projection
  suite: 7 pass, 0 fail. Root typecheck found one typed matcher fixture error;
  a separate narrow worker correction retained allowlist/cloning assertions.
  Corrected typecheck passes; named proof has 28 assertions. No product defect
  or extra implementation mechanism was involved.
- Slice 3 (list callers): accepted after hunk inspection and independent named
  `list provenance callers` proof: 5 pass, 0 fail, 16 assertions. Worker full
  builder/CLI/MCP suite: 62 pass, 0 fail, 341 assertions. No new input flag/schema.
- List placement was re-sliced after a context-compaction return with no code
  changes. This was a coordinator slicing error: SOURCE and SITE had independent
  placement constraints. SOURCE-only placement accepted after hunk inspection and
  independent `list source rows`: 5 pass, 0 fail, 15 assertions. Worker full file:
  23 pass, 0 fail, 59 assertions. SITE-only placement accepted after independent `list site rows`: 4 pass,
  0 fail, 15 assertions; full worker file 27 pass, 0 fail, 74 assertions.
  Annotated-read placement accepted after independent `read source rows`: 5 pass,
  0 fail, 48 assertions; full worker file: 24 pass, 0 fail, 107 assertions.
  A narrow fixture follow-up synchronized the served tag assertion after the
  current fixture correction; no production correction was needed.
- Coordinator retains legacy grep/file-list adapters because suppression of their
  existing resolution diagnostics requires identity-attribution judgment. Shared
  grammar, search/grep semantics, docs and integration remain coordinator-owned.
  No coordinator tests/builds run while the worker is active.
  Coordinator explicitly takes remaining list width plumbing: terminal width
  belongs to the CLI UI, alongside the other command adapters; fallback prose
  uses the existing width-aware wrapper. Adapter expectations remain delegated.
- Intermediate search/grep/shared-row check: 198 cases, 195 pass and 3 outdated
  wrapping assertions; those assertions were corrected to the new compact
  layout. Final integrated validation is still pending.

- Legacy identity check: `indexedVersion` is a backend version/tag/commit, not
  a proved package version. Legacy Sources use explicit targetResolution.served
  or an emitted repository plus result resolution SHA; a lone indexedVersion
  retains its existing diagnostic without inventing a package pin.

- Search projection closure: new row contexts select only requested, resolved
  requested, served and freshness facts. Opaque indexing handles and raw reasons
  remain outside the semantic presentation; existing contract tests pass.

- Latest main check: `git fetch origin main` moved origin/main from `d425bb4`
  to `39fa57d`; the intervening delta is four README lines only, with no output
  strings or project guidance changed. Rebase after the implementation checkpoint
  commit, before the full implementation review.

- Packed browser contract finding: new shared preparation rows made the existing
  package parser reachable from @githits/mcp/tools. Its registry constants came
  from core's service barrel, bringing Node dependencies into the browser probe.
  Core still owns the taxonomy; exporting the same pure constants from its
  existing browser-safe entrypoint and selecting that import fixes the boundary
  without duplicated registry names or new runtime machinery. Sibling scan covers
  the repository formatter, target-resolution helpers, preparation/error rows and
  the complete @githits/mcp/tools import graph via packed browser validation.

- List adapters accepted after independent `list row adapters`: 21 pass, 0 fail,
  47 assertions; full worker adapter files: 52 pass, 0 fail, 215 assertions.
- Integrated focused suite: 841 pass, 0 fail, 4,122 assertions in 29 files.
  Scoped Biome checks: clean (40 TS files before the browser closure; final
  scope also includes core/browser.ts and package-spec.ts). Typecheck, both
  builds and packed public-package/browser validation pass after the registry
  import-boundary closure. Parser/repository/shared-row closure: 184 pass,
  0 fail, 305 assertions across four files.
- Dev source CLI/MCP smoke and built CLI/MCP smoke exit 0. Live stable and
  experimental cohorts report AUTH_REQUIRED and were skipped; built coverage
  verifies unauthenticated CLI behavior and MCP registration, not business rows.
- Targeted Claude descriptor/explicit-GitHits evals for unified-search-investigation
  and grep-mixed-docs failed before any tool events (empty tool-calls.json,
  no final.json or isolation-violations.json). No agent-quality or cost claim.
- Exact fixture capture: 24 pass, 0 fail, 48 assertions (12 cases x CLI/MCP),
  including known/unknown/future/current/provisional/retained/withheld dates.
  Outputs: /tmp/shared-source-exact-outputs.txt and .json. These are fixture
  renders, not new live observations. Current dates stay visible and never wait.
- Ten Luna dispatches (including two fixture follow-ups), no interrupts. The
  broad SOURCE+SITE placement brief compacted without edits and was re-sliced;
  that was coordinator slicing, not a worker correctness limit. A read fixture
  compaction returned the correction without proof and was followed by a narrow
  proved assertion fix. Judgment-heavy attribution and import-boundary fixes
  remain coordinator-owned; no new infrastructure or major deferred development.
