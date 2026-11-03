# Plan: CLI ergonomics

## Status and expected outcome

- Overall: **IN PROGRESS**; Phase 1 merged in [#530](https://github.com/githits-com/githits-cli/pull/530);
  Phase 1a is complete pending merge; Phase 2 needs reorientation.
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

The original feedback baseline below predates #530; its line/context failures
are now fixed. Evidence was collected against CLI `0.37.0`, branch
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

Phase 1a planning baseline: refreshed `origin/main` at
`202dd2328990d0f435cdc33da3d7a6e8432eba6f`, the merge of #530.
The reviewed backend [regex investigation](https://github.com/githits-com/pkgseer-backend/blob/0ab7fcad13bfc6b3c932cfc15ff5d4848a923f08/docs/analysis/2026-11-03-grep-regex-ergonomics.md)
reproduced `foo|bar` as alternation and `foo\|bar` as a literal pipe in
REGEX-mode native GREP/MULTI_GREP; it also checked LITERAL-mode and
escaped/class variants.
It found no matcher defect. Content-index searches require usable literal text;
a single exact-file route accepts anchorless regexes subject to syntax/compile
limits. This is route policy, not a malformed-regex rule.

CLI evidence at that baseline: `src/commands/grep.ts` defaults to REGEX and `-F` selects
LITERAL; legacy `src/commands/code/grep.ts` defaults to LITERAL and `--regex`
selects REGEX. Both forward pattern bytes unchanged. Neither help explains the
pipe distinction. Unified help incorrectly says all anchorless expressions
fail; the legacy CLI-derived note qualifies literal-text requirements only by
selector presence, rather than the actual content-index/exact-file route.
Its existing `GREP_REPO_PATTERN_NOTE` has only a CLI consumer via the
workspace-only `@githits/mcp/internal` transition export; no MCP tool or public
entrypoint uses it. Its private package path does not make this a public MCP change.
The legacy CLI reference's ASCII-only folding sentence contradicts current
Unicode-aware help and its existing test; correct that adjacent documentation.

## Scope and boundaries

Included: context tolerance, exact single-line reads, path-operand guidance,
compact CLI regex help, Research recovery, optional bounded text output, and
later adoption of verified backend enclosing-symbol capabilities. Existing
command help and permanent implementation docs may change; skills, shared MCP
instructions and plugin assets must not change as a side effect.

Phase 1a additionally excludes MCP descriptors/instructions and public API
changes. Its CLI-only internal pattern note may change. Later producer adoption
retains its separate MCP gates.

Excluded: skill editing/routing rewrites; regex rewriting, intent detection,
empty-result reminders or automatic literal retries; automatic Research
retries/backoff; async Research infrastructure; quota accounting/doctor network probes; package
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
6. CLI owns command-specific syntax guidance and mode names. Update modern
   registration text and the existing CLI-only internal legacy note in place;
   preserve required argument-name translations without adding a whole-sentence
   replacement layer. No new formatter, helper, parser or service is needed.
   Refactoring opportunity: move legacy CLI-only helpers out of the private MCP
   transition tree with the CLI package move; relocation is unnecessary for copy.

## Assumptions, unknowns and constraints

Assumptions: existing service operations suffice for Phases 1–2; context's backend
ceiling stays 10; accepting `--lines N` means exactly line N; existing successful
multi-target, range, case, path-selector and pagination behavior must remain.
These are supported by the code/probes above, not assumptions about live latency.

Unknowns/product decisions: **none for Phase 1a**; help-only is the selected
CLI outcome. Its dependency is merged #530 and the verified backend behavior,
not a backend fix or release. Before Phase 2 is made ready,
verify live/mocked rejection shapes identify an offending extra grep operand;
otherwise limit that part to help examples and defer typed diagnostics to the
existing validation-recovery backlog. Phase 3 must settle budget units, supported
commands and exact replay of omitted evidence from captured output. Phase 4 must
settle the backend contracts and feature semantics with the user. Later unknowns
are not gates for independent CLI work, including Phase 1a.

No migrations, dependencies, caches, queues, retry layers, feature flags or
background processes. Defaults remain stable except acceptance of the documented
near-misses. No total-token, latency or backend-cost reduction is promised by
formatting alone. Obtain approval before introducing infrastructure.

## Ordered phase map

| Phase | Status | Observable outcome | Dependencies |
| --- | --- | --- | --- |
| 1 — tolerate common arguments | COMPLETE; merged #530 | `--lines N` selects one line; excessive valid context becomes 10 with a visible notice; path flags are clear in help. | Existing read/grep paths only. |
| 1a — compact regex guidance | COMPLETE; pending merge | Both CLI grep helps distinguish alternation/literal pipes and qualify route-dependent literal-text requirements. | Merged #530 and verified regex investigation; no backend change. |
| 2 — actionable failure recovery | PLANNED | Daily Research exhaustion offers one usable scoped discovery command where possible; verified path-operand failures explain the correct flags. | Phase 1; inspect exact failure/operand contracts before final detail. |
| 3 — bounded readable output | NEEDS DESIGN at phase boundary | Opt-in text budgets preserve trust facts and provide honest access to omitted evidence. | Phase 2; representative output and replay evidence. |
| 4 — backend-assisted enclosing symbols | WAITING ON NATIVE CONTRACT | Unified grep can opt into legacy-equivalent enclosing-symbol metadata and exact source-read ranges; source bodies remain conditional on cost. | Native implementation/release, PkgSeer adoption and verified wire contract. |

### Phase 1 — tolerate common arguments

Status: **COMPLETE; merged #530**. Exact single-line reads, validated/capped
context, compact selectors/help and isolated smoke storage are implemented.
Durable contracts live in `docs/implementation/cli-commands.md`,
`unified-read.md`, `unified-grep.md` and `docs/guidelines/TESTING.md`.
Verification and review records are on #530. No remaining Phase 1 gate.

### Phase 1a — compact CLI regex guidance

Status: **COMPLETE; pending merge**. Outcome: a coding agent reading either
CLI grep help can choose alternation or a literal pipe without guessing the
matching mode or receiving a misleading blanket anchorless-regex refusal.
Assumptions: #530's defaults and passthrough remain authoritative; the reviewed
backend route distinction applies. Unknowns/product decisions: **none**.
Dependencies: #530 merged and regex investigation above; no producer release.

As a coding agent, I want one compact syntax explanation at the CLI help surface
so that I can express alternation or a literal pipe correctly on the first call.

Implementation scope and order:

1. Edit CLI help copy in `src/commands/grep.ts`, `src/commands/code/grep.ts`
   and its existing internal note in
   `packages/mcp/src/shared/grep-repo-request.ts`. Explain once per help page,
   in REGEX context:
   `foo|bar` matches alternatives; `foo\|bar` matches a literal pipe. Keep default
   modes explicit (unified REGEX/`-F`, legacy LITERAL/`--regex`). Any shell examples
   quote the entire pattern so the shell preserves the pipe and backslash.
2. Replace the overly broad anchor prose with the verified route distinction:
   content-index regex needs usable literal text; a single exact-file route can
   accept anchorless regex. Do not promise that any `--path`, prefix/glob, package
   expansion or mixed-target request guarantees the exact-file execution route.
   Edit `GREP_REPO_PATTERN_NOTE` directly and remove the obsolete whole-target
   anchoring replacement from `CLI_GREP_PATTERN_NOTE`; keep the remaining CLI
   argument-name translations. Do not add a whole-sentence replacement or change
   MCP tool descriptions/public exports.
3. Update the matching/CLI sections of `docs/implementation/unified-grep.md` and
   `docs/implementation/cli-commands.md`, including the adjacent stale legacy
   ASCII-only folding sentence. Add `changes/cli-regex-guidance.changed.md` with
   `githits: patch` and `@githits/mcp: none` during implementation.
4. Extend existing help assertions in `src/commands/grep.test.ts` and
   `src/commands/code/grep.test.ts` for the syntax contrast, route qualification
   and unchanged mode controls; update the existing note assertions in
   `packages/mcp/src/shared/grep-repo-request.test.ts`. Extend existing checks in
   `scripts/cli-smoke.ts` so source/Bun and built/Node both preserve the escaped
   pipe. These are structural copy checks, not a new matching test suite;
   reuse existing request/mode tests and add no fixture files or native probes.

Acceptance and validation:

- Each help exposes one compact pipe contrast, preserves default/opt-in modes,
  and accurately limits the literal-text restriction to content-index routes.
  Existing context, target/path and global-limit guidance remains available.
- No action/formatter/service/schema/request changes: pattern bytes, errors,
  empty/partial/cursor responses and text/JSON output stay identical. No runtime
  warning, query rewrite, extra call, credential access or authentication probe.
- Compare the same two `helpInformation()` cases at width 80, before/after:
  `githits grep` baseline **2,191 UTF-8 bytes**, `githits code grep` **5,244**.
  Keep each at or below its baseline: redundant prose anywhere in these two
  help pages may be tightened, while context/target/path/global-limit facts and
  distinct mode/route guidance remain. Avoid appending explanatory paragraphs.
  Report rendered bytes, not model-token, latency, backend-cost or graded
  agent-quality savings. Inspect both rendered helps.
- Run `bun test src/commands/grep.test.ts src/commands/code/grep.test.ts
  packages/mcp/src/shared/grep-request.test.ts
  packages/mcp/src/shared/grep-repo-request.test.ts`, typecheck, lint/format,
  `bun run build`, `bun run smoke:cli`, `bun run smoke:mcp`,
  `bun run smoke:cli:built` and `bun run smoke:mcp:built`. Use disposable auth
  homes and the dev preset with unintended endpoint/token overrides removed;
  report authenticated-cohort skips honestly. No new agent eval is required:
  MCP descriptors/instructions and runtime tool behavior are unchanged.
- Internal preparation and one external reviewer per round precede a draft PR.
  No migrations or operational rollout; rollback is reverting CLI copy/docs.
  Keep this governing plan while later phases remain; replace this section
  with completion links when merged. Permanent docs retain the syntax contract.

### Phase 2 — actionable failure recovery

Status: **PLANNED**, reorient after Phase 1a merges before marking ready.
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
