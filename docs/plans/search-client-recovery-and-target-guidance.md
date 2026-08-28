# Plan: Search client recovery and target guidance

## Status

- Overall: IMPLEMENTED — FINAL VALIDATION/REVIEW PENDING
- Current phase: Phase 1 — deterministic client recovery and canonical target
  guidance implemented; final validation/review pending
- Later phase: Phase 2 — terminal backend failure details (BLOCKED on backend #2133)
- Runtime implementation: commit `56f6003`; focused runtime evidence: 329 tests
  pass and typecheck passes.
- Last verified: 2026-08-28

## Problem and expected outcome

The unified search backend already returns enough structured state for the client to
distinguish invalid or unresolvable targets, symbol results, and the lane that ignored
a filter. The shared CLI/MCP text projection discards those distinctions:

- `NOT_FOUND` and `UNRESOLVABLE` sources become `Next: rerun search later`, which
  sends callers into a futile retry loop;
- `SYMBOL` readiness is presented as `code`, so a symbol-only search can look as if
  the wrong lane ran; and
- ignored-filter warnings retain the target but lose the source lane, so a docs-lane
  warning can appear to describe the whole target.

Separately, all public target guidance describes package coordinates as generic
`registry:name[@version]`. That is incomplete for Swift and Zig, whose verified
canonical identities are repository-shaped package names. It also does not explain
that package targets are artifact/manifest-root scoped rather than full-repository
searches.

When this plan is complete:

- terminal target failures tell CLI and MCP text callers to verify or replace the
  target without advising an unchanged retry;
- symbol readiness is labelled as symbols, independently from code readiness;
- ignored-filter text identifies both the lane and target;
- search help, schemas, stable MCP guidance, and public Agent Skill guidance include
  verified Swift/Zig forms and the package-versus-repository scope boundary; and
- once the backend exposes typed terminal failure metadata, `FAILED` search sessions
  display an actionable cause without rendering opaque backend prose.

## Verified current state

### Client behavior

- `packages/mcp/src/shared/unified-search-presentation.ts` owns the projection used by
  both CLI and MCP text. Runtime commit `56f6003` maps `source === "symbol"` to
  `symbols`, preserves separate lane and target provenance, and derives a typed
  target-verification action for completed empty exact terminal source states.
- `packages/mcp/src/shared/unified-search-text.ts` renders target verification as
  positive family-specific guidance without a retry-later directive or fabricated
  `searchRef`; other terminal session statuses retain their existing new-search
  behavior.
- `packages/mcp/src/shared/unified-search-response.ts` preserves source statuses and
  lane-aware warning information in JSON. The defect is confined to text projection;
  the success JSON envelope does not need a compatibility change in Phase 1.
- Focused unit, CLI, MCP, and parity tests cover terminal target verification,
  distinct symbol readiness, and lane-aware warning text. The final repository
  validation and review remain pending.
- `packages/mcp/src/shared/package-spec.ts` validates registry and syntax only. It
  deliberately does not own backend package identity conventions.

### Target guidance

Canonical target guidance was incomplete across these user-facing boundaries; the
owned guidance surfaces below now carry the verified forms and scope boundary:

- the CLI search description and `--in` option in `src/commands/search.ts`;
- the MCP search target schema in `packages/mcp/src/tools/search.ts`;
- the code-navigation target schema in
  `packages/mcp/src/tools/code-navigation-shared.ts`;
- the stable MCP quick-start preamble in
  `packages/mcp/src/mcp/instructions.ts` and its exact public skill copy in
  `skills/githits-mcp/SKILL.md`;
- `skills/githits-code/references/code-and-docs.md`;
- the target syntax in `docs/implementation/cli-commands.md`; and
- the text/search scope contracts in `docs/implementation/tools.md`, which need the
  missing package-scope and recovery rules rather than replacement syntax wording.

Live smoke evidence established these canonical forms:

- Swift: `swift:github.com/<owner>/<repo>`;
- Zig: `zig:gh/<owner>/<repo>`.

Short forms such as `swift:vapor`, `swift:vapor/vapor`, and
`zig:zigzap/zap` returned `NOT_FOUND`. Client-side alias normalization would be
guesswork and would conflict with backend canonical identity ownership.

### Backend issue boundary

The backend defects have been filed with runnable repros:

- [#2128](https://github.com/githits-com/pkgseer-backend/issues/2128) — exact
  `name:` qualifiers remove valid symbol matches;
- [#2129](https://github.com/githits-com/pkgseer-backend/issues/2129) — standalone
  site path prefixes are ignored;
- [#2130](https://github.com/githits-com/pkgseer-backend/issues/2130) — symbol-only
  searches can complete empty while symbols are still indexing;
- [#2131](https://github.com/githits-com/pkgseer-backend/issues/2131) — repository
  locators can leak a foreign package identity;
- [#2132](https://github.com/githits-com/pkgseer-backend/issues/2132) — identical
  code ranges can occupy separate result slots; and
- [#2133](https://github.com/githits-com/pkgseer-backend/issues/2133) — terminal
  search sessions expose no actionable failure metadata.

The Zod hosted-doc duplicate repro was added to existing backend
[#2123](https://github.com/githits-com/pkgseer-backend/issues/2123).
The CLI must not locally deduplicate results, repair locators, reinterpret site scope,
or synthesize symbol indexing state for these backend-owned defects.

## Assumptions and decisions

1. Phase 1 handles only exact verified source statuses `NOT_FOUND` and
   `UNRESOLVABLE` as target-verification failures. Unknown future statuses retain
   conservative generic behavior rather than being guessed.
2. Existing higher-information recovery remains preferred: a backend-provided site
   suggestion or indexed alternative is rendered before generic target verification.
3. Text advice is client-owned and typed. Backend `note` strings remain structured
   JSON data and are not copied into terminal/MCP text.
4. Package target guidance documents canonical inputs; it does not add aliases, fuzzy
   resolution, new flags, or automatic repository fallback.
5. Package targets inspect the indexed package artifact or manifest root. Repository
   targets are the supported escape hatch for full monorepos and sibling packages.
6. `text-v1` evolves in place. The root CLI and public `@githits/mcp` package
   both receive patch-level change fragments; feature PRs do not bump package
   versions or edit released changelogs.
7. Phase 2 starts only after #2133 defines and deploys typed failure fields and their
   retryability semantics. Field names and selections are intentionally not guessed.

## Architecture

The shared presentation model remains the single behavior boundary:

```text
backend search/searchStatus payload
  -> unified JSON payload (lossless structured state)
  -> shared presentation projection
       - source labels
       - lane-aware warnings
       - typed recovery action
  -> CLI-native or MCP-native text renderer
```

The presentation layer owns semantic classification; renderers own surface wording.
This avoids duplicating status policy in CLI and MCP commands. Target syntax remains
owned by the existing parsers and service contract; public descriptions document that
contract without introducing a second normalization layer.

Phase 1 changes only pure request-independent projection and text functions plus
descriptors/docs. It needs no service mock, dependency injection, container change, or
additional API field. Existing payload fixtures test it deterministically at the
presentation, CLI, MCP tool, and parity layers.

## Cross-cutting constraints

- **Security:** target labels and backend notes are untrusted text. The new action must
  not interpolate additional backend prose or synthesize an executable command. The
  broader search-metadata sanitation gap remains owned by
  `docs/plans/terminal-text-sanitization.md` rather than being duplicated here.
- **Performance:** Phase 1 adds pure projection over the existing bounded source-status
  list and no network fields or requests. It is not an optimization and needs no new
  benchmark.
- **Compatibility:** structured JSON remains stable in Phase 1. `text-v1` wording
  changes intentionally in place, with CLI/MCP parity maintained.
- **Migration and rollback:** there is no stored data, schema migration, or rollout
  flag. Reverting the client patch restores prior text behavior without backend state
  changes.
- **Operations:** deterministic fixtures are the acceptance gate. Authenticated smoke
  validates the deployed service but transient timeouts and indexing races are recorded
  as external evidence, not hidden with retries.
- **Documentation:** stable MCP instructions and the public skill copy remain exactly
  aligned; implementation docs own lasting behavior after this plan is deleted.

## Phase map

1. **Phase 1 (IMPLEMENTED — FINAL VALIDATION/REVIEW PENDING):** CLI and MCP text give deterministic terminal-target recovery,
   preserve symbol/warning provenance, and document canonical Swift/Zig and package
   scope.
2. **Phase 2 (BLOCKED):** CLI and MCP expose an actionable typed cause for terminal
   `FAILED` sessions after backend #2133 supplies the contract.

## Phase 1: deterministic recovery and canonical guidance

**Status:** IMPLEMENTED — FINAL VALIDATION/REVIEW PENDING

Runtime behavior and focused tests are implemented in commit `56f6003`. The
guidance, durable documentation, and release metadata are now implemented; final
repository validation and review remain pending.

**Expected outcome:** An invalid or unresolvable target cannot send a text caller into
an unchanged retry loop; symbol readiness and ignored-filter warnings identify the
actual lane; every relevant public search-addressing surface teaches the verified
Swift/Zig forms and package-scope boundary.

**Assumptions:** The exact source states `NOT_FOUND` and `UNRESOLVABLE` are terminal;
the existing canonical target label is sufficient to distinguish package, GitHub
repository, standalone site, and unknown display families.

**Unknowns or product decisions:** none.

**Dependencies:** no backend change. Existing shared unified-search presentation and
text contracts remain the implementation boundary.

### 1. Represent terminal target recovery explicitly

Implemented in runtime commit `56f6003`: the shared action model has one typed
target-verification action. It is derived
only when a completed, empty search contains an exact `NOT_FOUND` or `UNRESOLVABLE`
source state and no more specific site suggestion or indexed alternative is available.
Evaluate exact terminal states carried by `indexingStatus` or `codeIndexState` after
site suggestions and indexed alternatives but before the generic
`hasIndexingTrustSignal` path. This precedence is required because a terminal
`UNRESOLVABLE` source may also carry target-resolution freshness `indexing`.

Carry the deduplicated display families represented by all affected source entries:
package, GitHub repository, standalone site, or unknown. Derive those families from the
already-canonical target labels; do not rewrite the request or interpolate a new copy of
backend target text into the action.

Render concise, surface-neutral guidance:

- package: verify the registry package coordinate and version; if the coordinate is
  correct but repository-wide evidence is needed, use its public GitHub repository;
- repository: verify the public GitHub repository and ref;
- site: verify the standalone site host/path; and
- unknown: verify or replace the unavailable target.

Render one deduplicated positive guidance line per affected family. Do not emit
`rerun search later`, fabricate a `searchRef`, or turn terminal state into polling.
Preserve current polling for active sessions and current new-search handling for
terminal `DEFERRED`, `TIMEOUT`, `FAILED`, and unknown session statuses until Phase 2
supplies better evidence.

### 2. Preserve symbol and warning provenance

Implemented in runtime commit `56f6003`: `symbols` is part of
`UnifiedSearchSourceKind` and backend `SYMBOL` source status maps to it. Source
ordering, compact labels, readiness summaries, empty-result summaries, and
action-related text keep code and symbol lanes distinct. A symbol-only completed search must
say `Searched: symbols`; code and symbol lanes must remain separately visible when
both are present.

Change both constraint trust facts and projected ignored-filter warnings to carry
separate normalized backend lane and target fields, rather than storing a target in
the misleading `source` field. Normalize known `AUTO`, `CODE`, `DOCS`, and `SYMBOL`
values to lowercase. Preserve an unknown non-empty source as lowercase pass-through
instead of dropping the warning. Keep presentation source kinds such as `site_docs`
separate from the raw query lane. Render target-scoped source warnings as, for example,
`Ignored filter (docs on npm:express): fileIntent`. Query-wide warnings keep their
current query attribution. JSON warning and source-status shapes remain unchanged.

### 3. Correct canonical target guidance

The implementation updates all verified user-facing target descriptions listed above
with two compact rules:

- Swift package names use `github.com/<owner>/<repo>` after `swift:`; Zig package
  names use `gh/<owner>/<repo>` after `zig:`.
- Package targets are artifact/manifest-root scoped; use a public GitHub repository
  target for the full repository or sibling packages.

Keep the CLI search help compact and put the longer explanation in its description and
implementation docs. Update the shared code-navigation schema because it exposes the
same package target contract to `code_files`, `code_read`, and `code_grep`; do not
change those tools' first-80-character selection descriptions.

`PACKAGE_TOOLS_PREAMBLE` and the exact corresponding paragraph in
`skills/githits-mcp/SKILL.md` were updated together. Generated plugin assets were
not edited directly; generation was run from canonical inputs and its empty diff
was inspected.

### 4. Tests

Implemented focused cases in the shared presentation/text tests and the existing
CLI/MCP search tests. They cover:

- `NOT_FOUND` and `UNRESOLVABLE` package, repository, and site sources produce the
  verification action and never contain `rerun search later`;
- multi-target and mixed-family terminal sources produce one deduplicated action
  line per represented family without dropping the package-scope hint;
- a live-shaped `UNRESOLVABLE` fixture with target-resolution freshness `indexing`
  still selects target verification after alternatives and before generic indexing;
- site suggestions and indexed alternatives remain higher-priority actions;
- active indexing still produces a polling action and `searchRef`;
- terminal session `FAILED` remains non-polling pending Phase 2;
- symbol-only, code-only, and mixed source readiness render distinct labels;
- a docs-lane ignored filter identifies `docs on <target>` and does not imply the code
  lane ignored it;
- constraint trust facts and warning facts agree on the raw lane/target pair, including
  symbol, hosted-doc, `AUTO`, and unknown-source cases;
- JSON payload regressions prove source status, warnings, hits, and error envelopes are
  unchanged; and
- CLI/MCP parity covers the new recovery action and provenance wording.

Descriptor/help contract assertions cover the Swift/Zig examples and package-scope
wording while preserving first-80 tool-description contracts. The MCP quick-start
parity test (`src/skills-packaging.test.ts`) and existing CLI registration/help tests
were updated instead of adding snapshots. The current
`MISSING`/`UNRESOLVABLE`/`FUTURE_STATE` table test was split: only `UNRESOLVABLE`
changes; `MISSING` and unknown future state keep conservative `new_search`
behavior.

### 5. Documentation and release record

Implemented in the owned documentation and guidance files: `cli-commands.md` and
`tools.md` now describe typed terminal recovery, the distinct symbol lane, warning
attribution, canonical Swift/Zig coordinates, and package/repository scope. Durable
target-failure guidance uses positive verification rather than retry-later wording.
The CLI target documentation's registry-prefix list mirrors canonical
`PKGSEER_REGISTRY_ARGS`, including Swift, RubyGems, and Go.

Added one independent `changes/search-client-recovery.fixed.md` fragment with:

```markdown
---
"githits": patch
"@githits/mcp": patch
---

- **Search recovery and target guidance** - Correct terminal target recovery,
  source provenance, and canonical package addressing.
```

The fragment describes corrected terminal recovery and target guidance in one
user-visible bullet. `CHANGELOG.md` and package versions remain untouched.

### 6. Verification

Run focused tests first, then the required repository checks:

```text
bun test <focused test files listed in Phase 1 section 4>
bun run plugins:generate
bun run plugins:check
bun test
bun run typecheck
bun run format:check
bun run lint
bun run build
(cd packages/mcp && bun run build)
bun run validate:packages
bun run validate:packages:mcp-publish
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

With authenticated live access, verify valid
`swift:github.com/vapor/vapor` and `zig:gh/zigzap/zap` searches, invalid short-form
recovery, symbol-only labelling, and lane-aware warnings. Record any live rate limit or
transient timeout exactly; do not weaken deterministic tests around it.

Because stable MCP instructions and public Agent Skill guidance change, run targeted
`bun run agent:e2e` workloads on the MCP descriptor/full profiles and the skills
surface with both Codex and Claude when practical. Inspect `tool-calls.json` and
`final.json` for canonical target use, absence of retry loops, `toolIssues`,
`instructionIssues`, and usefulness rather than relying on harness exit status.

### Phase 1 acceptance criteria

- CLI and MCP `text-v1` outputs for terminal `NOT_FOUND` and `UNRESOLVABLE` sources
  contain target-verification guidance, contain no unchanged retry-later advice, and
  expose no `searchRef`.
- Active progress still polls; site suggestions and indexed alternatives remain the
  preferred recovery when supplied.
- Symbol-only output says `symbols`, mixed code/symbol readiness keeps both lanes, and
  source warning text identifies both lane and target.
- Successful JSON payload schemas, values, and error envelopes are unchanged for the
  same service fixture.
- CLI help, MCP argument schemas, stable MCP instructions, and public skill guidance
  include the verified Swift/Zig forms and artifact/manifest-root scope rule.
- Focused tests, full repository checks, plugin generation/check, package validation,
  source and built smoke suites, and targeted agent-eval inspection complete with
  results recorded.
- One dual-package patch fragment exists; versions and released changelogs are
  untouched.

## Phase 2: terminal backend failure details

**Status:** BLOCKED

**Expected outcome:** A terminal `FAILED` search session exposes a bounded, typed cause
and an action consistent with backend-declared retryability while preserving any
returned evidence.

**Assumptions:** Backend #2133 will expose stable machine-readable failure and
retryability data on every search progress surface that can terminate as `FAILED`.

**Unknowns or product decisions:** exact field names, failure categories, message trust
contract, and retry semantics. Backend #2133 and a deployed schema resolve these before
Phase 2 can become READY.

**Dependencies:** backend #2133 implemented, deployed, and documented; Phase 1 merged
and reoriented against current `origin/main`.

### Entry gate

Start only after backend #2133 is implemented, deployed, and documents:

- a stable machine-readable failure code or category;
- a bounded display-safe message or client-owned mapping input;
- retryability and whether a fresh search can help; and
- field availability on both initial search and `search_status` progress responses.

Re-run discovery against the deployed GraphQL schema before writing the detailed
increment. Report any contradiction with this plan immediately.

### Expected outcome

Select the smallest failure fields needed by every actual consumer. Compare the query
against compact text, verbose/text-v1, JSON, MCP, CLI, and internal callers before
changing it. Use conditional selections if detailed fields are mode-specific and add
wire-query tests proving compact modes do not over-fetch.

Project typed terminal failure data through the shared payload and presentation model.
Render an actionable client-owned cause and recovery for `FAILED`; poll only when the
backend explicitly marks the state retryable and supplies a valid continuation
reference. Preserve any returned evidence. Never render opaque backend prose directly
or add timer/retry machinery.

Update durable docs, add a separate dual-package patch fragment, and run the same
build, package, smoke, and agent-eval verification appropriate to changed MCP behavior.

### Phase 2 acceptance criteria

- Every deployed typed failure category has an explicit client projection and tested
  recovery action; unknown categories fail conservatively without polling.
- CLI, MCP text, and JSON preserve terminal evidence and expose consistent failure
  semantics without rendering opaque backend prose.
- GraphQL wire tests prove compact consumers fetch no unneeded failure detail and every
  consumer that renders the cause selects the required fields.
- No timer, retry loop, or caller-ordering constraint is introduced.
- Durable docs, a separate dual-package patch fragment, full package validation, live
  smoke, and relevant agent-eval evidence are complete.

## Non-goals

- Client-side workarounds for backend #2128–#2132 or hosted-doc #2123.
- Swift/Zig aliases, fuzzy resolution, automatic repository discovery, or registry
  identity inference.
- Changing successful JSON envelopes in Phase 1.
- New flags, caches, queues, locks, feature flags, retry timers, or polling loops.
- Treating `crates:serde` as repository-wide; `serde_core` remains outside that
  package target by design.
- Filing or coding around the single transient GraphQL timeout without reproducible
  evidence.

## Phase boundary and completion

After Phase 1, commit the complete increment and use a fresh `origin/main` comparison
before beginning Phase 2. Do not mix speculative Phase 2 fields into the first PR.

This plan remains active while #2133 blocks Phase 2. After both phases are implemented,
transfer all lasting contracts to `docs/implementation/`, verify no unresolved work
remains, and delete this plan. If the backend contract makes Phase 2 unnecessary or
materially different, revise the plan with the verified contradiction rather than
leaving stale instructions.
