# Search and grep headers and footers

## Status and destination

- Overall: **READY FOR IMPLEMENTATION**.
- Phase 1: **READY** — one implementation increment makes search/status and
  grep headers and footers consistent on CLI and local/published MCP package text.
- Product decisions: **none open**. This document selects a concrete presentation
  for the user-requested follow-up. The user can revise the examples before coding.
- Dependencies: merged PR #454 (`c71ffb5`), current main `bc295b3`, existing source/preparation facts,
  existing read actions, search offset and grep cursor contracts.

Readers should immediately see what this page returned, what is preparing, and
how to read, continue or obtain updated results. Search and grep retain their different evidence
counts and continuation semantics within one visible anatomy. This is one
bounded PR with product changes, not a planning-only PR. No production edits
are authorized by this planning turn.

## Verified baseline

Authenticated dev captures on 2026-10-06 exercised all four commands with CLI
`npm:express@2.3.10` and local MCP `npm:express@2.3.11`. Both were registry-confirmed
and unindexed during the calls. The durable record is
[search-snapshot-presentation.md](../implementation/search-snapshot-presentation.md#shared-sourcepreparation-boundary-2026-10-06).
Final full text and metadata are preserved locally in
`/tmp/shared-source-final-outputs.md` and `/tmp/shared-source-final-metadata.md`;
these files are supplemental evidence, not implementation dependencies.

Search returned a usable documentation result but started with:

```text
1 partial result | 1 docs page | indexing | 0/1 ready | next_offset=1
```

Grep returned usable documentation while the same repository was preparing:

```text
1 match in 1 line across 1 page; more available
```

Both already display Sources and Preparing. Search includes requested aliases
on its hosted-doc source when needed; grep scopes and source attribution have
separate semantics. Those facts must survive; equal-looking strings are not
proof of equal facts.

Main was refreshed during planning to `bc295b3` (release0.27.0 and an
example-source tool). The diff from `c71ffb5` changes none of the inspected
search/grep formatters, projection/response, status API or smoke validators.
These selected contracts therefore remain current; implementation starts from
then-current main rather than requiring this planning branch as a code base.

Code inspection on the merged baseline established:

- `unified-search-text.ts` owns the outcome and action rendering; the status
  renderer delegates to it. `UnifiedSearchTextResult.nextOffset` is already
  available for both initial and retained-status pages.
- `progress.targetsReady/targetsTotal` is target readiness, not a count of usable
  hits or ready documentation contributors. Remove this ambiguous text shorthand;
  JSON retains the counts and per-scope context retains readiness facts.
- Search currently puts an offset only in the headline; it has no dedicated
  pagination footer. Its lifecycle action union describes polling/retry, not
  pagination. A healthy completed result has action `none`, so it also omits the
  existing first-hit read example.
- `search` accepts `--offset` / `offset`; `search-status` / `search_status` does
  not accept an offset. Status query echo omits original compile/filter options.
  Never reconstruct a complete filtered search from a status result or hit label.
- Grep's `totalMatches` is occurrences on this page. The formatter derives unique
  matching lines and files/pages. `nextCursor` is a complete backend operand;
  existing validation rejects resumable traversal without a cursor.
- Grep `hasCoverageGap` treats any traversal other than COMPLETE as a gap.
  `RESUMABLE_LIMIT` is normal pagination, so this predicate alone cannot drive a
  new incomplete-coverage headline. Keep exhaustive/no-match decisions intact.
- Search availability distinguishes backend partial results from active interim
  snapshots. Completed partial responses also exist; completion must not erase
  that fact. Terminal and unknown lifecycle states remain independently visible.
- Footer read operands come from `readTarget` or grep's existing native templates.
  `indexing-wait.ts` and `discovery-indexing-wait.ts` retain native wait policy.
- Search's bounded alternative suffix is ` +N`; read recovery already uses
  `(+N more)`. Category names such as versions versus versions/refs reflect
  different facts and must not be normalized into false equivalence.

No performance claim or changed computation path is proposed. A benchmark is
not needed for choosing these text layouts; no optimization is part of scope.

## Selected output design

### Header

Use the same ASCII ` | ` separator for outcome, tool-specific counts and short
qualifiers. Keep the headline free of request parameter names and readiness
fractions. Preserve pluralization and each tool's definition of its counts.

```text
1 result | 1 docs page | partial | more available
1 match in 1 line across 1 page | more available
3 results | 2 repo code hits, 1 docs page
4 matches in 3 lines across 2 files | coverage incomplete
```

Search `partial` follows backend partialResults for active and completed pages.
An active, non-partial snapshot with hits uses `interim` instead. `more available`
follows hasMore / nextCursor and never implies exhaustive coverage.
For grep, classify gaps from the existing facts before choosing a headline:

- Actual coverage gaps: a scope has readiness other than CURRENT, excluding
  UNSPECIFIED paired with RESUMABLE_LIMIT (documented unvisited pagination);
  traversal other than COMPLETE/RESUMABLE_LIMIT, an error or recorded scan omissions/issues,
  or overall traversal is NON_RESUMABLE_PARTIAL, FAILED or CURSOR_EXPIRED.
- Retryable omissions only: at least one unavailableTarget, every omission is
  retryable, and no actual coverage gap above. This includes preparing work and
  existing retryable non-preparing reasons. Use the pagination exception in the
  formatter-local omissions-only classification.
- Non-retryable omissions: any unavailableTarget with retryable=false.

Hit-bearing pages use `partial` for retryable omissions only, and
`coverage incomplete` for any actual coverage gap or non-retryable omission
(the stronger qualification wins, so never print both). Append `more available`
independently for a supplied nextCursor. Both CURRENT+RESUMABLE_LIMIT and
UNSPECIFIED+RESUMABLE_LIMIT with no error/scan issues are ordinary pagination
and add neither partial nor incomplete-coverage copy. Apply this exemption
consistently to headline, omissions-only and zero-page decisions. Preserve the
unvisited source row and its existing no-results-on-this-page qualifier; do not
pretend that unvisited content was searched.
Keep the existing exhaustive predicate for claiming a full no-match search.
Do not change service validation or source-evidence projection.

Search prints lifecycle separately immediately below its headline when active,
terminal or unknown; completed search needs no lifecycle line:

```text
1 result | 1 docs page | partial | more available
Search: indexing
```

This preserves INDEXING/SEARCHING/PENDING/deferred/timeout/failed/unknown distinctions
without presenting target counts as result readiness. Grep has no persistent
search session and does not invent this line. Existing grep cursor-expiry and
scope coverage explanations remain before matches.

Zero/no-snapshot outcomes keep their precise meanings:

- Completed search with no hits: `No results`; when hasMore is true:
  `No results on this page | more available`. Add `partial` before the pagination
  clause when the actual snapshot has partialResults=true.
- Active search with an empty snapshot: `No results yet`; absent snapshot:
  `No result snapshot yet`, each followed by its Search lifecycle line. Empty
  snapshots append `| partial` when true; absent snapshots cannot claim partial.
- Terminal/unknown search keeps `No results` versus `No result snapshot`, followed
  by its explicit lifecycle line and existing recovery disposition. Retained
  empty snapshots keep the same partial qualifier when supplied.

Grep's zero-hit headlines use these exact cases (pagination is independent):

| Returned page | Outcome |
| --- | --- |
| Exhaustive, no omissions, no cursor | `No matches.` |
| Only retryable omissions, no cursor | `No matches yet.` |
| No other coverage gap or omission, valid cursor | `No matches on this page | more available` |
| Only retryable omissions, valid cursor | `No matches yet on this page | more available` |
| Scope/scan/traversal failure or any non-retryable omission, no cursor | `Zero returned matches; coverage is incomplete.` |
| Same incomplete case, valid cursor | `Zero returned matches | coverage incomplete | more available` |

Retryable omissions include preparing repository/docs work as well as existing
retryable non-preparing reasons. Preparing is not called a failure. Sources,
Preparing and Omitted rows retain the exact reason and target attribution.
The captured hit-bearing Express docs/pending-code example therefore becomes
`1 match in 1 line across 1 page | partial | more available`;
its zero-hit equivalent follows the fourth row, without losing either "yet" or
the available continuation. No supplied cursor is silently hidden.

### Body and source sections

Order stays outcome/lifecycle, Sources, Preparing, scope warnings/recovery,
then tool-native hits/matches. Do not move actionable per-target remediation
into an unattributed global footer. Preserve source ordering, requested aliases,
zero-hit source disclosure, actual job identity, dates and all coverage facts.

### Footer

Use three optional sections, in this fixed order, separated by one blank line:

1. **Read:** existing concrete example or file/page templates.
2. **More results:** repeat the original request with its exact continuation.
3. **Follow-up:** existing optional polling, omitted-target retry, fresh-search or
   query-rewrite advice, with its conditions retained.

If the existing search action has useResults=true but no returned read action
exists, omit Read and retain `Use these results now.` as the first plain-prose
line in Follow-up, before its conditional wait/fresh-search advice. More results
remains earlier in the footer. Never invent a read locator.

No section is printed without a real action or meaningful advisory. Header and
labels use identical wording on CLI and MCP; action syntax remains native.

Search selects the first actual returned read action as an example even on a
healthy completed page. Lead with `Use these results now; example read:` rather than
implying it reads every result. Grep retains file/page templates, removes
only their leading `#` and prefixes CLI templates with `githits` so they are
consistent command recipes; no template appears for an empty page. Example:

```text
Read:
  Use these results now; example read:
  githits read 'https://expressjs.com/llms/resources.txt' --selector 'route'

More results:
  Repeat the original search, adding:
  --offset 1
  Results may change while this search is running.

Follow-up:
  If you need updated results, wait (hits and order may change):
  githits search-status <actual-search-ref> --wait 80
```

```text
Read:
  Pages: githits read --lines $start-$end -- $url

More results:
  Repeat the original grep, adding:
  --cursor '<complete-backend-cursor>'

Follow-up:
  To retry omitted targets, rerun the original query with --wait 80000.
```

Examples above are designed layouts using captured facts, not new live renders;
placeholder locators are explicitly illustrative. MCP uses the same labels with
`read target=...`, `offset=1`, `cursor=...`, `search_status search_ref=...` and
`wait_timeout_ms=...`. Search CLI wait remains seconds; grep wait remains ms.
The implementation must preserve the existing exact native read arguments instead
of deriving them from display labels; the grep CLI prefix changes presentation
only, not the command or operands.

For active/interim search pagination, add under More results:
`Results may change while this search is running.` Repeating search is not
continuing an immutable snapshot. Retained terminal results instead preserve
their existing mutable-evidence warning and fresh-search requirement; an ended
search reference never becomes pollable. More results always says *original
search*, including on search-status output, because its query echo cannot
reconstruct caller filters/targets. hasMore with no nextOffset remains a truthful
`More results are available; repeat the original search.` advisory without
inventing an offset. Never compute it from the visible hit count.

Prior-HEAD specific-ref guidance stays attached to the search read/follow-up advice.
Keep `If you need current HEAD` when that proof exists, the hits/order warning,
query-rewrite choices and no-poll terminal rules. Known terminal statuses are
DEFERRED/TIMEOUT/FAILED; other status values retain existing `status unknown`
wording rather than claiming a new backend lifecycle contract. Empty results have no Read
section; pagination and recovery are independently optional, not gated by the
lifecycle action union.

The full cursor cannot become shorter within the existing contract. Keep it
unwrapped and exact, dim action lines on ANSI CLI in both tools, and place each on its own
indented line. Section labels are bold, prose is plain, and all footer action
lines (read, offset/cursor and status commands) are dim. Use a tiny shared
action-line styling function; per-tool renderers pass exact action strings, so
the helper never guesses whether prose is a command. ANSI-free output carries
identical words, operands and order. It will still take space; truncation,
local handles, files, clipboard integration or a new cursor API are out of scope.

Search alternative summaries use `(+N more)` rather than `+N`. Preserve existing
limits, ordering, version/ref categories and suggested-versus-indexed meaning.
Uncounted `+more` evidence retains its unknown-count meaning; no synthetic count.
Read/list/resolve output and their alternatives do not otherwise change in this
PR. Document this intentional scope boundary so their older footer labels are
not mistaken for accidental drift.

## Architecture and scope

Shared MCP presentation naturally owns repeated output copy because CLI and MCP
already call these neutral formatters. Per-tool adapters own counts, lifecycle,
coverage and native actions; core services continue owning data and validation.
A Commander-level helper would duplicate MCP behavior; a core helper would put
presentation in transport. Neither is appropriate.

Use one small pure `packages/mcp/src/shared/search-grep-output-text.ts` helper for
` | ` headline joining/wrapping/emphasis and the fixed Read/More results/Follow-up
section skeleton. Its inputs are already-rendered headline clauses and optional
read/more/follow-up lines; it knows no backend state, target identity or command
arguments. Treat action lines as verbatim strings; only formatter-authored prose
is wrapped before supplying it. No configurable section registry, formatter DSL,
state machine, service DTO, runtime dependency or public export is needed.

Tool formatters retain all decisions and use this helper. Footer pagination is
rendered separately from search's existing lifecycle action; there is no reason
to add pagination to that semantic union. Reuse `renderReadTarget`, exact quoting,
existing wrapping/colors and wait policy. Header wrapping must work on both
surfaces; current search's unsplit first line needs the same width treatment as
existing grep prose. Do not rewrap returned source content or action operands.

Likely production files: `unified-search-text.ts`, `unified-search-status-text.ts`
(only if passing existing result facts needs adjustment), `grep-text.ts` and the
new small helper, plus affected structural assertions in
`scripts/cli-smoke.ts` and `packages/mcp/src/smoke-test.ts`. These validators
currently recognize `Next:` and old grep read labels; migrate only search/grep
assertions, leaving unrelated resolve/list checks intact. The existing
`UnifiedSearchAvailability` private projection gains the supplied partialResults
boolean (false when no snapshot), so empty snapshots can retain partial truth.
That fact naturally belongs in availability, not duplicated in CLI adapters or
inferred from hit count; add a focused projection test. No response/service/request/schema/descriptor changes
are planned. JSON and API field selections stay byte/structurally equivalent.
Shared header/footer placement replaces duplication without reworking result
bodies or source/preparation ownership. Existing mapped errors retain their
contracts; this change concerns successful/retained result text, not auth errors.

## Phase 1 — consistent and truthful result edges

- Status: **READY**.
- Expected outcome: the examples above hold for CLI/MCP search/status and grep;
  usable results, pending scopes and available actions are immediately clear.
- Assumptions: existing nextOffset/cursor/read/lifecycle facts suffice (verified
  above); fixed three-section helper needs no new service data; long cursors
  remain unavoidable within the existing contract.
- Unknowns/product decisions: **none**. Implementation evidence may expose a
  contradiction; report it before widening the scope or changing the design.
- Dependencies: reviewed plan, merged source rows and current main baseline.

Ordered implementation:

1. Add behavioral fixtures for headers and independently optional footer actions
   in existing formatter tests. Add the small shared helper and integrate search
   outcome/lifecycle lines and grep separator/coverage clauses.
2. Separate search read/pagination/follow-up rendering while preserving its semantic
   action projection; integrate grep's existing actions through the same skeleton.
   Preserve exact locators/cursors/wait units and all target recovery/body output.
3. Normalize search's counted alternative suffix. Scan affected structural smoke
   assertions and parity tests for old header/footer assumptions; update only
   expectations covered by this contract.
4. Update `search-snapshot-presentation.md`, `unified-grep.md`,
   `mcp-cli-parity.md` and relevant output examples in `cli-commands.md`/`tools.md`.
   Add an independent changes fragment with pending **patch** impact for both
   githits and @githits/mcp (text-only behavior). No version/changelog edits.
5. Focused verification, internal review and a fresh Claude implementation review
   loop; commit/push and one draft implementation PR. No merge or release.

Acceptance cases:

- Ready search code/docs/mixed hits and ready grep multiple occurrences on one
  line: counts are correct, JSON unchanged, same separators/section labels.
- Ready docs plus pending code, including multiple targets and duplicate aliases:
  Sources/Preparing stay truthful; no ambiguous readiness fraction; search and
  grep both say partial for usable docs while code prepares; grep normal
  pagination alone never claims incomplete coverage.
- Active non-partial interim and completed partial search: retain interim/partial
  truth independently of completed state. PENDING/INDEXING/SEARCHING and
  DEFERRED/TIMEOUT/FAILED/unknown remain visible and receive only their valid actions.
- Empty complete, empty active, absent snapshot, zero-hit continuation pages,
  withheld scopes, actual coverage issues and expired grep cursor: precise
  outcomes, no spurious Read, unchanged scope remediation.
- Search/status nextOffset and hasMore-without-offset, active mutable ordering,
  terminal retained pages and grep cursors: More results is independent of Follow-up,
  original-request controls retained, no status offset or invented operand.
- Multi-target grep with an unvisited UNSPECIFIED+RESUMABLE_LIMIT scope:
  both hit-bearing and zero-hit continuation pages omit false coverage-incomplete
  copy, keep the source page qualifier and exact cursor, with no invented retry.
- Grep zero-hit docs continuation with a retryable pending repository, and the
  same shape with non-retryable omissions: exact table outcomes, correct
  coverage qualifier, retained cursor and attributed omission reasons.
- Active search with hits: explicit `Use these results now` before
  `If you need updated results, wait`; no required retry implied for usable hits.
  Readless active hits retain use-now as the first Follow-up line, omit Read and
  never invent a read target.
- Prior HEAD, current HEAD and ended evidence: read-now before optional wait,
  exact specific-ref advice, no pollable ended search.
- 40/80/120-column output, ANSI stripped versus plain output and backend Unicode:
  prose wraps, fixed actions/content do not; all footer sections omit cleanly.

Verification: use bun test for the shared helper and existing
`unified-search-text.test.ts`, `unified-search-status-text.test.ts`,
`unified-search-snapshot-text.test.ts`, `unified-search-presentation.test.ts`,
`grep-text.test.ts`, `grep-text-rendering.test.ts`, `grep-response.test.ts`,
`indexing-estimates.test.ts`, `unified-search-semantic-text.test.ts`, and root
`search-parity.test.ts`/`grep-parity.test.ts`. Run affected smoke-assertion unit
cases, typecheck and both builds. Run `bun run smoke:cli`, `bun run smoke:mcp`,
`bun run smoke:cli:built` and `bun run smoke:mcp:built`; built checks verify
changed structural smoke assertions against packed Node launch paths. Run public
package validation after builds. Broader unit suite is the final integration
check after formatter changes; do not repeat it after wording-only closure.

For live verification, use authenticated dev only, remove unintended endpoint
and token overrides without displaying credentials, and compare search/grep
on an indexed pinned package and a registry-confirmed unindexed package.
Use `route` search and literal `foo` grep for Express documentation, limit 1,
and the same pinned input within each client; if the version becomes indexed,
record the transition and verify pending cases against a different verified
unindexed version rather than inventing its version number. Use
literal CLI --wait 1 and matching MCP waits, record actual input/version and
per-response states. Use fixtures for terminal/unknown/expired states rather
than waiting for sessions to expire. Inspect captured output manually as well as
structural checks. Agent-facing text behavior also requires targeted
`bun run agent:e2e` search-investigation and grep-mixed-docs workloads selected
from eval/agentic/README.md:
`GITHITS_ENV=dev bun run agent:e2e --agent claude --surface mcp --server local --workload eval/agentic/workloads/unified-search-investigation.md`
and the same command with
`--workload eval/agentic/workloads/grep-mixed-docs.md`.
Inspect actual calls/final answer/isolation/metrics.
Previous Claude runs failed provider login before tool use, which is no quality
result; verify current availability and report the same limitation if it persists.
No descriptor/instruction changes or broad routing eval is implied.

No new auth, deployment, performance or network risk is introduced. Programmatic
callers retain JSON; users receive revised text-v1 prose. Existing partial
search opt-out, wait defaults, selectors, filters, ordering and page size remain.
Hosted MCP adoption still follows its package release/dependency/deployment path.

## Review, completion and cleanup

Plan review: internal technical review followed by Claude Opus 5.5 external
rounds until clean (maximum three); adjudicate findings against the selected scope and verified facts.
Implementation review is a separate fresh loop. Keep the plan through its clean
round, move final facts/examples to permanent implementation docs, then delete
this plan in the final implementation PR commit. No separate cleanup PR.
Remove the selected backlog entry now that this plan owns it, replacing it with
one link while pending; delete that link on completion. The broader
`search-output-ux.md` plan's unrelated per-tool migrations are not absorbed;
this user-selected two-tool follow-up is an explicit narrow cross-tool increment.
One phase means no intermediate merge/reorientation boundary. If verified evidence
requires another phase or a broader design, stop and replan with the user.

Internal technical review is **clean** after correcting empty partial-search
provenance, empty resumable grep wording and the known terminal status list.
The private availability correction is the smallest boundary change needed;
public JSON and service contracts stay unchanged. External Claude round 1 accepted direction and found five plan corrections:
read-now/conditional wait wording, omitted-target pagination semantics, action
styling, grep CLI read prefix and missing focused test files. All are accepted
and applied. Round 2 accepted four closures and refined the remaining grep
wording: retryable omissions only now say partial, while actual gaps and
non-retryable omissions say coverage incomplete. The readless advisory has an
explicit Follow-up slot; the read/follow-up wording is corrected. Round 3 found one remaining documented unvisited-scope case:
UNSPECIFIED+RESUMABLE_LIMIT is ordinary pagination, now exempted consistently
in header/omissions-only/zero-page rules and acceptance. The three-round cap is
reached; no fourth external round is dispatched. Coordinator closure verifies
this against implementation documentation and its existing fixture tests.
Final internal technical closure is clean. Existing unvisited-scope contract
proof passed: `bun test packages/mcp/src/shared/grep-text.test.ts
packages/mcp/src/shared/grep-response.test.ts --test-name-pattern 'lists unvisited
scopes beside the matched source|retains an unvisited selected site'` — 2 passed,
0 failed. These tests verify the baseline contract, not the proposed new output.
All findings are corrected; no direction, scope or product question remains.
There was no finding-free external round within the cap; implementation will
receive its own fresh review loop and actual output verification. No production change or planning-only PR created.
