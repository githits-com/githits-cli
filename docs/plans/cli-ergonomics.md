# Plan: CLI ergonomics

## Status and expected outcome

- Overall: **IN PROGRESS**; Phase 1 merged in [#530](https://github.com/githits-com/githits-cli/pull/530);
  Phase 1a merged in [#533](https://github.com/githits-com/githits-cli/pull/533);
  Phase 2 is complete pending merge; Phase 3 needs design.
- Owner: this CLI worktree; backend investigations have separate child worktrees.
- User direction, 2026-11-03: improve CLI ergonomics from the supplied feedback;
  exclude all skill changes because OP is reviewing those separately. Dispatch
  backend agents for escaped-pipe regex handling and unified grep enclosing blocks.
- The user invoked `$orchestrate` to implement ready Phase 1. Later phases
  retain their contract and evidence gates; all skill changes remain excluded.
- User direction after #530 merged: plan compact CLI regex guidance. Matching
  is correct; explain alternation versus literal pipes in help, not runtime hints.

When complete, common valid CLI near-misses work without another call, failures
provide a relevant next command when the request supplies enough information,
and callers can bound large text responses without discarding trust facts or
losing access to omitted evidence. Unified grep can expose legacy-equivalent
enclosing-symbol metadata after its backend establishes that contract; actual
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
compact CLI regex help, Research recovery, optional bounded text output, and
later adoption of verified backend enclosing-symbol capabilities. Existing
command help and permanent implementation docs may change; skills, shared MCP
instructions and plugin assets must not change as a side effect.

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
4. Extend each affected shared formatter with explicit presentation inputs when
   adding text budgets; do not wrap finished stdout in a generic `head` filter.
   Preserve machine JSON and make omission distinct from backend incompleteness.
5. Backend-dependent controls follow a verified, versioned producer contract.
   Never hydrate blocks through hidden per-hit read requests or synthesize bounds
   from regex/indentation in the CLI.
6. CLI owns command-specific syntax guidance and mode names. Completed Phase 1a
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
Phase 3 still needs budget units, supported commands and exact replay semantics.
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
| 2 — scoped Research recovery | COMPLETE; pending merge | Daily Research exhaustion shows a scoped search example with a fixed query placeholder when an explicit search-compatible target exists. | Merged #533, existing typed rate-limit scope and local parser/quoting. Grep validation adoption remains separately gated. |
| 3 — bounded readable output | NEEDS DESIGN at phase boundary | Opt-in text budgets preserve trust facts and provide honest access to omitted evidence. | Phase 2; representative output and replay evidence. |
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

Status: **COMPLETE; pending merge**. Outcome: an agent hitting the daily
Research limit gets a scoped search example with the fixed `your query`
placeholder. Assumptions: existing daily scope and search grammar remain stable.
Unknowns/product decisions: **none**. Dependencies: merged #533 and existing
pure parser/quoting/error contracts; no backend change or release.

User correction on open PR #535: a conversational Research question is not a
useful BM25 query. Show a fixed `your query` placeholder, labelled as an example,
without keyword extraction or copying the original question. The caller fills
in search terms; the CLI makes no automatic follow-up call.

Ownership: root `src/commands/research.ts` naturally owns this policy because it
has the resolved explicit subject. One exported pure helper there is covered
by the existing command tests; a separate module has no
second consumer. Keep the shared transport mapper and generic formatter stable.
No context needs threading into MCP or services, and no new runtime facility.

Implementation contract:

1. Generate an example only for mapped `RATE_LIMITED` with
   `details.rateLimitScope === "daily"`, an explicit subject target, and a target
   accepted by `parseUnifiedSearchTargetSpec()`. Do not infer a target from the
   question, thread, cwd or manifest. Invalid/bare targets keep generic guidance;
   failed eligibility must never replace the original Research error.
2. Build exactly one template from the original target:
   `githits search --in 'npm:express' -- 'your query'`. Use `shellQuoteExact()`
   for the target, preserving its original bytes. The query is always the fixed
   placeholder, independent of the original question. Document the existing
   CLI argv input domain; add no unreachable NUL guard or synthetic NUL test.
3. In `researchAction()`'s existing failure branch, derive the example once.
   Human output adds one `Example: COMMAND` line alongside the unchanged diagnostic
   and identifiers; JSON adds that same template as `details.example` in its
   existing single stderr envelope. Keep stdout empty on failure, exit status 1,
   and preserve message/reset advice, retryable flag, status, retry timing,
   mapped details, `tool_call_id` and `thread_id`. Do not expand shared formatter
   behavior merely to print this one request-aware example.
4. Targetless and thread calls, malformed/bare explicit targets, request-rate
   limits, absent/unknown rate scopes and other errors retain current behavior.
   No automatic search, retry, target resolution, fallback, extra network call
   or new CLI flag. Preserve spinner/progress completion and cancellation paths.
5. Update `docs/implementation/research.md` and the Research section of
   `cli-commands.md` with the conditional CLI example and fixed query placeholder.
   Do not imply MCP also emits it or edit public skills/instructions. Add
   `changes/research-daily-limit-recovery.fixed.md` with `githits: patch` and
   `@githits/mcp: none` during implementation.

Acceptance and targeted validation:

- Extend `src/commands/research.test.ts` using its existing interface mocks;
  no new fixture files. Prove human/JSON example identity for one canonical
  target with preserved IDs/details and exactly one failed Ask call. Cover
  package/repository/site eligibility, unscoped/thread/bare/invalid targets,
  daily/request/unknown scopes, and no example for other errors. Verify that the
  original question is still sent to Ask but is absent from the example.
- One quote/Unicode target case and one accepted control-whitespace target case
  prove exact target quoting. The fixed query remains unchanged in both. Reuse existing
  shell-quote and target-parser coverage instead of a new shell parser/harness.
  Explicitly assert the suggestion is not executed and stdout stays empty.
- Run `bun test src/commands/research.test.ts src/commands/format-mapped-error.test.ts
  packages/mcp/src/shared/agentic-ask-error-map.test.ts
  packages/mcp/src/shared/shell-quote.test.ts
  packages/mcp/src/shared/unified-search-target.test.ts`, typecheck, targeted
  lint/format, build, and the four source/built CLI/MCP smoke modes. Keep smoke
  auth handling isolated with the dev preset; never exhaust a real allowance
  to exercise this branch. Mocked command tests gate daily-limit behavior;
  normal live-smoke skips do not prove that branch.
- Run one targeted qualitative CLI agent check using the existing harness:
  `bun run agent:e2e --agent codex --surface skills --server local --workload
  eval/agentic/workloads/express-router.md`, with the dev preset and established
  isolated eval credentials when available. Inspect raw tool calls, final answer,
  metrics and isolation violations. The existing workload may not encounter a
  daily limit: report whether it did, and do not claim it validates the new
  example if it did not. Report unavailable prerequisites honestly; no quota
  manipulation, new eval infrastructure or agent-quality/call-reduction claim.
- Keep added instruction text to the single command line. Original backend copy
  stays intact; no model-token or latency improvement is promised. No changes
  to backend API fields, persistence, migrations or successful command output. Rollback
  is reverting the CLI example/docs; no operational rollout is needed.

The scoped internal/external plan review is clean. During implementation, use
the normal scoped review and draft-PR workflow. Retain the
plan while later phases remain; after merge replace this detail with completion
links and keep the durable contract in implementation docs.

### Phase 3 — bounded readable output

Status: **NEEDS DESIGN**. Outcome: callers avoid external `head` while keeping
trust/coverage facts, read locators and an explicit route to omitted evidence.
Ordering: follows Phase 2. Design dependencies are reorientation against current
formatter ownership and representative captured output.
Assumption: opt-in presentation controls can improve ergonomics without changing
default output or machine JSON. Unknowns: first command, line/character units,
budget scope, large-line handling and replay semantics. Resolve from one grep
page and one source/docs read with existing fixtures plus real served output;
do not create a cross-tool truncation framework or add two competing knobs by
default. Coordinate with `search-output-ux.md` rather than duplicating its work.

Acceptance: a reviewed first-command design distinguishes locally omitted output
from backend partial coverage; preserves provenance/warnings/actions outside the
evidence budget; never slices ANSI/Unicode/source lines into misleading evidence;
leaves JSON complete; and provides an exact retry/read path for omitted content.
Before claiming an efficiency improvement, name and compare the same cases:
one existing mixed-source 100-hit grep page and one selected large-file read,
with identical inputs and recorded HTTP calls/selected fields plus output bytes
and lines before/after. Presentation-only savings must not be described as less
backend work. Runtime performance claims additionally require a narrow release
build benchmark and same-case baseline/candidate comparison. Detail only after
the preceding increment and captured output settle the contract.

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
