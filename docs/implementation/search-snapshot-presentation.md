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
Next: use these hits for lookup, or read a linked file now.
read target="github:anomalyco/opencode@bbd72fb8" path="..." start_line=480 end_line=490
For an exact version or ref, include it in the search target.
If fresh HEAD matters, wait for updated results (hits and order may change):
search_status search_ref="..." wait_timeout_ms=120000
```

The exact-version advice and HEAD-specific conditional appear only for proved
prior HEAD evidence. Other active results offer an optional wait for updated
results. The single read example preserves the emitted `readTarget` arguments,
including target, path, selector and bounds, rather than replacing its pinned
commit with requested HEAD. Existing per-hit locators and pagination remain.
Completed current searches keep their compact output. With no hits, active
searches retain their status next action. Ended searches needing updated evidence
require a new search; their stored reference is never offered as a poll target.

Per-target copy discloses `using commit: github:owner/repo@<sha>` and, when known,
`indexed from ref <ref>`. A historical named branch or HEAD alias is never a claim
about its current pointer. Missing or SHA-valued historical refs omit that clause.
The resolved requested commit is compared with the served commit using full SHAs;
different commits are disclosed independently from indexing state. Only
`fallback_recent`, actual matching source hits, two distinct commits, and request
kind `repo_default_branch` or `repo_head` establish prior HEAD evidence. Same-SHA
artifact refreshes and explicit branch/tag/commit intents do not qualify.
`freshnessReason=requested_ref_indexing` supplies the requested-ref indexing fact.
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
