# Repository snapshots during search indexing

Initial `search` and `search_status` use the same semantic projection and text
formatter in `packages/mcp/src/shared/unified-search-presentation.ts` and
`unified-search-text.ts`. The former owns evidence and continuation decisions;
the latter owns wording and surface-native read/status commands. CLI/MCP adapters,
Explicit user wait options are unchanged; commit-date metadata is described below. Search
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
Completed current searches keep their compact output. With no hits, active
searches retain their status next action. Ended searches needing updated evidence
require a new search; their stored reference is never offered as a poll target.

Per-target copy discloses `commit: github:owner/repo@<sha>` and, when known,
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
dates without new calls. The separate public `list` and `grep` services have their
own queries and do not gain dates in this increment. No mode-specific fetch
is needed: both compact text and JSON consume these two timestamps.

The root cause of missing dates was omission at every existing shared boundary:
the GraphQL selection did not request the field; schema parsing, service
normalization and lean whitelisting discarded it; the snapshot projection/text
had no date clause. The fix extends those owners rather than adding a lookup.
The semantic presentation slices the verified UTC timestamp's first ten
characters into a calendar date, gated by the existing served/full-SHA evidence
and requested-commit difference checks. JSON retains the full timestamp.

Example of the shared compact target details, before normal width wrapping:

```text
commit: github:owner/repo@aaaaaaaa (committed 2026-09-01, indexed from ref HEAD); requested HEAD resolves to a different commit (committed 2026-10-05) and is indexing; searched: code
```

With only the requested date known:

```text
commit: github:owner/repo@aaaaaaaa (indexed from ref HEAD); requested HEAD resolves to a different commit (committed 2026-10-05) and is indexing; searched: code
```

With no historical ref, a known served date stands alone as
`(committed 2026-09-01)`. Unknown date clauses disappear without a placeholder.
Same-SHA snapshots show only their independently known served date; requested
metadata is never borrowed for it. Healthy current results keep their compact
text and full dates in JSON. An old current HEAD date does not make it stale.
The existing exact readTarget, use-hits-now action, conditional wait, lifecycle,
partial/completeness signals, attribution and zero-hit/withheld rules are unchanged.

**Rollout prerequisite:** confirm production backend schema deployment before
client release or hosted MCP adoption. This increment was verified against the
supplied backend dev records, not production. If deployed too early, all `read` requests fail GraphQL validation because
`ReadService` has no schema fallback and its document includes the field for code
and docs reads alike. Search/status and legacy navigation instead make sequential
fallback retries before dropping all `targetResolution`, losing served provenance
and prior-HEAD advice.
No new fallback is added. The user owns release; hosted clients additionally need
`@githits/mcp` release, remote-mcp dependency adoption and deployment.

Commit-date verification:

- Focused 14-file checks: 668 tests pass, zero failures, 3,258 expectations. Covered shared core
  search/status transport and progress, exact read transport and JSON, lean
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

## Verification for this increment

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
