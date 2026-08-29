# Plan: Search client recovery and target guidance

## Status

- Overall: Phase 1 COMPLETE; Phase 1B READY; Phase 2 remains BLOCKED
- Current phase: Phase 1B — unified target-state text UX ready for implementation
- Later phase: Phase 2 — terminal backend failure details (BLOCKED on private backend #2133)
- Commits: implementation runtime `56f6003`; guidance/docs `e0057e6`; runtime/preflight
  fixes `c88194b`, `80f93a2`; privacy/wording review closure `b6c0581`.
- Final evidence: 3522 full tests pass; deterministic, build, package, and plugin
  checks pass; all four smoke modes pass; six targeted agent evaluations pass.
- Last verified: 2026-08-29

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
- CLI and MCP text render one compact target-state representation in which searched,
  indexing, terminal, stale/provisional, alternative, suggestion, and target-warning
  facts stay attached to their target, while only session-wide continuation remains
  global; and
- once the backend exposes typed terminal failure metadata, `FAILED` search sessions
  display an actionable cause without rendering opaque backend prose.

## Verified current state

### Client behavior

- `packages/mcp/src/shared/unified-search-presentation.ts` owns the projection used by
  both CLI and MCP text. Runtime commit `56f6003` maps `source === "symbol"` to
  `symbols`, preserves separate lane and target provenance, and derives a typed
  target-verification action for completed empty searches with any source-status entry
  carrying an exact terminal state.
- `packages/mcp/src/shared/unified-search-text.ts` renders target verification as
  positive family-specific guidance without a retry-later directive or fabricated
  `searchRef`; other terminal session statuses retain their existing new-search
  behavior.
- `packages/mcp/src/shared/unified-search-response.ts` preserves source statuses and
  lane-aware warning information in JSON. The defect is confined to text projection;
  the success JSON envelope does not need a compatibility change in Phase 1.
- Focused unit, CLI, MCP, and parity tests cover terminal target verification,
  distinct symbol readiness, and lane-aware warning text. Full repository validation
  and internal/external review are clean after the follow-up fixes.
- The current presentation already assembles `targetGroups`, but also exposes parallel
  top-level `targets`, `sources`, `siteSuggestions`, `trustLimits`, `warnings`, and
  `alternatives`. The text renderer consequently emits target state, target warnings,
  session facts, and target recovery in separate sections. This contradicts the
  product decision to make each target the single readable unit and repeats target,
  readiness, reference, and action context.
- Current active output renders lifecycle in the headline, target readiness in target
  blocks, and `Search <ref> | <ready>/<total> targets ready` in a later session row.
  The same `searchRef` then appears again in `Next:`. Current terminal recovery is a
  global action classified only by target family, so a multi-target caller cannot tell
  which target failed or which source lane carried `NOT_FOUND` versus
  `UNRESOLVABLE`.
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

This public githits-cli plan refers to backend work only by private backend issue
number; it does not publish the private repository name or URL.

The backend defects have been filed with runnable repros:

- private backend #2128 — exact
  `name:` qualifiers remove valid symbol matches;
- private backend #2129 — standalone
  site path prefixes are ignored;
- private backend #2130 — symbol-only
  searches can complete empty while symbols are still indexing;
- private backend #2131 — repository
  locators can leak a foreign package identity;
- private backend #2132 — identical
  code ranges can occupy separate result slots; and
- private backend #2133 — terminal
  search sessions expose no actionable failure metadata.

The Zod hosted-doc duplicate repro was added to private backend #2123.
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
7. Phase 2 starts only after private backend #2133 defines and deploys typed failure fields and their
   retryability semantics. Field names and selections are intentionally not guessed.
8. Phase 1B uses formatter-authored ASCII punctuation, preserving the existing compact
   text contract. Examples use ` | ` within summary rows and ` - ` between a target
   and its compact healthy source list.
9. Product decisions for Phase 1B are closed: hits remain a separate ranked evidence
   list; every requested target has at most one state row/block; target-specific
   `Fix:`/`Try:` guidance stays directly below that target; only session-wide actions
   use a final `Next:` line; and successful JSON envelopes remain lossless and
   unchanged.

## Architecture

The shared presentation model remains the single behavior boundary:

```text
backend search/searchStatus payload
  -> unified JSON payload (lossless structured state)
  -> shared presentation projection
       - one semantic group per target
       - source/readiness/trust/error facts attached to that group
       - target-local recovery attached to that group
       - query/session-wide continuation retained globally
  -> CLI-native or MCP-native text renderer
```

The presentation layer owns semantic classification; renderers own surface wording.
This avoids duplicating status policy in CLI and MCP commands. Target syntax remains
owned by the existing parsers and service contract; public descriptions document that
contract without introducing a second normalization layer.

Phase 1B corrects the current ownership split rather than merging strings only in the
renderer. `UnifiedSearchTargetGroup` becomes the sole renderable owner of target-scoped
identity, sources, exact terminal reason, freshness/coverage, constraints, alternatives,
site suggestions, and `Fix:`/`Try:` recovery. `UnifiedSearchPresentation` retains only
global lifecycle, availability, progress counts, query warnings, hits-related context,
and a session-wide continuation action. Projection may use local intermediate arrays,
but the returned semantic model must not expose duplicate render authorities for the
same target facts.

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
- **Token efficiency:** Phase 1B removes the standalone session row, repeated
  `searchRef`, global target recovery, and separate target-warning block. Exact-output
  tests assert one target identity and at most one target-local recovery instruction per
  requested target. This is a representation change, not a runtime performance
  optimization, so no execution benchmark is required.
- **Migration and rollback:** there is no stored data, schema migration, or rollout
  flag. Reverting the client patch restores prior text behavior without backend state
  changes.
- **Operations:** deterministic fixtures are the acceptance gate. Authenticated smoke
  validates the deployed service but transient timeouts and indexing races are recorded
  as external evidence, not hidden with retries.
- **Documentation:** stable MCP instructions and the public skill copy remain exactly
  aligned; implementation docs own lasting behavior after this plan is deleted.

## Phase map

1. **Phase 1 (COMPLETE):** CLI and MCP text give deterministic terminal-target recovery,
   preserve symbol/warning provenance, and document canonical Swift/Zig and package
   scope.
2. **Phase 1B (READY):** CLI and MCP text expose one token-efficient state list that
   keeps every transient, terminal, trust, warning, and recovery fact with its target.
3. **Phase 2 (BLOCKED):** CLI and MCP expose an actionable typed cause for terminal
   `FAILED` sessions after private backend #2133 supplies the contract.

## Phase 1: deterministic recovery and canonical guidance

**Status:** COMPLETE

Runtime behavior and focused tests are implemented in commit `56f6003`. Guidance,
durable documentation, release metadata, final repository validation, and internal
and external review are complete. Runtime/preflight fixes are recorded in `c88194b`
and `80f93a2`; privacy/wording review closure is recorded in `b6c0581`.

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
target-verification action. It is derived when a completed, empty search has any
source-status entry carrying an exact `NOT_FOUND` or `UNRESOLVABLE` state and no more
specific site suggestion or indexed alternative is available.
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

Final Phase 1 validation is complete. The full deterministic suite passes with 3522
tests, along with `bun run typecheck`, `bun run format:check`, and `bun run lint`.
Build and package validation pass with `bun run build`,
`(cd packages/mcp && bun run build)`, `bun run validate:packages`, and
`bun run validate:packages:mcp-publish`. Plugin generation and validation pass with
`bun run plugins:generate` and `bun run plugins:check`.

All four product smoke modes pass: `bun run smoke:cli`, `bun run smoke:mcp`,
`bun run smoke:cli:built`, and `bun run smoke:mcp:built`. The first live
`get_example` smoke attempt encountered a transient timeout; the rerun passed. Live
evidence covers canonical `swift:github.com/vapor/vapor` and `zig:gh/zigzap/zap`
targets, invalid short-form recovery, symbol-only labelling, and lane-aware warnings.
Six targeted agent evaluations passed across the MCP descriptor/full and skills
surfaces. Internal and external reviews are clean after runtime/preflight fixes
`c88194b` and `80f93a2`, followed by privacy/wording review closure `b6c0581`.

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
- Focused tests, the 3522-test full repository suite, type/lint/format checks, builds,
  package validation, plugin generation/check, source and built smoke suites, and six
  targeted agent evaluations complete with results recorded.
- One dual-package patch fragment exists; versions and released changelogs are
  untouched.

## Phase 1B: unified target-state text UX

**Status:** READY

**Expected outcome:** CLI human output and MCP `text-v1` present one compact semantic
list of requested targets. Each target's searched, indexing, terminal, stale or
provisional, alternative, site-suggestion, constraint, and recovery facts are readable
together. Progress is summarized in the outcome headline, target recovery is inline,
and the only final `Next:` line is a session/query-wide continuation. Ordinary healthy
results collapse to one `Sources:` row. Ranked hits remain separate.

**Assumptions:** The current backend payload is sufficient. Exact source states
`NOT_FOUND` and `UNRESOLVABLE`, existing target-resolution provenance, alternatives,
site suggestions, contributor readiness, trust limits, and query warnings are the
complete inputs for this client projection. `text-v1` can evolve in place; JSON is the
stable programmatic contract.

**Unknowns or product decisions:** none. The user selected one target-state list,
inline target recovery, a single global continuation, compact healthy collapse, and
token efficiency as a first-class acceptance constraint on 2026-08-29.

**Dependencies:** Phase 1 projection and guidance are present on this branch. No backend
change, new API field, schema change, dependency, feature flag, migration, or new
infrastructure is required. Phase 2 remains independently blocked.

### Exact text contract

Formatter-authored punctuation remains ASCII. Labels are lower-case inside compact
state rows so repeated headings do not dominate agent context. Wording may wrap at the
existing width boundary, but ordering and semantic grouping are deterministic.

The target-row vocabulary is fixed before implementation:

| Token | Meaning | Structured source |
| --- | --- | --- |
| `searched: <lanes>` | These lanes ran, including a searched empty lane. | source/contributor state `searched` |
| `indexing: <lanes>` | These lanes are transiently waiting. | source state `waiting`; target freshness `indexing`/`pending` |
| `available: <items>` | Searchable but unsearched contributors or informational site suggestions. | contributor `READY`; bounded site suggestions when no `Try:` is emitted |
| `indexed: <items>` | Bounded already-indexed versions or repository refs that are informational while another action owns continuation. | target alternatives when no `Try:` is emitted |
| `using: <served> while <fresh> indexes` | An older served identity is supplying evidence during refresh. | requested/fresh/served divergence plus stale/indexing trust |
| `<family> not found: <lanes>` | Exact terminal `NOT_FOUND`. | source `indexingStatus`/`codeIndexState` |
| `<family> unresolved: <lanes>` | Exact terminal `UNRESOLVABLE` without an explicit version/ref component. | source terminal state plus parsed requested identity |
| `version unavailable: <lanes>` / `repository ref unresolved: <lanes>` | Exact `UNRESOLVABLE` with an explicit parsed package version/repository ref. | source terminal state plus existing target parser |
| `unavailable: <lanes>` | Conservative non-terminal/unknown unavailable state. | source state `unavailable` without an exact terminal reason |
| `ignored/incompatible <feature> (<lane>): <values>` | Target-scoped constraint warning. | deduplicated constraint trust/warning fact |
| `ready` / `pending` / `indexing` / `provisional` / `older snapshot` | Lane-free target state when progress/target freshness exists without source entries. | progress target freshness |

Provisional and coverage facts qualify their source rather than adding another section:
`searched: code (provisional)` and `searched: docs (120 pages; partial)`.
`capped` uses the same coverage qualifier. Site identities remain concrete in detailed
rows (`n8n.io docs`); repository contributors remain `repository docs`. Detailed lane
order is `code`, `symbols`, `repository docs`, concrete `<site> docs`, then plain `docs`.
Segment order is `using`, `searched`, `indexing`, terminal/unavailable, `available`,
`indexed`, constraints. Empty
segments are omitted and duplicate lanes/facts are removed. When no source entry exists,
render the lane-free freshness token instead of inventing lanes from global
`requestedSources`; aggregate headline readiness does not replace per-target state.

Ordinary completed, current results collapse all healthy groups to one line:

```text
10 results | 6 repo code hits, 4 docs pages | next_offset=10
Sources: npm:express@5.2.1 - code, docs
```

Multiple healthy targets use one semicolon-delimited `Sources:` row, with each target
written once and its searched lanes following it. Repository/site contributor details
are not repeated in this compact row; ranked hit locators retain the concrete evidence
source and JSON retains full provenance.

Mixed progress and terminal state use the same target list:

```text
1 partial result | 1 repo code hit | indexing | 1/3 ready

- npm:express@5.2.1 | searched: code, docs
- pypi:fastapi | indexing: symbols
- swift:vapor | package not found: symbols
  Fix: verify registry coordinate/version; use its public GitHub repo for repo-wide search.

[1] ...

Next: githits search-status abc123 --wait 20
```

The express row in this example intentionally represents a plain `DOCS` source with no
contributors. A detailed row backed by documentation contributors uses `repository docs`
and concrete `<site> docs` identities instead.

The MCP form differs only in the surface-native final command. The `searchRef` appears
once, in that executable continuation; there is no separate `Search <ref>` session row.
The headline carries lower-case lifecycle and aggregate readiness when progress exists.
Active empty/no-snapshot forms are `No results yet | indexing | 0/1 ready` and
`No result snapshot yet | indexing | 0/1 ready`. Active result headlines preserve the
existing `partial` versus `interim` truth. Completed headlines omit lifecycle/readiness.
Terminal session headlines retain the terminal lifecycle without presenting a stopped
reference as actionable. For example, a failed progress response with no snapshot and
0/1 ready renders `No result snapshot | failed | 0/1 ready`.

The exact headline grammar is:

```text
<outcome> [| <result breakdown>] [| <lifecycle>] [| <ready>/<total> ready] [| next_offset=<n>]
```

Known lifecycle words are `preparing`, `indexing`, `searching`, `deferred`, `timeout`,
and `failed`; an unknown future status renders `status unknown` rather than raw backend
enum text. Progress readiness is included for active, terminal, and unknown progress
responses. Active results retain `partial` versus `interim`, their type breakdown, and
pagination. Completed responses omit lifecycle/readiness. The old single-target
`from <target>` suffix is removed because the target list owns identity. Terminal and
unknown progress without a snapshot use `No result snapshot | <lifecycle> | <n>/<m>
ready`; with an empty snapshot they use `No results | ...`.

Completed target failures stay local and preserve the exact reason:

```text
No results

- npm:missing | package not found: code
  Fix: verify registry coordinate/version; use its public GitHub repo for repo-wide search.
- github:owner/repo#bad-ref | repository ref unresolved: code
  Fix: verify public GitHub repository/ref.
```

`NOT_FOUND` maps to `<family> not found`. `UNRESOLVABLE` uses `version unavailable`
only when the requested package target has an explicit parsed version, and `repository
ref unresolved` only when the requested repository target has an explicit parsed ref;
otherwise it renders `<family> unresolved`. Reuse `parsePackageSpec()` and
`parseRepositoryTargetSpec()` (or their already-projected requested metadata) rather
than adding string heuristics; scoped npm names and repository refs containing `@` must
retain their existing parser semantics. Unknown non-terminal unavailable states remain
`unavailable` and are not invented into a typed error. Source lanes remain attached to
every state. Family wording is client-owned; opaque backend notes remain JSON-only.
If the same target has any searched or indexing lane, omit the family prefix and
recovery line:
render `searched: code; not found: symbols` (or `unresolved: <lanes>`). The successful
or actively indexing lane proves the target identity works, so telling the caller to
repair its coordinate would be false. Family-specific error/recovery wording applies
only when the target has no searched or indexing lane. Completed-empty and terminal
site suggestions are the explicit exception: they remain replayable `Try:` recovery
even when the site lane was searched empty.

Higher-information recovery remains preferred and local:

```text
No results

- npm:express@99 | version unavailable: code
  Try: npm:express@5.2.1 (also indexed: 5.1.0 +2)
```

When `Try:` is emitted, replayable candidates live only on that line: the first candidate
is the command-ready target and remaining bounded candidates appear as
`(also indexed: ... +N)`. Site suggestions use the same rule and preserve backend order;
the boolean truncation signal renders `+more` because no exact omitted count exists.
Candidates stay in the target row while a session-wide poll/status action owns the next
step only for a target that has no independently actionable terminal recovery. An active
site suggestion without an exact terminal reason is informational and stays in
`available:`; any site suggestion becomes `Try:`-eligible under completed-empty or
terminal/unknown-session recovery rules. If a target warrants `Try:`, its candidates live only on
that line even when poll/status for the wider session remains global. This prevents the
same candidate appearing on adjacent lines.

Replayable target composition is typed:

- a package version becomes `<registry>:<name>@<version>` using the parsed requested
  package identity without its old version;
- a repository ref becomes the canonical `github:<owner>/<repo>#<ref>` using the parsed
  repository identity;
- a site suggestion is already a replayable `site:<host[/path]>` target; and
- package `availableRefs`/`suggestedRefs` remain informational because no valid package
  target syntax can apply them. Do not invent `<package>#<ref>` or silently switch to a
  repository target.

If source-status-only input lacks an explicit requested identity, compose from the group
primary identity (`requested ?? fresh ?? served`) after stripping its old version/ref
with the existing parser. Do not compose a `Try:` target if no parseable identity exists.

A target gets at most one recovery line: a replayable indexed alternative or site target
wins over generic verification. Stable family copy is:

- package: `Fix: verify registry coordinate/version; use its public GitHub repo for repo-wide search.`
- repository: `Fix: verify public GitHub repository/ref.`
- site: `Fix: verify site host/path.`
- unknown: `Fix: verify or replace target.`

Indexing alone never gets target-local retry prose; an active final `Next:` polls once.

Target-scoped ignored/incompatible filter or query-feature warnings move into the same
target block and name the affected lane without repeating the target. Query-wide warning
strings remain in one global `Warnings:` block because they have no target owner.
Stale/provisional snapshot identity and coverage stay in the target row/block. Hits
remain a separately numbered ranked evidence list after target state. The global
`Warnings:` block, when present, appears after the target list and before hits.

For example, duplicated constraint/trust and promoted-warning representations collapse
to one group fact and one row segment:

```text
- npm:express@5.2.1 | searched: code, docs; ignored filter (docs): fileIntent
```

The hardest current fixture becomes the durable detailed-output source of truth:

```text
No results yet | indexing | 0/1 ready

- npm:n8n -> 2.36.7 | indexing: code, repository docs; available: n8n.io docs (1,480 pages; capped); indexed: versions 2.26.9, 2.26.5, 2.23.2 +2, refs HEAD, master

Next: githits search-status <search-ref> --wait 20
```

The line may wrap with the existing hanging indentation at the configured width. The
package ref candidates remain informational. There is no `Try:` because the active poll
is the session-wide next step.

When `using:` is present, omit the identity `->` resolution suffix. If the fresh identity
equals the row identity, render it only once:
`- npm:express@5.2.1 | using: 5.1.0; searched: code`. The searched lane ran against
the served snapshot. Include `while <fresh> indexes` only when `<fresh>` differs from
the row identity, for example
`- npm:express | using: 5.1.0 while 5.2.1 indexes; searched: code`.
A target-level provisional fact qualifies every searched lane for that target; a
contributor-level provisional fact qualifies only that contributor. A target-scoped
constraint without a resolvable target attaches to the sole target group when exactly
one exists; otherwise it remains a global warning with its lane attribution.

### Presentation contract and data flow

1. Extend the source/target projection to retain the exact terminal reason on the
   affected source entry instead of collapsing it to `unavailable` only. Preserve
   `NOT_FOUND` versus `UNRESOLVABLE`; do not classify `MISSING` or unknown future values.
2. Attach target-scoped constraint warnings to the matching `UnifiedSearchTargetGroup`
   using the same alias matching as sources, trust facts, alternatives, and suggestions.
   Keep only query-wide warnings at presentation scope.
3. Project one target-local recovery value per group after all facts are attached:
   replayable indexed alternative, replayable site suggestion, family-specific verify,
   or none. This replaces global `site_retry`, `indexed_alternative`, and
   `verify_target` actions. The global action union retains only poll/status,
   new-search, query-rewrite, or none. Any target-local `Fix:`/`Try:` suppresses global
   `new_search` and `query_rewrite`; those actions are allowed only when no target has
   actionable recovery. Poll/status continuation remains independent.
4. Return target groups as the single semantic render authority. Remove redundant
   top-level target/source/alternative/site/trust collections from
   `UnifiedSearchPresentation` where they are used only to re-derive target output;
   local projection intermediates are allowed. This module is shared internally and is
   not an exported JSON/API schema.
5. Derive compact healthy `Sources:` entries from target groups, not flattened source
   identities. The switch is all-or-nothing: render the single compact row only when
   every group is searched, has explicit current freshness or no non-current freshness
   signal, and is free of terminal/trust/warning/candidate/recovery facts; otherwise
   render every target as a bullet, including healthy peers.
   Compact rows collapse repository/site/general documentation contributors to `docs`
   and use `code`, `symbols`, `docs` ordering. Detailed rows preserve `repository docs`
   and concrete `<site> docs` identities. Dropping the healthy row's repository commit
   suffix is an explicit token-efficiency trade-off; JSON retains exact provenance.
   Compact identity uses `served ?? fresh ?? requested`, so the one-line source names
   the evidence actually searched.
6. Fold lifecycle and aggregate readiness into `formatPresentationOutcome()`. Delete
   the standalone session rendering path. Keep one session/query-wide action after hits,
   with `searchRef` only when that action consumes it.

Recovery/action gating is deterministic:

| Lifecycle/snapshot | Target facts | Target-local action | Global action |
| --- | --- | --- | --- |
| active, any snapshot | exact terminal reason on a target with no searched/indexing lane | `Try:` when replayable, otherwise `Fix:` | `poll` when `searchRef` exists; local recovery does not suppress it |
| active, any snapshot | exact terminal reason on a target with any searched/indexing lane | none; keep bare reason on affected lane | `poll` when `searchRef` exists |
| active, any snapshot | indexing/non-terminal alternatives only | none; show candidates in row | `poll` when `searchRef` exists |
| completed with hits | exact terminal reason on a target with no searched/indexing lane | `Try:` when replayable, otherwise `Fix:` | none, except existing `status` for an evidence notice |
| completed with hits | exact terminal reason on a target with any searched/indexing lane | none; keep bare reason on affected lane | none, except existing `status` for an evidence notice |
| completed with hits | non-terminal candidates/site suggestions | none; show candidates in row | none, except existing `status` for an evidence notice |
| completed empty | exact terminal reason on a target with no searched/indexing lane, or any site suggestion | `Try:` when replayable, otherwise `Fix:` | none |
| completed empty | exact terminal reason on a target with any searched/indexing lane | none; keep bare reason on affected lane | query rewrite for the searched-empty evidence |
| completed empty | indexing plus replayable indexed version/repository ref | `Try:` | none |
| completed empty | searched empty with no target recovery | none | query rewrite |
| completed empty | other unavailable/stale/indexing trust without replayable recovery | none | new search |
| terminal/unknown session | any target-local recovery, including suggestion-only site recovery | `Try:`/`Fix:` | none |
| terminal/unknown session | exact terminal reason on a target with any searched/indexing lane | none; keep bare reason on affected lane | none; this row takes precedence over generic new search |
| terminal/unknown session | no target-local recovery or exact lane reason | none | new search |

Any target-local recovery suppresses global `new_search` and `query_rewrite`, but never
suppresses an active `poll` or completed evidence `status`. This permits a mixed active
response to tell the caller how to repair one terminal target while polling remaining
indexing targets exactly once.

Ownership check: target state belongs to `UnifiedSearchTargetGroup`; lifecycle and
continuation belong to `UnifiedSearchPresentation`. The earlier friction came from the
same target concept being owned by both the group and the global action/warning
collections. This boundary correction is smaller and more maintainable than adding
renderer-only suppression rules.

### Affected components

- `packages/mcp/src/shared/unified-search-presentation.ts`: target/source semantic
  types, exact terminal classification, target warning/recovery projection, and the
  reduced global action/presentation contract.
- `packages/mcp/src/shared/unified-search-text.ts`: compact healthy sources, one-row
  target grammar, inline `Fix:`/`Try:`, headline progress, query warnings, and global
  continuation.
- `packages/mcp/src/shared/unified-search-presentation.test.ts`: pure projection and
  precedence coverage.
- `packages/mcp/src/shared/unified-search-text.test.ts` and
  `packages/mcp/src/shared/unified-search-status-text.test.ts`: exact representative
  output plus structural invariants.
- Existing CLI/MCP tool, command, parity, and smoke tests whose structural assertions
  cover search/search-status text. Update only assertions affected by the intentional
  text-v1 change; JSON fixtures remain unchanged.
- `packages/mcp/src/smoke-test.ts` and `scripts/cli-smoke.ts`: replace the public MCP
  smoke helper and CLI smoke assumptions that require the deleted `Search <ref> | ...`
  row or capitalized detail labels. Keep structural assertions for one target list, one
  continuation, and `searchRef` appearing exactly once on the `Next:` line without
  depending on obsolete prose.
- `docs/implementation/tools.md` and `docs/implementation/cli-commands.md`: lasting
  target-state ownership, grammar, examples, and continuation contract.
- `changes/search-client-recovery.fixed.md`: expand the existing unreleased dual-package
  patch fragment; do not create a second fragment for the same search recovery effort.

No MCP description, input schema, stable instruction, public Agent Skill, generated
plugin asset, service query, or response-envelope file should change. If implementation
evidence contradicts that boundary, stop and replan before editing it.

### Edge cases and precedence

- One target with several lanes produces one row; lanes of the same state are
  deduplicated and ordered deterministically.
- Multiple requested targets that resolve or serve aliases remain distinct when their
  requested identities differ. Existing alias matching must not merge two requests.
- Exact terminal reason outranks generic `unavailable` even when target freshness also
  says `indexing`; this preserves the Phase 1 precedence fix.
- A searched empty lane stays `searched`, not `unavailable`. A contributor `READY`
  remains available but not searched. `MISSING` and unknown future source states remain
  conservative `unavailable`.
- A stale served identity is stated once. Provisional, partial/capped coverage, and
  target-scoped constraints remain visible without a second warning section.
- A terminal target with no searched/indexing lane plus a concrete alternative/suggestion
  uses `Try:` only. Without a replayable candidate it uses `Fix:`. No target emits both.
  Completed-empty and terminal site suggestions remain `Try:`-eligible after a searched
  empty site lane.
- An explicit package version or repository ref is required before `UNRESOLVABLE` can
  be described as version/ref-specific. Unversioned packages and implicit-ref
  repositories use family-level `unresolved` wording.
- Query rewrite remains a single global `Next:` because it changes the whole search.
  Terminal session `DEFERRED`, `TIMEOUT`, `FAILED`, and unknown statuses keep the current
  non-polling new-search policy only when no target-local recovery or exact bare lane
  reason exists; Phase 2 still owns richer session-failure semantics.
- ANSI changes emphasis only. Removing color from CLI output must leave MCP-equivalent
  hierarchy and wording except for the final surface-native command.

### Verification strategy

Implement test-first at the pure presentation/text layers. Exact-output tests are
required for the four representative contracts above, the n8n contract, and a
multi-target warning/trust case. Use a wide explicit test width for exact semantic
grammar and separate default-80/narrow-width assertions for hanging continuation lines,
so wrapping does not obscure state-contract failures. Structural tests must additionally
prove:

- each requested target identity appears once in the target-state area;
- `NOT_FOUND` and `UNRESOLVABLE` remain distinguishable and retain their source lane;
- versioned/unversioned packages and explicit/implicit repository refs receive only the
  specificity justified by their parsed requested identity;
- each target has zero or one inline `Fix:`/`Try:` line and no target-specific global
  `Next:` line;
- a target with both searched and exact-terminal lanes renders the bare terminal reason
  on that lane and no coordinate-level recovery;
- an active response has one global continuation and one `searchRef` occurrence;
- progress readiness appears in the headline and no `Search <ref>` session row remains;
- ordinary healthy output has one `Sources:` row and no target bullets;
- omitted freshness remains compact when no non-current signal exists;
- progress-only targets render exact lane-free states with and without global
  `requestedSources`, without inventing per-target lanes;
- target warnings are inline, query warnings remain global, and neither is duplicated;
- a `FAILED` response with `NOT_FOUND` renders its inline `Fix:` and no global rerun;
- a completed evidence `status` can coexist with one target-local `Try:` without
  repeating its candidates;
- row candidates use `indexed:` consistently with `Try:` parentheticals, and package
  refs never become replayable targets;
- stale/provisional/coverage and site-truncation facts remain visible;
- CLI/MCP no-color output differs only in surface-native continuation syntax;
- successful CLI `--json` and MCP `format: "json"` payloads and error envelopes are
  byte-for-byte/structurally unchanged for shared fixtures.

Run focused presentation/text/status tests after each slice, then affected CLI/MCP/parity
tests. Final deterministic validation is `bun test`, `bun run typecheck`,
`bun run format:check`, `bun run lint`, `bun run build`, MCP package build,
`bun run validate:packages`, `bun run validate:packages:mcp-publish`, all four required
source/built CLI/MCP smoke modes, and targeted `bun run agent:e2e` workloads that inspect
mixed target state and continuation behavior. Agent evaluation must inspect actual tool
calls and final output for scanability and futile-retry behavior; it is qualitative
evidence, not a deterministic gate. Do not expose credentials or add retry machinery to
make live checks pass.

### Documentation and release record

Update the two implementation documents from the old five-section anatomy to the new
single target-state contract and replace the representative n8n output. Keep the plan
until Phase 2 completes; record Phase 1B commits and observed verification here after
implementation. Expand the existing change fragment to mention unified target-state
text and inline recovery. Versions and `CHANGELOG.md` remain untouched.

### Plan review record

- Internal technical review accepted two findings: target-local recovery suppresses
  futile global reruns/rewrites, and version/ref-specific `UNRESOLVABLE` wording requires
  an explicit parsed component. The speculative possibility that both backend status
  fields carry conflicting exact terminal values was rejected for lack of fixture or
  contract evidence; JSON remains the lossless diagnostic surface.
- Its closure pass accepted three normal-shape clarifications: lane-free progress target
  states, candidate placement when global status and target-local `Try:` coexist, and
  compact eligibility when healthy lean payloads omit freshness.
- Fresh Fable UX review round 1 accepted nine specification gaps: complete state tokens
  and n8n output, stable family recovery copy, non-repeating candidate placement,
  replayable target composition, lifecycle/action gating, all-or-nothing compact mode,
  headline grammar, inline warning deduplication, and public smoke-helper coverage.
- Fable's request to rename `search-client-recovery.fixed.md` to `.changed.md` was
  rejected. The single unreleased fragment describes this PR's overall terminal-recovery
  bug fix; the UX consolidation is the fix's final text representation, not a separate
  release category. The bullet will name both effects.
- Fable round 2 accepted four remaining contract contradictions and eight precision
  gaps: active result breakdown, active site-suggestion gating, mixed searched/terminal
  lane recovery, detailed docs fixture shape, non-repeating stale identity, provisional
  qualification, deterministic lane/warning/outcome order, consistent `indexed:` copy,
  identity fallbacks, completed-hit candidate gating, compact served identity, and the
  exactly-once smoke reference assertion. No product decision or scope expansion was
  required.
- Fable round 3, the final external plan round, verified all prior closures and found two
  exact-output corrections plus three precision items. They were closed without another
  external round: `using:` now states a fresh identity only when it differs from the row;
  completed-empty and terminal suggestion-only site recovery remains actionable; matrix
  precedence distinguishes a bare exact lane reason from generic terminal rerun; the
  terminal no-snapshot example includes readiness; and coordinate recovery requires no
  searched or indexing lane. No unresolved major finding or product decision remains.

### Phase 1B acceptance criteria

- The exact representative healthy, mixed, terminal, and alternative outputs satisfy
  the contract above in CLI syntax, with MCP differing only in the final command.
- All target-scoped transient, terminal, trust, warning, alternative, suggestion, and
  recovery facts render under one target identity; there is no separate in-progress,
  unavailable, target-warning, or target-recovery list.
- Only query/session-wide guidance renders as final `Next:`. Active continuation contains
  the sole visible `searchRef`; stopped terminal references are not rendered.
- Exact terminal reasons and lanes remain human/agent readable without raw backend prose;
  unknown states remain conservative.
- Healthy output collapses to one target-plus-lanes `Sources:` row; ranked hits and
  structured JSON remain unchanged.
- Presentation, renderer, CLI/MCP/parity, smoke, full repository, package, and targeted
  agent-eval validation pass with evidence recorded in this plan.
- Durable implementation docs and the existing dual-package patch fragment reflect the
  final behavior; package versions, released changelogs, descriptors, skills, generated
  assets, and backend requests remain unchanged.

## Phase 2: terminal backend failure details

**Status:** BLOCKED

**Expected outcome:** A terminal `FAILED` search session exposes a bounded, typed cause
and an action consistent with backend-declared retryability while preserving any
returned evidence.

**Assumptions:** Private backend #2133 will expose stable machine-readable failure and
retryability data on every search progress surface that can terminate as `FAILED`.

**Unknowns or product decisions:** exact field names, failure categories, message trust
contract, and retry semantics. Private backend #2133 and a deployed schema resolve these before
Phase 2 can become READY.

**Dependencies:** private backend #2133 implemented, deployed, and documented; Phase 1 merged
and reoriented against current `origin/main`.

### Entry gate

Start only after private backend #2133 is implemented, deployed, and documents:

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

- Client-side workarounds for private backend #2128–#2132 or private backend #2123.
- Swift/Zig aliases, fuzzy resolution, automatic repository discovery, or registry
  identity inference.
- Changing successful JSON envelopes in Phase 1.
- New flags, caches, queues, locks, feature flags, retry timers, or polling loops.
- Treating `crates:serde` as repository-wide; `serde_core` remains outside that
  package target by design.
- Filing or coding around the single transient GraphQL timeout without reproducible
  evidence.

## Phase boundary and completion

Phase 1 is complete in the recorded commits above. Phase 1B is the current ready
increment and stays within the existing client-owned text projection. After Phase 1B
implementation and review, record its commits and observed evidence here before pushing
the updated draft PR. Use a fresh `origin/main` comparison before beginning Phase 2, and
do not mix speculative Phase 2 fields into the client UX increment.

This plan remains active while private backend #2133 blocks Phase 2. After both phases are implemented,
transfer all lasting contracts to `docs/implementation/`, verify no unresolved work
remains, and delete this plan. If the backend contract makes Phase 2 unnecessary or
materially different, revise the plan with the verified contradiction rather than
leaving stale instructions.
