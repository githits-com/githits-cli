# Plan: Search output information hierarchy

## Status

- Overall: **IN PROGRESS**
- Phase 1a: **COMPLETE**
- Phase 1b: **COMPLETE** (implemented in the same draft PR after the formatter
  ownership correction)
- Phase 2: **PENDING**

## Problem and expected outcome

`githits search` and `githits search-status` currently expose the same indexing
state through warnings, progress fields, target-resolution prose, source notes,
documentation-contributor notes, and an evidence notice. The renderers append
those independent projections instead of deciding which facts the reader needs.
The result is repetitive, hard to scan, wider than the terminal, and especially
expensive in default MCP text output.

When this work is complete:

- the first line states what the command returned and whether indexing continues;
- each lifecycle, freshness, coverage, and continuation fact appears once;
- progress and source readiness are expressed in user terms instead of internal
  reason codes and duplicated target identities;
- CLI color reinforces the information hierarchy without carrying meaning by
  itself;
- CLI human output and MCP `text-v1` use the same semantic projection while
  retaining surface-native actions;
- JSON remains the complete structured/debug representation;
- the same terminal hierarchy is applied to other high-information commands
  where the follow-up audit proves equivalent problems.

## Verified current state and evidence

1. The reported `npm:n8n` response says indexing is active at least four ways:
   three promoted warnings, the `Indexing/search still in progress` headline,
   `status: indexing`, the target `state=pending`, source details, and the backend
   evidence notice.
2. `formatProgressTarget()` repeats requested/fresh identities, `indexingRef`,
   target-resolution notes, freshness reason, and indexed alternatives on one
   unbounded line. In the supplied screenshot, that line exceeds the viewport.
3. `formatUnifiedSearchTerminal()` in `src/commands/search.ts` independently
   concatenates warnings, progress, source status, documentation contributors,
   and the evidence notice. `renderUnifiedSearchSuccess()` and
   `renderUnifiedSearchStatusText()` build a second, different narrative for MCP.
   No layer owns prioritization or cross-section deduplication.
4. Indexing and target-resolution conditions are promoted into top-level
   `warnings[]` for structured callers. CLI and MCP text then render those warnings
   alongside the structured progress/source facts that generated them.
5. The core service already receives `UnifiedSearchResult.partialResults`, but
   `buildUnifiedSearchSuccessPayload()` and
   `buildUnifiedSearchStatusResultPayload()` drop it. The CLI consequently labels
   every incomplete result set `Partial results`, including atomic interim evidence
   for which `partialResults` is false.
6. Search CLI status headlines and next actions are unstyled while result targets
   and locations receive bold cyan emphasis and almost all provenance is dimmed.
   The most important decision points therefore have less visual priority than
   incidental identifiers.
7. The repository documents MCP `text-v1` as a public format, but the user has
   explicitly decided that it is not a compatibility boundary for this redesign.
   `text-v1` will be improved in place; no `text-v2` or legacy renderer is needed.
8. Phase 1a is implemented: the additive `partialResults` JSON field, one shared
   presentation projection, outcome-first text rendering, tool/parity assertions,
   and MCP smoke invariants are complete. The model's source-entry
   boundary now uses required `searchTarget` for the searched package context;
   the overloaded `contextTarget` is gone. Requested/fresh/served divergence is
   retained only in progress and trust facts.
9. The original phase boundary was corrected after the user clarified that CLI is
   the inspectable fidelity harness for MCP text and agents use both surfaces.
   Phase 1b now routes CLI search/search-status through the same formatter, adds
   ANSI and CLI-command inputs, and deletes the duplicated private CLI formatter.

### Final integrated Phase 1 evidence

- `bun test`: 3,371 tests passed, 0 failed, 10,871 expects across 184 files.
- `bun run typecheck`: clean; format and lint checked 437 files clean.
- Root and `packages/mcp` builds passed on merged `origin/main`.
- `bun run validate:packages` and `bun run validate:packages:mcp-publish` passed;
  the publish dry-run was skipped because `@githits/mcp@0.11.0` is already
  published.
- Source `bun run smoke:cli` and `bun run smoke:mcp` passed sequentially on the
  final formatter state: 89 CLI steps and 46 MCP steps. An earlier parallel attempt
  hit the backend rate limit in the unrelated `get_example` step; its evidence was
  preserved and both suites passed after the rate window cleared.
- Targeted `unified-search-investigation` agent E2E succeeded with both Claude
  and Codex; usefulness was helped/high confidence. The discovered symbol-label
  bug was fixed.
- The final focused shared/status/tool/CLI cohort passed 149 tests with 0 failures
  and 584 assertions before the smoke-contract unit cases were added.
- Production/shared-smoke delta across the seven counted source files is 1,679
  additions and 1,753 deletions (net -74). The single-formatter correction crossed
  the addition-only caution threshold but deleted 818 lines from the CLI command and
  removed the obsolete shared helper block instead of retaining two apparent
  implementations. The user explicitly authorized the root-cause correction even if
  it grew this PR.
- `origin/main` at `739ec4e` was merged cleanly with no conflicts. Overlapping
  permanent documentation auto-merged, and integrated full-test, build, package,
  and source-smoke verification passed.
- Built smoke suites were not required: smoke launch and CI product-validation
  behavior did not change.

## Scope

### Phase 1a and 1b scope

- CLI `search` and `search-status` human output for completed, active, terminal,
  unknown, empty, interim, partial, stale, provisional, and capped-coverage states.
- MCP `search` and `search_status` default `text-v1` output for the same states.
- Shared response projection needed to distinguish actual partial evidence from
  atomic interim evidence.
- Search-specific use of existing terminal colors and any smallest shared semantic
  color helpers required to express the hierarchy cleanly.
- Search CLI/MCP documentation, smoke coverage, qualitative agent evaluation, and
  release fragment.

### Phase 2 scope

- Other user-facing terminal formatters that the post-Phase-1 audit proves violate
  the same hierarchy: primary outcome first, actionable state at full intensity,
  muted detail only for optional provenance, and semantic severity colors.
- Permanent cross-command terminal-output guidance once the roles have been proven
  by the search implementation.

### Non-goals

- Backend lifecycle, indexing, ranking, or evidence semantics.
- Changing search defaults, polling behavior, retry rules, or partial-result policy.
- Removing structured fields from JSON or hiding diagnostic data from `--json` /
  `format: "json"`.
- A general rendering framework, theme engine, layout DSL, output mode, or new CLI
  flag.
- Rewording unrelated command results during Phase 1.
- Using color as the only indication of state.
- Changing raw source/document content rendering; the existing terminal-text
  sanitization plan owns that separate trust boundary.
- Changing search error-envelope shape or error semantics. Existing CLI and MCP
  error rendering remains unchanged in Phase 1.

## Target architecture

### Ownership

The shared search presentation layer owns the meaning and priority of response
facts. The response builder continues to own lossless structured projection. One
shared text formatter owns hierarchy, wording, wrapping, hit anatomy, and semantic
color roles. CLI and MCP callers supply only ANSI enablement and surface-native
action syntax.

```text
Core UnifiedSearchOutcome
        |
        v
shared JSON payload builder  ---->  CLI --json / MCP format=json
        |
        v
shared search presentation model
        |
        v
shared search text formatter
        |                         |
        v                         v
CLI: ANSI + CLI actions       MCP: no ANSI + MCP actions
```

This corrects both ownership problems: neither surface rediscovers semantic state
from warning strings, and wording/layout cannot drift between duplicated renderers.
CLI output remains a directly inspectable proxy for MCP token and output quality.

### Presentation model

Add one pure shared projection that derives four independent dimensions from the
typed payload:

- **availability**: no snapshot, empty snapshot, interim results, partial results,
  or final results;
- **lifecycle**: the exact active status (`PENDING`, `INDEXING`, or `SEARCHING`),
  completed, the exact terminal status (`DEFERRED`, `TIMEOUT`, or `FAILED`), or
  an unrecognized raw status;
- **trust limits**: older snapshot, provisional index, pending/unsearched source,
  incomplete/capped coverage, ignored or incompatible query constraints;
- **action**: poll the current reference, start a later search, change the query or
  source, use an indexed alternative, or none.

The projection must consume structured fields. It must not parse promoted warning
prose. Promoted warnings remain available in JSON, while text renderers show only
query/filter/source problems not already represented by the lifecycle and trust
dimensions.

The model contains display facts, not finished sentences or ANSI codes. It retains
the exact target/source identities and continuation reference needed by the formatter,
but omits internal-only `freshnessReason`, `requestedRefKind`, and `indexingRef` from
default text unless one becomes a verified user action. Those values remain in JSON.

The source-entry boundary is explicit: `searchTarget` names the searched
package/target context, while `target` remains the served or contributor identity.
The former overloaded `contextTarget` is not used. Requested/fresh/served divergence
lives in progress and trust facts, so it cannot accidentally rename a result based
on contributor or docpack identity.

### Structured contract correction

Preserve the backend's actual `partialResults` Boolean on initial search payloads
and stored status results. Both renderers use it to distinguish:

- `N interim results returned` when an active response contains an atomic
  serveable snapshot (`partialResults: false`); and
- `N partial results returned` only when the backend says the snapshot is a subset
  (`partialResults: true`).

This is an additive JSON field. No GraphQL/API selection change is needed because
both search queries already select `partialResults` and core already validates it.

### Information hierarchy

Every human/agent text response follows this order:

1. **Outcome headline** — what was returned and whether work continues.
2. **Progress/trust summary** — only facts needed to interpret that outcome.
3. **Results**, when any were returned.
4. **Bounded secondary provenance/alternatives**, only when actionable or needed to
   qualify the evidence.
5. **One next action**, when applicable.

Rules:

- Active output starts with the exact work state, never with warnings:
  `Preparing`, `Indexing`, or `Searching` for `PENDING`, `INDEXING`, or `SEARCHING`.
- Do not say `No hits` when no result snapshot was searched; say no results were
  returned yet.
- Do not print `status: indexing` after an indexing headline.
- Print `searchRef` only inside the exact next action in human and MCP text.
- Do not print `indexingRef` in default text.
- Collapse requested/fresh/served identities to the one identity that changes the
  user's interpretation. Explain divergence once in plain language.
- Group readiness by user-facing evidence source (`code`, `repository docs`, site
  docs), not by raw source-status rows.
- State `available but not searched` distinctly from `waiting` and `searched`.
- Treat `evidenceNotice` presence as one concise text-level trust signal that the
  disclosed evidence or ordering may change. Do not parse or reproduce its opaque
  prose in default text. Preserve the verbatim notice in JSON.
- Bound alternatives in text by category: show at most three versions and three
  refs, then `+N more`; JSON remains complete.
- Keep each status/provenance line bounded and independently wrappable. Never join
  the complete target diagnostic record with ` | `.
- Query/filter incompatibilities remain visible once, below the outcome headline.
- Active responses retain `Do not repeat search.` before the exact status action.
  Completed empty responses retain `Do not repeat this search unchanged.`, and
  evidence-limited responses retain `Do not repeat immediately.` Terminal responses
  retain a transport-neutral prohibition on polling a stopped reference. These
  guardrails remain on both surfaces because agents can invoke either one.

The action dimension also preserves the existing empty-result pivot rules:

1. evidence-limited or unsearched-source results suppress generic query pivots;
2. indexing/provisional results suggest waiting or an indexed alternative, not query
   rewriting;
3. standalone site searches suggest only a shorter/broader site query and never
   another source or `code_grep`;
4. removing filters or switching to symbol search is suggested only when those pivots
   apply to the actual request.

### Implemented CLI shape for the reported active empty snapshot

```text
Indexing npm:n8n@2.36.7 - no results returned yet
Ready: 0/1 targets
Target: requested npm:n8n; fresh npm:n8n@2.36.7
Waiting: code, repository docs
Available but not searched: n8n.io docs (1,480 pages; capped)
Evidence may change.
Indexed alternatives: versions 2.26.9, 2.26.5, 2.23.2 +2 more; refs HEAD,
master
Do not repeat search.
Next: githits search-status fabUr1S3MEVeSgD93pMoSQ --wait 20
```

The supplied text proves this response contains an empty result snapshot with
`sourceStatus` and documentation contributors: contributor identity, readiness, and
page counts cannot come from progress alone. The regression fixture will encode the
disclosed structured facts from the supplied output; it will not depend on reproducing
the transient production indexing state with a fresh network call. The regression
now passes through the same formatter as MCP; only the final command dialect and
ANSI option differ.

A true progress-only CLI response has no `sourceStatus` or documentation contributors
and therefore renders only derivable facts:

```text
Indexing npm:n8n@2.36.7 - no result snapshot returned yet
Ready: 0/1 targets
Indexed alternatives: versions 2.26.9, 2.26.5, 2.23.2 +2; refs HEAD, master

Next: githits search-status <ref> --wait 20
```

It must not synthesize per-source waiting state, site identity, or page coverage.

### Other response shapes

```text
Indexing continues - 4 interim results returned
Ready: 1/2 targets

<results>

Next: githits search-status <ref> --wait 20
```

```text
Indexing continues - 4 partial results returned
Ready: 1/2 targets

<results>

Next: githits search-status <ref> --wait 20
```

```text
10 results from npm:n8n@2.26.9
Latest npm:n8n@2.36.7 is still indexing; these results use the older snapshot.

<results>
```

Completed current results retain the existing result blocks but use a concise count
headline and at most one source-provenance line before the hits. Completed empty
results state which evidence was actually searched before suggesting one applicable
pivot. Terminal and unknown states preserve disclosed evidence without inventing
indexing, completion, or absence claims.

### Color semantics

Phase 1 uses a small semantic mapping:

- active indexing / degraded-but-usable headline: bold yellow;
- failed terminal headline: bold red;
- completed result count and primary result identity: bold neutral;
- exact next command: cyan or bold cyan;
- backend match spans: existing bold yellow;
- optional provenance, bounded-alternative remainder, and secondary metadata: dim;
- warnings that require a user decision: full-intensity yellow, never dim.

No-color output keeps identical wording, order, spacing, labels, and glyph-independent
meaning. Do not color entire status paragraphs or whole result locations merely because
they are identifiers.

## Assumptions and unknowns

### Overall assumptions

1. Phases 1a and 1b ship in one PR. The earlier merge boundary was removed after the
   user clarified that CLI must be the directly inspectable fidelity harness for MCP
   text and both humans and agents invoke it.
2. `text-v1` may change in place, per the user's explicit decision on 2026-08-26.
3. JSON is the correct place for full diagnostic identities, reason codes,
   indexing references, and unbounded alternatives.
4. Existing lifecycle statuses and conservative handling of unknown statuses remain
   authoritative.
5. The current backend fields are sufficient for Phase 1; no new service call or
   backend change is required.
6. The implemented source-entry boundary uses `searchTarget` for searched package
   context and keeps requested/fresh/served divergence in progress/trust facts.

### Overall unknowns

- The exact Phase 2 command cohort. Resolve at the Phase 1 boundary by comparing
  representative no-color/color output from every formatter that uses shared color
  helpers against the proven hierarchy. This does not block Phase 1.
- Whether permanent terminal-output guidance belongs in a new focused implementation
  document or an existing CLI document. Resolve during Phase 2 reorientation based on
  the size of the proven cross-command contract.

### Open product decisions

None for Phases 1a and 1b.

### Resolved product decisions

- Improve MCP `text-v1` in place; do not add a versioned compatibility branch.
- Default human/MCP text may summarize opaque `evidenceNotice` prose as one generic
  trust limitation. Exact backend prose remains available in JSON. This deliberately
  makes default text lossy to remove the reported token-heavy boilerplate while still
  stating that returned evidence or ordering may change.

## Cross-cutting considerations

### Compatibility and migration

- CLI human text intentionally changes; `--json` remains the automation boundary.
- MCP `text-v1` intentionally changes in place by user decision. Tool schemas and
  default format names remain unchanged.
- `partialResults` is added to structured initial and status-result JSON. Existing
  fields retain their meaning.
- Search and search-status must remain behaviorally aligned for the same stored
  result and lifecycle state.

### Security

This work must not copy or expose credentials. It does not add network calls. New
formatting must follow the separate terminal-text sanitization plan when that shared
helper becomes available; Phase 1 does not absorb the broader sanitization effort.

### Performance

The presentation projection is a linear pass over already-bounded targets, source
statuses, contributors, warnings, and results. No benchmark is required because this
is not an optimization and adds no I/O, cache, or repeated search. Avoid sorting large
backend collections; preserve backend order and cap only display projection.

### Release boundary

Phase 1 changes shared MCP/CLI text and adds `partialResults` to both MCP JSON and
root CLI `--json`. Its single cohesive fragment uses `githits: patch` and
`@githits/mcp: patch`. Patch is appropriate because this corrects
misleading/duplicated output within the current minor and adds one structured truth
field without removing or redefining existing fields. The 0.11.0 precedent is not
comparable: it added public `quick_start`/configuration APIs and a deprecation path;
the closer 0.6.4 agent-facing search/recovery change was a patch. Retain patch/patch.

The formatter ownership correction is part of that same user-visible search-output
fix, so it does not add a second fragment. Do not edit `CHANGELOG.md` or package
versions outside release preparation.

Phase 2 will add its own fragment. Expected impact is `githits: patch` and
`@githits/mcp: none` if it changes only CLI ANSI styling; re-evaluate if shared MCP
text changes.

### Documentation

- Update `docs/implementation/cli-commands.md` with the outcome-first search family
  contract and concise examples.
- Update `docs/implementation/tools.md` with the revised in-place `text-v1` anatomy.
- Update `docs/implementation/mcp-cli-parity.md` to state that search shares semantic
  projection while rendering surface-native commands.
- Update MCP tool/instruction copy only where it describes the old output anatomy.
- Phase 2 records durable cross-command semantic color rules after they are proven.

## Phase map

### Phase 1a — Shared semantics and MCP text become outcome-first

- Status: **COMPLETE**
- Delivered: structured search payloads preserve actual partialness, one pure model
  owns lifecycle/availability/trust/action decisions, and MCP `text-v1` clearly
  states what was returned without duplicate lifecycle prose. Source provenance
  keeps explicit searched-target context separate from served/contributor identity.
- Verification: see `Final integrated Phase 1 evidence` above. No major Phase 1a item is
  deferred and no Phase 1a TODO remains.

### Phase 1b — CLI search output gains the same hierarchy and useful color

- Status: **COMPLETE**
- Delivered: CLI search/search-status invoke the same shared formatter as MCP;
  callers vary only ANSI and command dialect. The reported active-empty case is
  concise, CLI actions are directly executable, and 780 lines of duplicated private
  CLI formatting were deleted.
- Verification: targeted CLI/shared/status tests, ANSI-stripped parity, full tests,
  builds, package validation, source smoke, and retained Opus review all pass.

### Phase 2 — Proven terminal hierarchy becomes consistent across commands

- Status: **PENDING**
- Expected outcome: other high-information CLI commands with verified hierarchy or
  color-role problems use the same semantic roles without unrelated copy redesign.
- Assumptions: Phase 1 establishes usable roles and test patterns; Phase 2 remains a
  separate increment to contain review scope.
- Unknowns or product decisions: exact formatter cohort and durable documentation
  location, resolved at phase-boundary reorientation.
- Dependencies: Phase 1 merged and reorientation against current `origin/main`.
- Acceptance criteria:
  - every migrated command has an outcome-first first screenful;
  - warnings/actions are not dimmed and colors follow the documented roles;
  - no-color output conveys the same state and action;
  - unchanged commands are explicitly shown not to violate the proven rules;
  - no general theme/rendering infrastructure is introduced.

## Phase 1a and 1b detailed implementation plan

### Expected outcome

Phase 1 delivers correct structured truth plus one shared compact formatter for CLI
and MCP. Interim, actual partial, completed, stale/provisional, terminal, and unknown
cases use the same hierarchy. The surfaces cannot independently reintroduce duplicate
lifecycle prose because both presentation decisions and final text layout have one
owner.

### Likely affected components

- `packages/mcp/src/shared/unified-search-response.ts`
- new `packages/mcp/src/shared/unified-search-presentation.ts`
- `packages/mcp/src/shared/unified-search-text.ts`
- `packages/mcp/src/shared/unified-search-status-text.ts`
- `packages/mcp/src/shared/target-resolution.ts` only if display facts must be split
  from current prose helpers
- `packages/mcp/src/internal.ts`
- `src/commands/search.ts`
- `packages/mcp/src/shared/follow-up-command-text.ts` for surface-native commands
- existing shared color primitives; no CLI-only renderer or new framework
- colocated response, presentation, renderer, tool, command, parity, smoke, and color
  tests
- implementation documentation and the phase-specific changes fragments

### Ordered implementation

#### Phase 1a — structured truth, presentation model, and MCP text (complete; do not repeat)

The numbered execution list is superseded by the completed implementation. Phase 1a
added the additive `partialResults` field, the pure presentation projection, and the
MCP `text-v1` search/status renderers; migrated tool/parity tests and MCP smoke
invariants; updated permanent docs and the patch/patch release fragment; and passed
the final verification and agent evaluation recorded above. The final corrective
boundary uses `searchTarget` for searched package context, keeps `target` as served or
contributor identity, and retains requested/fresh/served divergence only in progress
and trust facts. No further Phase 1a execution is pending.

#### Phase 1b — shared CLI/MCP formatter and color hierarchy (complete)

The CLI now passes its payload to `renderUnifiedSearchSuccess()` or
`renderUnifiedSearchStatusText()` with `useColors` and `actionSyntax: "cli"`.
MCP uses the same functions with no color and MCP action syntax. Shared tests prove
the same layout with substituted continuation commands; CLI tests prove initial and
status equality for the n8n regression plus ANSI-stripped text parity. The private
CLI search/status formatter and its duplicate hit/provenance helpers were deleted.

### Edge cases and failure behavior

- Missing `progress`: state what is known without inventing indexing details; an active
  reference can still supply the exact next action.
- Progress without a result/source status: render target readiness and target-level
  alternatives only; never synthesize evidence sources, contributor readiness, site
  identity, or page counts.
- Unknown lifecycle status: print the raw status once, preserve evidence, do not label
  it active/terminal, and do not poll the same reference.
- `DEFERRED`, `FAILED`, and `TIMEOUT`: never emit search-status polling guidance.
- Incomplete response with results and `partialResults: false`: call results interim,
  not partial.
- Incomplete response with `partialResults: true`: explicitly state that requested
  evidence is missing.
- Completed response with evidence notice/search reference: state results are returned
  and may change, then emit one continuation action.
- Available-but-unsearched docs contributor: never describe it as searched or pending.
- Capped/partial docs coverage: disclose evidence limits without calling them indexing
  progress or suggesting a wait.
- Stale/provisional/fallback results: identify the served evidence once and keep
  follow-up locators pinned to it.
- Multiple targets: retain labels only where needed for disambiguation; do not repeat
  the same requested/fresh identity per source.
- Site suggestions: preserve backend order, truncation signal, and explicit retry
  labels without automatic selection.
- Long alternatives/targets: cap display and wrap by terminal cells; never truncate the
  exact next command or result follow-up.
- Color-disabled/non-TTY output: identical words and layout, no ANSI.

### Phase 1a and 1b acceptance criteria

Implementation criteria below are verified by targeted and integrated tests, both
source smoke suites, and the completed follow-up review.

- The n8n-shaped active empty-snapshot CLI fixture starts with indexing, contains one
  readiness summary, distinguishes waiting from available-but-unsearched evidence,
  omits raw reason codes and `indexingRef`, bounds alternatives, and ends with one
  exact status command.
- A progress-only fixture emits only the lifecycle headline, target readiness,
  target-level alternatives when present, and one next action; it does not invent
  source or contributor details.
- No lifecycle/freshness fact appears in more than one human/MCP text section.
- `PENDING`, `INDEXING`, and `SEARCHING` produce distinct preparing, indexing, and
  searching headlines; terminal and unrecognized raw statuses likewise remain
  distinct and are never collapsed before rendering.
- The model classifies every result-bearing response as final, interim, or partial from
  lifecycle plus `partialResults`; rendered copy never calls an interim snapshot final
  or an atomic interim snapshot partial.
- No-snapshot states never claim zero hits; completed empty snapshots never imply
  sources were searched when they were not.
- CLI and MCP invoke the same formatter and differ only in ANSI enablement and
  surface-native command syntax.
- Shared-renderer parity tests substitute the surface action and assert the remaining
  text is identical; CLI tests assert search/status equality for the n8n fixture.
- `--json` and `format: "json"` remain equal and add the exact `partialResults` Boolean;
  full diagnostic fields and alternative lists remain available.
- Active states have one continuation action; terminal/unknown states obey existing
  conservative no-polling rules.
- Shared text retains the three documented anti-repeat directives and all four conditional
  empty-result pivot-suppression rules.
- CLI status hierarchy remains readable with colors disabled, and ANSI-stripped color
  output is identical to no-color output.
- Explicit tests cover all listed states and the existing targeted baseline remains
  green after updated expectations.
- Required unit, parity, smoke, build, package-validation, and qualitative agent checks
  pass or any environment-only limitation is reported with exact evidence.
- CLI smoke structurally verifies the outcome-first headline, absence of duplicate
  `status:` prose, and single action-contained `searchRef` when continuation exists.
- Permanent docs and the cohesive Phase 1 changes fragment match implemented
  behavior.

### Verification

Run at minimum:

```text
bun test <changed search response/presentation/renderer/tool/command/parity tests>
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
(cd packages/mcp && bun run build)
bun run validate:packages
bun run validate:packages:mcp-publish
bun run smoke:cli
bun run smoke:mcp
```

Run targeted `bun run agent:e2e` search lifecycle workloads. Use both Claude and Codex
when practical because default agent text and continuation guidance change broadly.
Built smoke suites are required only if smoke launch behavior or built-product CI
validation changes; otherwise source smoke plus both package builds/validators are the
proportionate gates.

## Phase-boundary reorientation

After Phase 1 merges, run `$next-steps` before detailing Phase 2. Record observed color/no-color
output, accepted/rejected UX rules, test/eval evidence, and any command-specific
exceptions. Then inventory the remaining formatter call sites using those proven rules,
select the smallest coherent command cohort, and add exact files and test tactics for
Phase 2. Do not continue from a stale Phase 2 outline if the search roles did not
generalize cleanly.

## Completion and plan cleanup

The overall effort is complete when Phases 1a, 1b, and 2 meet their acceptance criteria,
permanent implementation documentation owns the resulting search and terminal-output
contracts, all required release fragments exist, and no temporary design decision
remains only in this plan. Then delete this plan. If Phase 2 is explicitly removed from
scope, transfer the verified Phase 1a/1b contract to permanent docs and delete the plan
after Phase 1b rather than retaining a stale future-work artifact.

## Review record

- Internal technical review: findings covering exact active statuses, explicit
  evidence-notice lossiness, and duplicate coverage were accepted and fixed.
- Luna preflight findings on bounded summary wrapping and `hasMore` ownership were
  fixed. The initial Opus loop findings were also fixed; that loop exposed the
  overloaded source-target identity later corrected by the explicit `searchTarget`
  boundary.
- The user selected that root-cause boundary correction. Retained follow-up Opus
  rounds found and closed the CLI pagination dialect leak, obsolete formatter helper
  block, missing smoke-predicate unit coverage, and stale parity wording. The final
  round was clean. Its two non-blocking observations were also fixed inline: the
  smoke predicate now accepts legitimate completed-empty and terminal actions, and
  the parity wording states the exact syntax exceptions.
- Repository policy prevented a second internal `code_reviewer`: this session had
  already used its one allowed reviewer for the technical plan.
- Rejected remedy: do not issue a fresh live search to capture transient JSON. The
  original indexing state may no longer exist; code inspection proves contributor
  details require a result/source-status snapshot, and the regression fixture can
  encode every fact disclosed in the supplied output without a network call.
