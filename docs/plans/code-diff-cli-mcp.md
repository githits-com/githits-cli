# Plan: Raw code diff CLI and MCP surface

> Overall status: ready for Phase 1; Phase 2 ergonomics require focused design
> against the accepted Git-like direction and the narrower backend glob
> contract.
>
> Reoriented: 2026-08-17 against `githits` `origin/main` at `57619e8`,
> PkgSeer backend `main` at `91d4b2079`, and GraphQL schema hash
> `sha256:e7046c0af330`.

## Problem and expected outcome

Package changelogs are often missing or too abstract to explain an upgrade.
GitHits should expose PkgSeer's authoritative raw `codeDiff` evidence through:

- `githits code diff` for humans and shell automation; and
- `code_diff` for agents.

Both surfaces must compare the exact resolved `from` and `to` trees, return
bounded source-file evidence, distinguish missing content from an empty diff,
and preserve enough exact identity for `code_read` follow-ups. They must not
claim compatibility, safety, or semantic impact that the raw patch does not
prove.

The completed effort also lets package-changelog responses steer callers to
the stable diff operation through typed data. Structural/symbol diff remains a
separate, unexposed backend capability.

## Verified current state

### Repository state

- The working branch was rebased on 2026-08-17 and exactly matches
  `origin/main` at `57619e8`; it has no branch-only commits.
- No CodeDiff client, CLI command, MCP tool, response formatter, or changelog
  action consumer exists in the current GitHits tree.
- `CodeNavigationService` owns source navigation and is the verified service
  boundary for the new operation. CLI commands live under `src/commands/code/`;
  MCP tools and shared request/response modules live under
  `packages/mcp/src/tools/` and `packages/mcp/src/shared/`.
- Root `githits` is version `0.9.2`; public `@githits/mcp` is version `0.9.1`.
  User-visible implementation will require one independent changelog fragment
  with pending impacts for both artifacts. Version bumps happen during release
  preparation, not feature implementation.
- `CodeNavigationService` and `CodeNavigationServiceImpl` are publicly
  re-exported through `@githits/mcp/client`, and `CodeNavigationService` is part
  of public `McpToolServices`. Phase 1 therefore adds public client API even
  though it adds no MCP tool or CLI command. Custom service implementations
  must add the required method when adopting that package version.

### Backend contract

PkgSeer commit `59f0f0283` replaced GitHub Compare with credential-free aigrep
RawDiff. That commit is an ancestor of backend `main`; backend commit
`9a90e294d` retired its completed CodeDiff plan after transferring the lasting
contract to `docs/implementation/CODE_DIFF.md`.

The committed GraphQL schema and implementation now prove:

- `codeDiff` resolves package versions or repository refs to full immutable
  commit SHAs before raw execution.
- Raw compares the two exact trees directly. Forward, reverse, and diverged
  pairs share the same directional contract; identical SHAs perform no raw
  subprocess work.
- A broad authoritative inventory is filtered by verified publication scope,
  optional `pathPrefix` and `pathGlob`, then relevance-sorted before
  `maxFiles`. The old provider-order and 300-file upstream cap blockers are
  gone.
- `RawCodeDiffSummary` reports scoped counts before projectability and
  `maxFiles`: `filesChanged`, added/deleted/modified, mode/type changes,
  `inventoryComplete`, and `unprojectableFiles`.
- `hasMoreFiles` reports additional projectable files after `maxFiles`; it does
  not include overlong unprojectable paths.
- Selection controls work. Inventory requires one raw call; selecting stats or
  patches performs one additional exact-path call only for retained files.
- Content truth is typed independently through `contentCoverage`, optional
  `contentFailure`, and per-file `contentStatus` /
  `contentOmissionReason`. Paths also expose `pathEncoding` and
  `contentSafety`.
- Backend bounds/defaults are `maxFiles=50` within `1..300` and
  `maxPatchBytes=262144` within `1024..2097152`, with a fixed 131072-byte
  per-file patch ceiling. Numeric values are clamped by the backend; the client
  must reject out-of-range values instead of silently changing agent input.
- `pathPrefix` and `pathGlob` are independently optional, compose by
  intersection, reject explicit empty values, and have 1024-byte limits.
- First-inventory failures are GraphQL field errors. Failures after an
  authoritative inventory remain data under `contentFailure`, preserving the
  inventory and selected file identities.
- Raw file status is only `ADDED`, `DELETED`, or `MODIFIED`. The contract does
  not expose rename identity, so the client must not infer or advertise
  renames.

The local backend checkout matches its `origin/main`, but deployment of this
exact schema to the development and production GraphQL endpoints has not been
verified in this reorientation. The schema changelog still labels the
replacement change as pending. The user reported on 2026-08-17 that a backend
GraphQL documentation round is still needed. Phase 1 can use the committed SDL
and implementation contract; if that round changes fields or semantics rather
than descriptions, reorient before implementation continues.

### Contradictions retired from the old proposal

| Old proposal statement | Current verified contract |
|---|---|
| GitHub `BASE...HEAD` cannot produce reverse patches | Exact-tree RawDiff supports forward, reverse, and diverged transformations |
| GitHub exposes at most 300 upstream files | Authoritative inventory has no GitHub Compare file window |
| Upstream ordering can consume the file/patch budget | PkgSeer applies publication scope and relevance before caller limits |
| Counts are repository-wide before caller scope | Summary counts are recomputed after publication and caller scope |
| `compareUrl`, direction counts, previous rename path, and patch-omission enums are available | Those fields were removed; use exact resolutions, content coverage/failure, content status, and omission strings |
| Only patch/stat views need consideration | Backend has distinct Inventory, Stats, and Patches execution modes |

## Scope

### In scope

- Package addressing for all registries accepted by the existing code-target
  parser, when PkgSeer can resolve both published versions to public GitHub
  source.
- Public GitHub repository addressing with explicit `from` and `to` refs.
- Raw inventory, stats, and patch projections, subject to the Phase 2 view
  decision.
- Prefix/glob filtering, file and patch budgets, compact text, structured JSON,
  typed errors, CLI/MCP parity, smoke coverage, and agent evaluation.
- Later consumption of a typed package-changelog diff action once PkgSeer
  publishes that action contract.

### Non-goals

- Public structural/symbol diff.
- Compatibility, upgrade-safety, API-stability, or semantic-version verdicts.
- Private repositories, local worktrees, proprietary code, or uncommitted
  changes.
- Client-side ranking, patch inversion, rename detection, patch synthesis, or
  fallback to a hosted compare API.
- A client cache, queue, lock, concurrency gate, retry layer, or feature flag.
- Reproducing Git's full revision or pathspec language.

## Target architecture

### Boundaries and responsibilities

`packages/core-internal` owns the transport-neutral contract:

- Add explicit CodeDiff request/result/error types and
  `CodeNavigationService.codeDiff(params)`.
- Build the GraphQL variables from one normalized package or repository target.
- Use a mode-specific selection for inventory, stats, and patches. Never select
  structural fields. Patch mode selects patch fields; stats omits patch and
  patch-only fields; inventory omits per-file `additions`, `deletions`, and
  patch content. The authoritative summary's added/deleted file counts remain
  selected in every mode.
- Validate the external response with Zod and preserve backend enum/string
  values needed to represent content truth.
- Handle root errors separately from `raw` field-local errors. A field-local
  raw error must carry parsed GraphQL extensions plus the successfully returned
  package/from/to resolutions; ordinary CodeNavigation methods may keep their
  existing fail-on-any-error behavior.

`packages/mcp` owns public request and response behavior:

- A dedicated diff-target builder reuses existing package/repository parsers
  but rejects target-embedded package versions and repository refs because the
  comparison endpoints own both identities.
- Shared pure modules normalize view, filters, explicit defaults, and error
  envelopes once for CLI/MCP parity.
- A data-first camelCase JSON envelope exposes exact resolutions, scoped
  summary, scope, content coverage/failure, files, `hasMoreFiles`, and only the
  effective/caller-supplied filters needed to interpret truncation.
- Compact text shows the requested range and exact resolved SHAs once, then
  scoped summary, scope warning if unknown, relevance-ordered files, selected
  stats/patches, and only actionable recovery guidance.
- MCP validation failures and service errors remain JSON error envelopes in
  every requested format.

The root CLI owns Commander syntax and terminal error adaptation. The MCP
server owns tool registration, annotations, descriptions, instructions, and
public package exports. Both call the same shared builders and formatters.

### Data flow

```text
CLI args / MCP input
  -> shared target, endpoint, view, and option normalization
  -> CodeNavigationService.codeDiff
  -> mode-minimal GraphQL selection of codeDiff.raw
  -> Zod-validated transport result or typed partial/root error
  -> shared data-first envelope
  -> CLI text/JSON or MCP text-v1/JSON
```

### Failure behavior

- Invalid target/range/filter/budget input returns `INVALID_ARGUMENT` without a
  network request.
- Shared resolution errors retain backend `code`, `retryable`, side, retry
  delay, publication/ref candidates, and ambiguity kinds when supplied.
- Raw first-call failures preserve partial root resolution data when GraphQL
  returned it. Codes such as `RAW_DIFF_LIMIT_EXCEEDED`,
  `RAW_DIFF_UNAVAILABLE`, `RATE_LIMITED`, `TIMEOUT`, and `UPSTREAM_ERROR` must
  not collapse when they imply different recovery.
- A post-inventory `contentFailure` is a successful partial evidence result,
  not a thrown request error. Text and JSON must show that inventory is
  authoritative while requested content is partial or failed.
- `UNKNOWN` package scope is visibly repository-wide. Empty scoped inventory
  is not described as missing evidence when `inventoryComplete=true`.
- `BYTE_ESCAPED` paths remain evidence but cannot be reused as if they were an
  exact UTF-8 path. Follow-up hints are emitted only for stable UTF-8 paths.

## Assumptions and open decisions

### Verified assumptions

1. `code` remains the correct command/tool family because the output is source
   evidence and composes with `code_read`.
2. Raw remains read-only from the caller's perspective and does not enqueue
   indexing. MCP annotations can therefore use the existing read-only shape.
3. The exact-tree schema on backend `main` is the implementation target; no
   compatibility adapter for the removed GitHub Compare schema will be added.
4. Structural exposure remains independently blocked by backend quality and
   uncertainty work documented in PkgSeer's implementation guide.

### Resolved product direction (2026-08-17)

1. **CLI addressing:** use the compact
   `githits code diff <target> <from>..<to>` form for packages and repositories,
   with paired `--from` / `--to` only as the delimiter escape hatch.
2. **Public views:** expose Inventory, Stats, and Patches behavior. Design the
   names, defaults, flags, output, and option interactions to match `git diff`
   expectations as closely as the backend can truthfully support; validate the
   ergonomics with agents rather than treating the provisional
   `inventory | stat | patch` names as final.
3. **Path scoping:** when a caller supplies path scope, make backend `pathGlob`
   the primary public mechanism. An omitted path filter still means the whole
   resolved package/repository scope. Retain `pathPrefix` only when it provides
   a materially clearer exact-subtree escape hatch.

The backend glob is not a Git pathspec. It accepts one pattern, keeps `*` and
`?` within one component, and lets an exact `**` component span directories.
It rejects character classes, brace alternatives, negation, empty components,
and multiple patterns. CLI design should investigate a familiar
`-- <path-glob>` position after the range, but help/tool descriptions must call
the value a bounded glob and document the difference rather than claiming full
Git pathspec compatibility. MCP should use `path_glob` as the primary field.

The exact client defaults for returned files and cumulative patch bytes are
not a product decision yet. Start with 20 files and 32 KiB as evaluation
hypotheses only. Phase 2 must measure them against the backend's relevance
ordering and select the smallest useful defaults before public descriptions or
tests pin them.

### External unknowns

- Whether the exact schema is deployed to the development endpoint. Evidence:
  authenticated schema/introspection or representative dev calls. Due before
  Phase 2 live smoke; lack of deployment does not block the isolated Phase 1
  adapter and fixtures.
- Whether the backend GraphQL documentation round is description-only.
  Evidence: inspect the resulting SDL hash/changelog and implementation diff.
  Due before Phase 1 merges if the round lands while Phase 1 is open; any shape
  or semantic change requires immediate reorientation.
- The future PkgSeer changelog action discriminator and argument fields. Due
  before Phase 3; resolve from the committed backend schema, not prose.

### Overall dependencies

- The exact-tree PkgSeer GraphQL contract remains stable through Phase 1 and is
  deployed before Phase 2 live validation.
- Phase 2 follows the transport-neutral Phase 1 API and the resolved Git-like
  product direction; Phase 3 follows the stable Phase 2 invocation and a
  committed backend changelog-action contract.
- Existing CodeNavigation authentication, request-header, content-safety,
  smoke, plugin-generation, and package-boundary workflows remain the shared
  infrastructure. This effort does not replace them.

## Cross-cutting considerations

### Security and privacy

- Never print, persist, or place credentials in command output, fixtures,
  plans, telemetry, or tool-call evidence. Live validation may use existing
  process-local authentication only.
- Keep public-Git scope explicit. Do not accept credential-bearing repository
  URLs or weaken the existing repository parser.
- Treat paths and patches as untrusted. Respect backend `contentSafety`, keep
  formatter-owned layout separate, and do not invent exact-path hints after
  identity-changing normalization.

### Performance and data minimization

- Mode-minimal GraphQL selections are part of the contract and require wire
  tests. Inventory must not request stats or patches; stat must not request
  patches.
- Evaluate response bytes, model tokens, materially relevant patched files,
  end-to-end time, and agent follow-up quality before fixing client defaults.
  Use release builds for any reported performance numbers.
- Do not add client-side ranking. Backend relevance runs over authoritative
  scoped inventory before bounds and is the correct ownership boundary.

### Compatibility, release, and rollback

- Phase 2 changes both public artifacts and therefore adds one changelog
  fragment with pending SemVer impacts for `githits` and `@githits/mcp`.
- Use the repository-internal `githits-plugin-maintenance` skill for MCP
  instructions, root Agent Skill, plugin/extension manifests, and generated
  assets. Edit canonical inputs, run `bun run plugins:generate`, then
  `bun run plugins:check`.
- Rollback is the previous CLI/MCP package version; this feature writes no
  persistent data and needs no cleanup or migration.

### Durable documentation

Implementation starts a focused CodeDiff document in Phase 1 and updates
`docs/implementation/tools.md`,
`docs/implementation/cli-commands.md`, MCP/CLI parity documentation where the
new shared contract matters, and a focused CodeDiff implementation document.
The durable document must explain exact-tree identity, scope/summary semantics,
content coverage/failure, view-minimal fetching, and non-goals. It must not
copy transient rollout detail from this plan.

## Phase map

| Phase | Status | Outcome |
|---|---|---|
| 1. Transport-neutral CodeDiff adapter | Ready | Typed exact-tree request/result/error support in `CodeNavigationService`, with no public command/tool yet |
| 2. Public CLI/MCP raw diff | Design refinement pending; no product blocker | Git-like shared request/response rendering, validated defaults, `githits code diff`, and `code_diff` with tests, smoke, docs, assets, and release fragment |
| 3. Changelog steering | Blocked on backend action contract and Phase 2 | Consume typed PkgSeer changelog actions and render context-appropriate diff calls |
| Structural track | Out of scope / backend-blocked | Separate future proposal only after backend says structural evidence is externally safe |

## Phase 1: transport-neutral CodeDiff adapter

**Status:** ready.

**Expected outcome:** `packages/core-internal` can request and validate all
three raw modes through `CodeNavigationService.codeDiff`, represent partial
content separately from field errors, and preserve exact root identity on raw
field errors. The method and types become public through
`@githits/mcp/client`; no MCP tool, CLI command, or user-facing default is
introduced.

**Assumptions:** backend `main` exact-tree schema is the intended final client
contract; service callers choose an explicit mode; no compatibility with the
removed compare schema is required.

**Unknowns/product decisions:** none for this internal adapter. The deployment
state is not needed for isolated tests.

**Dependencies:** current `CodeNavigationService`, shared request-header/token
provider behavior, PkgSeer SDL hash `e7046c0af330`, and existing service mock
factories.

**Likely files:**

- `packages/core-internal/src/services/code-navigation-service.ts`
- `packages/core-internal/src/services/code-navigation-service.test.ts`
- `packages/core-internal/src/index.ts` if public workspace exports require it
- `packages/mcp/src/client.ts`
- `packages/mcp/src/mcp/server.ts` for the descriptor-only service stub
- `packages/mcp/src/services/test-helpers.ts`
- `src/services/test-helpers.ts`
- `scripts/validate-public-packages.ts`
- `docs/implementation/code-diff.md`
- one independent `changes/*.added.md` fragment

**Contracts and edge cases:**

- Params use a normalized unversioned package/repository target plus explicit
  `from`, `to`, raw mode, and optional raw bounds/filters.
- Package variables populate only `registry/name/fromVersion/toVersion`;
  repository variables populate only `repoUrl/fromRef/toRef`. Empty opposite
  fields are omitted, not sent as empty strings.
- Each mode has a test-visible minimal selection. Shared identity, summary,
  scope, files, `hasMoreFiles`, and `contentSafety` remain selected where used;
  content fields appear only in the mode that consumes them.
- Runtime schemas cover every committed enum and nullable field. Unknown
  omission/failure strings remain bounded backend facts rather than closed
  client enums unless the SDL defines an enum.
- Identical SHAs, empty authoritative inventory, unknown scope, moved package
  roots, unprojectable paths, binary/metadata-only files, byte-escaped paths,
  partial/failed content, and field-local raw errors all have fixtures.
- Field-local errors preserve root data; root/shared-resolution errors do not
  fabricate a result.

**Ordered implementation:**

1. Add service-level request/result/error interfaces and update both mock
   factories first so compilation exposes every consumer.
2. Add Zod schemas for CodeDiff root, raw modes, GraphQL extensions, and partial
   responses. Keep them local to the service until a second consumer proves a
   shared schema is needed.
3. Add mode-minimal query selections and exact variable construction. Prefer
   the smallest explicit query construction that lets tests assert selected
   fields; do not introduce a general GraphQL query builder.
4. Implement `codeDiff` using the existing authenticated request boundary and
   a dedicated mapper for CodeDiff-specific partial/root errors.
5. Add focused async service tests for variables, selections, normalization,
   malformed responses, root errors, raw field errors with root data, and
   post-inventory failure-as-data.
6. Document the client adapter's exact-tree identity, mode-minimal fetching,
   partial/error contract, public export boundary, and current lack of a CLI or
   MCP tool. Add a changelog fragment with `githits: none` and
   `@githits/mcp: minor`; the required interface method is a public client API
   addition and custom service implementations must adopt it.
7. Run focused tests, the full `bun test`, `bun run build`, and
   `bun run validate:packages`. Inspect built declarations and packed artifacts
   to ensure private `@githits/core-internal` names do not leak.

**Acceptance criteria:**

- All three modes produce exact variables and minimal selections proven by
  wire-level tests.
- Every schema field needed by later text/JSON consumers survives typed
  normalization without compare-era fields.
- Partial content remains successful evidence; field-local and root errors are
  distinguishable and retain all safe actionable metadata the backend sent.
- Existing navigation behavior and error mapping are unchanged.
- Durable documentation and the changelog fragment state the public client API
  impact without advertising an unimplemented tool or command.
- Focused tests, `bun test`, `bun run build`, and
  `bun run validate:packages` pass.

## Phase 2: public CLI/MCP raw diff

**Status:** product direction resolved; detailed ergonomics must be validated
after Phase 1 and before the public schema/help is pinned.

**Expected outcome:** users and agents can invoke the same exact-tree raw diff
through `githits code diff` and `code_diff`, with compact truthful output,
lossless selected JSON, useful defaults, and complete local/built/live
validation.

**Assumptions:** Phase 1 result types remain sufficient; the deployed dev
schema matches the committed SDL before live smoke; the selected public modes
map directly to backend selection modes.

**Unknowns/product decisions:** no remaining product blocker. Exact Git-like
view names/flags and the single-glob CLI spelling require usability design;
client file/patch defaults require workload evidence. Both are due before the
public schema, descriptions, and tests are finalized.

**Dependencies:** completed Phase 1; deployed development backend for final
smoke; plugin-maintenance workflow; current smoke/eval harnesses.

**Likely files/components:**

- shared `code-diff-request.ts`, `code-diff-response.ts`, and
  `code-diff-text.ts` modules with focused tests;
- `packages/mcp/src/tools/code-diff.ts`, tool index/server registration,
  instructions, public types/exports, and test helpers;
- `src/commands/code/diff.ts`, command registration/help, CLI helpers, and
  parity tests;
- smoke-test tool inventories, CLI/MCP smoke scripts, targeted agent workloads,
  canonical Agent Skill/guidance, generated plugin assets, implementation
  docs, and one `changes/*.added.md` fragment.

**Behavior and constraints:**

- MCP input is `target + from + to`, not the backend's coupled flat XOR groups.
  The target may be compact or structured but must not embed an endpoint.
- The normal CLI begins with `githits code diff <target> <from>..<to>`. View and
  path controls should borrow familiar Git spelling where semantics align.
  Familiar spelling must not imply unsupported Git pathspec, revision, rename,
  or unbounded-output behavior.
- `path_glob` is the primary MCP path filter. Evaluate one CLI glob after `--`
  as the closest honest match to `git diff ... -- <pathspec>`; do not accept
  multiple values or unsupported pathspec magic unless the backend contract
  gains equivalent semantics.
- CLI and MCP reject empty endpoints, mixed/partial range forms, explicit empty
  filters, invalid glob syntax, out-of-range numeric values, and no-op option
  combinations before network I/O.
- JSON is a stable data-first projection, not a raw GraphQL wrapper. It retains
  selected content truth and exact full SHAs without prose-only facts.
- Text shows exact range direction as `from -> to`; it does not recreate the
  removed AHEAD/BEHIND/DIVERGED model. Equal full SHAs are labeled identical.
- Summary counts describe the complete scoped inventory. Returned-file counts,
  `hasMoreFiles`, and `unprojectableFiles` remain separate.
- Patch omission actions depend on `contentStatus`, omission reason, and
  coverage. Raising total bytes is never suggested for a fixed per-file,
  binary, metadata-only, invalid-UTF-8, or transport failure.
- No rename wording appears because the backend does not preserve rename
  identity.

**Ordered implementation:**

1. Reorient against Phase 1 types and the completed backend documentation
   round. Build small CLI/MCP ergonomics fixtures for common `git diff`
   expectations, then pin only the spellings whose semantics match.
2. Add pure target/range/view/filter normalization tests, then implement the
   shared request builder. Reuse existing parsers without loosening other code
   tools.
3. Add data-first response and text fixtures covering every scope, summary,
   coverage, failure, content status, path encoding, truncation, identity, and
   error state; then implement the smallest formatter modules that satisfy
   them.
4. Add MCP and CLI adapters, registrations, read-only annotations, JSON parity,
   and surface-native hints.
5. Before pinning defaults, run representative small patch, medium minor,
   large major, non-root monorepo, root-workspace, unknown-scope,
   generated/lockfile-heavy, binary, reverse, diverged, and identical cases.
   Compare 16/32/64 KiB and practical file caps using release builds. Record
   aggregate counts, bytes/tokens, latency, content status, and agent follow-up
   quality without persisting patches or credentials.
6. Pin defaults and descriptions from the evidence. Run targeted Claude and
   Codex `agent:e2e` workloads when practical; inspect tool calls,
   `toolIssues`, `instructionIssues`, follow-ups, and unsupported conclusions.
7. Update smoke inventories, durable docs, canonical guidance, and changelog
   fragment. Use `githits-plugin-maintenance`, generate assets, and inspect the
   complete diff.
8. Run `bun test`, `bun run build`, `bun run smoke:cli`,
   `bun run smoke:mcp`, `bun run smoke:cli:built`,
   `bun run smoke:mcp:built`, `bun run plugins:check`, and external package
   export/declaration validation. Run authenticated dev smoke only if an
   existing credential is available without exposing it; unauthenticated smoke
   must still pass its auth-handling contract.

**Acceptance criteria:**

- Equivalent CLI/MCP calls send equivalent normalized service params and
  produce the same JSON success/error facts.
- Inventory/stat/patch behavior matches the accepted public view set and each
  view fetches no unused GraphQL fields.
- CLI addressing, view flags, `--` path placement, help, and errors feel
  familiar to `git diff` users while explicitly rejecting unsupported
  pathspec/revision behavior; agents select the intended view and filter in
  targeted evaluations.
- Ordinary package upgrades return materially relevant bounded evidence under
  the measured defaults; incomplete evidence is unmistakable and leads to a
  valid focused follow-up.
- Reverse and diverged calls are direct exact-tree transformations, not
  compare-era relationship claims.
- Scope, authoritative summary, returned/projectable counts, content coverage,
  partial content failure, and per-file status are impossible to confuse in
  text or JSON.
- All required unit, parity, smoke, built-product, plugin, package-boundary,
  and agent evaluations pass. Any unavailable authenticated dev check is
  reported explicitly rather than represented as passed.

## Phase 3: changelog steering

**Status:** blocked on Phase 2 and a committed backend action contract.

**Expected outcome:** sparse/missing range changelogs carry typed package-only
diff arguments that GitHits maps to the active MCP or CLI syntax without
matching human prose.

**Assumptions:** the action remains transport-neutral and package-addressed;
Phase 2 invocation is stable.

**Unknowns/product decisions:** exact discriminator, field names, and success /
error placement. Resolve from the future SDL and backend implementation during
phase-boundary reorientation.

**Dependencies:** deployed Phase 2 and committed/deployed PkgSeer action schema.

**Acceptance criteria:** empty, partial, and missing-content range outcomes
steer to a valid CodeDiff call in both contexts; latest/repository outcomes and
unknown actions remain truthful; structural stays unexposed. Tactical files
and steps are intentionally deferred until the backend contract exists.

## Phase-boundary reorientation

After each phase merges, fetch and rebase on current `origin/main`, inspect the
merged delta and current PkgSeer SDL/changelog/implementation guide, then update
this same plan before detailing or implementing the next phase. Record:

- the merged outcome and tests actually passed;
- changed schema fields, assumptions, decisions, dependencies, or release
  boundaries;
- contradictions between this plan, implementation, backend behavior, or user
  comments; and
- whether the next phase is `READY`, `REPLAN`, or `PRODUCT INPUT NEEDED`.

Do not carry forward compare-era fields, an unmeasured client default, or an
unverified changelog action shape.

## Overall acceptance, completion, and plan cleanup

The effort is complete only when:

- raw CodeDiff is released through CLI and MCP with exact-tree identity,
  truthful scoped inventory/content states, and measured useful defaults;
- typed changelog steering is consumed in both CLI and MCP contexts;
- structural remains honestly unexposed;
- durable docs match the implementation and no compare-era contract remains in
  active guidance; and
- all required unit, build, parity, smoke, built-product, package-boundary,
  plugin, live-when-authenticated, and targeted agent validation has passed or
  an unavailable authenticated check is explicitly reported.

Keep this plan through final implementation review. Then transfer remaining
lasting decisions to `docs/implementation/`, delete this plan as the final
substantive cleanup, and search the repository for stale compare-era or plan
references.
