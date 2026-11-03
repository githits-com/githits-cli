# Plan: CLI ergonomics

## Status and expected outcome

- Overall: **IN PROGRESS**; Phase 1 is complete pending merge; Phase 2 needs reorientation.
- Owner: this CLI worktree; backend investigations have separate child worktrees.
- User direction, 2026-11-03: improve CLI ergonomics from the supplied feedback;
  exclude all skill changes because OP is reviewing those separately. Dispatch
  backend agents for escaped-pipe regex handling and unified grep enclosing blocks.
- The user invoked `$orchestrate` to implement ready Phase 1. Later phases
  retain their contract and evidence gates; all skill changes remain excluded.

When complete, common valid CLI near-misses work without another call, failures
provide a relevant next command when the request supplies enough information,
and callers can bound large text responses without discarding trust facts or
losing access to omitted evidence. Unified grep can expose enclosing source
blocks only after its owning backend establishes that contract. Regex intent is
never silently changed.

## Verified planning baseline

Evidence was collected against CLI `0.37.0`, branch
`jlitola/analyze-ergonomics-feedback`, initial HEAD
`c7a9e0f7df371ca4d034cd792a8af129f21cc440`.

| Observation | Verified implementation and implication |
| --- | --- |
| `--lines 42` fails; `42-42` works | `packages/mcp/src/shared/parse-lines-option.ts` explicitly rejects single integers. Top-level `read`, legacy `code read`, and `docs read` use it. Its suggested `--start 42` does not express an exact one-line selection. |
| Top-level grep rejects context above 10 | `src/commands/grep.ts` and `shared/grep-request.ts` validate every supplied value before selecting the last one. Legacy `shared/grep-repo-request.ts` already clamps nonnegative safe integers to 10 and returns clamping metadata. |
| A bare path is another grep operand | Commander registers `<pattern> <targets...>`. A direct request probe forwarded `lib/router.js` as a target alongside `npm:express`. Multi-target order and duplicates are meaningful. |
| Regex bytes pass through | `buildGrepParams` preserves `foo\|bar`; matching belongs to the backend. RE2 syntax uses `|` for alternation; an escaped pipe can be intentional. This is a guidance opportunity, not proof of a matcher defect. |
| Research rate-limit distinctions exist | `core-internal/services/agentic-ask-service.ts` distinguishes request and daily limits and captures `Retry-After`. `shared/agentic-ask-error-map.ts` preserves these facts. Daily exhaustion is nonretryable; the current message names search/grep/list/read without a scoped command. |
| Output controls are partial | Grep `--limit` caps page matches, not bytes/lines. MCP read presentation caps spans at 150/300 lines with continuation; CLI reads retain complete selections. `shared/grep-text.ts` retains sources, omissions, coverage and cursor/read actions. |
| Enclosing symbols differ by route | Legacy `code grep --symbol-field` supports enclosing-symbol metadata. The CLI unified grep query/types contain line slices, bounded context and a one-line `readTarget`, with no symbol/block fields. Backend schema support remains to be checked; metadata alone is not a full block. |
| Existing plans overlap narrowly | `search-output-ux.md` owns general formatter hierarchy, not optional budgets. `open-backlog.md` owns literal-path round trips and future typed validation-error recovery. Do not duplicate those efforts or change literal-path grammar in this plan. |

Source feedback: the user-supplied `feedback-summary-2026-11-03.docx`.
Its aggregate error/token/time figures are directional reports, not reproduced
measurements. Raw traces, exact tested CLI versions and regex inputs are absent.
The user corrected the initial `\[` reference to `\|`.

## Scope and boundaries

Included: context tolerance, exact single-line reads, path-operand guidance,
Research recovery, optional bounded text output, and later adoption of verified
backend regex/enclosing-block capabilities. Existing command help and permanent
implementation docs may change; skills, shared MCP instructions and plugin assets
must not change as a side effect.

Excluded: skill editing/routing rewrites; automatic Research retries/backoff;
async Research infrastructure; quota accounting/doctor network probes; package
freshness timestamps; inferred manifest/registry selection; multi-file or
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

## Assumptions, unknowns and constraints

Assumptions: existing service operations suffice for Phases 1–2; context's backend
ceiling stays 10; accepting `--lines N` means exactly line N; existing successful
multi-target, range, case, path-selector and pagination behavior must remain.
These are supported by the code/probes above, not assumptions about live latency.

Unknowns/product decisions: **none for Phase 1**. Before Phase 2 is made ready,
verify live/mocked rejection shapes identify an offending extra grep operand;
otherwise limit that part to help examples and defer typed diagnostics to the
existing validation-recovery backlog. Phase 3 must settle budget units, supported
commands and exact replay of omitted evidence from captured output. Phase 4 must
settle the backend contracts and feature semantics with the user. Later unknowns
are not gates for the independent Phase 1 fixes.

No migrations, dependencies, caches, queues, retry layers, feature flags or
background processes. Defaults remain stable except acceptance of the documented
near-misses. No total-token, latency or backend-cost reduction is promised by
formatting alone. Obtain approval before introducing infrastructure.

## Ordered phase map

| Phase | Status | Observable outcome | Dependencies |
| --- | --- | --- | --- |
| 1 — tolerate common arguments | COMPLETE; pending merge | `--lines N` selects one line; excessive valid context becomes 10 with a visible notice; path flags are clear in help. | Existing read/grep paths only. |
| 2 — actionable failure recovery | PLANNED | Daily Research exhaustion offers one usable scoped discovery command where possible; verified path-operand failures explain the correct flags. | Phase 1; inspect exact failure/operand contracts before final detail. |
| 3 — bounded readable output | NEEDS DESIGN at phase boundary | Opt-in text budgets preserve trust facts and provide honest access to omitted evidence. | Phase 2; representative output and replay evidence. |
| 4 — backend-assisted grep context | WAITING ON BACKEND PLANS | Unified grep can provide requested enclosing blocks with authoritative ranges; regex diagnostics clarify intent without rewriting patterns. | Backend evidence, user-settled contracts and backend availability. |

### Phase 1 — tolerate common arguments

Status: **COMPLETE; pending merge**. Outcome: exact single-line selections and
excessive valid grep context are accepted across the planned CLI paths.

Assumptions verified: existing read and grep operations support the normalized
controls; the backend context ceiling remains 10. Unknowns/product decisions:
**none for this increment**. Dependencies: no backend or skill changes.

Completed contracts:

- `--lines N` sends N as both bounds in top-level source/docs/symbol reads and
  legacy `code read`/`docs read`. Existing closed/open range forms and conflict
  checks remain. All written CLI bounds, including explicit flags and numeric
  suffixes, are positive integers at most 2,147,483,647. Empty and malformed
  explicit values fail before a service call. Numeric errors retain the original
  argument text, including oversized values.
- Every supplied CLI grep context value is validated as a nonnegative safe
  integer before repeated-flag and explicit-side precedence. Effective sides
  are then capped at 10 using the policy shared with legacy grep. Overridden
  excessive values produce no notice when neither effective side is reduced.
- Text reports one reduction notice on stderr with the larger-read action.
  Successful capped CLI JSON adds `contextClamping` with requested/effective
  sides; ordinary JSON parity is unchanged. JSON failures remain one stderr
  error envelope. MCP context schemas remain strict and unchanged.
- Grep help explains that positional operands are targets and gives exact-file
  `--path` and directory `--path-prefix` examples. It does not infer caller intent
  or change multi-target semantics.
- Disposable scoped smoke homes default to file storage and preserve explicit
  overrides, including differently cased environment keys. They do not copy host
  file credentials or depend on the host's default Keychain configuration.

Acceptance is covered by the parser/context helper suites, reader/grep command
tests, existing CLI/MCP parity tests, smoke assertions, and bounded dev read/grep
checks. Execution commands, outputs and review records belong on the implementing
PR. The accepted Phase 1 scope requires no agent eval because MCP behavior,
descriptors and instructions did not change.

Durable contracts live in `docs/implementation/cli-commands.md`,
`unified-read.md`, `unified-grep.md`, and the Testing guide. Release fragments
record a CLI patch and a separate repository-only smoke correction. Phase 2 must
reorient after merge before its tactical detail or readiness changes.


### Phase 2 — actionable failure recovery

Status: **PLANNED**, reorient after Phase 1 merges before marking ready.
Outcome: users can recover from a known failed operation without guessing a
sequence of discovery commands.

Assumptions: requests may contain an explicit public target and question;
thread-only/question-only requests do not necessarily identify a local target.
Unknowns: exact typed grep rejection attribution; resolve from captured producer
responses and service tests at this phase boundary. Dependencies: Phase 1 and
existing Research scope/Retry-After mappings; no new backend endpoint.

Next-detail outline:

1. For daily-limit Research errors with an explicit target accepted by the
   existing search-target parser, append one opt-in
   discovery action equivalent to `githits search --in TARGET -- QUESTION`,
   quoting original arguments exactly. It is a discovery pivot, not an equivalent
   Research answer or a guaranteed successful query. Keep the original error,
   daily reset advice and diagnostic IDs. Do not execute the suggestion.
2. Without an explicit canonical search target (including a supplied bare name),
   retain honest generic recovery; do not parse a natural-language question/thread
   ID to invent scope or add a resolution call. Validate eligibility with existing
   target grammar without replacing the original target bytes.
   Request-rate limits keep existing retry timing, without automatic retries.
3. For an explicitly attributed invalid extra grep target that could be a file
   or directory, add a conditional `--path`/`--path-prefix` correction. Preserve
   original operands and failure status; never scrape backend prose or reject
   valid multi-target input. If attribution is unavailable, ship help-only
   guidance and retain the typed-diagnostics dependency in the existing backlog.
4. Keep actions in root CLI request-aware helpers and existing mapped-error
   presentation. Test shell metacharacters, leading dashes, Unicode, control
   characters, targetless/thread requests, daily versus request limits, and one
   service call on each failure. Human text and any structured action must be
   consistent; preserve the existing error envelope classification.

Acceptance: a canonical-target daily limit yields a copyable scoped search command;
targetless cases invent no scope; no path hint changes multi-target semantics;
no failed request is retried automatically; existing errors, reset facts and IDs
remain available. Update implementation docs, add a CLI release fragment and run
affected unit/smoke checks. Add targeted agent evals if agent-facing error actions
change; raw trace and neutral-answer inspection is required, not just harness exit.

### Phase 3 — bounded readable output

Status: **NEEDS DESIGN**. Outcome: callers avoid external `head` while keeping
trust/coverage facts, read locators and an explicit route to omitted evidence.
Dependencies: Phase 2 and reorientation against current formatter ownership.
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

### Phase 4 — backend-assisted grep context

Status: **WAITING ON BACKEND PLANS**. Outcome: an explicit request can return
the enclosing source block in unified grep, and regex diagnostics explain
escaped-pipe intent without changing matching semantics.
Assumptions: source bodies/ranges must come from the served snapshot and
backend-authored locators; default grep remains lean. Unknowns: existing backend
support, block budgets/deduplication, unsupported languages/site behavior,
conditional fetching, typed regex advice and producer version requirements.
Dependencies: the handoffs below, user-settled semantics and available producer
contract. This phase does not block Phases 1–3.

Acceptance: actual block content (not just metadata) is available with accurate
range/omission disclosure and no hidden per-hit CLI read calls; default requests
fetch no unused block fields; literal pipes/character classes/-F remain correct;
backend partial/cursor/source identity facts survive projection. Add exact wire
selection tests, CLI/MCP parity/smokes, narrow release-build comparisons if added
backend work needs validation, and targeted agent evals before reporting a call
reduction. Revise/review the phase once backend plans establish tactical detail.

## Backend dependencies

Two independent backend investigations own `\|` matching/validation/diagnostics
and unified grep enclosing symbols versus actual blocks. Phase 4 waits on their
reviewed contracts. They do not block independent CLI fixes. Runtime handoff
paths, agent handles and execution results belong in the PR handoff record.

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
there is no uncommitted or unpushed work; they are still active handoffs now.
