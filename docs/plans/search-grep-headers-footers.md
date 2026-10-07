# Search and grep headers and footers

## Status and destination

- Overall: **IN PROGRESS — implementation authorized**.
- Phase 1: **IN PROGRESS** — one implementation increment makes search/status and
  grep headers and footers consistent on CLI and local/published MCP package text.
- Product decisions: **none open**. The user approved the plain-language
  direction, constrained repeated prose on 2026-10-07, and invoked $implement.
  These instructions settle the previously proposed wording and concision rules.
- Dependencies: merged PR #454 (`c71ffb5`), current main `bc295b3`, existing source/preparation facts,
  existing read actions, search offset and grep cursor contracts.

Readers should immediately see what this page returned, what is preparing, and
how to read, continue or obtain updated results. Search and grep retain their different evidence
counts and continuation semantics within one visible anatomy. This is one
bounded PR with product changes, not a planning-only PR. Implementation is authorized; no merge or release.

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

### Header — revised proposal after user feedback

The earlier pipe-separated design is superseded. It counted one documentation
hit twice (`1 result | 1 docs page`) and used `partial` without saying what was
missing. The user contested this on 2026-10-06; do not implement that shape.

Lead with one plain sentence describing this returned page. Count each search
result once, either as a known kind or in a mixed-kind breakdown; do not add a
redundant total. Documentation results are returned hits, not a newly invented
count of unique URLs (multiple sections can come from one page).

```text
Found 1 documentation result.
Found 2 code results and 1 documentation result.
Found 4 matches on 3 lines in 2 files.
```

Search labels should distinguish repository documentation, hosted documentation
and symbols when supplied by existing hit kinds; unknown kinds retain a plain
result count rather than acquiring an invented classification. Grep's matches,
lines and files/pages are different quantities, so retain their useful relation
in the sentence. Both start with Found and use normal pluralization.

Do not append `partial`, `interim`, readiness fractions or pagination parameters.
More results belongs solely in its footer. Preparation and limitations are
explained in sentences or their existing attributed sections, not compact flags.
For the captured documentation-ready/code-pending case, the proposed anatomy is:

```text
Found 1 documentation result.

Sources:
  - site:expressjs.com (hosted documentation)

Preparing:
  - github:expressjs/express@1bb798d9 (indexing, estimated total: 25-61s)
    Requested: npm:express@2.3.10
```

#### Per-call concision constraint (user feedback, 2026-10-07)

Default to exactly one outcome sentence. Sources and Preparing already carry
served scope and pending work; do not add a second sentence paraphrasing them.
In the captured ready-documentation/pending-code case above, there is no extra
`Repository code is still indexing` or `documentation results are usable now`
paragraph. Repetition on every call accumulates unnecessary agent context.

Add at most one short explanation only when a meaningful limitation or lifecycle
fact is otherwise missing. The notice must add a fact, not restate a label or
teach the output format. Name a cause only when supplied facts establish it;
a preparing refresh does not prove no code was searched. Preserve the deliberate
use-now/conditional-wait guidance when actually offering a wait alongside usable
hits; healthy results without wait advice need no use-now explanation.

Search backend partialResults remains meaningful, including empty/completed
snapshots. If attributed source/preparation/coverage notes already explain the
missing scope, do not repeat an abstract warning. If partialResults=true has no
such explanation, say `These results do not cover the full request.` without
guessing an indexing cause. Retain this fact in the private availability model;
public JSON stays unchanged. Active work not explained by Preparing can say
`Search is still running.` Known terminal states retain explicit ended/failed
reason sentences and unknown states remain unknown; do not imply completion.

Grep classification keeps the reviewed distinction, but it now drives prose and
empty outcomes rather than abstract headline qualifiers:

- Actual gaps: readiness other than CURRENT except the documented unvisited
  UNSPECIFIED+RESUMABLE_LIMIT case; non-pagination traversal, errors, skips and
  scan issues, or overall NON_RESUMABLE_PARTIAL/FAILED/CURSOR_EXPIRED not explained solely by omitted targets.
- Only retryable omissions: no actual gap, at least one unavailableTarget and
  all omissions retryable. NON_RESUMABLE_PARTIAL is also emitted for omission-only pages; the existing Preparing/Omitted rows explain that temporary limit without another traversal warning.
- Non-retryable omissions or actual gaps: existing attributed coverage/reason
  notes explain the limit. When no existing note conveys the overall limitation,
  use `Some requested content could not be searched.` without inventing a cause.
- CURRENT+RESUMABLE_LIMIT and unvisited UNSPECIFIED+RESUMABLE_LIMIT without
  independent errors/skips are ordinary pagination, not failures. Keep unvisited
  source qualifiers and the exact cursor; no unnecessary retry.

Preserve the strict exhaustive predicate. The revised zero-page examples are:

| Returned page | Outcome |
| --- | --- |
| Exhaustive search/grep | `No results found.` / `No matches found.` |
| Active search or only retryable grep omissions | `No results available yet.` / `No matches available yet.` |
| Empty continuation page | `No results on this page.` / `No matches on this page.` |
| Empty continuation plus retryable grep omissions | `No matches available yet on this page.` |
| Actual missing/failed scope | Plain no-results/no-matches outcome plus the attributed limitation explanation |
| No search snapshot | `No results available yet.` while active, or explicit ended-search explanation otherwise |

Pagination remains independently available under More results. Partial empty
snapshots must not imply an exhaustive no-result search; use the scope explanation
or the full-request warning above. These copy choices were settled by the user
and are now under implementation review; prior plan reviews covered the
semantics, not this revised wording.

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
healthy completed page. On a healthy page with no wait advice, show the read
command without instructional prose. When a wait is also offered, retain the
short `Use these results now; example read:` lead to prevent wait-first behavior. Grep retains file/page templates, removes
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
the fixed Read/More results/Follow-up section skeleton only. Headline sentences
reuse existing terminal prose wrapping and emphasis in each tool formatter;
there is no reason for a separate shared counter/joining abstraction.
Its inputs are optional
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

- Status: **IN PROGRESS**.
- Expected outcome: the examples above hold for CLI/MCP search/status and grep;
  usable results, pending scopes and available actions are immediately clear.
- Assumptions: existing nextOffset/cursor/read/lifecycle facts suffice (verified
  above); fixed three-section helper needs no new service data; long cursors
  remain unavoidable within the existing contract.
- Unknowns/product decisions: **none** after the user invoked $implement on the
  revised design. Fresh implementation review covers the final approved wording.
- Dependencies: reviewed plan, merged source rows and current main baseline.

Ordered implementation:

1. Add behavioral fixtures for headers and independently optional footer actions
   in existing formatter tests. Add the small shared helper and integrate search
   plain outcome sentences and evidence-based limitation explanations.
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
  line: counts are correct and not repeated, JSON unchanged, plain sentences and
  the same footer section labels; no pipe-separated counters or unexplained flags.
- Ready docs plus pending code, including multiple targets and duplicate aliases:
  Sources/Preparing stay truthful; no ambiguous readiness fraction; search and
  grep explain pending work through attributed Preparing facts rather than an
  unexplained partial label; no extra sentence restates Preparing or the usable
  Sources. Grep normal pagination alone never claims incomplete coverage.
- Active interim and completed partial search: explain continuing work and
  incomplete request coverage in plain language independently of completed state. PENDING/INDEXING/SEARCHING and
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
- Repeated-call concision: ordinary ready and ready-docs/pending-code pages
  contain one outcome sentence, no redundant status explanation, and action-only
  healthy read guidance. Exceptional notes add otherwise missing facts; conditional
  waits with usable results retain the behavioral use-now safeguard.
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

Historical review of the superseded pipe-separated proposal follows. It does
not establish readiness of the current headline revision.

Internal technical review was **clean** after correcting empty partial-search
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

## User-directed headline revision (2026-10-06)

The previous READY state and pipe-separated examples are superseded by the
feedback above. The underlying reviewed continuation/coverage semantics and
footer design remain available; headline copy and the smaller footer-only helper
are proposed, not reviewed-ready. Do not treat historical review closure as
approval of the revised words. No production code changed.

The user additionally requires per-call token discipline on 2026-10-07: default
header-only outcome, no paraphrase of Sources/Preparing, and exceptional prose
only for otherwise undisclosed facts. This refines the proposed copy and
acceptance; it is not an output-token reduction claim before implementation.


## Implementation evidence (2026-10-07)

Implemented inline under $implement on merged main bc295b3. Private availability
retains backend partialResults for completed/empty snapshots; no public JSON,
request/query selection, descriptors, auth or other commands changed. The shared
helper owns fixed footer layout only; tool renderers retain state and exact
operands. Grep gap checks reuse the same target predicate while the exhaustive
predicate remains stricter. No new infrastructure or major deferral.

Focused closure: 297 pass, zero fail, 932 assertions across four renderer/smoke
contract files. Full verification passed 5,624 tests/zero failures/22,404 assertions across235 files; typecheck, both builds, source and built CLI/MCP smokes and packed public-package validation passed. Targeted
Claude agent:e2e search-investigation and grep-mixed-docs executions failed with
`Not logged in` before any tool calls. Both tool traces are empty, final/isolation
artifacts absent and usage unknown; no comprehension/quality claim follows.

Same fixed fixtures before/after: ready search 89 -> 163 bytes (+74), preparing
search 459 -> 553 (+94), mixed paged grep 6992 -> 6985 (-7). Search adds useful
native read/pagination actions that the baseline omitted. This is output size,
not token count, latency or agent-quality evidence.

Authenticated dev CLI express@2.3.12 (registry-confirmed) returned one docs hit
and one hosted-doc grep match with Sources, repository Preparing, then Read,
More results and Follow-up. Exact command operands, alias and indexed alternatives
remain. MCP grep express@2.4.0 showed the same hierarchy with native syntax.
Initial MCP search encountered a transient Keychain error; retry succeeded after
that version had indexed, proving healthy code Read+pagination without a wait.
Fresh pending MCP search express2.4.1 and immediate retained status succeeded with identical text, exact read selector/offset1/native status wait70000. Healthy CLI/MCP search returned code with Read+More and no wait.


Internal finding closure: direction sound. Overall NON_RESUMABLE_PARTIAL/FAILED
can retain a cursor (parser accepts this valid shape); the old no-cursor-only
warning hid the limitation in that case. Fixed overall warning selection while
retaining exact cursor and omission-only silence. Sibling scan covered all overall
traversal branches, target gap/exhaustive predicates, parser enum/cursor contracts,
zero/hit pages and related documentation. Added both statuses with zero/hit pages;
no service/state change or speculative mechanism. Two stale grep-doc outcome
paragraphs now match current prose. Internal revised-delta closure is clean; 244 tests/zero failures/913 assertions across eight affected files prove the fix. Closure typecheck, both builds and source/built CLI/MCP smoke checks passed.


External round 1: direction sound, not clean (one code finding, one doc nit).
F1 accepted: empty cursor pages gated their page qualifier on coverage/omission
classification, so ordinary skipped-file + cursor and terminal-omission + cursor
pages could sound exhaustive. Root invariant is that a returned cursor scopes the
outcome to this page independently of missing coverage; warnings own limitations.
Removed that gate. Closure scan covers all empty grep branches, source exhaustive
qualifiers, target and overall failure warnings, retryable/non-retryable omissions,
normal/unvisited pagination and search/status's corresponding page qualifier.
Tests assert headlines for skipped-file and failed/partial cursor pages, plus a
non-retryable-omission cursor page. F2 accepted: replaced a dangling permanent-doc
review placeholder with the verified closure. Also restored explicit lifecycle
sentence assertions where a migrated test left an unused label. No machinery or
scope expansion. Nine-file closure passes 354 tests, zero failures and 1,353
assertions. Internal revised-delta closure is clean. Typecheck, both builds, and
source/built CLI/MCP smoke checks pass after the external correction; external
round 2 pending.

External round 2: direction sound; R1 behavior and closure correct. Low finding
accepted: the overall failed/partial fixture asserted warning/cursor but omitted
the headline assertion claimed above. Root class is evidence that does not prove
a documentation claim. Scanned the new skip/omission/overall fixture assertions
against those claims; added explicit zero/hit headlines for both overall states.
Moved the omission test into the related describe block (accepted test-organization
nit). Production is unchanged. Focused `bun test packages/mcp/src/shared/grep-response.test.ts`
passes 19 tests, zero failures and 118 assertions; scoped Biome and diff checks
pass. Internal full revised-delta closure is clean. Round 3 pending.
