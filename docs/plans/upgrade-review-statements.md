# Upgrade review: complete changelog statements

## Status and destination

Overall: **IMPLEMENTING**. One implementation increment; no production changes
are made during planning. Branch `jlitola/upgrade-review-statements`, planning base
`acd717488569485bf4af68bc09dab6c0ef2be7e4` (origin/main, merged PR476).

Outcome: CLI `pkg upgrade-review` and package-owned MCP `pkg_upgrade_review` use
complete backend-parsed statement evidence, with useful filters, honest coverage,
uncertainty and nearby source links. Detailed results have no 50-item cap. Compact
batch output retains whole-range confident/uncertain counts and ranking without
fetching quotes. Security, dependencies and keyword evidence remain functional.

Dependencies: the new aggregate statements contract, verified on dev below;
existing shared changelog collection/normalization and approved compact tags.
Assumptions: the owner accepted the preceding recommendation to preserve the
focused default and reuse explicit changelog filter meanings. No client confidence
threshold, package verdict, backend parsing or local deduplication is introduced.
Open product decisions: **none**. Production deployment is a release prerequisite,
not verified by the dev checks; verify before publishing (outside this increment).

Overall acceptance: complete selected evidence and CLI/MCP text/JSON parity;
mode-specific queries under500 at the public30-package maximum; existing security,
dependency and heuristic semantics intact; documented JSON migration and both
public-artifact release impact; clean review and green CI on the implementation PR.

## Problem and verified evidence

Current aggregate query and service are in
`packages/core-internal/src/services/package-intelligence-service.ts`. It selects
`riskItems`, `riskCoverage`, entries, sampledEntries and keywordEntries for every
host/view, including compact batch text. `riskItems` is priority ordered and capped
at50. The client has no changelog tier filter. JSON selects complete quote text;
text/verbose consume bounded quotes. Global counters already separate confident
and ambiguous tiers; batch ranking uses confident MUST_ACT only. The shared
upgrade formatter owns version groups, keyword excerpts and source references.

Merged PR476 supplies statement schemas, normalizers, complete collection/progress
checks and source-ordered changelog rendering with `[!behavior]`, `[deprecation]`,
kindless `[!]` / `[should know]`, explicit uncertainty and plain no-impact bullets.
No existing active plan covers this migration. The internal plan assessment found
that keyword excerpts require keywordEntries.body, not just its preview; this
projection exception and a beyond-preview regression are explicit below.

Backend SDL: `~/proj/githits/pkgseer-backend/priv/graphql/schema.graphql`,
`PackageUpgradeChangelog` at6469; changelog entry2026-10-14, schema hash
`sha256:3d8a7e9f6602`. It adds `statements(first: Int!, offset: Int!,
tiers: [ChangelogStatementTier!])`. Explicit first100 and offset0 are sent; the
changelog mentions defaults but the SDL requires these arguments. The field:

- covers the complete upgrade range independently of changelogLimit;
- filters before pagination; missing/null/empty tiers mean all, including
  NO_IMPACT and `classification: null`;
- supplies source/version positions, heading, source URL, bounded/full text,
  predecessor context, nullable classification with authoritative ambiguous;
- supplies full-range totalCount/matchingCount, progress metadata and per-version
  assessment coverage before filtering;
- shares the lazy label path/bounded wait with risk siblings; text-only selections
  parse without labels, but classifications/assessment fields/active filters load
  labels; labels may complete in background;
- continues per review through a single-package aggregate request, with current
  offsets rather than a persisted snapshot; coverage/notes changes require restart;
- deprecates riskItems while retaining riskCoverage and keyword siblings.

Planning used the existing authenticated backend `scripts/graphql-call.mjs`
wrapper and normal built CLI auth, explicit dev environment; no credential value,
storage, token output or authorization header was inspected/exported. Dev queries
worked. Evidence files/scripts are under `/tmp/upgrade-review-statements-planning/`;
this plan records durable results so implementation does not depend on temp files.

### Complexity measurements

Admission-only probes add an independently measured rejection control. Its
510 packageVulnerabilities aliases cost5100 on current dev; subtract5100 from
combined costs. Root __typename aliases cost0 and are not a valid control. Raw
responses and the calibrated measurements are retained; no probe aliases belong
in product queries and rejection executes no resolvers.

| Operation, transitive security and dependency issues enabled | Admission total | Actual cost |
| --- | --- | --- |
| Current operation,1 package | 5389 | 289 |
| Current operation,30 packages | 5534 | 434 |
| Proposed initial detailed JSON,1 package | 5430 | 330 |
| Proposed initial detailed JSON,3 packages | 5440 | 340 |
| Proposed initial detailed JSON,30 packages, focused or all | 5575 | 475 |
| Proposed compact triage,30 packages | 5491 | 391 |
| Full JSON statement-only continuation,1 package | 5188 | 88 |

Detailed prototype replaces riskItems with first100 statements including full
JSON context/provenance/page/coverage fields, removes legacy itemsOmitted, and
retains current entry/security/dependency selections. Triage additionally omits
statements and all three entry arrays. Continuations select identity and statement
pages only, includeTransitiveSecurity:false, changelogLimit:1 (the backend clamps0 to1). Thus even the
conservative maximum JSON projection (focused or unfiltered all) fits under500 with25 headroom. Final query
builders must be remeasured against these exact cases; directives cannot be assumed
to remove complexity. Do not split the initial batch or reduce its public maximum.

### Live completeness and counter agreement

Three ranges were fully assessed on these requests. Stored labels are not a cold
classification benchmark; no background completion or initially cold claim.

| Range | Parsed | New focused / old returned | Confident / uncertain act | Confident / uncertain know | No impact | Versions classified / pending / without notes / unparseable |
| --- | --- | --- | --- | --- | --- | --- |
| npm:express5.0.0..5.2.1 | 141 | 15 / 15 | 0 / 8 | 6 / 1 | 126 | 4 / 0 / 0 / 0 |
| npm:express4.19.2..4.21.2 | 57 | 14 / 14 | 3 / 4 | 7 / 0 | 43 | 4 / 0 / 0 / 0 |
| npm:@biomejs/biome2.4.2..2.4.15 | 875 | 62 / 50 | 13 / 27 | 12 / 10 | 813 | 13 / 0 / 0 / 0 |

The five riskCoverage tier counters equal classification counts over complete
focused pages in every case. Each focused selection fits one100-unit page.
Biome all returns875 across9 pages with stable coverage, unique version/position
keys, valid offsets/counts,813 no-impact labels and full-text/context provenance.
Oversize, pending and missing notes were not observed here; fixtures must cover
these documented states. Old cap now hides12 Biome quotes, rather than earlier
historical13; current stored labels are authoritative.

For the same three-package selection with both optional evidence sections, compact
JSON serialization of raw GraphQL responses measured current443,505bytes,
proposed detailed467,275bytes, and proposed triage16,202bytes. Normal-auth helper
walltimes were4.486s /6.111s /3.932s, respectively; one observation each including
CLI auth/startup, not isolated rendering/network benchmarks or a speedup claim.
Current built CLI JSON was440,795bytes /4.055s; its envelope is different and is
not a like-for-like wire comparison. The decision rests on completeness, omitted
selections and complexity, not these timing differences. Initial all-Biome page
plus eight continuations took40.252s across separate auth-helper processes; the
implementation reuses its service/token flow within one operation, so this is
not projected CLI latency. Re-run the same narrow projection comparison after
implementation; do not schedule a broad benchmark sweep.

Contradictions: planning corrects the stale backlog claim now; implementation
corrects the CLI reference. Specifically, cli-commands still describes the old
524-cost backend violation as open, although production maximum-batch support was
verified in pkg-upgrade-review.md. The backlog also says coverage membership and
omitted quotes need backend design; the new contract closes those two limitations.
Supersession/reverts and consumer applicability remain unresolved backend/domain
questions and are explicitly outside this migration.

## Scope and architecture

One PR, root CLI and packages/core-internal/packages/mcp only. No backend or
remote-mcp edits, releases, merges, snapshots, caches, jobs, automatic retry/polling,
schema fallback, custom classifier policy, package verdict or dependency comparison
redesign. No new raw-note flag or repurposing of global verbose. Public skills are
staged for release in permanent docs, not modified in this feature PR.

Ownership: core owns GraphQL projection, request/response validation and complete
collection because both hosts need identical completeness and errors. MCP shared
request/response modules own public filter normalization and presentation; commands
and tool handlers only adapt host inputs. The backend owns parsing, restatement
suppression, labels, interpretation and whole-range counters. Keep these levels;
extract existing small pure helpers, not a general pager or new service layer.

Data flow: host options -> shared request builder (packages, tiers, view) -> one
initial aggregate request -> only needed sequential single-package statement continuations
-> complete validated service evidence -> shared JSON builder/formatter. Do not
compose packageChangelog or dependency probes to obtain these statements.

### Public behavior

- Omitted/blank changes preserves focused `[MUST_ACT, SHOULD_KNOW, UNCLASSIFIED]`.
  This differs deliberately from changelog's all default and must be explicit in
  help/tool schema/docs; explicit filters have identical meanings on both tools.
- `--changes actionable` / MCP changes:"actionable" sends `[MUST_ACT]`, including
  uncertain action labels. `important` sends `[MUST_ACT, SHOULD_KNOW]`. `all`
  omits tiers and includes no-impact/unassessed/oversize units. Trim and lowercase
  input through the shared normalizer; invalid values fail locally before package-intelligence service calls.
- Filtering limits detailed quote evidence, not whole-range triage/security counts.
  Compact batches echo an explicitly requested filter and explain it applies to
  detailed reports; no quote selection is fetched merely to apply a filter there.
- Keep compact batch triage as default for multiple packages. Whole-range act/know
  counts separate uncertain labels and sort only by confident action totals,
  regardless of filter. JSON and verbose batches retrieve matching quotes for each
  review; single-package text retrieves matching quotes by default.
- Keep upgrade identity, security, compatibility, dependency and unknown groups.
  Only Changes uses the approved source-ordered version/source bullets and nearby
  authoritative URLs, compact bracket tags and explicit uncertainty/context. The
  old tier sections/reference table are replaced by this evidence grouping; no
  duplicate sampled-note previews or separate global changelog Sources table.
  Source order is backend order, not local semver sorting or tier reranking.
- Preserve breakingSignals, migrationSignals, entry signals and separate keyword
  excerpts not already present in displayed quotes. Keyword matches stay lexical
  evidence, never classification. Filtered-out model quotes cannot silently hide
  keyword-only evidence; that separately labelled evidence may still appear.
- Global verbose remains useful for full batch reports, security/dependency
  examples and quote expansion; it is not a verbatim alias. Keep existing compact
  quote bounds for every non-action bullet (240 Unicode characters), including
  should-know, oversize, no-impact and unassessed in all mode. Action is full
  backend-bounded text; verbose expands every tier to full backend-bounded text.
  Client excerpts are marked with a verbose hint; backend truncation
  is always disclosed with a JSON full-text hint. No extra fullText fetch in text.
- Coverage always shows classified/pending/missing-note versions, no-impact totals
  and positive oversize/unparseable counts, including filtered/zero-item results.
  Pending jobs get existing rerun guidance; missing/unparseable never implies safe.
  Zero matching items with outstanding assessment is not no-impact evidence.

### View projections and JSON migration

| View | Changelog fields consumed |
| --- | --- |
| Compact batch text | Whole-range riskCoverage counters except itemsOmitted; source/fallback, entry totals/truncation/body availability, keyword totals/signals; no item pages or entry arrays |
| Detailed text, single or verbose batch | first100 matching statement pages + assessment coverage; needed source/entry locator metadata, keywordEntries.body and signals for actual matching excerpts; global counters; no fullText/confidence/model/formulation, ordinary raw-note bodies or duplicate sampled previews |
| JSON | Complete matching pages, full statement/context text, source positions, per-item confidence/model/formulation; retained ordinary entry and keyword metadata/bodies/signals and other upgrade blocks |
| Continuation | One package identity + matching statement page/progress/coverage; same tiers, no security, dependencies, summary, riskCoverage or entry arrays |

Reuse ChangelogStatement/Classification/Context/Coverage schemas and normalization.
Do not assert coverage versions equal sampled entry versions: upgrade entries are
bounded by changelogLimit whereas statement coverage is the whole range.
Selected required fields must validate; omitted triage-only fields are absent,
not fabricated empty arrays. JSON always uses the detailed contract.

JSON keeps the top-level upgrade envelope and security/dependency/entry/keyword
facts. Replace `changelog.riskItems` with `changelog.statements` using the existing
changelog collection shape: count, totalCount, matchingCount, items and per-version
coverage; classifications remain nullable, enum spelling normalized consistently.
Keep riskCoverage's whole-range tier/coverage counters but remove itemsOmitted:
it describes the deprecated50-item API, not omissions from complete pages. Do not
select both APIs or synthesize a compatibility riskItems array. Document the
breaking JSON/type-export migration and pending minor impact for both public0.x
artifacts, including the public @githits/mcp/smoke-test assertions. Hosted MCP
adoption of that helper/package requires the production statement contract first;
no remote-mcp edits are in scope.
Keep explicit-only changes in the top-level filter echo, but always include
`changelog.statements.selection: "focused" | "actionable" | "important" | "all"`
in detailed JSON. This output-only metadata names the effective tier selection;
focused means action/should-know/oversize, excluding no-impact/unassessed. All
means every parsed unit, including null classification. Detailed text always names
the effective view and its exclusions, even when the caller omitted changes.
Do not drive default disclosure solely from explicitFilterFields.

### Consistency and failure behavior

Reuse the existing pure page-progress/order/count/field validation and collector,
with thin host-specific query loops. Max100 per page, monotonic next offsets,
counts/hasMore/nextOffset agreement, version membership and position order are
mandatory. Continuations run sequentially in original review order, one page at
a time per review; no concurrency pool, fanout or deduplicating cache. Explicit
all on large batches can require many requests and may hit caller tool timeouts;
there is no promised fixed latency. The3–6.6s helper observations include repeated
CLI authentication and cannot be called per-page product latency. Record the
built CLI walltime for the same single Biome all case after implementation,
alongside actual request counts and auth/runtime-inclusive limitations. Source-position gaps are valid after suppression
or filters; positions
are contiguous per version only for an unfiltered complete collection.

Upgrade-review must compare complete assessment coverage between pages even in
all mode: its header/triage counters come from the initial aggregate snapshot.
This prevents returning initial totals beside later, newly classified quotes.
Standalone changelog's all mode remains tolerant of arriving labels because it
derives its own final assessment coverage; do not change that behavior. The shared
collector need not enforce one universal loop policy. On an observed count/coverage
change, use the existing retryable changed-evidence error and explicit rerun hint;
do not return a partial "complete" collection or add automatic restarts/polling.
Complete collected all-tier counts must agree with the initial global counters;
for filtered views check the selected tiers' totals/confident/ambiguous counts.
A final collected-versus-initial counter disagreement without observed page
change is a malformed backend response (the existing protocol error), not the
retryable changed-evidence error. Contiguity refers to retained position;
sourcePosition can have gaps after suppression even without a tier filter.

Compare continuations with the initial returned review identity, preserving
canonical Go versions and duplicates in batch input. Unexpected review membership,
malformed pages or missing selected fields produce existing protocol errors;
HTTP/auth/transient/cancellation mapping stays in the established layers. Preserve
`classification:null`, ambiguous:false and numeric zero. The API is current evidence,
not an immutable source snapshot; same-count/same-coverage source edits cannot be
proved unchanged. Do not invent a digest, lock or snapshot mechanism. With more than100 units,
all on a cold range may need a rerun until background answers settle, because
assessment changes abort the collection. Document this bounded trade-off with
the existing pending-classification guidance, not as a safety verdict.

## Phase map

**Phase1 — complete, filtered upgrade evidence reaches both hosts without cap or
unused quote fetching (IMPLEMENTING).** Expected outcome: default focused
reviews and explicit filters return all selected quotes; compact batches stay
small, counts/coverage stay honest and old security/keyword behavior works.
Assumptions: approved defaults/projections above; dev contract and counters verified.
Unknowns/product decisions: none for implementation. Dependencies: currentmain,
existing changelog primitives and deployeddev schema. Acceptance: overall criteria,
mode wire tests, fixtures/live checks below, clean review/greenCI and permanent docs.

One phase is sufficient: no independent data-only phase or preparatory abstraction
PR. If implementing the narrowly shared helpers starts adding machinery or exceeds
1.5–2k implementation lines, stop and reassess the smallest boundary correction.
After this increment merges, use $next-steps against currentorigin/main before any
subsequent work; no speculative later phase is planned here.

## Phase1 implementation detail

Likely files verified by exploration:

- `packages/core-internal/src/services/package-intelligence-service.ts`, its tests
  and `package-changelog-statements.test.ts`: extract existing statement primitives
  into a small core helper only where both callers actually share them; add
  triage/text/JSON initial projections and statement-only continuation. Update
  service interfaces/validators, including current test factories/exports consumed
  through packages/mcp/client without leaking private aliases.
- `packages/mcp/src/shared/package-upgrade-review-request.ts` and tests: shared
  changes normalization and focused default, effective view options. Reuse/extract
  the existing changelog changes normalizer without copying package addressing.
- `packages/mcp/src/shared/package-upgrade-review-response.ts` and tests,
  package-changelog-response.ts and tests: JSON migration and narrow shared
  statement presentation primitives (kind annotation, nested text, context/source
  groups). Update `packages/mcp/src/shared/fixtures/upgrade-review-express-changelog.json`,
  which the upgrade formatter tests import and which still contains riskItems.
  Retire obsolete helpers in `packages/mcp/src/shared/changelog-risk-presentation.ts`
  while preserving its used kind labels, lexical text/sanitation and pending message. Each tool retains its own surrounding formatter. Keep changelog output
  unchanged, including its all default and raw-note/timeline flag rules.
- `src/commands/pkg/upgrade-review.ts`, `packages/mcp/src/tools/package-upgrade-review.ts`
  and their tests: new changes option and view-aware service params; preserve tool
  discovery's first sentence, negative transitive opt-out and read-only annotations.
- `src/tools/package-upgrade-review-parity.test.ts`, shared service mock factories,
  `packages/mcp/src/smoke-test.ts` / its tests (public @githits/mcp/smoke-test),
  `scripts/cli-smoke.ts` / smoke-script tests, relevant MCP server/catalog cases
  and packed public consumer tests: update canonical
  contract and assert no accidental host/provider divergence.
- Permanent docs `docs/implementation/pkg-upgrade-review.md`, cli-commands.md,
  pkg-changelog.md for shared ownership notes, tools.md input table; backlog correction; one new
  changes/ fragment with pendingminor for githits and @githits/mcp.

Ordered work:

1. Red tests for current50-cap loss, selected filters, compact-batch no quote
   selections and continuation avoiding repeated aggregate evidence.
2. Extract only existing shared pure schemas/normalization/page checks. Introduce
   mode-specific query/response projections, collect needed pages sequentially, validate raw
   coverage/identity and global-counter agreement. Remove riskItems selection and
   legacy omission consumption. Delete verified-unused risk-item types/schemas,
   normalizers/tier-section helpers and includeChangelogFullText options after
   their consumers migrate; move the shared kind enum to neutral statement-owned
   typing/schema first. Retain used coverage/keyword/sanitation/pending primitives
   and document removed public type exports with the JSON migration. In particular,
   retire ChangelogRiskItem/PackageUpgradeChangelogRiskItem and their risk-item
   schemas, UpgradeChangelogRiskItem/old version-item types, ClassifiedChangelogItem,
   normaliseChangelogRiskItems/changelogRiskSections, unused risk summary helpers
   and isUncertainRiskItem; retain the neutral kind enum and used coverage types.
   Retain keywordEntries.body in detailed text and JSON ordinary-entry facts.
3. Add shared input filter normalization, host view propagation and parity.
4. Render the approved Changes bullets/context/nearby sources with existing
   surrounding upgrade groups and lexical evidence. Keep shared standalone
   changelog behavior stable. Update JSON consumers/smoke fixtures and docs.
5. Execute verification, review/closure and final documentation transfer. Keep
   this plan available through implementation review; delete in the final clean
   implementation PR commit, not in a post-merge follow-up. Commit/push/open own
   PR and runCI, but never merge/publish/deploy without owner approval.

Tests and verification:

- Core wire fixtures for triage versus detailed text versus JSON, first-page
  field projections/variables,100-unit pages and one-package continuations; assert
  no deprecated riskItems, no ordinary body/provenance over-fetch in text; retain keywordEntries.body for a verified keyword hit beyond its preview, no statements or
  entry arrays in compact triage, no security/deps metadata in continuations.
- Coverage/collection fixtures:51+ focused items,101+ all, exactly100 and empty,
  selected version with zero units, missing/unparseable notes, all pending,
  mixed-null classifications, oversize units/truncated statement and context,
  source-suppression position gaps, mixed formulations, invalid progress/identity,
  arriving labels or source/count changes between pages and counter disagreements.
  Upgrade all/filtered rejects changed assessment; standalone changelog all still
  accepts label arrival and derives collected coverage. Confidence never controls UI.
- Shared formatter/CLI/MCP/parity tests: every filter and blank/invalid input, always-present effective selection in detailed JSON/text (focused/important/all),
  all's plain no-impact/null tags, bracketed known/kindless tiers and uncertainty,
  keyword-only evidence and quote overlap, version/source URLs outside sampled
  entries, long links/nested code/Unicode/terminal control sanitation, width/color
  equivalence, JSON full provenance, summary ranking unaffected by filters, and
  original security/dependency/30-package/batch-duplicate behavior.
- Run `bun test` on affected core service/statement, shared request/response,
  CLI/tool/parity/catalog/smoke contract files; `bun run typecheck`, `bun run build`,
  changed-fileBiome and `bun run validate:packages`. Run source CLI/MCP smokes;
  use their credential-free modes if the documented isolatedHOME keychain
  limitation persists, plus normal-auth affected dev checks. Built smokes are
  required if smoke launch/CI validation changes; no credential export workaround.
- Reuse the exact three planning ranges for built CLI and localstdio MCP text/JSON
  parity: focused default, actionable, important, all; single and batch/verbose.
  Biome focused must exceed50 with no omissions; all must retrieve875/current
  backend total over9/current required pages. Counts are observations, not immutable
  fixtures; validate totals/provenance/coverage rather than hardcode stored labels.
- Remeasure maximum JSON initial query at1/3/30 packages, compact30 and JSON
  continuation against a separately measured rejection control: all under500.
  Repeat the same three-package raw projection comparison using identical enabled
  optional evidence sections and compact serialization; report bytes/page counts
  and auth/runtime-inclusive timings without a rendering speedup claim. No broad
  package sweep or repeated tests without changes/failures.
- Targeted descriptor-intent `package-upgrade-safety` workload with local MCP on
  dev using Codex; inspect tool-calls/final/metrics/isolation, report absence of
  actual GitHits calls or lack of grading honestly. Discovery first-sentence/80
  contracts and packed MCP consumers remain intact; no broad instruction change.

## Reorientation, completion and cleanup

Planning review must judge direction before implementation guesses. Internal
code_reviewer then one Opus plan reviewer; adjudicate under agent-feedback and
reround only for material corrections. Plan review is its own scope and its
reviewer closes after clean settlement. Implementation starts a fresh code loop.

Phase completion requires all acceptance criteria verified, no unresolved findings,
implementation PR prepared with actual evidence and greenCI. Transfer contracts,
query ownership, consistency rules, JSON migration, operational limits and release
skill-staging notes to permanent documentation, then delete this temporary plan
inside the final clean implementation PR commit. Retain code reviewer until owner
confirms merge. No new deferred work is authorized: close resolved backlog parts,
preserve supersession/applicability limits without expanding this increment.

## Plan review record

Internal technical review: direction sound. Accepted keyword-body finding; retained
keywordEntries.body for detailed text, omitted ordinary raw bodies, added a
beyond-preview wire/render check. Bounded projection/step/test/docs scan and full
recheck found no further issues.

External Opus round1: direction sound; five findings accepted within scope:

1. Implicit focused filtering was not observable -> add always-present effective
   statements.selection metadata and detailed header/exclusion disclosure; test
   focused/important/all regardless of explicit input echo.
2. Old risk-item plumbing would become dead -> remove verified obsolete types,
   schemas/options/helpers after migrating consumers; move shared kind typing first,
   preserve used keyword/sanitation/coverage helpers and document public exports.
3. Public smoke/helper and tool-table surfaces were implicit -> name MCP smoke-test,
   CLI smoke and tools.md, with hosted production-contract adoption requirement.
4. Continuation scheduling/latency was implicit -> sequential review order,
   actual same-case built-CLI all timing and request counts, operational timeout
   limits and cold-all rerun behavior. Reject only treating auth-inclusive helper
   timing as transport/product latency; the supplied evidence does not isolate it.
   Send changelogLimit1 explicitly (existing0 is clamped to1).
5. Extra all-tier quote limits were unspecified -> reuse240-character compact
   bounds for every non-action bullet; verbose expands bounded text for every tier,
   with client/backend truncation markers and stable source/full-text locators.

No new phases, infrastructure, domain verdicts or backend requirements. Re-read
complete revised plan and directly related body/filter/counter/projection/tests/
public-smoke/documentation paths for contradictions. Material changes require the
internal closure pass and another plan round before READY.

External round2: clean after minor wording corrections, including its one
fresh-context final check. Named the imported Express fixture and the shared risk
presentation helper file; clarified that unobserved final counter disagreement
is malformed protocol evidence while observed page changes are retryable; clarified
retained position versus sourcePosition gaps. Internal closure review was clean.
Minimum changelogLimit1 continuation cost was independently confirmed88. All
review notes are adjudicated, none remain open. No production changes were made.
The planning gate was READY; its single implementation increment is now underway.

## Orchestration ledger

Actual sandbox: danger-full-access, approval never; workers inherit it. One callable
luna_implementor, sequential bounded dispatches; coordinator owns judgment, all
network evidence, full verification, commits and reviews. Currentmain stillacd7174.

Sequence before first dispatch (re-slice at each verified return):
1. Worker: shared changes parsing and upgrade request filter mapping only; prove
   named default/blank/actionable/important/all/invalid request tests.
2. Coordinator: mode-specific core queries/schemas and complete sequential
   collection/counter consistency; ordering/attribution judgment stays inline.
3. Coordinator: shared statement renderer, upgrade JSON/Changes migration and
   keyword preservation; evidence-contract judgment stays inline.
4. Worker: CLI changes/view wiring only against settled service contract; prove
   named command-param tests.
5. Worker: MCP changes/view wiring only, same contract; prove named tool-param tests.
6. Worker: mechanical migration of canonical fixtures/test factories and existing
   smoke assertions to the settled statement shape, separate artifact dispatches.
7. Worker: settled docs/release-fragment updates, separate documentation concern;
   coordinator checks assertions against final evidence.
8. Coordinator: affected regressions, live dev/parity/complexity/built timing/eval,
   one fresh luna_reviewer preflight, own full review, internal code_reviewer and
   external Opus loop, PR/CI and final-plan retirement after clean review.

Workers return verified uncommitted changes at each checkpoint; never commit/push
or edit outside the exhaustive slice list. Interrupts are normal. No broad extra
validation/platform/infrastructure invented by workers. No coordinator tests/builds
while a worker is active. Rewrite the next slice if scope or evidence changes.

### Implementation checkpoint (2026-10-14)

Core complete collection/projections and shared JSON/source bullet rendering are
implemented. Initial batches remain unsplit, continuations sequential; all mode
compares assessment coverage, and stable counter disagreement is malformed.
Standalone all still tolerates label arrival. Legacy risk item schemas/types and
presentation helpers are removed; the kind schema is neutral before that removal.
Keyword bodies, unversioned/aggregate matches, 240-character compact bounds and
same-source quote suppression remain functional. No backend changes were needed.

Luna dispatches: shared parser/filter mapping; CLI wiring; MCP wiring; MCP proof
wording correction; readonly table correction; union correction; default fixtures;
public smoke contract; reference docs; release fragment (10 total). Coordinator
owns canonical fixture migration, pagination/renderer semantics/tests and durable
implementation doc. Runtime proofs passed, but host table fixes still failed
TypeScript; coordinator explicitly took over those two tables and resolved them.
The documentation proof guessed an absent row prefix; coordinator ran and passed
the explicit two-section wording check. These were evidence-contract/slicing costs,
not product decisions. No interrupts, worker commits, scope fanouts or extra
platform validation. Final worker edits are accepted after diff/proof inspection.

Final query complexity: JSON1/3/30=330/340/475; all30=475; triage30=391;
JSON continuation=88. Independently calibrated control5100. Exact requested dev
URLs were used for final built CLI/local MCP parity; the repository's dev preset
now routes code navigation to oss-dev.githits.dev. Initial preset smoke parity
also passed, but explicit endpoint evidence is authoritative for this task.

Coverage remains the planning counts: Express141/15 (0+8 act,6+1 know,126 no
impact,4 classified); Express57/14 (3+4 act,7 know,43 no impact,4 classified);
Biome875/62 (13+27 act,12+10 know,813 no impact,13 classified). All have zero
pending/missing/unparseable versions. No cold claim. Biome all875 collected in
9 observed requests and13.683s built Node walltime including auth/startup/observer.
Raw same-case projection bytes: baseline443505, detailed467275, triage16202.

262 affected tests initially passed; expanded regression run618 passed with one
source launch timeout. A diagnostic and an unchanged default-timeout rerun passed
that exact case; no timeout or product change was made. Core final32 and renderer
final26 passed after edge-case and keyword checks. Typecheck/public-package
validation and four source/built smoke modes passed before the last keyword fix;
final affected checks/build/smokes are pending below.

Agent workload: first preset run timed out302s after starting pkg_upgrade_review,
no final, cause unproven. Exact arguments succeeded directly on Fly dev via built
Node/source Bun MCP. Correct-endpoint descriptor/intent rerun succeeded177.3s,
9 logical calls including2 completed upgrade reviews; final/metrics/trace inspected,
no isolation violations recorded. One missing-release follow-up failed and research
was unfinished in the trace. No grading ran; no quality claim. Permanent facts are
in docs/implementation/pkg-upgrade-review.md. Final preflight/internal/external
reviews, stable commits, PR/CI and plan retirement remain.

Final local gates: public package validation (both builds/packed consumers) passed;
624 affected/regression tests and2858 assertions passed; all four source/built
CLI/MCP smoke modes passed; changed TypeScript files pass Biome with no warnings.
The final typecheck found one test-only indexed access after wire-fixture types
were tightened; corrected it and the canonical-Go input fixture, then32 core cases
and typecheck passed. No product fallback/timeout change. Implementation churn is
1628 changed lines (tests/docs excluded), below the agreed2k stop threshold.
The exact release fragment has pending minor impacts for both artifacts.

Preflight direction is sound and acceptance evidence meets the plan. Its three
minor documentation findings are closed: sibling changelog ownership notes no
longer claim upgrade review is unchanged, and the JSON example marks fullText,
sourcePosition and classification provenance as required where JSON requires
them. Bounded scan covered the changelog/upgrade implementation and tool/CLI
references. Internal correctness review, external review and PR/CI remain.

Internal code_reviewer full-delta pass: direction sound, no findings. Production
rollout remains a public-release prerequisite. External Opus review follows.

External Opus round1: direction sound; accepted terminal-sanitation regression,
keyword-only source duplication/list-marker noise, source nesting, duplicated view
shaping and misleading oversize terminology. Root cause/sibling closure: keyword
rendering skipped the established sanitation boundary; checked all detailed
keyword bodies, signals, source URLs and aggregate unmatched signals. They now
normalize/sanitize before wrapping/style; JSON stays faithful. Keyword URLs
already shown for a version/source are suppressed and original list markers
removed. Upgrade adds two spaces and subtracts two columns around the shared
source renderer; standalone output unchanged. Shared request builder now owns
view derivation and tier selection, with required resolved view/selection and no
response-layer fallback. Checked all build callers/host adapters. Worker dispatch
11 owns view shaping, dispatch12 owns oversize argument wording; coordinator owns
formatter regressions and closure. Targeted verification and round2 pending.

Round1 closure verification:124 focused request/response/standalone/host/parity
tests,663 assertions passed. New schema wording test needed object/non-null
narrowing for JSONSchema's boolean union; worker dispatch13 corrected it,
isolated test and typecheck passed. Package validation and both source smoke
modes passed again. Internal full revised review is clean. Final built smokes,
narrow Fly parity and description-sensitive agent workload rerun are active.
No query change, complexity evidence remains applicable; implementation churn
1650lines, below2k. External round2 follows.
