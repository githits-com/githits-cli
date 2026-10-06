# Repository snapshots during search indexing

Initial `search` and `search_status` use the same semantic projection and text
formatter in `packages/mcp/src/shared/unified-search-presentation.ts` and
`unified-search-text.ts`. The former owns evidence and continuation decisions;
the latter owns wording and surface-native read/status commands. CLI/MCP adapters
and explicit user wait options are unchanged; commit-date metadata is described below. Search
descriptions retain their selection sentences and make continuation conditional
on needing updated results; completed references are stored, not poll targets.

Previously the projection discarded `evidenceNotice` wording and chose a status
wait whenever the search was active. An agent following the next action literally
could wait 120 seconds despite already having useful code locations. Completed
mutable snapshots also received a status action even though the reference was
stored and could not obtain later evidence.

With returned hits, an active search now leads with:

```text
Next: use these hits now; read for details:
read target="github:anomalyco/opencode@bbd72fb8" path="..." start_line=480 end_line=490
For a specific ref, search github:anomalyco/opencode@<ref>.
If you need current HEAD, wait (hits and order may change):
search_status search_ref="..." wait_timeout_ms=120000
```

The specific-ref advice and HEAD-specific conditional appear only for proved
prior HEAD evidence. Other active results offer an optional wait for updated
results. The single read example preserves the emitted `readTarget` arguments,
including target, path, selector and bounds, rather than replacing its pinned
commit with requested HEAD. Existing per-hit locators and pagination remain.
Completed current searches use the same source rows, including independently known dates. With no hits, active
searches retain their status next action. Ended searches needing updated evidence
require a new search; their stored reference is never offered as a poll target.

Shared `Sources:` rows disclose `github:owner/repo@<8-character SHA>` and, when known,
`indexed from ref <ref>`. A historical named branch or HEAD alias is never a claim
about its current pointer. Missing or SHA-valued historical refs omit that clause.
The resolved requested commit is compared with the served commit using full SHAs;
different commits are disclosed independently from indexing state. Only
`fallback_recent`, actual matching source hits, two distinct commits, and request
kind `repo_default_branch` or `repo_head` establish prior HEAD evidence. Same-SHA
artifact refreshes and explicit branch/tag/commit intents do not qualify.
`freshnessReason=requested_ref_indexing` supplies the requested-ref indexing fact.
A searched source with `resultCount=0` also discloses its known served commit,
so an empty lookup is not presented as evidence about requested HEAD. That
source's own provenance needs no borrowed hit; it does not qualify for prior-HEAD
use/read advice. A withheld/unsearched source does not establish searched evidence.
Backend notice prose is not parsed as state or duplicated in the text.

`completed=false` means the search is still active, not that visible hits are
incomplete. `partialResults=true` retains its separate omission meaning. Readiness
and docs/other-target limitations stay attached to their targets; one usable hit
never promotes all targets to ready. There is no commit-age, distance-behind-HEAD,
or completeness claim. Index completion time cannot establish commit age.

Recorded acceptance provenance comes from the 2026-10-01 dev OpenCode response:
served `bbd72fb8b0bb6de580d2041a0150016227c63ac0`, historically indexed as HEAD;
requested HEAD resolved to `0112a92c416f5ad833d96e7a8308441f0a875d94`.
Backend #2909 supplied this contract on dev. Production rollout is not established.
The Q04 Transformers observation motivated the advice fix; its old comparison
searched a PyPI artifact, so it is not a controlled speed/token comparison.

## Known commit dates

`TargetResolutionIdentity.committedAt` is the backend-verified nullable UTC
committer timestamp for the exact `repoUrl` and full `commitSha`. It is not push
or indexing time, elapsed freshness, current branch membership, distance behind
HEAD, or ancestry proof. Dates can be future-dated or non-monotonic. Unknown
historical dates are expected; this client performs no enrichment or backfill.

The shared `TARGET_RESOLUTION_SELECTION` selects `committedAt` on `served` and
`resolvedRequested`, leaving original `requested` undated. The nullable transport
schema accepts the returned field; the service normalizer and lean projection
retain known timestamp strings and omit null, matching sibling identity fields.
That selection also supplies existing `read`, code-context and legacy CLI
`code files` / `code grep` responses, so their structured provenance gains known
dates without new calls. Public `list` now selects minimal dated provenance for normal text and full provenance for JSON; public `grep` still has no commit-date or resolved-requested contract. No mode-specific fetch
is needed: both compact text and JSON consume these two timestamps.

The root cause of missing dates was omission at every existing shared boundary:
the GraphQL selection did not request the field; schema parsing, service
normalization and lean whitelisting discarded it; the snapshot projection/text
had no date clause. The fix extends those owners rather than adding a lookup.
The semantic presentation slices the verified UTC timestamp's first ten
characters into a calendar date, gated by the independently supplied served or requested full identity. The
requested date never repairs a missing served date. JSON retains the full timestamp.

Example before normal-width wrapping:

```text
Sources:
  - github:owner/repo@aaaaaaaa (committed 2026-09-01, indexed from ref HEAD, older snapshot)

Preparing:
  - github:owner/repo@bbbbbbbb (indexing, estimated total: 100-120s, committed 2026-10-05, observed HEAD)
```

Preparing uses the actual job's repository and full SHA. Its optional date and
`observed HEAD` join only independently supplied resolved-requested facts with
exact raw repository URL and full SHA equality. Explicit branch/tag/SHA/package
intent never proves observed HEAD. Different coalesced work stays separate;
`Requested:` retains the independently observed commit/date instead. Missing
job identity keeps the supplied request label. No metadata lookup occurs.
Retained ended-search estimates say `indexing when observed` and do not revive
polling. Empty estimates on provisional results do not fabricate active work.

Known served dates and historical refs appear for healthy current sources too.
Unknown clauses disappear without placeholders. Requested metadata never repairs
missing served metadata, even for the same SHA; useful independent requested
facts remain separately labelled. Old/future dates never affect state or waits.
The existing exact readTarget, use-hits-now action, conditional wait, lifecycle,
partial/completeness signals, attribution and zero-hit/withheld rules are unchanged.

**Rollout prerequisite:** confirm production backend schema deployment before
client release or hosted MCP adoption. This increment was verified against the
supplied backend dev records, not production. If deployed too early, all `read`
requests fail because `ReadService` has no schema fallback: the code fragment
selects the field, and GraphQL validates the whole document before returning
either code or docs. Public list text and JSON likewise require schema support: its query document includes the date field even when the provenance directive is false. Search/status and legacy navigation instead make sequential
fallback retries before dropping all `targetResolution`, losing served provenance
and prior-HEAD advice.
No new fallback is added. The user owns release; hosted clients additionally need
`@githits/mcp` release, remote-mcp dependency adoption and deployment.

Original commit-date verification (2026-10-05):

- Focused 14-file checks: 668 tests pass, zero failures, 3,258 expectations.
  Covered shared core search/status transport and progress, exact read transport and JSON, lean
  projection, search presentation/text/status/response, tools, CLI commands,
  timing parity and actual CLI/MCP adapter parity. Retained status JSON timestamps are also verified through both adapters.
- Date cases include both/served/requested/neither known, null/absent wire data,
  same/different SHA, future and reversed chronology, current, provisional,
  searched zero-hit, withheld and terminal retained results. Tests compare
  date-free/date-bearing actions, lifecycle, availability and emitted read pointers.
- `bun run typecheck`, `bun run build`, `bun run --cwd packages/mcp build`, and
  scoped `bunx biome check`, `git diff --check` and `bun run validate:packages` pass. A scratch rendered preview confirmed grammatical
  copy at the normal width, date attribution and the unchanged read-before-wait order.
- Required `GITHITS_ENV=dev GITHITS_AUTH_STORAGE=file bun run smoke:cli` and
  `bun run smoke:mcp` pass with endpoint/token overrides unset. Authenticated
  cohorts skip with `AUTH_REQUIRED` in isolated homes. A direct dev CLI file-auth
  search also returned `AUTH_REQUIRED`; the normal auth probe blocked on macOS
  keychain access and was stopped. No successful live CLI/MCP business response
  is claimed for this worktree.
- The supplied 2026-10-05 backend dev search/status/read verification has usable
  Transformers hits at served SHA `2112ec4e74fdb1225f78e676d4a8b6d28a00378d`
  with unknown date, independently dated requested SHA
  `f5ab85619d989359ef47b5efed8a91a15045627b` at `2026-10-05T15:28:19Z`, and
  byte-identical retained provenance. Its exact served read immediately returned
  the missing return line. The Jason repository's current HEAD date `2026-05-05T14:33:58Z`
  remained current. These are upstream evidence, not a new client live run.
- Targeted `GITHITS_ENV=dev GITHITS_AUTH_STORAGE=file bun run agent:e2e --agent
  claude --server local --intent-profile githits --workload
  eval/agentic/workloads/unified-search-investigation.md --timeout 180` failed
  before tool use: Claude reported `Not logged in · Please run /login`.
  Run `2026-10-05T17-25-30-431Z` has zero raw tool calls, no final.json and no
  isolation-violations artifact. Raw stdout/tool calls and metrics were inspected.
  This is unavailable qualitative evidence, not a UX pass or quality/performance claim.

## Historical read-before-wait verification (2026-10-01)

- `bun test packages/mcp/src/shared/unified-search-presentation.test.ts
  packages/mcp/src/shared/unified-search-text.test.ts
  packages/mcp/src/shared/unified-search-status-text.test.ts
  packages/mcp/src/shared/unified-search-snapshot-text.test.ts
  packages/mcp/src/shared/unified-search-response.test.ts
  packages/mcp/src/tools/search.test.ts packages/mcp/src/tools/search-status.test.ts
  src/commands/search.test.ts src/tools/search-parity.test.ts`: 447 pass,
  0 fail, 1,744 expectations. Tests render both initial and status text, exercise
  the actual CLI/MCP adapters, preserve JSON follow-up capping, and prove text
  retains the backend-selected pinned read arguments unchanged.
- Changed TypeScript files pass Biome; `bun run typecheck`, `bun run build`, and
  `bun run --cwd packages/mcp build` pass.
- Required dev `bun run smoke:cli` / `bun run smoke:mcp` pass with
  `GITHITS_AUTH_STORAGE=file` and endpoint/token overrides unset. They validate
  auth handling and skip authenticated cohorts with `AUTH_REQUIRED`: scoped smoke
  homes do not copy host file-auth state. Initial runs using default keychain
  storage failed at package auth probes because keychain access was unavailable
  in those isolated homes. Explicit CLI unauthenticated and MCP registration modes
  also pass (38 and 9 steps respectively).
- Direct authenticated dev CLI search `Session`, target
  `github:anomalyco/opencode`, source code, limit 3, wait 0 returned three current
  hits. Reading the recorded emitted target `github:anomalyco/opencode@bbd72fb8`,
  path `packages/app/e2e/performance/timeline/session-timeline-benchmark.fixture.ts`,
  lines 480-490 returned the full matching served SHA with `exact_current`.
  No indexes were reset to recreate a pending state.
- `GITHITS_ENV=dev CODEX_HOME=/Users/jpl/.codex-eval bun run agent:e2e --agent codex
  --surface mcp --server local --workload /tmp/search-copy-agent-workload.md
  --timeout 240` ran Codex Luna against ordinary OpenCode implementation lookup.
  Run `2026-10-01T11-17-25-654Z`: final success/high confidence, ten completed MCP
  calls (three search, three read, two grep, one list, one quick_start), no
  `search_status`. `tool-calls.json`, `final.json`, and `metrics.json` were inspected;
  no `isolation-violations.json` was emitted. The evidence was current, not pending.
  The workload specified initial code lookup, so this is follow-up behavior
  evidence, not free tool-discovery evidence or an independently graded quality
  result. No before/after speed or token claim is made.

The public `githits-code` reference also corrects continuation advice using the
existing released read/wait contract: visible hits may be used now, an active
wait depends on needing updates, and completed references are stored. It does
not describe the new formatter wording or introduce unreleased commands/fields.
No public quick-start builder or embedded guide changes, transport changes, or
release/version changes are involved.

Before the external round 1 fix, full-suite validation: `bun test` passed 5,313 tests with 20,141 expectations
across 230 files. The bounded attribution scan also covers two requests for the
same repository/SHA, including a zero-hit HEAD source and hits belonging only to
an explicit commit. A historical served alias cannot attribute those hits to HEAD.
`bun run plugins:generate` / `bun run plugins:check` pass; all ten generated assets
remain unchanged.

After descriptor/reference edits, descriptor-only Luna run
`2026-10-01T11-35-25-139Z` reported success/high confidence with thirteen completed
MCP calls: three search, five read, two grep, two list, one quick_start, no
search_status. It received current snapshot evidence. The matching skills run
`2026-10-01T11-35-25-140Z` is **inconclusive**, despite the harness success exit:
its sole CLI search failed at unavailable keychain access in the isolated home;
no snapshot output was observed. Final answers, tool traces, and metrics were
inspected for both, and neither emitted an isolation-violations artifact. No
independent answer-quality grading or comparative performance claim is made.

External round 1 closure: the zero-hit provenance omission was valid. The shared
projection had coupled evidence disclosure to hit-based action proof; it now
retains a searched pair's own served commit when its count is explicitly zero,
without qualifying it for prior-HEAD read advice. The bounded scan covered source
readiness, actual-hit attribution, withholding, initial/status rendering, terminal
continuation, adapter normalization, and related docs. Empty active and all four
terminal states retain commit disclosure; withheld sources and counts that cannot
prove an empty searched pair do not. Bare request labels with historical HEAD
served aliases are exercised through actual CLI/MCP initial/status adapters,
including JSON parity. CLI help and continuation docs were also rewrapped and the
repeated condition removed. No infrastructure, new state, or product change was
needed.

Round 2 closure validation: the ten-file focused command above plus
`src/commands/search-registration.test.ts` passes 459 tests with 1,880 expectations.
`bun run typecheck`, both root/MCP builds, and both required dev smoke commands
also pass after the fixes; the smoke authentication limitations remain as stated.

External Opus 5.5 round 2 is clean at `2db186b`, including one fresh-context
final check. Both round 1 findings are closed. The reviewer independently rendered
a completed zero-hit bare-label fallback case (one scratch test passed, removed
afterwards) and verified changed help lines fit 80 columns. No valid finding or
major deferral remains. The completed working plan was removed after this clean
review; the contract, evidence, and limitations are retained here.

Copy pass after the draft PR: visible active hits are labeled `results`; the
adjacent lifecycle still says `indexing`/`searching`, while `partial` continues to
mean omitted runnable pairs. `commit` beside `searched: code` identifies what the query covered,
including zero-hit sources. Requested-commit difference and indexing share one
clause when they describe the same ref. The next action points directly to the
emitted read command (`use these hits now; read for details`) and omits the read
invitation when there is no emitted read target. The conditional wait names the
reader's need (`If you need current HEAD`); specific-ref advice uses the actual
repository name with `@<ref>`. No freshness proof, hit attribution, wait timeout,
pagination, emitted read arguments, JSON, schemas, or descriptions change.

Copy-pass focused verification:
`bun test packages/mcp/src/shared/unified-search-text.test.ts
packages/mcp/src/shared/unified-search-status-text.test.ts
packages/mcp/src/shared/unified-search-snapshot-text.test.ts
packages/mcp/src/tools/search.test.ts packages/mcp/src/tools/search-status.test.ts
src/commands/search.test.ts src/tools/search-parity.test.ts
src/tools/discovery-indexing-estimates-parity.test.ts`: 331 pass, 0 fail, 1,610
expectations across eight files. Root typecheck/build, MCP build and both required
dev smoke commands pass with the same isolated-auth limitations. Copy preflight
is clean. A recorded one-hit rendered example is 807 characters versus 860 before
this pass; this is output length, not tokenizer or comparative agent performance.

External copy round 3 raised only minor wording/documentation findings and counts
as clean after applying them: three stale display-label claims in `tools.md` and
`mcp-cli-parity.md` now distinguish visible `results` from genuine `partial`;
specific-ref advice uses the proved snapshot's own repository name instead of
abstract parameter/version placeholders. The optional repeated `searched` label
was shortened to `commit`. The bounded closure scan covers active header claims,
repo-only ref wording, provider examples, source rows, initial/status output and
actions. GitHub, Codeberg and nested GitLab examples pass; prose assertions retain
normal wrapping. Internal closure review is clean. The reviewer independently
rendered MCP/CLI active prior-HEAD and terminal cases (one scratch test passed,
removed afterwards). No code finding remains; the full final check from round 2
and copy review from round 3 are recorded separately.

Targeted copy-pass Luna eval `2026-10-02T07-02-12-436Z` reported success/high
confidence: one search, four reads and one quick_start, no status wait. Final,
tool calls and metrics were inspected; no isolation-violations artifact was
emitted. Reads used the default repository target, so this does not prove emitted
pinned-target usage. The saved trace does not expose rendered search text;
fixtures/adapters establish prior-snapshot output. No free-discovery, independent
quality grade or performance comparison is claimed. The eval preceded the final
minor ref-example/label wording fixes; final focused checks and builds/smokes
above cover those changes.

Commit-date code review round 1: direction sound and implementation correct.
Accepted documentation corrections name the no-fallback `read` failure on an
early rollout and distinguish legacy shared-query navigation from public
`list`/`grep`; the duplicate test date assignment was removed. The bounded closure
scan covered every TARGET_RESOLUTION_SELECTION use, direct/fallback GraphQL
clients, the separate list/grep queries and projections, rollout wording in the
plan/change fragment/PR brief, and all added test date assignments. No runtime
change, new machinery or major deferred finding was needed.

Commit-date review closure is clean at `5b2ba65` after the final minor wording
correction above. Opus 5.5 reviewed the full delta in two implementation rounds;
a supplemental task resumed the same fresh-context final-check subagent to
complete tests/docs/fragment/plan coverage after its initial production-only
pass. The only final note clarified whole-document GraphQL validation; no code
issue remains. Internal revised-delta preflight is clean. The 47-test snapshot
closure run passes with 549 expectations, and the follow-up commit hook passes
scoped Biome and typecheck. The completed plan is removed after this clean
review; all relevant contract, evidence and rollout limits are retained here.
No major deferred item or required refactoring remains.

## Shared source/preparation boundary (2026-10-06)

`source-provenance-text.ts` owns common identity/date/ref clauses and source rows;
`indexing-estimates-text.ts` owns preparation rows and existing timing/retry copy.
Search's semantic projection still owns actual-hit/zero-hit attribution, corpora,
coverage, prior-HEAD proof and lifecycle/actions. Recognized requested-ref indexing
reasons use the shared requested-indexing explanation when no matching preparation
row conveys them. The explanation concerns the ref, so it never mislabels an
independently observed SHA as the actual coalesced job. Top-level provenance
details wrap with hanging indentation. Rows replace repeated commit
serialization without parsing backend notices. Site scope and package aliases
remain explicit. Per-tool formatters control placement, width and native actions.
Annotated read and legacy navigation replace human resolution serialization with
these facts while retaining deferred/unavailable/provisional/unknown state and
queryable-versus-suggested recovery. Structured search warnings remain unchanged.

Focused verification after review fixes: 862 tests pass across 30 files with 4,265 assertions;
parser/repository/row browser closure adds a 184-test check (305 assertions).
Typecheck, scoped Biome, both builds and packed public-package validation pass.
The latter caught a registry import through core's service barrel; the parser
now consumes the same taxonomy through core's existing browser-safe entrypoint.
No registry copy, new runtime layer or network request was introduced.

Source CLI/MCP and built CLI/MCP smoke commands pass unauthenticated/registration
checks with dev presets. Live business cohorts skip with AUTH_REQUIRED; this
smoke run does not prove authenticated client output; the later narrow live
verification below does. The supplied 2026-10-05 backend
dev records remain the independent date-contract evidence. Targeted Claude
unified-search-investigation and grep-mixed-docs evals failed with `Not logged in` before tool use;
empty tool traces, absent final/isolation artifacts and unknown usage provide
no agent-quality claim. Exact fixture capture covers 12 date/lifecycle cases
on both surfaces (24 passing parity checks, 48 assertions); examples and unit
assertions establish the row wording. Production schema support remains required
before release or hosted adoption.

Internal review accepted an unresolved compact-list identity gap: original
repository/package fields had been gated behind detailed metadata, so an
unresolved repository could render only its ref. Normal list text now selects
those four existing fields; requested SHA and recovery arrays stay detailed-only.
Exact wire/projection and repository/package output regressions pass (3 tests,
10 assertions); the six-file list service/projection/request/CLI/MCP closure passes
129 tests with 676 assertions. Typecheck and both builds pass after this correction.
The bounded sibling scan covered list projections and caller selection, full
read/navigation identity fragments and search provenance. External review evidence
is recorded after the clean round.

## Live pending-version verification (2026-10-06)

Authenticated dev CLI calls used `npm:n8n@2.36.7` with literal `--wait 1`.
Search used query `router`, source code and limit 3; grep used literal `router`
and limit 3; read requested `package.json`, verbose lines 1-10; list used limit 5.
Search's wait unit is seconds; grep/read/list use milliseconds. No credentials
were read or displayed. The package remained unindexed throughout both passes;
all four reported actual work `github:n8n-io/n8n@f09fcad4`, total estimate 52-64s.
No `Sources` section was shown because no served content was available.

| Call | Captured Preparing metadata after adjustment | Native continuation |
| --- | --- | --- |
| search | `indexing, estimated total: 52-64s`; requested package alias | `search-status <ref> --wait 80` |
| grep | Same pin/estimate, `time spent indexing: 261s`; requested input 0; separate documentation preparation with no estimate | Retry original query `--wait 80000` |
| read | Same pin/estimate, `time spent indexing: 260s`; requested package alias; unavailable-content INDEXING error (exit 1) | Retry read `--wait 60000` |
| list | Same pin/estimate/elapsed 260s, independently known `committed 2026-08-25`; requested package alias | Retry list `--wait 80000` |

Dates and elapsed values differ only when the response supplies different facts;
no missing date is borrowed from list. Estimates remain advisory totals even when
observed elapsed execution exceeds them. Grep's hosted-documentation preparation
reflects its broader package scope; the code-only search does not claim that scope.
Search initially repeated an unresolved repository tag with no SHA/date beneath
the existing package alias. Shared Requested copy now suppresses duplicated
intent already represented under Preparing; independently resolved commits and
coalesced-work differences remain separate. A captured-shape CLI/MCP regression
passes, and the live CLI rerun confirms the extra row is gone.

A narrow local stdio MCP pass exercised the same four real dev tools, using
`wait_timeout_ms=1000` for search and 1 for the others to match CLI waits. It
confirmed the same actual-work pin, shared copy and source omission, with native
MCP actions; read returned `isError: true` for INDEXING. This verifies local
MCP package behavior, not published hosted adoption or agent interpretation.


The original version became indexed during review. A fresh pending-version pass
used `npm:n8n@2.36.6` with the same literal waits and query/path options after the
review fixes. All four calls identified `github:n8n-io/n8n@4fdfc9f9`, estimated total
437-1044s, and omitted Sources while no artifact was served. Captured elapsed
values were 0s for the initial list probe, 47s for search, 51s for grep and 53s for
read. List independently received committed 2026-08-24; the other three omitted
the unknown date. Grep also prepared documentation. Search disclosed indexed
version 2.36.7 and ref HEAD; read preserved its indexed-versions/refs recovery
hint. Native retries remained search 120 seconds, grep/list 120000 milliseconds,
and read 60000 milliseconds. Empty list no longer offers a Read files recipe.


Partial results are now enabled by default in the shared request builder and
transport, with explicit false preserved (`--no-allow-partial` /
`allow_partial_results: false`). Sources remains actual searched/served evidence.
This allows hosted docs to contribute while repository code prepares; it does not
change backend partialResults, target counts, pagination or continuation rules.
The compact initial query echo omits default true and retains explicit false. Search/status
and mapped indexing errors use shared `Indexed alternatives` copy inside Preparing,
with exact request attribution. Suggested refs remain advisory and separate.

Healthy source status is deliberately omitted from non-empty public JSON. The
response builder retains selected source facts in its private presentation DTO
(`sourceStatusForText`) so initial/status text can still disclose known dates.
Public projection removes that property; no additional network fields or requests
are introduced. Actual adapter tests cover Sources dates and JSON parity/omission.


The default correction was verified against dev using fresh `npm:express@1.0.7`.
With literal `--wait 1`, search returned one partial docs hit and a
`site:expressjs.com (hosted documentation)` Source, while Preparing identified
`github:expressjs/express@8c3ad123` (25-61s) and the requested package.
Indexed alternatives were versions 1.0.3, 2.0.0, 1.0.0 +7 under that row. Grep
returned one docs match with the same Source and actual job. Read was INDEXING
(exit 1) and list returned no files; both identified the same job. Only list
received the independently matching date 2011-02-07. Elapsed values were 0s,
2s, 4s and 5s respectively. Live captures are observations at different moments,
not guarantees of exact timing or order. Alternatives ordering/limits reflect
the supplied backend facts and each tool's existing selection.


Healthy repository-doc contributors retain matching known commit dates and
historical refs in private text facts even when public JSON omits their healthy
resolution. A searched zero-hit source retains its explicit zero count in those
facts beside sources with hits, so its served pin appears with `no results` (or
`no results on this page` when pagination applies).

When a searched source has no resolution, search presentation attributes exact
repository/full-SHA pins from that source's returned hits and deduplicates them.
It does not copy the hit locator's read ref into historical-ref metadata or borrow
a date from another command. Dev ready search for `npm:n8n@2.36.6` supplied pin
`4fdfc9f9db35702b64a8f15044a454044e47f6fc` in hits but no resolution/date.
Both initial and status adapter regressions cover this shape, repository-doc
provenance, mixed hit/zero-hit scopes, and compact JSON parity/omission.

Grep Requested and coverage prose uses target labels without backend input
indices. Its read templates follow the matches, before pagination and retries;
empty results offer no read template. JSON correlation fields remain unchanged.


Final integrated validation after the partial-default and grep corrections:
`bun test` passed 5,595 tests across 234 files, with zero failures and 22,303
assertions, including the compact query-echo closure. Typecheck, CLI/MCP builds, source/built CLI/MCP smoke suites and public
package validation passed. The smoke suites validate unauthenticated handling
and registration; authenticated dev CLI/local MCP captures separately verify the
four business-query surfaces. Qualitative Claude agent workloads remained blocked
by provider login before any tool use, so no agent-quality claim follows.

The user approved macOS Keychain access and final authenticated dev captures
completed on registry-confirmed, initially unindexed Express versions:
CLI `npm:express@2.3.10` and local stdio MCP `npm:express@2.3.11`.
The earlier probe used unpublished `1.0.9`; its read/list publication errors
were test-input errors, not indexing behavior. Package info did not enumerate
old versions, so the npm registry independently confirmed the replacement pins.
All four CLI calls used literal `--wait 1`; MCP used `wait_timeout_ms=1000`
for search and 1 for grep/read/list, matching their existing units.

| Call | Final authenticated metadata |
| --- | --- |
| search | One partial docs result; hosted-doc Source; actual repository Preparing pin, 25-61s total, requested alias and indexed alternatives beneath Preparing |
| grep | One hosted-doc match; same Source and preparation pin/estimate, requested alias without input indices; native read recipe after matches and before cursor/retry |
| read | INDEXING error with the same actual preparation pin/estimate, requested alias and indexed alternatives; native 60000ms retry |
| list | No files yet; same actual preparation pin/estimate and requested alias, plus its independently supplied matching commit date; native 80000ms retry |

CLI identified `github:expressjs/express@1bb798d9`; MCP identified
`github:expressjs/express@e2cdd760`. Only list knew the corresponding dates,
2011-05-27 and 2011-06-04 respectively; other tools omitted them. Elapsed values
reflect each response rather than synchronized observations. Fresh ready CLI and
MCP search for `npm:n8n@2.36.6` also confirmed the hit-derived source pin
`github:n8n-io/n8n@4fdfc9f9` without an invented date or historical ref.
No credentials were displayed.

Final external Claude Opus 5.5 review, including its one fresh-context full-delta
check, was clean after a minor tools-reference wording correction. A fabricated
cross-version package fallback carrying both package and repository identities
was investigated: fixtures cover package-only fallback (whose served version is
retained) and current combined identities, but no verified different-version
combined fallback. The user-selected canonical repository pin remains the text
identity; complete package provenance remains in JSON. No code defect, major
deferred work or required refactoring was established.

The user explicitly requested the partial-results default to become true after
indexing-state visibility was added. This is a deliberate exception to the
guideline against default-true agent booleans, preserving the existing
`allow_partial_results: false` opt-out contract rather than introducing an inverted
flag. Compact query echo omits true as a default; false remains explicit. The
parameter/status description changes are in this same user-directed increment;
qualitative eval authentication limits above remain unchanged.
