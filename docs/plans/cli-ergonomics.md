# Plan: CLI ergonomics

## Status and expected outcome

- Overall: **IN PROGRESS**; Phase 1 merged in [#530](https://github.com/githits-com/githits-cli/pull/530);
  Phase 1a merged in [#533](https://github.com/githits-com/githits-cli/pull/533);
  Phase 2 merged in [#535](https://github.com/githits-com/githits-cli/pull/535);
  Phase 3 is parked by user decision; Phase 4 awaits the backend contract.
- Owner: this CLI worktree; backend investigations have separate child worktrees.
- User direction, 2026-11-03: improve CLI ergonomics from the supplied feedback;
  exclude all skill changes because OP is reviewing those separately. Dispatch
  backend agents for escaped-pipe regex handling and unified grep enclosing blocks.
- The user invoked `$orchestrate` to implement ready Phase 1. Later phases
  retain their contract and evidence gates; all skill changes remain excluded.
- User direction after #530 merged: plan compact CLI regex guidance. Matching
  is correct; explain alternation versus literal pipes in help, not runtime hints.
- User decision, 2026-11-03: park built-in output limits. Frequent use of `head`
  in one feedback report does not establish a need for another output control.

When complete, common valid CLI near-misses work without another call, failures
provide a relevant next command when the request supplies enough information.
Unified grep can expose legacy-equivalent enclosing-symbol metadata after its
backend establishes that contract; actual
source bodies are a separate, cost-dependent improvement. Regex guidance is
compact and accurate without silently changing caller intent.

## Verified planning baseline

Phase 2 is based on refreshed `origin/main`
`31b2fd60848aeab869c15540caf4f56596c2e012`, the merge of #533.
Source feedback remains the supplied `feedback-summary-2026-11-03.docx`;
its aggregate error/token figures are not reproduced measurements.

- `AgenticAskHttpError.rateLimitScope` distinguishes `daily` from `request`.
  The service's exact daily-429 classification is nonretryable and preserves
  00:00 UTC reset advice. `mapAgenticAskError()` retains scope, status,
  retry timing, Research run ID and thread ID. No backend change is needed.
- `researchAction()` owns the explicit target/thread/question and formats both
  human errors and JSON. Current daily errors give generic search/grep/list/read
  advice but no executable scoped command. The shared terminal formatter handles
  request-rate timing; it does not render arbitrary `details.action` values.
- `parseUnifiedSearchTargetSpec()` accepts explicit packages, repository
  shorthands/URLs and site targets. Local probes accept `npm:express`,
  `github:expressjs/express@4.21.2`, its HTTPS URL and `site:expressjs.com`;
  they reject bare `express` and `lib/router.js`. `search --in TARGET -- QUERY`
  is the actual registered CLI grammar. Reuse the parser only for eligibility;
  preserve the original target bytes in a suggested command.
- `shellQuoteExact()` is already exported through the private CLI transition
  surface and handles quotes and C0/C1 controls using the established shell
  action policy. Research values come from CLI argv, which cannot contain NUL.
- Grep's core error preserves raw GraphQL extensions. The current mapper drops
  validation `input_path`, `reason` and `expected`, retaining only `graphqlCode`.
  A local producer-shaped probe with `input_path: ["targets", 1]` confirms that
  loss. Backend source already supplies typed paths, so this is not evidence
  that the producer lacks attribution. Deployed shapes and generic validation
  adoption remain the existing backlog gate; preparation `target_issues` is a
  different contract and cannot prove that an operand was intended as a path.

These planning probes used pure parsers/error mappers and synthetic failures;
no login, credentials, Research request or quota exhaustion was used. Runtime
verification output belongs on the PR, not in permanent implementation docs.

The completed regex investigation is preserved at
[PkgSeer commit 0ab7fca](https://github.com/githits-com/pkgseer-backend/blob/0ab7fcad13bfc6b3c932cfc15ff5d4848a923f08/docs/analysis/2026-11-03-grep-regex-ergonomics.md).
It established correct matching and route policy; #533 adopted the CLI guidance.
Its separate backend schema-documentation note remains in PkgSeer's backlog.

## Scope and boundaries

Included: context tolerance, exact single-line reads, path-operand guidance,
compact CLI regex help, Research recovery, and later adoption of verified backend
enclosing-symbol capabilities. Existing
command help and permanent implementation docs may change; skills, shared MCP
instructions and plugin assets must not change as a side effect.

Built-in output limits are parked, outside active implementation scope. Phase 3
records the evidence required to reconsider them.

Phase 2 additionally excludes MCP descriptors/instructions, shared error-map
or generic formatter changes, and public API changes. Its action is CLI-only;
later producer adoption retains its separate MCP gates.

Excluded: skill editing/routing rewrites; regex rewriting, intent detection,
empty-result reminders or automatic literal retries; automatic Research
retries/backoff; async Research infrastructure; quota accounting/doctor network
probes; package freshness timestamps; inferred manifest/registry selection; multi-file or
disjoint-range batching; literal numeric-colon/whitespace path fixes; broad
formatter redesign; release, publish, deploy or merge. These substantial backend
and product candidates remain recorded below rather than silently disappearing.

## Ownership and target architecture

CLI owns textual argument tolerance and shell-native actions. Shared MCP-package
helpers own reusable pure conversion and presentation; core services own wire
types, selections and decoding. PkgSeer owns API diagnostics, source projections
and authoritative read actions; aigrep owns matching and parsed source blocks.

1. CLI parses user syntax, reports any reduction of requested context, and
   passes canonical service controls to the existing strict shared builders.
   MCP schemas and defaults need not change for CLI tolerance. This increment
   deliberately stays within the requested CLI scope; changing MCP acceptance
   would require a package release and descriptor eval. The same excessive-
   context failure on MCP remains a recorded follow-up, not a solved problem.
2. Reuse one small pure context clamp/metadata helper between legacy and unified
   CLI paths. Place it with shared grep request utilities, without importing the
   legacy service builder just to normalize a number. The legacy private helper
   is simpler locally but would leave two policies for the same ceiling.
3. Keep input-derived correction actions at the request-aware CLI boundary;
   do not move request discovery or service calls into a formatter. Reuse exact
   shell quoting and terminal sanitization. Backend locators remain authoritative.
4. Backend-dependent controls follow a verified, versioned producer contract.
   Never hydrate blocks through hidden per-hit read requests or synthesize bounds
   from regex/indentation in the CLI.
5. CLI owns command-specific syntax guidance and mode names. Completed Phase 1a
   updated registration text and its CLI-only legacy note in place, preserving
   argument-name translations without a new replacement layer or helper. Phase 2
   adds its small request-aware action helper at the same CLI ownership level.
   Refactoring opportunity: move legacy CLI-only helpers out of the private MCP
   transition tree with the CLI package move; relocation is unnecessary for copy.

## Assumptions, unknowns and constraints

Assumptions: existing service operations suffice for Phases 1–2; context's backend
ceiling stays 10; accepting `--lines N` means exactly line N; existing successful
multi-target, range, case, path-selector and pagination behavior must remain.
These are supported by the code/probes above, not assumptions about live latency.

Unknowns/product decisions: **none for Phase 2's Research increment**.
Its typed limit scope and local search eligibility are verified. Grep operand
recovery stays with [typed validation recovery](open-backlog.md#validation-error-recovery-after-pkgseer-phases-3-4):
verify deployed producer shapes and preserve their facts before adding hints.
Phase 3 is parked; no output-budget design or implementation is scheduled.
Phase 4 needs the released producer contract and any separately approved body
extension. These later unknowns do not block scoped Research recovery.

No migrations, dependencies, caches, queues, retry layers, feature flags or
background processes. Defaults remain stable except acceptance of the documented
near-misses. No total-token, latency or backend-cost reduction is promised by
formatting alone. Obtain approval before introducing infrastructure.

## Ordered phase map

| Phase | Status | Observable outcome | Dependencies |
| --- | --- | --- | --- |
| 1 — tolerate common arguments | COMPLETE; merged #530 | `--lines N` selects one line; excessive valid context becomes 10 with a visible notice; path flags are clear in help. | Existing read/grep paths only. |
| 1a — compact regex guidance | COMPLETE; merged #533 | Both CLI grep helps distinguish alternation/literal pipes and qualify route-dependent literal-text requirements. | Merged #530 and verified regex investigation; no backend change. |
| 2 — scoped Research recovery | COMPLETE; merged #535 | Daily Research exhaustion shows a scoped search example with a fixed query placeholder when an explicit search-compatible target exists. | Merged #533, existing typed rate-limit scope and local parser/quoting. Grep validation adoption remains separately gated. |
| 3 — bounded readable output | PARKED by user decision | No built-in output limits; reconsider only with demonstrated harm or repeated avoidable cost from current previews. | New evidence and a decision to resume. |
| 4 — backend-assisted enclosing symbols | WAITING ON NATIVE CONTRACT | Unified grep can opt into legacy-equivalent enclosing-symbol metadata and exact source-read ranges; source bodies remain conditional on cost. | Native implementation/release, PkgSeer adoption and verified wire contract. |

### Phase 1 — tolerate common arguments

Status: **COMPLETE; merged #530**. Exact single-line reads, validated/capped
context, compact selectors/help and isolated smoke storage are implemented.
Durable contracts live in `docs/implementation/cli-commands.md`,
`unified-read.md`, `unified-grep.md` and `docs/guidelines/TESTING.md`.
Verification and review records are on #530. No remaining Phase 1 gate.

### Phase 1a — compact CLI regex guidance

Status: **COMPLETE; merged #533**. Both CLI grep helps distinguish alternation
and literal pipes and qualify route-specific literal-text requirements without
help growth. Durable contracts live in `docs/implementation/unified-grep.md`
and `cli-commands.md`; execution and review evidence is on #533. No open gate.

### Phase 2 — scoped Research recovery

Status: **COMPLETE; merged #535**. Eligible CLI daily-limit errors show a scoped
search template with the fixed `your query` placeholder, labelled `Example:`
and exposed as `details.example`. Original request/error facts and diagnostic
IDs remain; no inferred target, question replay or automatic follow-up call.
Durable contracts live in `docs/implementation/research.md` and
`cli-commands.md`; review and verification evidence is on #535. No open gate.

### Phase 3 — bounded readable output

Status: **PARKED by user decision, 2026-11-03**. No design or implementation is
scheduled, and this phase does not gate enclosing-symbol adoption.

Evidence: the supplied report says agents piped output through `head` more than
half the time. This establishes frequent previewing, not failure of that workflow.
`head` already keeps discarded text out of the agent's context. A formatter-only
limit would still fetch the same backend response. Grep's trailing continuation
cursor and read guidance can be discarded, but the report does not demonstrate
that this caused failed tasks or additional calls.

The earlier assumption that built-in budgets would improve ergonomics enough to
justify a new control remains unproven. Reconsider only when traces demonstrate
lost continuation information causing problems or repeated avoidable refetching,
and compare the smallest remedy with existing request controls and shell previews.
No budget units, commands, formatter architecture or acceptance contract are
selected. A decision to resume requires new evidence; coordinate any resulting
design with `search-output-ux.md` rather than duplicating its work.

### Phase 4 — backend-assisted enclosing symbols

Status: **WAITING ON NATIVE CONTRACT**. Outcome: opt-in unified grep exposes
legacy-equivalent enclosing-symbol identity/ranges with exact snapshot reads.
Metadata is not a source body. The backend handoff records the user's accepted
legacy-parity minimum; actual source bodies are conditional on a cheap, reviewed
extension, not required for the first delivery.
Assumptions: producer-owned bounds and read locators remain authoritative;
default requests stay lean. Unknowns: released fields/API version, supported
absence and any cheap body extension. Dependencies: aigrep implementation and
release, PkgSeer adoption, then a verified client wire contract. This phase does
not block independent CLI work, including Phase 1a's settled regex guidance.

Acceptance: requested symbol metadata and accurate source-read ranges survive
CLI/MCP projection; absence, source identity, coverage and cursors remain honest;
no hidden per-hit CLI fetches or unused default fields. Actual bodies, if adopted,
need a separately settled omission/budget contract. Add tactical details and
appropriate wire/parity/smoke/eval evidence after the producer contract arrives.

## Backend dependencies

Regex investigation is complete: matching is correct and Phase 1a needs no
backend change. The small backend schema-description correction remains in
PkgSeer's backlog and is owned there; it does not gate CLI help.
Enclosing-symbol work remains native -> PkgSeer -> client adoption, as described
above. Agent handles, runtime progress and execution results belong on PRs, not
in this contract.

## Deferred feedback candidates

- Unified MCP grep context tolerance: the same normal-agent failure remains on
  MCP. `docs/implementation/agent-context-loading.md` records prior agents sending
  context 12 and the legacy CLI/MCP cap correction; the unified MCP schema still
  rejects above 10. A separate change should accept nonnegative safe integers,
  report effective context consistently, preserve the backend ceiling and ship
  with the MCP release/descriptor evaluation its changed acceptance requires.
- Remaining quota/reset visibility: backend accounting contract required;
  do not infer allowance from local history or make doctor unexpectedly networked.
- Async Research: backend operation lifecycle, cancellation and credit behavior
  need investigation/product decisions. Existing timeout evidence remains in
  `docs/backlog.md`; no client process/retry workaround is proposed.
- Package latest-version freshness: authoritative metadata observation time is
  missing from the client contract; publication/download dates cannot substitute.
- Batched files/disjoint ranges: verify producer batching and request limits
  before adding comma grammar or fan-out disguised as one cheap operation.
- Resolve context: explicit registry/task hints already exist; automatic local
  manifest inference and backend ranking changes are not part of this CLI plan.
- Skill shortening/routing: explicitly excluded by the user; OP owns that review.

## Completion, delivery and cleanup

Every implementation increment gets one scoped review workflow and a draft PR;
routine commit/push/CI need no further permission. Merge/release/publish/deploy
require their own explicit user approval. Keep releases per artifact; do not bump
MCP solely because a CLI-only helper is physically in the shared package.

After each merged increment, reorient against `origin/main`, update assumptions
and detail only the next one or two phases. Do not claim later phases ready while
their contracts are open. Move durable contracts to implementation docs with the
code, put execution evidence on the implementing PR, and retain major deferred
work in this plan/backlog. Delete this plan in the last increment's final push
after clean review, transferring unresolved accepted items to `docs/plans/open-backlog.md`.
Remove child worktrees/terminals only when their work is merged/discarded and
there is no uncommitted or unpushed work. Retain unmerged backend work and
children with uncommitted or unpushed changes.
