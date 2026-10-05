# Grep preparation UX

## Status and outcome

- Overall: IMPLEMENTING the combined client increment; backend contract finalized.
- Phase 1: IN PROGRESS - indexing responses explain the pending work and
  give the agent an executable next step using the existing contract.
- Phase 2: IN PROGRESS - shared metadata selection, decoding, rendering and wait
  policy for existing waiting client surfaces; dev verified, production unverified.
- Product decisions: none. The user requested plain indexing status, estimates
  when supplied, and explicit agent retry guidance, comparable to search.
- Dependencies: backend PR #2980 is merged and dev supports the finalized field.
  Verified production schema deployment remains a release/adoption prerequisite.

The completed effort makes grep preparation actionable in CLI and MCP text:
which target is indexing, what evidence is available, and exactly how to retry.
Partial matches remain usable and clearly limited. Estimates are displayed only
when backed by metadata, with their actual timing semantics.

## Verified evidence (2026-10-05)

- The reported DeepSeek Flash response is reproduced exactly by
  `formatGrepText` with no hits/scopes, one unavailable target whose reason is
  `repository_indexing`, retryable true, and NON_RESUMABLE_PARTIAL traversal.
- `packages/mcp/src/shared/grep-text.ts` prints raw reason strings, input
  indices, an opaque progress reference and a cursor-absence warning. Successful
  partial responses never receive the retry guidance added by the error path.
- `packages/core-internal/src/services/grep-service.ts` selects and validates
  unavailable-target reason, retryable, progressRef and suggestedSiteTargets.
  Neither unavailable targets nor scope status currently carries estimates.
- A read-only authenticated production GraphQL validation probe rejected
  `GrepResult.indexingEstimates`, `GrepUnavailableTarget.indexingEstimate`,
  `GrepUnavailableTarget.estimatedIndexingDuration`, and
  `GrepTargetStatus.indexingEstimate`. Introspection was unavailable. These
  probes establish that those selections cannot ship now; they do not establish
  that no differently named backend metadata exists.
- Search already selects `progress.indexingEstimates` with kind, targets,
  repositoryUrl, commitSha, estimate and unavailableReason. The estimate has
  lowerSeconds, upperSeconds, elapsedSeconds, sampleCount and source.
  `docs/implementation/tools.md` specifies total active indexing execution
  duration, not remaining time or guaranteed completion. Normal search progress
  text currently uses estimates for wait selection without displaying the range;
  indexing errors separately render estimate details through the shared mapper.
- Grep preparation defaults to zero wait; retry requests support
  `wait_timeout_ms` / CLI `--wait` in milliseconds. Continuation never waits.
  `progressRef` has no verified grep-status operation; it must not be routed to
  search_status merely because it resembles a search reference.
- Both top-level CLI and MCP share the grep formatter. JSON uses the existing
  parsed backend result. Legacy `code_grep` is a separate path.
- External review read backend pkgseer-backend @289a35bd6, specifically
  `grep/preparation.ex`, `repo_resolver.ex`, `error_extensions.ex`, GraphQL docs
  and tests. It confirmed repository_indexing and documentation_publishing
  (with crawl progress refs) are retryable successful unavailable targets.
  Preparation errors do not emit those indexing/progress-ref issues; some current
  client error fixtures are synthetic, not backend contract evidence.
  A real no_grep_scopes issue has neither target nor input index: the current
  hint would render `Input null: no_grep_scopes`.
- The backend already has `IndexingDurationEstimate.estimate_for_repo` used by
  navigation errors; grep preparation drops this duration evidence. Client
  `IndexingDurationEstimate`, its navigation service schema/normalizer, and CLI
  `formatIndexingError` provide existing timing semantics and range rendering.
  PUBLIC_ISSUE_KEYS allowlists error issue fields; do not extend it for estimates
  without a verified backend error contract.
- Existing `docs/plans/search-output-ux.md` is a broader formatter program;
  this plan governs the specific preparation contract defect and metadata gap.

## Scope, ownership and constraints

The MCP package's shared grep formatter naturally owns agent/human presentation:
both CLI and MCP already call it. The core service owns wire selection and
validation; the backend owns preparation state and measured duration evidence.
Keep those boundaries. A host-specific formatter would duplicate the behavior;
a new generic lifecycle abstraction is unnecessary for this change.

Scope includes successful pending/partial grep pages and the existing
GREP_TARGET_PREPARATION_REQUIRED error envelope. No automatic retries, timers,
new status tool, cursor protocol, backend scheduling machinery, or new caller
constraints. Do not change tool descriptions, quick_start or published skills
unless implementation evidence requires it and the plan is updated first.
No search formatter rewrite and no legacy grep rewrite.

Assumptions: `repository_indexing` and `documentation_publishing` are verified
pending preparation reasons; only explicit known reasons warrant that wording.
`retryable` controls retry advice, not the presence of a progress ID. Unknown
reasons remain honestly represented without being relabeled as indexing.
No unresolved product or field-placement decision remains. Dev supports the
contract; production support is unverified and must be verified before release.

Compatibility: the combined increment adds indexingEstimates to selected success
payloads and pending sentinel error details. Existing singular estimates, backend
messages, attribution and structured target issues retain their semantics. Never expose credentials in evidence or
review briefs. Text retains control escaping, wrapping, ASCII authored prose,
stable read locators, scope coverage, skips, stale snapshots, and cursor expiry.
This is a UX correctness change, not a performance optimization; no performance
claim or benchmark sweep is required.

## Phase 1 - actionable preparation responses

Expected outcome: the reported page clearly says the repository is indexing and
instructs the agent to retry the same grep with a bounded preparation wait.
Dependencies: current client/service contract only. Unknowns: none.

1. Add representative fixtures/tests for the reported zero-hit page, pending
   documentation, mixed successful/pending targets, and backend-tested
   preparation errors before editing production. Do not manufacture indexing
   error-envelope fixtures for a state the backend does not emit.
2. In `packages/mcp/src/shared/grep-text.ts`, translate the observed indexing
   reasons into plain language: repository is being indexed; documentation is
   being prepared. Identify every unavailable target without routine input-index
   scaffolding; preserve attribution only if needed for colliding labels. An
   empty response says "No matches yet" only when there is at least one
   unavailable target and every coverage gap is an unavailable target with
   retryable true. Use this same condition for step 4; independent scope gaps,
   failures and expiry do not qualify. Pending wording remains limited to the
   two verified pending reasons. Mixed pages preserve actual counts and explain
   the unsearched pending targets.
3. Add a surface-native next step for retryable preparation: repeat the same
   ordered targets, pattern and matching controls with MCP
   `wait_timeout_ms=30000` or CLI `--wait 30000`, deriving the value from the
   existing DEFAULT_WAIT_TIMEOUT_MS constant. Key retry advice on retryable,
   never on the presence of a progress ID. The wait is a request budget, never an
   estimate or polling cadence. Restart without a cursor; continuation cannot
   wait or recover omitted targets. If a real nextCursor also exists, retain the
   continuation action and explain it pages currently available evidence, while
   a fresh grep retries the unavailable targets.
4. Omit progressRef from all unavailable-target text; it remains in JSON. Replace
   the unactionable traversal/cursor warning with the retry action under step 2's
   identical retryable-unavailable-only condition. Unknown retryable reasons
   retain honest reason text without being called preparation. Keep explicit
   coverage warnings for other gaps;
   indexing must not obscure independent failures, stale evidence or expiry.
5. Make `grep-error-map.ts` preparation target-issue hints identify the supplied
   target name, or the actual input index when no target is supplied. When neither
   exists, omit the prefix instead of printing `Input null`. Translate verified
   reasons such as no_grep_scopes into plain language without labeling resolution
   failures as ongoing indexing. Omit opaque progress IDs from human hints as a
   general rule, not a special invented error state.
   Keep structured targetIssues and backend messages intact.
   Reuse a small grep-local pure helper only if both paths need the same mapping;
   no separate presentation model or cross-tool framework.
6. Update `docs/implementation/unified-grep.md` and add a `changes/` fix fragment
   with pending minor impacts for githits and @githits/mcp (the combined metadata increment adds public fields); Agent Skills unchanged.

Acceptance criteria:

- The reproduced response identifies indexing, names the target, and explicitly
  tells the agent to repeat grep with the correct wait argument. No raw
  repository_indexing, progress UUID, input-zero row or cursor-absence warning
  is the default explanation of this known preparation-only response.
- Documentation preparation receives the same target/status/action hierarchy;
  its crawl ref stays out of default text. Nonretryable targets do not receive
  unchanged-retry advice. Unknown/unrelated
  reasons are not called indexing. A progress ID alone proves neither indexing
  nor pollability.
- Partial matches, real pagination, cursor expiry, skipped files, stale scopes
  and other failures retain honest coverage and their usable actions.
- CLI/MCP text agree except surface-native syntax and color/width; JSON
  retains existing evidence and adds the shared metadata. Preparation errors retain backend message and structured
  target details while gaining readable, correct guidance. Assert actual error
  shapes: target-bearing issues use names; index-bearing issues retain attribution;
  no_grep_scopes has no fabricated `Input null` prefix. MCP errors encode the
  shared JSON envelope as text: test human details.hint/details.action fields
  separately from preserved structured targetIssues on both JSON surfaces.
- Verify with `bun test packages/mcp/src/shared/grep-text.test.ts
  packages/mcp/src/shared/grep-text-rendering.test.ts
  packages/mcp/src/shared/grep-error-map.test.ts
  packages/mcp/src/tools/grep.test.ts src/commands/grep.test.ts
  src/tools/grep-parity.test.ts`, `bun run typecheck`, `bun run build`,
  `bun run smoke:cli`, and `bun run smoke:mcp`. Pending output is covered in
  the existing unit/parity tests; smoke remains live and must pass. No fixture
  injection mechanism is added to smoke. Live ready data alone cannot prove
  recovery from a pending state.
- Run `bun run agent:e2e` with local MCP and the targeted
  `eval/agentic/workloads/code-grep-investigation.md` workload. Inspect tool
  calls, final answer, metrics and isolation violations. Report whether indexing
  was actually encountered; a warm run cannot validate pending-state recovery.
  Do not fabricate cold refs or reset backend data to force pending output.
- One clean external implementation review, or the documented three-round limit
  with every remaining valid in-scope finding fixed and verified.

## Phase 2 - finalized uniform contract and client integration

Status: IN PROGRESS in the same client increment as Phase 1. Expected outcome:
existing waiting client surfaces preserve the same indexing evidence and use one
shared duration renderer/wait policy; grep gains actionable pending output.
Dependencies: backend PR [#2980](https://github.com/githits-com/pkgseer-backend/pull/2980)
merged as 884d09bda21666d63386bc23e267e0812a4d06e7. Containing revision
bd9043e8305b24255c9a623d373d50afaa15da83 deployed to dev through
[run 37301772368](https://github.com/githits-com/pkgseer-backend/actions/runs/37301772368).
All five dev machines passed health checks. Backend-owner authenticated live
checks covered pending/ready grep, list, read and navigation, both diff sides,
ready documentation inventory, preserved cursors, and clearing to [] when ready.
The original reported SQLAlchemy ref is now ready; replaying it cannot prove
pending recovery. NO_HISTORY/unsupported work were covered by backend tests.
Unknowns: production support only; do not claim deployment from local/dev tests.

Final contract, supplied by the user-authorized handoff:

```graphql
indexingEstimates {
  kind targets repositoryUrl commitSha unavailableReason
  estimate { lowerSeconds upperSeconds elapsedSeconds sampleCount source }
}
```

The nonnull result-level array reuses DiscoveryIndexingEstimate and the existing
IndexingDurationEstimate. Read selects it only inside CodeContextResult;
nonwaiting documentation and ambiguity members do not expose it. Backend
structural diff exposes it inside structural; options live at structuralOptions.
This checkout exposes raw codeDiff only and has no codeOverview/listSymbols/
versionDiff/structural client API; do not add unused selections or new APIs just
because the backend supports them. Existing waiting consumers are grep, list,
read/fetchCodeContext, legacy listRepoFiles/grepRepo, discovery/search-status,
and listPackageDocs. Preserve all entries, including multiple targets/work sides.

Bounds are advisory TOTAL repository indexing execution seconds, excluding
queue/retry/query/hosted-doc time. Never subtract elapsed or call them guaranteed
or remaining ETA. Elapsed is observable active execution only. NO_HISTORY can
carry elapsed-only evidence or no estimate. Hosted work is DOCUMENTATION /
UNSUPPORTED_WORK with null URL/SHA/timing. Coalesced work may have unknown SHA.
Ready/terminal scopes have []; readable evidence may coexist with pending refresh.
Legacy singular estimates remain independent; pending read deadline handoffs can
have a null singular estimate alongside populated shared timing.

Implementation steps:

1. Extract the existing core duration/entry schema, selection and normalization
   into a small transport-neutral shared module. Preserve existing exported type
   names. Require the selected result array at the wire boundary, retain optional
   public service fields where needed for custom provider source compatibility,
   and add no old-server fallback or flag.
2. Select/decode the identical metadata on existing waiting query branches. Carry
   it through success projections and typed pending sentinel errors, including
   read's deadline handoff. Keep status decisions based on current status fields;
   timing alone must not classify failed/terminal work as pending. Ready results
   remain []; nonwaiting read branches fetch none. Preserve existing singular
   fields, requested attribution, partial hits and cursors. Error repo_url feeds
   existing indexed-ref guidance without manufacturing result-level entries.
3. Generalize existing discovery wait calculation with an explicit caller cap;
   keep discovery's 120000ms and read/navigation's 60000ms budgets. Grep/list
   retry suggestions use the conservative verified 120000ms presentation cap
   despite their backend argument ceiling of 300000ms. Largest upper bound plus
   ten seconds, rounded up to ten seconds; default floor for uncovered work,
   never sum labels/jobs or subtract elapsed. Keep request defaults unchanged.
4. Share plain total-duration/active-elapsed rendering between grep, list,
   discovery and existing pending error output. Reuse that rendering for legacy
   singular fallback without changing its semantics. Preserve ready output and
   raw pipe-friendly file output; structured/annotated read surfaces retain
   pending-refresh metadata. Existing actions stay surface-specific; no automatic
   retries/status calls. Grep retries fresh first pages without cursor.
5. Add wire variable/selection and decoding regression tests for existing
   consumers, metadata preservation in JSON/projections/errors, duration policy,
   two-entry/coalesced/absent-history/unsupported-doc evidence, pending read with
   null singular timing, pending grep mixed with hits/cursor, and ready [] output.
6. Verify focused tests, full bun tests, typecheck, formatting/lint, build and
   package validation, then authenticated source CLI/MCP smoke with GITHITS_ENV=dev
   and unintended URL overrides removed. Run the targeted agent:e2e grep workload
   against local dev MCP and inspect its trace/metrics/isolation; report warm-data
   limitations. No production selection probes, data resets, new duration model,
   backend edits, polling API or infrastructure.
7. Update unified-grep and shared indexing implementation documentation, add a
   changes fragment for both public artifacts, complete project review and draft
   PR. Shared success/service metadata is an additive public API change: minor
   pending impact for githits and @githits/mcp. Do not bump versions now.

Acceptance: identical decoded timing semantics across existing consumers; selected
fields reach their text/JSON/error consumers; minimal branch-correct fetching;
backend attribution and all work entries preserved; grep explains preparation,
shows honest estimates and gives the correct retry action; ready text remains
quiet; tests cover unknown timing and partial evidence independently of live
warm targets; dev smoke passes. Production schema support is a documented release
prerequisite, not a reason to add a compatibility mechanism. No merge/release/
publish/deploy authorization is conveyed by this handoff.

## Reorientation, review and cleanup

Review the plan now, before implementation. Record internal and single external
review dispositions here. The finalized backend contract allows both phases in one client PR; implementation
review covers the full shared contract and grep UX delta. The current plan
does not authorize publishing or deploying either artifact.

Review record:

- Internal preflight: direction sound. Accepted the shared error-hint cleanup and
  corrected assertions to distinguish human hints from JSON issue fields.
- External round 1: direction sound. Accepted all six findings: actual backend
  error shapes replace synthetic indexing errors; documentation_publishing shares
  the pending UX; deterministic coverage uses existing unit/parity tests, not new
  smoke fixture infrastructure; reuse DEFAULT_WAIT_TIMEOUT_MS; cite the existing
  backend estimate producer/client type/rendering and respect error allowlisting;
  relay the backend request alongside Phase 1. Closure: reviewed the complete plan
  against success/error routing, wait/cursor handling, smoke implementation,
  duration contracts and phase acceptance criteria; revised those sections.
- Optional subset-target retry is unnecessary: retain the existing full ordered
  target/control contract for predictable attribution and recovery.
- Baseline focused tests: 31 passed, 0 failed, 219 assertions across six files.
  Production code, builds, smokes and agent evals are unchanged/not run in planning.
- External round 2: clean after a minor wording correction. Headline and
  traversal-warning replacement now use the same retryable-unavailable-only
  condition; reason-specific pending language remains restricted to the two
  verified pending reasons. All round-1 findings are closed; no open findings.

Keep this plan through final implementation review. On the last increment's
clean review, move durable UX/metadata contracts to implementation documentation,
record any genuinely open backend dependency in the repository backlog, and
delete the plan as the final commit of that PR. Do not call the overall effort
complete before estimates supplied by the backend are consumed and displayed.

## Implementation verification and review (2026-10-05)

- Shared core selection/decoding and optional provider fields implemented for all
  existing waiting consumers. Public wire arrays remain required. Null-singular
  pending read handoff and every distinct success normalizer have positive tests.
- Grep preparation text and retry action implemented; opaque progress stays in JSON.
  Shared total-duration wording and capped wait calculation retain active elapsed
  and provenance without computing remaining time. Annotated discovery/list/read/
  docs/legacy navigation retain metadata; raw path/content output stays raw.
- Focused service/shared/grep CLI/MCP parity: 2117 pass, 0 fail, 7566 assertions
  across 84 files. Separate smoke regression suite: 85 pass, 0 fail.
- Full `bun test`: 5354 pass, 9 fail, one runner error, 384.97s. One failed
  public grep provider projection was corrected; other failures were process
  timeouts. All affected files rechecked in isolation: 104 pass, 0 fail across
  seven files. No test timeout settings were weakened.
- `bun run typecheck`, build and public package validation passed. Formatting and lint passed (existing lint warnings remain). Built CLI
  unauthenticated and MCP stable/experimental registration smoke passed.
- Authenticated dev MCP grep/list/read selected and decoded ready arrays `[]`,
  preserving two-match grep continuation, two-entry list continuation and read
  content on the original SQLAlchemy ref. Warm results do not prove pending
  recovery; deterministic fixtures and supplied backend pending capture do.
- Codex targeted local-dev MCP agent eval succeeded: 66.7s, six completed calls
  (quick_start, two grep, three read), no failed calls or isolation artifact.
  Final answer cited both Express router import sites with high self-reported
  confidence. No grading stage ran; this is execution evidence, not a quality score.
  The workload was warm and did not exercise indexing.
- Initial source smoke passed isolated registration/auth handling but the live
  probe failed with UNKNOWN/missing JSON envelope without an injected token. Retried with
  dev token passed privately in the environment. MCP reached a preexisting smoke
  defect: explicit three-line body budgets incorrectly required a truncation hint
  for changelog entries that fit. Fixed the conditional assertion in place and
  added a short-body regression; full authenticated dev smoke is rerunning.
- Internal implementation round 1: direction sound; accepted service-normalizer
  positive coverage gap. Round 2 clean after the tests and smoke correction.
- Production schema support remains unverified and recorded in docs/backlog.md.
  No backend edits, release, merge, publish or deployment performed.
