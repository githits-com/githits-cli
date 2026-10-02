# Repository snapshots during search indexing

Initial `search` and `search_status` use the same semantic projection and text
formatter in `packages/mcp/src/shared/unified-search-presentation.ts` and
`unified-search-text.ts`. The former owns evidence and continuation decisions;
the latter owns wording and surface-native read/status commands. CLI/MCP adapters,
GraphQL selections, JSON, and explicit user wait options are unchanged. Search
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
