# Classified statements in package changelogs

## Outcome and status

Status: IMPLEMENTED, external code review pending. The owner confirmed production deployment on 2026-10-13.
Backend #3204 is merged; current SDL and changelog match the reviewed contract.
Plan review is clean after the round 3 wording fix. `pkg changelog` and MCP `pkg_changelog` retain their release-note
previews and additionally show the backend's classified statements per version.
Users can select actionable statements, actionable plus should-know statements,
or all classified statements. JSON retains evidence, provenance and honest
coverage. Classifications never become a package-level compatibility verdict.

The user confirmed note previews remain the default on 2026-10-12 and requested
the three cumulative filters. After review, the user confirmed `all` as the
default and keeping `--no-body` as the existing timeline-only mode: it skips
classification, and `--changes` is a no-op there. No fourth `none` value. Backend changes are explicitly authorized. PR #463
has merged; this work started from CLI main 6b35537, now refreshed to5531953 in a separate feature PR.

## Verified evidence

- Latest backend main 4fac1441178082398eb28419389448d7f35987be was read through
  `gh api`; the local canonical checkout bf74b72f0 is stale. Latest SDL exposes
  `riskItems` and `riskCoverage` only on `PackageUpgradeChangelog`, not on
  `PackageChangelogResult` or `PackageVersionChangelog`.
- Latest/range requests already use `packageChangelog`. Exact pins use
  `packageInfo.selectedVersion.changelog`, preserving the authoritative selected
  version, including prereleases. No invented previous version is necessary.
- Backend `PackageChangelog` carries displayed and alternate note bodies, with
  source URLs, internally. `PackageUpgradeReview.risk_entries/1` adapts these to
  the reusable `Changelog.Risk` classifier. Stored fingerprints incorporate the
  note bodies, so changing caller must not change classification inputs.
- `ChangelogRiskItem` already has `ambiguous`, bounded `text`, optional selected
  `fullText`, `url`, and per-item model/formulation. Coverage has five pre-cap
  confident/ambiguous tier counters, pending/missing/unparseable version counts,
  no-impact count and `itemsOmitted`.
- Upgrade review has no classification filter; `--min-severity` is advisory-only.
- Current changelog text previews ten body lines, with explicit body omission and
  verbose expansion. CLI and MCP share request/envelope/formatter modules. JSON
  uses `entries: {count, items}` and echoes only explicit filters.

## Ownership and boundaries

The backend owns classification, stored labels, source aggregation, policy,
coverage, filtering before the cap and job budgets. The service client owns
typed GraphQL transport/validation. The shared MCP presentation layer owns
envelopes and terminal rendering used by both hosts. Classification presentation
primitives reused with upgrade review belong beside those shared formatters;
changelog must not manufacture an aggregate upgrade review to obtain labels.

Backend work is handed off to its own Orca worktree per backend AGENTS:
`/Users/jpl/orca/workspaces/pkgseer-backend/changelog-classifications`.
The receiving agent owns backend planning, implementation, tests, docs and its
draft PR. This coordinator edits only githits-cli and reads the shared contract
artifact `/tmp/pkg-changelog-backend-contract.md`.

No new classifier, queue, cache, storage, public dependency, package verdict,
repository-addressed CLI tool, extra GraphQL query, or upgrade-review filter.
Backend jobs and storage are existing infrastructure. Neither PR is merged or
deployed by this task. Deployment needs the owner's separate authorization.

## Contract and behavior

Backend contract confirmed by the receiving agent in
`/tmp/pkg-changelog-backend-contract.md`; final SDL is checked before client
queries are finalized:

- Add `riskItems: [ChangelogRiskItem!]!` and
  `riskCoverage: ChangelogRiskCoverage!` to both changelog result objects.
- Optional `riskTiers: [ChangelogRiskTier!]` on the timeline root and exact
  changelog field filters statements before the 50-item cap. Omitted/all tiers
  means all. Version selection and note previews remain unchanged.
- Coverage and the five tier counters describe all selected release versions,
  before filtering/capping; `itemsOmitted` counts matching filtered statements
  omitted by the cap. Document those different scopes explicitly.
- Risk selection is lazy and sibling fields share one computation. Body-only
  legacy callers neither schedule classification nor incur classification waits.
- Selected versions' displayed plus alternate bodies are classified using the
  same inputs/fingerprints and current job budget as upgrade review: six seconds
  and at most ten batches, not the stale twenty-version ceiling. Latest main
  `Changelog.Risk` lines55-58/129-158 confirm this.
- Empty selections and exact versions without notes remain successful. A missing
  note is never evidence of no risk. Repo-only backend addressing must have an
  explicit supported contract; CLI never invokes it.

CLI `--changes <view>` and MCP `changes` have identical values:

| View | Classified statements shown |
| --- | --- |
| `actionable` | MUST_ACT, including visibly uncertain MUST_ACT |
| `important` | MUST_ACT and SHOULD_KNOW, including uncertain items |
| `all` (default) | All three tiers, including statements too long to classify |

Empty optional MCP strings normalize to the default; unknown non-empty views
fail locally with mapped INVALID_ARGUMENT when classification is enabled. The
explicit nonblank view is echoed in `filter.changes` only when effective.
Filtering affects classifications, not note previews or the release timeline.
Existing `--no-body` / `omit_bodies` skips note bodies AND risk selections,
preserving a fast timeline-only mode and its existing JSON envelope. `changes`
is ignored there (including validation/echo, like MCP ignored `body_lines`).
Existing verbose overrides for bodies remain unchanged: MCP text verbose enables
bodies/classifications even with omit_bodies, whereas CLI rejects no-body with
verbose as before. Risk field @include directives reuse includeBodies.

Text retains version/date/source headings and note previews. Add adjacent
classification sections: Requires action, Possibly requires action, Should know,
Too long to classify - read it. Do not put subsection counts after titles.
Show kind labels when present; missing kind still has a tier. Uncertain derives
only from `ambiguous`, never tierConfidence. Confident MUST_ACT quotes are full
within the bounded wire text; lower-priority quotes are brief, verbose expands.
Model/formulation/confidences remain machine evidence, not default text clutter.
Keep source URLs available once through references when multiple sources apply.
Show whole-selection tier counters and classification coverage once, with the
pending rerun message, no-impact count and explicit matching-item omissions.

JSON adds top-level `riskItems` and `riskCoverage` to the existing lean envelope
when classification is selected, with established lowercase enum/null-stripping
conventions. `fullText` is JSON-only, matching upgrade review; verbose expands
bounded quotes and existing full note bodies. Compact selection omits unconsumed
provenance/confidence/heading fields using conditional selections: model and
formulation for JSON, confidence/heading for JSON or verbose. Bodies and risk
fields share includeBodies selection, so omitted bodies produce the old timeline
envelope without classifier work. Do not silently accept missing risk fields
once selected; report schema/protocol errors. Join items to entries by `version`,
not `normalizedVersion`; keep source ownership separate from version spelling.

## Ordered delivery

### Backend slice — COMPLETE (#3204, owner-confirmed production deployment)

Outcome: exact/latest/range APIs expose lazy filtered classification evidence.
Assumptions: existing Risk jobs and stored labels are reusable (verified).
Unknowns: none. Delivered handoff confirms exact/timeline riskTiers argument,
repo-only risk-selection validation and maximal backend complexity73/71/96
(exact/latest50/range, including contentSafety). Measure final client documents.
Dependencies: none beyond existing backend services.
Acceptance: focused backend tests cover lazy selection, both sibling fields,
empty/no-notes, selected-version scopes, alternate-source locators, server
ambiguity/counters, filtered-before-cap ordering and existing six-second/ten-batch job budget. Draft
PR contains current SDL/docs and complexity evidence for exact/latest50/range.

### Client slice — IMPLEMENTED, review pending

Outcome: both hosts show useful per-version classifications and identical JSON,
with the three cumulative filters and existing note controls preserved.
Assumptions: backend contract above is delivered; no production fallback or
parallel aggregate query is introduced. Public deployment precedes release.
Unknowns/product decisions: none. Live dev validation passed. Stored labels meant
no live pending sample; pending-only and truncated/oversize edge cases are tested.
Dependencies: backend gate satisfied. SDL riskTiers/riskItems/riskCoverage and
filter-before-cap/all-tier-counter semantics verified on 2026-10-13. Source
branch fast-forwarded to current CLI main5531953 before implementation.

Implementation order:

1. Review this plan, then verify exact SDL and arguments from the backend handoff.
2. Extend core changelog params/report/query/Zod normalization. Factor a shared
   risk item schema base, with an upgrade-review extension retaining REQUIRED
   model/formulation/confidence/heading keys and a changelog extension allowing
   the omitted compact fields. Add a regression proving upgrade review rejects
   missing model/formulation. Reuse neutral risk types and factor presentation
   primitives only where both formatters consume them. Preserve upgrade review.
3. Extend shared request validation, both host options and lean envelope. Add
   per-version classification rendering and one coverage summary, with source
   references, wrapping, color-independent labels and terminal sanitation.
4. Update tools/CLI/implementation docs and a dual-artifact minor fragment.
   CLI --changes help and MCP changes description explicitly state it is ignored
   when bodies are omitted; MCP text verbose re-enables it.
   Stage exact edits for canonical skills/githits-package/SKILL.md and its
   package reference in durable implementation docs, with timeline-only no-body
   semantics and filter guidance. Leave the published package skill unchanged in
   this feature PR to avoid advertising unreleased flags, following the explicit
   CLI code/package release-branch guidance rule in
   .agents/skills/githits-release/SKILL.md (read by the reviewer). The onboarding
   section alone is not the authority for this package guidance decision. Its current no-body timeline advice remains true. Test
   descriptor prefix contracts; generate/check plugin assets only if a canonical
   plugin input actually changes.
5. Verify focused tests, build and both smoke surfaces, then internal pre-flight
   and one external reviewer per round. Open a separate draft client PR.

Acceptance tests:

- CLI/MCP JSON and text parity for exact/latest/range and all three filters.
- Wire selections/variables prove backend tier filtering, no-body skipping risk/body
  fields with ignored changes, MCP verbose override and CLI conflict rejection,
  JSON-only fullText and provenance versus compact/verbose selections, and one query per call.
- Pending-only, zero risk items, missing/unparseable notes, omitted matching
  items, oversize/truncated quotes, mixed provenance, and kindless items.
- Backend ambiguity overrides any numeric confidence (test opposite numeric
  values); no client-side confidence policy.
- Version matching uses entry.version even when normalizedVersion differs.
- Existing notes, latest limits, excluded lower bound, exact prereleases, empty
  results and mapped errors keep working. All terminal strings sanitize control
  sequences; JSON stays unchanged. Narrow-width text wraps prose.
- Upgrade-review regression tests pass after any shared extraction.
- Dev source CLI/local stdio MCP verify exact express@5.2.1, latest express and
  express@5.0.0..5.2.1, plus a many-item Biome range with each filter; report
  cold/warm coverage and operation complexity below 500. Auth uses normal CLI.
- Targeted changelog descriptor/agent workloads run only after the backend is
  available, with trace/final/metrics/isolation artifacts inspected. Do not
  describe harness completion as graded quality.

Baseline verification: five existing changelog test files pass (129 tests,
423 assertions, 446 ms). Authenticated dev exact `npm:express@5.2.1` returned its
release body and locator through normal CLI auth. Internal technical plan review
found no findings; static query complexity remains a measurement requirement.
External round 1: direction sound. Accepted the default/timeline clarification
(user confirmed all + timeline-only no-body, no fourth view), guidance/descriptor
coverage, JSON-only fullText, and explicit version join. No rejected findings.
Round 2 accepted schema-base/required-upgrade/optional-changelog extensions
with a strict upgrade-provenance regression; corrected remaining no-body
wording and pinned package-guidance release authority. Round 3 confirmed technical closure; its only finding was this explicit help/
description requirement, now added. The round is clean under the minor-wording
rule. No fresh-context external subagent or validation was run during planning.

No performance optimization is proposed. Measure GraphQL complexity on the exact
documents before/after; preserve bounded backend classification wait. Rendering
adds a bounded 50 statements and does not require a performance benchmark claim.

## Reorientation, completion and cleanup

After receiving the backend contract, compare it against every assumption above;
update the plan and review any material change before implementation. After
owner-authorized deployment, verify live coverage and schema using normal auth.
Do not merge/release/deploy. If deployment is pending, deliver draft PRs and state
the remaining verification explicitly; keep this plan current until complete.

When implementation and reviews are complete and live acceptance passes, transfer
durable contracts/semantics to implementation docs, then delete this plan in the
final commit of the client PR. Major deferred work belongs in the repository
backlog; none is currently proposed.


## Client implementation evidence (2026-10-13)

- Implemented note-preserving classifications and views, no-body selection gates,
  raw-version joins, mode-specific field selection/validation and shared quote
  presentation. Source labels use matching item evidence, not aggregate source.
- Focused8files:440pass/0fail/1800 assertions. Source/built CLI and MCP smoke
  suites passed; build and typecheck passed after two typed test assertions fixed.
- Authenticated dev CLI/localstdioMCP exact/latest/range and all views, Biome,
  latest50, empty, no-notes and timeline-only JSON parity passed. Range text is
  equal except intended host-specific body expansion hint.
- Expressrange4classified/0pending/125no-impact,0confident+8uncertain action,
  6confident+2uncertain know; warm unchanged. Biome13classified/0pending,
  13confident+27uncertain action,12confident+10uncertain know,813no-impact:
  all50returned/12omitted versus actionable40returned/0omitted.
- Latest50 selects50classified/0pending,41action+42know precap,597no-impact,
  all50returned/33omitted versus actionable41returned/0omitted. Counter scopes
  stable acrossfilters; stored formulationsv2/v3/v5 preserved peritem.
- Complexity maximalactualclientJSON: exact56/latest50=65/range90. Verified
  rejected-control510 plus documents566/575/600, before resolver execution.
- Internal codepreflight: direction sound, no findings after typed assertions.
  External code review pending. Descriptor-only Codex exact-release eval: neutral
  run completed with zero tool calls (not tool-use evidence); explicit GitHits
  intent run completed with3logicalcalls (quick_start, pkg_changelog default and
  verbose), no isolation violations, high self-reported confidence,20.8seconds.
  Final answer quoted the rollback/security context and preserved uncertainty.
  No quality grading ran. Initial missing dedicated CODEX_HOME preflight did not
  execute a model; retry used the existing dedicated eval home without reading
  auth material. Last touched request/CLI/parity files:89pass/266 assertions.


External code round1: direction sound. Accepted citation collision finding:
renderer-owned references now tracked separately from raw body previews; original note Markdown is retained; formatter references use a distinct `[S1]`
namespace. Relative Markdown links cannot count as owned citations. Regression covers
reference-style links, bare numbered refs, a URL after a cut quote, and verbose
heading/source admission; raw JSON unchanged. Relabeled mixed count line to
Classification coverage in both sibling changelog/upgrade formatter surfaces.
Internal follow-up correctly caught loss of note links in the initial remedy;
namespace separation replaced body rewriting. Authored markers are escaped in
quote normalization before formatter references are injected; raw notes stay
unchanged. Upgrade citation collection excludes relative Markdown links too.
No findings rejected; internal final closure is clean. The cited-only namespace preserves note links and quote evidence. Source numbers can have gaps after local excerpts; the registry keeps stable identifiers without adding renumbering machinery. Focused closure:123pass/743assertions, build/typecheck pass, compact/verbose live CLI/MCP text parity pass. External round2 pending.
