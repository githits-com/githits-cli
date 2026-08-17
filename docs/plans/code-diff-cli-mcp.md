# Plan: CodeDiff CLI dogfood and agent rollout

> Overall status: Phase 1 is merged. Phase 2 is implementation-ready as a
> silent CLI-only dogfood launch. MCP and agent-facing exposure are deferred
> until the CLI contract has been exercised.
>
> Reoriented: 2026-08-17 against `githits` `origin/main` at `77417aa` and
> PkgSeer backend `origin/main` at `c0cf92e` with GraphQL schema hash
> `sha256:28413c4e9b31`.

## Problem and overall expected outcome

Package changelogs are often missing or too abstract to explain an upgrade.
GitHits needs a bounded source diff that compares the exact resolved `from`
and `to` trees and remains truthful about package scope, truncation, omitted
content, and failures.

The rollout is deliberately staged:

1. land the transport-neutral CodeDiff client;
2. expose `githits code diff` as a normally registered but unpromoted CLI
   dogfood surface;
3. use dogfood evidence to stabilize the contract before adding `code_diff`,
   MCP instructions, or agent guidance; and
4. later consume typed changelog steering when PkgSeer publishes that
   contract.

The completed effort gives humans and agents the same authoritative raw diff
facts without claiming compatibility, upgrade safety, semantic impact, rename
identity, or any other conclusion the raw evidence cannot prove. Structural
CodeDiff remains a separate, unexposed backend evaluation surface.

## Verified current state and evidence

### GitHits repository

- Phase 1 merged through PR #287 at `origin/main` `77417aa`. The merged delta
  adds `CodeNavigationService.codeDiff`, exact request/result/error types,
  mode-minimal GraphQL selections, runtime validation, fixtures, public client
  exports, and `docs/implementation/code-diff.md`.
- The declaration-build pipeline failure was fixed before merge. Phase 1's
  focused tests, full tests, build, and public-package validation passed.
- No `githits code diff` command, `code_diff` MCP tool, response formatter,
  MCP instruction, Agent Skill guidance, plugin asset, or changelog action
  consumer exists on `origin/main`.
- `CodeNavigationService` is already available through the CLI container and
  its mock factory. Existing indexed `code` commands keep Commander and
  terminal adaptation under `src/commands/code/` while reusing pure request,
  response, text, and error helpers through the workspace-only
  `@githits/mcp/internal` boundary.
- `githits resolve` is the verified silent-rollout precedent: it is a normally
  registered, documented CLI command backed by workspace-internal pure
  helpers, but it has no MCP tool or Agent Skill promotion.
- Root `githits` is version `0.9.2`; public `@githits/mcp` is version `0.9.1`.
  A new CLI command affects `githits` only unless implementation changes a
  public MCP export or behavior.
- This worktree remains at the merged PR head `f263cf8` while `origin/main`
  points at the merge commit. Phase 2 implementation must begin from current
  `origin/main`; this replan does not itself rewrite branch history.

### Backend contract

PkgSeer `origin/main` now contains the completed GraphQL documentation round.
The SDL and implementation documentation prove:

- `codeDiff` accepts exactly one complete addressing form: package
  `registry/name/fromVersion/toVersion` or public GitHub repository
  `repoUrl/fromRef/toRef`.
- Both endpoints resolve to full immutable commit SHAs before raw work. Forward,
  reverse, diverged, and identical pairs use the same direct tree-to-tree
  contract; identical SHAs perform no raw subprocess work.
- GraphQL selection determines Inventory, Stats, or Patches work. Phase 1 maps
  those shapes to `inventory`, `stats`, and `patches` service modes and proves
  their selected fields at the wire boundary.
- `pathGlob` and `pathPrefix` are repository-relative even for package scope.
  Package publication evidence restricts the inventory but does not rewrite
  returned paths or caller filters to package-relative values.
- `pathGlob` supports a bounded subset: `*` and `?` stay within a component and
  an exact `**` component spans components. Unsupported shell/pathspec syntax
  is rejected. Only one glob is accepted per request.
- Server defaults are `maxFiles=50` and `maxPatchBytes=262144`; each patch also
  has a fixed 131072-byte ceiling. The server clamps numeric options, but the
  CLI must reject out-of-range user values rather than silently altering them.
- `summary`, `hasMoreFiles`, and `contentCoverage` answer different questions.
  `summary` covers the full filtered inventory before projectability and
  `maxFiles`; `hasMoreFiles` covers omitted projectable paths; content coverage
  covers only returned file evidence.
- Content outcomes distinguish inventory-only, stats, patch, binary,
  metadata-only, omitted, and unavailable rows. A failed post-inventory content
  phase remains data with an authoritative inventory; a first-inventory or
  resolution failure is a typed GraphQL error.
- The documentation round was description/contract clarification plus tests;
  it did not replace Phase 1's GraphQL shapes. The later correction at
  `1388b42` clarified repository-relative path identity and is consistent with
  this plan.

Deployment of schema hash `sha256:28413c4e9b31` to the development endpoint has
not been authenticated or introspected during this replan. That is an external
readiness check due before Phase 2 is represented as live-validated, not a
blocker for isolated implementation and fixtures.

### Reorientation contradiction and resolution

The merged plan still grouped CLI, MCP, instructions, plugin assets, parity,
and agent evaluation into one public Phase 2. That conflicts with the user's
2026-08-17 decision to launch the CLI silently, dogfood it like `resolve`, and
leave the MCP tool and instructions out. This revision splits those outcomes
into separate phases. Do not implement the old combined Phase 2.

## Scope

### Overall scope

- Package comparisons for registries already accepted by the code-target
  parser when PkgSeer can resolve both published versions to public GitHub
  source.
- Public GitHub repository comparisons with explicit base and target refs.
- Authoritative raw Inventory, Stats, and Patches projections.
- Repository-relative glob filtering, file and patch budgets, exact resolved
  identity, pipe-friendly terminal output, structured JSON, typed errors, and
  truthful completeness signals.
- CLI-only dogfooding before MCP/agent exposure.
- Later MCP parity and typed changelog steering after their dependencies are
  verified.

### Overall non-goals

- Public structural/symbol diff.
- Compatibility, safety, API-stability, or semantic-version verdicts.
- Rename/copy detection or compare-era ahead/behind/diverged relationships.
- Working-tree, staged, local-path, private-repository, or arbitrary Git host
  diff.
- Full Git revision grammar, three-dot merge-base semantics, multiple
  pathspecs, pathspec magic, exclusions, attributes, or unbounded output.
- Automatic indexing, background rollout machinery, feature flags, telemetry
  infrastructure, or persistent storage.
- Changelog action parsing before PkgSeer commits the typed action contract.

## Target architecture and end state

### Boundaries and responsibilities

- `CodeNavigationService.codeDiff` remains the only network/service boundary.
  It owns authenticated GraphQL execution, exact variable construction,
  mode-minimal selections, runtime validation, and typed CodeDiff errors.
- Small pure CodeDiff request, response, text, and error helpers live under
  `packages/mcp/src/shared/` and are exported only through
  `packages/mcp/src/internal.ts` during CLI dogfooding. This follows the
  existing `resolve` pattern and lets a later MCP adapter reuse an exercised
  contract without exposing a public `@githits/mcp` API prematurely.
- `src/commands/code/diff.ts` owns Commander syntax, CLI-native validation
  wording, dependency acquisition, spinner lifecycle, stdout/stderr routing,
  JSON serialization, and process exit behavior. It does not construct
  GraphQL or duplicate backend response mapping.
- Phase 3 adds a thin MCP `code_diff` adapter only after Phase 2 evidence is
  reviewed. It reuses the pure contract, adds agent-native descriptions and
  errors, and introduces no second CodeDiff service path.
- Changelog steering later produces typed calls to the stable CLI/MCP
  invocation; it never parses human changelog prose for suggestions.

The root CLI may import `@githits/mcp/internal`. Public packages and future
remote MCP servers must not. No new module from Phase 2 is exported by
`@githits/mcp`, `@githits/mcp/client`, or `@githits/mcp/smoke-test`.

### Data flow during silent dogfood

```text
CLI target + from..to + view/filter/bounds
  -> pure CLI request normalization
  -> CodeNavigationService.codeDiff
  -> mode-minimal codeDiff.raw GraphQL selection
  -> typed CodeDiff result or error
  -> pure selected-view JSON/text projection
  -> primary view on stdout + diagnostics on stderr
```

Phase 3 later adds MCP input/output adapters on either side of the same pure
normalization and projection modules.

### CLI dogfood contract

The initial syntax is:

```text
githits code diff <target> <from>..<to> [options] [-- <path-glob>]
githits code diff --repo-url <url> <from>..<to> [options] [-- <path-glob>]
```

- `<target>` accepts an unversioned package target such as `npm:express` or an
  existing compact public GitHub target. `--repo-url` remains available for
  consistency with the other `code` commands.
- Versions/refs belong only in `<from>..<to>`. A version embedded in a package
  target, a ref embedded in a repository target, `--git-ref`, an empty side,
  more than one `..` separator, or `...` is rejected before network I/O.
- Direction is always left-to-right. Reverse comparison is expressed by
  swapping the endpoints; no compare relationship or merge-base behavior is
  inferred.
- The default view is patch output, matching ordinary `git diff`. Explicit
  `-p`/`--patch`, `--stat`, `--name-only`, and `--name-status` are supported and
  mutually exclusive. `--name-only` and `--name-status` both use the cheap
  Inventory service mode; they differ only in the selected output projection.
- One value after `--` maps to backend `pathGlob` and is the primary public
  path filter. It is called a repository-relative glob in help and errors, not
  a full Git pathspec. Multiple values and unsupported pathspec syntax are
  rejected. `pathPrefix` is not exposed during dogfooding; evidence must show a
  distinct need before adding a second path control.
- `--max-files` is valid for every view. `--max-patch-bytes` is valid only for
  patch view. Omitted values are omitted from the service request so dogfooding
  measures the documented backend defaults rather than pinning a separate
  client default.
- `--json` returns a data-first envelope containing normalized target identity,
  public view, exact `from`/`to` resolutions, scoped summary, scope,
  `contentCoverage`, optional `contentFailure`, selected file facts, and
  `hasMoreFiles`. File objects contain only facts selected for the view:
  path-only for `name-only`, path/status for `name-status`, line counts and
  content status for `stat`, and bounded patch/omission/safety facts for patch.
- Default text keeps stdout compatible with the chosen Git-style view:
  patches for patch mode, bare paths for `--name-only`, status plus path for
  `--name-status`, and line-count rows plus a total for `--stat`. Resolution,
  scope, truncation, unprojectable-path, safety, and incomplete-content
  diagnostics go to stderr so piping the primary output remains useful.
- `--verbose` adds requested/resolved identities, full summary, effective
  scope/filter, returned count, and content coverage to terminal output. JSON
  already carries these facts and does not change shape under `--verbose`.
- No rename wording is emitted. Binary and metadata-only changes explicitly
  state that content differs without claiming a textual patch. Byte-escaped
  paths are marked display-only and are never suggested as exact follow-up
  identities.

### Failure and exit behavior

- Empty authoritative diffs exit 0, matching normal `git diff` behavior.
- Client validation, authentication, root/shared-resolution errors, and raw
  field errors exit 1 and use the existing CLI JSON error envelope on stderr.
- CodeDiff-specific backend details are mapped into a bounded CLI error shape;
  arbitrary GraphQL extensions and raw backend codes are not passed through.
  Preserve safe side, published-version/ref candidates, retry timing, stage,
  limit kind, repository identity, and any partial exact resolutions.
- `PARTIAL` or `FAILED` content coverage inside a successful result remains a
  successful evidence envelope and exits 0 because the authoritative inventory
  is usable. Text emits an unmistakable stderr warning; JSON retains structured
  coverage/failure and per-file statuses. Dogfooding must revisit whether this
  is suitable for agent automation before Phase 3.
- Terminal-visible backend text and paths use existing sanitization. Patches
  use the backend's content-safety projection; the CLI does not restore removed
  content or log patches.

## Overall assumptions and unknowns

### Assumptions

1. Phase 1's public service signatures are sufficient for the CLI; dogfooding
   should change normalization and presentation before changing that boundary.
2. Git-like syntax means matching familiar behavior where backend semantics
   are equivalent, not accepting Git flags or pathspecs that would be ignored
   or approximated.
3. Silent rollout means normal CLI registration, help, implementation docs,
   smoke coverage, and a release fragment, while omitting MCP registration,
   MCP instructions, Agent Skills, plugin guidance, and proactive agent
   evaluation.
4. Manual dogfood notes and existing debug facilities are sufficient for this
   phase. No feature flag, telemetry schema, counter, or rollout service is
   authorized.

### Unknowns and product decisions

- **Development deployment:** whether the dev endpoint serves schema hash
  `sha256:28413c4e9b31`. Resolve with authenticated introspection or a
  representative CLI call before claiming authenticated live smoke passed.
- **Client defaults:** whether later public agent use needs file/patch limits
  smaller than backend defaults. Resolve from Phase 2 dogfood evidence before
  Phase 3 schema/descriptions pin defaults.
- **Agent view schema:** whether MCP should expose Git-like view names or the
  service's Inventory/Stats/Patches names. Resolve after CLI dogfood and before
  Phase 3 implementation.
- **Content-failure exit semantics:** Phase 2 deliberately keeps successful
  authoritative inventory at exit 0. Reassess from shell and automation
  dogfooding before agent exposure.
- **Changelog action shape:** discriminator, fields, and placement do not yet
  exist as a committed client contract. Resolve from future PkgSeer SDL and
  implementation before the changelog-steering phase.

There is no blocking product decision for Phase 2.

## Cross-cutting considerations

### Security and privacy

- Only already-supported public package and public GitHub addressing is
  accepted. Existing URL parsing must continue rejecting credential-bearing or
  path-bearing repository URLs rather than silently canonicalizing them.
- Do not expose, print, persist, fixture, or record credentials. Authenticated
  smoke may use an existing credential only through the normal client path and
  must not print its value.
- Dogfood notes may record target/version pairs, aggregate sizes, latency, and
  outcome categories, but never patches, file bodies, tokens, or arbitrary
  backend failure prose.
- Preserve content-safety and terminal-sanitization behavior in every text and
  JSON path.

### Performance and data fetching

- Each CLI call makes one CodeDiff GraphQL request through the existing
  service. No local Git checkout, GitHub Compare fallback, cache, queue, or
  background indexing is introduced.
- View choice must reach the service unchanged so Inventory never selects line
  counts and Stats never selects patches or omission reasons. Existing Phase 1
  wire tests remain the authority for this boundary.
- Omitted limits stay omitted. Dogfood observation is not a performance claim
  or optimization benchmark; any later optimization requires the repository's
  benchmark-first workflow.

### Compatibility, release, and rollback

- Phase 2 adds a root CLI command and therefore adds one independent fragment
  with pending impacts `githits: minor` and `@githits/mcp: none`.
- Phase 2 does not bump versions directly. Release preparation owns package and
  generated-manifest versions.
- Workspace-internal shared modules must not appear in public export maps or
  declarations reachable through `@githits/mcp`, `@githits/mcp/client`, or
  `@githits/mcp/smoke-test`.
- The feature writes no state and needs no migration. Rollback is the previous
  root CLI release; no cleanup is required.

### Durable documentation

- Update `docs/implementation/code-diff.md` with the exercised CLI projection,
  exact-tree identity, repository-relative glob semantics, output/failure
  contract, and current absence of an MCP tool.
- Update `docs/implementation/cli-commands.md` with command examples, piping,
  view flags, JSON shape, warnings, exit behavior, and the silent dogfood
  posture.
- Do not edit MCP instructions, `docs/implementation/tools.md`, root Agent
  Skills/guidance, generated plugin assets, or `CHANGELOG.md` in Phase 2.

## Phase map

| Phase | Status | Outcome |
|---|---|---|
| 1. Transport-neutral CodeDiff adapter | Complete and merged | Typed exact-tree request/result/error support with no CLI command or MCP tool |
| 2. Silent CLI dogfood | Implementation-ready | Git-like `githits code diff`, CLI-only tests/smoke/docs/release fragment, and dogfood evidence with no agent exposure |
| 3. MCP and agent rollout | Blocked on Phase 2 evidence | Stable `code_diff`, CLI/MCP parity, instructions, assets, smoke, and agent evaluation |
| 4. Changelog steering | Blocked on backend action contract and stable Phase 3 invocation | Typed sparse-changelog actions that point to valid CLI/MCP diff calls |
| Structural track | Out of scope / backend-blocked | Separate future proposal only after backend says structural evidence is externally safe |

## Phase 1: transport-neutral CodeDiff adapter

**Status:** complete and merged through PR #287.

**Expected outcome:** the transport-neutral service can request and validate
exact-tree raw CodeDiff Inventory, Stats, and Patches without exposing a CLI or
MCP surface.

**Assumptions:** the committed exact-tree backend contract is the client
target; no compatibility adapter for the removed GitHub Compare shape is
needed.

**Unknowns/product decisions:** none remaining for this completed phase.

**Dependencies:** completed backend exact-tree SDL and existing authenticated
CodeNavigation request boundary.

**Observed outcome and acceptance:** mode-minimal variables/selections, runtime
schemas, partial/root error separation, fixtures, mock factories, public client
exports, durable documentation, release fragment, focused tests, full tests,
build, and public-package validation merged. No user command/tool or agent
guidance was added.

## Phase 2: silent CLI dogfood

**Status:** implementation-ready.

**Expected outcome:** developers and deliberate CLI users can run an
authoritative exact-tree raw diff through `githits code diff` with familiar
Git-style views, pipe-friendly text, structured JSON, and truthful bounded
evidence. Agents receive no new tool, instructions, suggestions, or packaged
guidance.

**Assumptions:** Phase 1 types remain sufficient; existing code-target parsing,
container injection, auth handling, sanitization, spinner, and CLI error
envelopes can be reused without changing their unrelated behavior; backend
defaults are acceptable evaluation defaults but are not yet endorsed for agent
use.

**Unknowns/product decisions:** none blocking implementation. The development
deployment, later client defaults, Phase 3 MCP view names, and final
content-failure automation semantics remain evidence questions described
above.

**Dependencies:** current `origin/main`; merged Phase 1; committed backend SDL
and CodeDiff guide; existing CLI container and smoke harness. Authenticated dev
deployment is required only for authenticated live validation.

### Likely files and components

- `packages/mcp/src/shared/code-diff-request.ts` and focused tests for target,
  range, view, glob, and numeric normalization;
- `packages/mcp/src/shared/code-diff-response.ts` and focused tests for
  selected-view success/error envelopes;
- `packages/mcp/src/shared/code-diff-text.ts` and focused tests for
  pipe-friendly views and diagnostic facts;
- a small CodeDiff-specific error mapper beside those modules if the existing
  generic code-navigation mapper cannot preserve the required bounded details
  without broadening unrelated error behavior;
- `packages/mcp/src/internal.ts` for workspace-only exports, with no public
  export-map or package-index change;
- `src/commands/code/diff.ts` and `src/commands/code/diff.test.ts`;
- `src/commands/code/index.ts` registration and code-group help;
- `scripts/cli-smoke.ts` structural command/help/auth/JSON coverage;
- `docs/implementation/code-diff.md`,
  `docs/implementation/cli-commands.md`, and one new
  `changes/*.added.md` fragment.

Do not add or edit an MCP tool, MCP server registration, MCP instruction,
smoke-test tool inventory, Agent Skill, `AGENTS.md`, plugin/marketplace manifest,
plugin generator, or generated agent asset in this phase.

### Contracts and edge cases

- Parse package and repository forms into the Phase 1 target union without
  own-key leakage from the opposite target shape.
- Accept exactly one non-empty `from..to` pair. Preserve endpoint spelling in
  the request and exact resolved identity in the result. Identical endpoints
  and equal resolved SHAs are valid; empty sides, whitespace-only sides,
  `...`, or ambiguous separators are invalid.
- Reject versions/refs embedded in target syntax because comparison endpoints
  own both identities. Reject `--git-ref` for the same reason.
- Map patch, stat, name-only, and name-status views to the minimal Phase 1
  service mode. Explicit conflicting view flags are invalid instead of relying
  on Commander option order.
- Accept at most one non-empty repository-relative glob after `--`. Reject
  multiple values, absolute paths, invalid encoding/length, and unsupported
  backend glob syntax before network I/O.
- Validate `--max-files` against 1..300 and `--max-patch-bytes` against
  1024..2097152. Reject patch bytes outside patch view. Do not populate omitted
  option keys.
- Cover package scope, repository scope, unknown scope, moved package roots,
  empty inventory, identical SHA, reverse/diverged pairs, truncation,
  unprojectable and byte-escaped paths, binary and metadata-only files,
  content omissions, partial/failed content, safety modifications, root errors,
  and raw field errors with partial resolutions.
- Keep summary counts separate from returned file count. Never infer that
  `contentCoverage: COMPLETE` means the full inventory was returned.
- Preserve pipe-friendly stdout in every view and send non-primary diagnostics
  to stderr. Tests must assert the two streams separately.

### Ordered implementation

1. Start from current `origin/main`. Add focused behavior fixtures for the
   accepted CLI grammar and the four Git-style views, including rejected Git
   syntax the backend cannot honor.
2. Write request-normalization tests, then implement the smallest pure builder
   that produces `CodeDiffParams`. Reuse existing package/repository parsing
   without loosening other `code` commands.
3. Write data-first response fixtures for all scope, summary, coverage,
   content-status, safety, truncation, identity, and error states. Implement
   selected-view envelopes and the bounded CodeDiff error mapping.
4. Write stdout/stderr formatter fixtures, then implement patch, stat,
   name-only, name-status, verbose context, and actionable warnings. Do not
   synthesize rename or compare-relationship facts.
5. Add the thin Commander action and registration. Use the existing container,
   auth gate, spinner, color/sanitization, JSON error, and exit paths.
6. Extend CLI smoke with command/help registration, unauthenticated auth
   handling, invalid local grammar, and built-product coverage. If an existing
   credential is available without exposing it and dev serves the schema, run
   representative package and repository calls; otherwise record the live
   check as unavailable.
7. Dogfood representative small patch, medium release, large release,
   non-root monorepo package, root-workspace package, unknown package scope,
   generated/lockfile-heavy, binary, reverse, diverged, and identical cases.
   Record only target/version pairs and aggregate outcome/size/latency notes.
   Evaluate view spelling, stdout piping, one-glob sufficiency, backend default
   usefulness, warnings, and recovery behavior; add no instrumentation.
8. Update durable CLI/CodeDiff documentation and add the CLI-only release
   fragment. Inspect the complete diff to confirm MCP instructions, tool
   inventories, Agent Skills, and generated assets are unchanged.
9. Run focused tests, `bun test`, `bun run build`, `bun run smoke:cli`,
   `bun run smoke:cli:built`, `bun run validate:packages`, formatting/lint
   checks required by the changed files, and package-artifact inspection. Do
   not report an unavailable authenticated smoke as passed.

### Acceptance criteria

- The documented package and repository examples normalize to exact Phase 1
  service params; invalid/mixed/empty forms fail before service invocation.
- Default patch, explicit patch, stat, name-only, and name-status output use the
  intended minimal service modes and preserve Git-like stdout discipline.
- Omitted bounds are absent on the wire; explicit bounds and the single glob
  are validated and forwarded exactly.
- Text and JSON cannot confuse full scoped summary, returned/projectable
  files, content coverage, content failure, or per-file content status.
- Exact resolutions and safe recovery facts survive success and typed error
  projections without arbitrary GraphQL extensions or unsafe terminal text.
- Empty and identical diffs succeed; real errors fail; successful partial or
  failed content evidence succeeds with unmistakable structured/text warnings.
- CLI help states the bounded glob and revision limitations without claiming
  full Git pathspec or revision compatibility.
- No `code_diff` tool, MCP instruction, agent guidance, plugin asset, or public
  `@githits/mcp` export is added or changed.
- Durable docs describe the dogfood posture and one release fragment records
  `githits: minor`, `@githits/mcp: none`.
- Focused tests, full tests, build, CLI smoke, built CLI smoke, package
  validation, and relevant format/lint checks pass. Authenticated dev results
  are recorded accurately.

## Phase 3: MCP and agent rollout

**Status:** blocked on Phase 2 merge, dogfood evidence, and phase-boundary
reorientation.

**Expected outcome:** the exercised raw-diff contract becomes a public
`code_diff` MCP tool with CLI/MCP JSON parity, agent-native errors and
descriptions, minimal instructions/guidance, generated assets, complete smoke
coverage, and targeted agent evaluation.

**Assumptions:** dogfooding identifies a stable view/filter contract and useful
bounded defaults; no Phase 1 service redesign is required; structural remains
unexposed.

**Unknowns/product decisions:** MCP view names, public defaults, content-failure
automation semantics, whether `pathPrefix` has proven necessary, and any CLI
signature corrections found during dogfooding. Resolve from Phase 2 evidence
before adding tactical Phase 3 steps.

**Dependencies:** merged Phase 2; verified deployed backend; accepted dogfood
findings; MCP/package release workflow; plugin-maintenance workflow; smoke and
agent-evaluation harnesses.

**Acceptance criteria:** equivalent CLI/MCP requests produce equivalent
normalized service params and JSON facts; every view remains mode-minimal;
agents choose correct views/filters and avoid unsupported conclusions in
targeted Claude and Codex evaluations; MCP/CLI smoke, built smoke, plugin
generation/checks, package validation, and required release fragments pass;
durable instructions remain concise and truthful. Tactical files and steps are
intentionally deferred until Phase 2 reorientation supplies evidence.

## Phase 4: changelog steering

**Status:** blocked on a stable Phase 3 invocation and a committed/deployed
PkgSeer changelog-action contract.

**Expected outcome:** sparse or missing package range changelogs carry typed
package-only diff arguments that GitHits maps to the active CLI or MCP syntax
without matching human prose.

**Assumptions:** the future action remains transport-neutral and
package-addressed; the stabilized diff invocation can represent it directly.

**Unknowns/product decisions:** exact discriminator, field names, success/error
placement, and fallback behavior. Resolve from the future SDL and backend
implementation during phase-boundary reorientation.

**Dependencies:** merged Phase 3 and committed/deployed PkgSeer action schema.

**Acceptance criteria:** empty, partial, and missing-content range outcomes
steer to valid CodeDiff calls in both contexts; latest/repository outcomes and
unknown actions remain truthful; structural stays unexposed. Tactical detail is
intentionally deferred until the backend contract exists.

## Phase-boundary reorientation

After each phase merges and before detailing or implementing the next phase:

1. run `$next-steps` against current `origin/main` and fetch the backend's
   current `origin/main`;
2. inspect the merged delta, tests actually passed, SDL hash/changelog,
   deployment evidence, and dogfood findings;
3. record changed assumptions, decisions, dependencies, release boundaries,
   and contradictions in this same plan;
4. classify the next phase as `READY`, `REPLAN`, or `PRODUCT INPUT NEEDED`; and
5. add tactical detail only when its blocking evidence and product decisions
   are resolved.

Do not rebase or rewrite branch history unless explicitly requested. Do not
carry forward compare-era fields, unmeasured client defaults, or an unverified
changelog action shape.

## Overall acceptance, completion, and plan cleanup

The effort is complete only when:

- raw CodeDiff is released through CLI and MCP with exact-tree identity,
  truthful scope/inventory/content states, and evidence-backed defaults;
- typed changelog steering is consumed in both CLI and MCP contexts;
- structural remains honestly unexposed;
- durable implementation docs match shipped behavior and no compare-era
  contract remains in active guidance; and
- all required unit, build, parity, smoke, built-product, package-boundary,
  plugin, and agent validations for the affected phases pass.

Keep this plan through implementation review. After the final phase merges,
transfer all lasting architecture, contracts, operational findings, and
rollout decisions to `docs/implementation/`, then delete this temporary plan so
it cannot become stale guidance.
