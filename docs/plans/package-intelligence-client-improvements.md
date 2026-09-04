# Plan: Deeper package-intelligence client evidence

## Status

- Overall: **IN PROGRESS**
- Phase 1 — package overview distinguishes current-version and package-history
  evidence: **COMPLETE — merged in PR #350 at `9d267a2`**
- Phase 2 — dependency analysis exposes actionable issue and conflict evidence:
  **COMPLETE — merged in PR #351 at `16ecf75`**
- Phase 3 — vulnerability inspection optionally audits resolved transitive
  dependencies: **PENDING REORIENTATION — awaiting `$next-steps` after Phase 2 merge**
- Last verified: 2026-09-04

## Problem and expected outcome

At planning time, the package-intelligence backend already returned more
decision-relevant data than the shared CLI/MCP clients exposed. The largest gaps did
not require a new backend contract:

- `pkg_info` reported only the count affecting the latest version while verbose
  output immediately lists package-wide historical advisories. On the live
  `npm:express` response this renders “No active vulnerabilities” followed by
  five recent historical advisories, without stating the package-wide total.
- `pkg_info` omitted the already-available published-version count and download
  refresh timestamp.
- `pkg_deps` reports a conflict count in compact output but requires undocumented
  `--verbose` use to show even the conflicting package and constraints. It never
  exposes the backend's deprecated, outdated, duplicate, and richer conflict
  analysis.
- `pkg_vulns` can inspect all direct package advisories through `scope=all`, but
  cannot include vulnerabilities affecting resolved transitive dependencies even
  though the dependency GraphQL contract already provides that analysis.

When this plan is complete, CLI and MCP callers receive the same durable package
evidence:

- `pkg_info` distinguishes advisories affecting the returned version from all
  known package advisories and includes bounded metadata/freshness facts;
- `pkg_deps` can explicitly request dependency health analysis and turns conflict
  counts into package, constraint, and importer evidence; and
- `pkg_vulns` can explicitly request an npm-audit-style view of vulnerabilities
  affecting the resolved dependency graph while retaining its existing direct
  package history mode.

These are client contracts, not temporary backend workarounds. Future backend
summary, version, code-index, license, and version-history improvements may replace
wire selections or service calls, but do not replace these user-facing distinctions.

## Verified current state and evidence

### Shared ownership

- Root `src/commands/pkg/*.ts` owns Commander arguments, auth checks, terminal
  environment inputs, and CLI-native error presentation.
- `packages/mcp/src/tools/package-*.ts` owns MCP schemas/descriptions and thin tool
  orchestration.
- `packages/mcp/src/shared/package-*-request.ts` owns validation and normalized
  request construction shared by CLI and MCP.
- `packages/core-internal/src/services/package-intelligence-service.ts` owns the
  transport-neutral GraphQL documents, mode-sensitive selections, Zod validation,
  normalized service types, and typed backend errors.
- `packages/mcp/src/shared/package-*-response.ts` owns lean JSON projection and the
  single shared CLI/MCP text formatter for each tool.
- CLI `--json` and MCP `format: "json"` have parity tests and must continue to
  deep-equal for service-sourced results.

“CLI-only” in this plan means client-repository work requiring no backend change.
It does not mean terminal-only behavior: shared CLI and MCP surfaces change together
unless a surface-native hint or option spelling requires a deliberate difference.

### `pkg_info` baseline and merged result

The backend `PackageSummaryResult` exposed:

- `PackageIdentity.versionCount`;
- `PackageIdentity.downloadsRefreshedAt`; and
- `PackageSecurityOverview.allVulnerabilityCount`.

Before Phase 1, the client GraphQL document did not select or type these fields. Its
lean `vulnerabilities.total` held the backend's latest-version affected count, while
`recent` contained package-wide advisories. Default text labeled the former correctly
as latest-version risk, but verbose output did not state why historical rows followed
a zero count.

Authenticated source CLI probes on 2026-09-03 established the current baseline:

- `pkg info npm:express` returned version 5.2.1, 529M monthly downloads, zero
  vulnerabilities affecting latest, and no package-history count.
- `pkg info npm:express --verbose` then listed five historical advisories.
- The live JSON envelope likewise returned `vulnerabilities.total: 0` alongside
  the historical `recent` rows.

Post-implementation product review of the live color-enabled CLI on 2026-09-03
found two presentation defects in the otherwise-correct data contract:

- `Repository` and `Homepage` values are wrapped with the shared `dim()` style,
  which makes URLs dark grey and low-contrast in the reviewed terminal. The color
  module already exposes non-bold cyan through `colorize(..., "cyan", ...)`; no
  dedicated link abstraction exists.
- `Inspect history` is appended as an indented third vulnerability row. That makes
  an action look like evidence owned by the `Vulnerabilities` field and weakens the
  output hierarchy. CLI help already names the all-version `pkg_vulns` command. The
  MCP descriptor routes version-specific vulnerability-detail questions to
  `pkg_vulns`, but does not currently name `advisory_scope: "all"`; removing the inline
  hint therefore requires that small descriptor correction to preserve history
  discoverability.

The user explicitly accepted URL highlighting but rejected dark-grey highlighting,
and preferred removing `Inspect history` over retaining it as an inline row. This
supersedes the earlier plan decision that compact output needed a direct history
hint. The `Latest:` / `History:` evidence itself was accepted and remains unchanged.

The merged implementation retains `includeVerboseFields` as the cost boundary:
package-wide advisory count is compact/default evidence; version count and download
refresh time are verbose/JSON evidence. The backend declares
`allVulnerabilityCount` non-null inside the optional security block, so the client
must reject a present security block that omits it rather than treating the field as
optional.

### `pkg_deps`

The normal dependency query already selects typed `dependencyConflicts`, including
`conflictingEdges`, and the typed dependency graph needed to resolve edge indices
to importer identities. The lean response discards those edges and retains only
`{name, requiredVersions}`.

The backend also already exposes lazy `TransitiveDependencySummary.dependencyIssues`
with:

- aggregate deprecated, outdated, duplicate, and conflict counts;
- exact registry/name/version rows and deprecation reasons;
- latest-version and semver-delta evidence for outdated rows; and
- richer conflicts containing target versions, declared constraints, and graph
  edge indices.

The service Zod schemas and normalized `DependencyIssuesSummary` types exist because
`pkg_upgrade_review` consumes them, but the normal `PACKAGE_DEPENDENCIES_QUERY` and
`pkg_deps` request path never select them.

Authenticated `pkg deps npm:express --depth 3` on 2026-09-03 reported one conflict
but no detail. Adding `--verbose` revealed only:

```text
Conflicts (1):
  content-type:   ^1.0.5, ^2.0.0, ^2.1.0
```

The same verbose transitive listing already proved the graph contains the missing
importer evidence: Express requires `^1.0.5`; body-parser and type-is require
`^2.0.0`; negotiator requires `^2.1.0`. The gap is projection/discoverability, not
backend data.

### `pkg_vulns`

Direct package history is already implemented:

- CLI uses `--scope affected|non_affecting|all`;
- MCP uses `advisory_scope` with the same values;
- counts always distinguish affected, non-affecting, and all advisories; and
- descriptors, help, tests, and the `package-vulnerability-history` agent workload
  cover package-wide history.

Authenticated `pkg vulns npm:next` on 2026-09-03 reported zero affecting the latest
version and 64 historical advisories. `--scope all --json` returned all 64 rows.
The capability is already discoverable through CLI help. The MCP tool descriptor must
name the all-version `pkg_vulns` route as part of this correction; `pkg_info` does not
need to repeat that routing action inside its evidence table.

For transitive risk, the backend already exposes lazy
`packageDependencies.dependencies.transitive.vulnerabilitySummary(minSeverity:)`.
The core client already validates and normalizes its affected/non-affecting counts,
severity buckets, affected package rows, advisory IDs, most-critical advisory, and
bounded affected-version occurrences for `pkg_upgrade_review`. Transitive summaries
always exclude withdrawn advisories; the direct package query can optionally include
withdrawn rows. NuGet, Maven, and Packagist support direct vulnerability queries but
are not supported by the current dependency client.

### Contradictions resolved during planning

- The original concern that `pkg_vulns` cannot inspect package history is stale:
  current CLI/MCP behavior supports it and live evidence verifies it. CLI help and
  the MCP descriptor provide sufficient discovery; default `pkg_info` output should
  stay focused on the evidence it owns.
- The original concern that dependency conflict details are absent from GraphQL is
  false. Typed edges already exist. Current output hides or drops them.
- The original Phase 1 plan treated an inline `Inspect history` action as necessary.
  Product review of the implemented output rejected that hierarchy. The action will
  be removed from `pkg_info` text rather than moved into another section; CLI help
  and the MCP descriptor are the routing owners. The descriptor needs a small wording
  correction because it currently mentions only version-specific details.
- Repository code statistics exist in `codeOverview`, but composing `targetInfo`
  and a potentially index-triggering query inside `pkg_info` would be a temporary,
  latest-only client workaround. This plan waits for the backend-owned no-side-effect
  contract instead.

## Scope

1. Enrich `pkg_info` with already-available advisory-scope, version-count, and
   download-freshness evidence.
2. Finish the `pkg_info` presentation with readable URL emphasis and a vulnerability
   block containing evidence only.
3. Add explicit dependency issue analysis to `pkg_deps` and make current conflict
   evidence actionable.
4. Add explicit transitive vulnerability audit mode to `pkg_vulns`.
5. Preserve shared CLI/MCP JSON parity, compact text hierarchy, typed errors,
   minimal GraphQL selections, smoke coverage, and agent discoverability.
6. Update permanent implementation documentation and add one independent changes
   fragment per delivered phase.

## Non-goals

- `pkg_quality` and package comparison. The user postponed both on 2026-09-03
  because their product contracts need more work.
- Version-aware `pkg_info`; tracked by private backend issue #2211.
- Exact-version, non-triggering code-index availability and repository statistics;
  tracked by private backend issue #2212.
- Transitive dependency licenses; tracked by private backend issue #2213.
- Package version listing/history; tracked by private backend issue #2214.
- Client-side N+1 fallbacks for version, license, code-index, or repository data.
- A new aggregate backend query, cache, queue, feature flag, retry loop, or local
  vulnerability/semver evaluator.
- Changing default direct-package vulnerability scope from affected to all.
- Treating historical or transitive advisory presence as an approval, rejection,
  or risk verdict.
- Documentation availability, monorepo sibling-package discovery, and new package
  commands. These are separate product surfaces, not required to close the verified
  gaps above.
- A repository-wide URL-color redesign. Phase 1 changes only the two URL values in
  `pkg_info`; other formatters retain their current presentation until separately
  reviewed.

## Target architecture

### Boundaries and ownership

Package summary owns root-package identity and overview facts. Dependency analysis
owns the resolved graph and its health evidence. Vulnerability presentation owns the
user's direct-plus-transitive audit question, but consumes dependency analysis rather
than reimplementing graph traversal.

The durable data flow remains:

```text
CLI command / MCP tool
  -> shared request builder
  -> PackageIntelligenceService
       -> field-minimal GraphQL query selected by requested mode
       -> Zod validation and neutral normalized types
  -> shared lean response builder
  -> JSON, or one shared text formatter
       CLI: colors, terminal width, CLI-native hints
       MCP: no colors, bounded fallback width, MCP-native hints
```

No entrypoint owns response semantics independently. New booleans are explicit
opt-ins and work when sent as `true`; omission and explicit `false` retain current
behavior. A flag that requests graph analysis drives the necessary backend
computation internally, while the service selects only the result fields the chosen
client view consumes. Callers never have to discover and combine coupled flags.

### Stable public response principles

- Keep existing fields and meanings. In particular,
  `pkg_info.vulnerabilities.total` continues to mean advisories affecting the
  returned/latest version; it is never silently redefined as package-wide history.
- Add scope-explicit fields. Package-wide history and dependency audit evidence must
  be named so a future selected-version `pkg_info` remains unambiguous.
- JSON remains lossless for every selected backend fact, but expensive analysis is
  absent unless explicitly requested.
- Text remains bounded and outcome-first. Default text includes decisive counts;
  compact issue evidence is bounded to the resolved terminal width with ASCII
  ellipses and a single complete-detail hint, while verbose text wraps without
  dropping selected rows or requirements. Follow-up actions belong after evidence
  only when the current output needs them to complete the task. `pkg_info` needs no
  inline action because CLI help routes history today and the corrected MCP
  descriptor will route all-version callers to `pkg_vulns`.
- Backend registry/version matching and advisory classification remain authoritative.

### Error and partial-result behavior

- Existing direct-only behavior and errors are unchanged when new flags are absent.
- An explicitly requested dependency issue or transitive vulnerability analysis does
  not silently degrade to direct-only output. Unsupported registries and failed graph
  analysis return the existing typed client/backend error envelope.
- Direct `include_withdrawn` applies only to direct package advisories because the
  existing transitive backend summary excludes withdrawn advisories. Text and JSON
  state that distinction; no client-side approximation is added.
- `min_severity` applies to both direct and transitive advisories when transitive
  audit is requested. Direct `advisory_scope` continues to control direct advisory
  rows; transitive audit reports only advisories affecting resolved dependency
  versions.

## Assumptions and unknowns

### Overall assumptions

- The currently deployed GraphQL fields match the committed backend schema inspected
  on 2026-09-03; authenticated live probes confirmed the existing summary, history,
  and conflict paths.
- Additive CLI flags and MCP arguments are appropriate because issue/security graph
  analysis is materially more expensive than current defaults.
- `text-v1` can evolve in place while JSON fields remain additive and existing field
  meanings remain stable.
- Non-bold cyan is the Phase 1 URL emphasis color. This is an explicit planning
  assumption based on the user's acceptance of URL highlighting and rejection of
  dark grey; it uses an existing color primitive, preserves ordinary text weight,
  and does not make color carry meaning.
- Each phase is a separate implementation/review/PR increment to keep tool behavior,
  output review, and release impact bounded.

### Overall unknowns or product decisions

- None for Phases 1 and 2. This plan fixes non-bold cyan and removal of the inline
  action as the Phase 1 product contract.
- Phase 3 tactical detail will be refreshed now that Phase 2 has merged, but its product
  outcome, opt-in behavior, scope semantics, and error behavior are decided here.

## Cross-cutting considerations

### Security and trust

- Package descriptions, advisory summaries, deprecation reasons, repository URLs,
  and dependency metadata remain untrusted backend text. Reuse existing guardrails
  and sanitization boundaries; do not interpolate them into executable commands.
- Counts, affectedness, constraints, versions, and importer edges are evidence, not
  advice. Formatters must not declare a package safe, compatible, legally acceptable,
  or suitable for upgrade.
- No credentials or raw GraphQL/auth payloads enter fixtures, docs, diagnostics, or
  review evidence.

### Performance and data fetching

- This is not an optimization; no performance benchmark is required. Graph analysis
  cost is nevertheless part of the public contract.
- `pkg_info` selects compact/default fields unconditionally and gates verbose/JSON-only
  metadata with the existing directive variable.
- `pkg_deps` selects `dependencyIssues` only for explicit issue analysis. It preserves
  the existing single-query graph selection because root edges are required to map
  direct constraints to resolved versions; an uncapped issue analysis therefore has
  an explicit full-graph payload cost.
- Ordinary transitive conflict projections also fail closed when a returned conflict
  contains indexed `conflictingEdges` but the nullable companion graph is absent.
  Edge-free conflict summaries remain valid without a graph because they require no
  index resolution.
- When issue analysis is explicitly selected, the service fails closed if either the
  nullable `dependencyIssues` result or its companion graph is absent; default and
  explicit-false calls retain their existing nullable transitive behavior.
- `pkg_vulns` selects transitive vulnerability fields only for explicit transitive
  audit and does not select the dependency graph.
- Wire tests assert variables, directives, and omitted subtrees for default and
  detailed modes. No field is selected solely for possible future use.
- Text samples are bounded; JSON reports complete selected aggregate/package rows and
  explicit truncation whenever advisory occurrence samples are capped.

### Compatibility, migration, and rollback

- There is no stored state or migration. Each phase is an additive option/field plus
  intentional `text-v1` wording improvement.
- Existing commands, MCP calls, JSON fields, default network cost, and typed errors
  remain compatible when new options are omitted or explicitly false.
- Each phase can be reverted independently; no rollout flag or dual path is needed.
- Every phase changes both root `githits` and public `@githits/mcp` behavior and adds
  an independent changes fragment with explicit pending SemVer impact. Feature PRs
  do not edit versioned changelogs or bump package versions.

### Documentation and release lifecycle

- Update `docs/implementation/tools.md`, `docs/implementation/cli-commands.md`, and
  `docs/implementation/mcp-cli-parity.md` with the final request, response, fetching,
  and text contracts.
- Update MCP descriptions/instructions only where routing behavior changes. If stable
  MCP quick-start guidance changes, update its public Agent Skill copy through the
  repository plugin-generation workflow and preserve exact parity.
- After all phases are implemented and their durable contracts are transferred to
  implementation docs, delete this plan. Backend issues remain the durable record for
  excluded backend work.

## Phase map

### Phase 1 — package overview distinguishes version risk from package history

- **Status:** COMPLETE — data contract and UX correction merged in PR #350 at
  `9d267a2`
- **Expected outcome:** `pkg_info` reports affecting-latest and package-wide advisory
  counts without contradiction; its URL values remain readable in color-enabled
  terminals; its vulnerability field contains evidence rather than an embedded action;
  and verbose/JSON callers receive version-count and download-freshness evidence already
  available from the summary resolver.
- **Assumptions:** Existing `PackageSummaryResult` field semantics remain deployed;
  no new backend request is needed. Existing non-bold cyan is an acceptable URL accent
  based on the user's stated color direction.
- **Unknowns or product decisions:** none.
- **Dependencies:** current package-summary query, shared response builder/formatter,
  CLI/MCP parity, and existing compact/verbose field directive.
- **Acceptance criteria:** default text distinguishes latest-version affected count
  from package-wide history; JSON adds scope-explicit package-history evidence without
  changing existing field meanings; verbose/JSON surface version/freshness fields;
  repository and homepage URLs use the same non-dim cyan treatment when ANSI is enabled;
  no `Inspect history` row appears in compact or verbose CLI/MCP text; default wire
  selection remains minimal; deterministic, parity, smoke, build, documentation,
  release-fragment, and targeted agent-eval checks pass.

### Phase 2 — dependency issues and conflicts become actionable

- **Status:** COMPLETE — merged in PR #351 at `16ecf75`
- **Expected outcome:** callers can explicitly request deprecated, outdated,
  duplicate, and conflict analysis, and every visible conflict can identify the
  target package, incompatible constraints, and contributing importers without
  decoding graph indices.
- **Assumptions:** `dependencyIssues` and conflict-edge indices refer to the selected
  companion dependency graph; current schemas and upgrade-review consumption verify
  those shapes.
- **Unknowns or product decisions:** none.
- **Dependencies:** Phase 1 merged only for sequencing; technically independent.
- **Acceptance criteria:** one effective option requests issue analysis and the graph
  evidence needed to preserve direct resolved versions and conflict provenance;
  default calls do not
  select/compute issues; bounded text and additive JSON expose
  typed issue evidence; current conflict-only transitive output gains importer
  provenance; graph scope/depth is explicit; parity, wire, smoke, build,
  documentation, release-fragment, and targeted agent-eval checks pass.

### Phase 3 — vulnerability inspection optionally audits transitive risk

- **Status:** PENDING REORIENTATION — awaiting `$next-steps` after Phase 2 merge
- **Expected outcome:** an explicit `pkg_vulns` transitive mode reports direct
  package affectedness plus vulnerabilities affecting resolved dependency versions,
  with severity, package/version, matched-range, and nearest-fix evidence and without
  changing direct-only defaults.
- **Assumptions:** The backend retains the current lazy transitive vulnerability
  summary and affected-occurrence semantics.
- **Unknowns or product decisions:** none. Exact file/fixture detail is intentionally
  deferred until the post-Phase-2 reorientation.
- **Dependencies:** Phase 2 merged and `$next-steps` reorientation against current
  `origin/main`; neutral package-dependency service ownership remains intact.
- **Acceptance criteria:** one explicit option requests the full resolved dependency
  audit without selecting the dependency graph payload; unsupported graph registries
  fail honestly; severity applies to both scopes;
  direct history and transitive affectedness remain distinct; withdrawn semantics and
  occurrence truncation are explicit; default query cost/output remain unchanged;
  parity, wire, smoke, build, docs, release-fragment, and agent-eval checks pass.

## Phase 1 implemented contract

### Behavioral contract

Extend normalized summary types and the lean envelope additively:

- `PackageIdentity.versionCount?: number`;
- `PackageIdentity.downloadsRefreshedAt?: string`;
- `PackageSecurityOverview.allVulnerabilityCount: number` whenever the optional
  security block exists;
- lean top-level `versionCount?: number`;
- `downloads.refreshedAt?: string`; and
- additive top-level `advisoryHistory?: { total: number }`.

Keep `vulnerabilities.total` and `affectsLatest` unchanged for compatibility.
Continue emitting `vulnerabilities` only when the backend's nullable
`vulnerabilityCount` exists. Independently emit `advisoryHistory.total` whenever the
security block exists; it is the package-wide, deduplicated, non-withdrawn count and
remains valid if `vulnerabilityCount` is null. `vulnerabilities.recent` remains
package-wide for compatibility. Do not emit an absent security block as zero. Treat a
present security block without its schema-required package-wide count as a malformed
service response.

Default text uses scope-explicit wording from the two independent blocks:

```text
Vulnerabilities  Latest: none affected
                 History: 5 known across all versions
```

Use singular/plural grammar and preserve an explicit unavailable distinction. If the
latest count is null but the security block exists, render `Latest: unavailable`
alongside the verified history count; do not invent `vulnerabilities.total`. If the
history count is greater than the latest affected count, preserve both facts without
adding an inline action or printing historical rows in compact `pkg_info`. CLI help and
the corrected MCP descriptor own the route to `pkg_vulns`.

In color-enabled CLI output, render the repository and homepage URL substrings in
existing non-bold cyan rather than with `dim()`. Keep attached repository statistics in
the normal foreground color. No-color CLI and MCP text retain identical characters,
ordering, and wrapping, so the emphasis never carries information.

Verbose text adds compact trust facts rather than another prose section:

- published version count when present; and
- download refresh date when download counts and refresh evidence are present.

JSON always includes selected verbose fields because MCP JSON and CLI `--json` already
request `includeVerboseFields`; compact text does not fetch them.

### Edge cases

- `advisoryHistory.total: 0` must be emitted and rendered as verified zero, not
  omitted.
- An absent security block is unavailable, not zero; a present block missing the
  required package-wide count fails service validation.
- A null latest-version count with a valid history count emits only
  `advisoryHistory` in JSON and renders latest evidence as unavailable in text.
- `vulnerabilities.total > 0` with `affectsLatest: false` is tolerated as backend drift evidence and
  rendered from counts without inventing a stronger boolean claim.
- A history total below the latest-version total is contradictory backend data.
  Preserve both JSON facts, avoid a misleading text comparison, and cover the
  conservative text behavior.
- URL emphasis changes only the repository/homepage substrings when colors are enabled;
  missing URLs, repository statistics, wrapping, no-color output, and MCP output retain
  their existing behavior.
- Refresh timestamp without a download count is omitted from text but retained in JSON.
- Version count zero is retained in JSON; released packages normally have at least one,
  but the client does not add an unverified guard.

### Phase 1 implementation record

Implemented and merged on 2026-09-03 in bounded product commits, including:

- `77bdbc6` adds the minimal GraphQL selections, normalized service types, strict
  security-block validation, and compact-versus-detailed wire tests;
- `9254dac` adds the additive JSON evidence and shared scope-explicit formatter;
- `77a6928` connects CLI/MCP surface-native hints and preserves JSON parity;
- `8e46c27` adds authenticated and deterministic smoke assertions; and
- `ac3e2b0` records the permanent contract and pending release impact; and
- `418e480` wraps the vulnerability evidence and history action to the caller's
  terminal width after implementation review found the initial rows could overflow;
- `050ed54` keeps the history action available when latest evidence is unavailable
  and labels verbose rows explicitly as all-version history; and
- `6a68469` applies the same scope label to CLI/MCP help and discovery text; and
- `087f43a` aligns the authored package skill, stable MCP quick-start copy, and CLI
  help layout with the advisory-scope contract; and
- `5e33dc7` separates and aligns the `Latest:` and `History:` evidence after the first
  live-output review; and
- `ba5dc73` applies the final URL contrast, evidence-only hierarchy, surface cleanup,
  and unambiguous MCP history route.

PR #350 merged to `main` as `9d267a2` on 2026-09-03. The release fragment remains
pending: the merged CLI and MCP behavior has not yet been released, published, or
deployed to the hosted MCP server.

Verified results:

- affected focused suites passed, including 63 core-service tests, 35 response
  tests, 32 entrypoint/parity tests, and 131 smoke-helper tests;
- the final full suite passed: 3,829 tests, 0 failures;
- typecheck, lint, formatting, build, and public-package validation passed;
- plugin generation produced no derived diff and plugin consistency checks passed;
- authenticated source CLI and MCP smoke suites passed against the deployed backend;
- built unauthenticated CLI and MCP smoke suites passed;
- Codex full-guidance evaluations passed both target workloads with high confidence,
  used the intended `pkg_info`/`pkg_vulns` tools, and produced no isolation-violation
  artifact; raw calls and final answers were inspected; and
- the Claude workload harness was present but not logged in, so its overview run
  stopped before any tool call. The identical history run was not repeated. This is
  an eval-environment limitation, not product evidence.

The implementation required no backend change, new infrastructure, fallback, or
ownership move. Subsequent product review of `5e33dc7` accepted the evidence lines but
reopened Phase 1 for URL contrast and action hierarchy. At that point Phase 2 was a
separate ready increment; it is now implemented as recorded above. Phase 3 still
requires the planned post-Phase-2 reorientation.

Review closed one terminal-width defect in the internal runtime pass. Three external
Claude Opus rounds then closed independent-history action gating, all-version scope
labels across formatter/help/skills, CLI help reflow, and the public Agent Skill
release clause. The round-3 code verdict was clean; its final release-metadata note
was fixed directly under the three-round limit. No automated review finding remained
at that point; the later user product feedback above supersedes the accepted inline-hint
decision and is not a deferred review finding.

### Phase 1 UX correction implementation record

**Ownership:** the shared package-summary response formatter naturally owns URL styling
and field hierarchy because it is the single CLI/MCP text renderer. CLI help and the MCP
descriptor own surface-specific command routing, so removing the formatter's `surface`
option restores the simpler boundary. The MCP tool definition owns its one missing
all-version routing phrase; no new helper or abstraction is needed.

Expected terminal anatomy:

```text
Repository       https://github.com/expressjs/express (69k stars, 24k forks, 235 issues)
Homepage         https://expressjs.com/
Published        9 months ago
Downloads        529M / month
Vulnerabilities  Latest: none affected
                 History: 5 known advisories across all versions
```

The two URLs are non-bold cyan only when colors are enabled. The example intentionally
contains no `Inspect history` row. Verbose sections continue after a blank line exactly
as they do now.

#### Implemented result

- Response tests now lock non-bold cyan URL substrings, normal-color repository
  statistics, ANSI-stripped/no-color equivalence, the unchanged aligned vulnerability
  lines, and absence of `Inspect history` for positive, zero, and unavailable evidence.
- The shared formatter colors only repository and homepage URLs with existing cyan,
  removes the inline history action, and no longer accepts a surface discriminator.
- Thin CLI/MCP entrypoints no longer pass surface identity. CLI help retains
  `githits pkg vulns <registry>:<name> --scope all`; the MCP descriptor unambiguously
  routes version-specific details to `pkg_vulns` and package-wide history to
  `pkg_vulns` with `advisory_scope: "all"`.
- Permanent implementation docs and the existing Phase 1 changes fragment describe the
  final evidence-only output and discovery routes.
- Live compact, verbose, and narrow-width output confirms the accepted hierarchy and
  cyan contrast without changing the existing URL-row wrapping behavior.

#### Increment boundaries and failure behavior

- Do not change GraphQL selections, service types, JSON, vulnerability counts, verbose
  advisory rows, line wrapping, labels, or section ordering.
- Do not introduce terminal hyperlinks, underline escapes, a new brand token, or a
  repository-wide link helper. Existing cyan is sufficient for this scoped correction.
- Missing URLs remain omitted. ANSI-disabled and MCP output contain plain URL text and
  remain semantically complete.
- The reviewed live terminal accepted existing non-bold cyan; no new palette token or
  repository-wide styling rule was introduced.

#### Increment acceptance criteria

- Color-enabled `pkg_info` renders repository and homepage URL substrings with existing
  non-bold cyan and never applies ANSI dim to them; repository statistics retain normal
  weight/color.
- Removing ANSI produces the same characters, line order, and meaning as no-color/MCP
  text.
- Compact and verbose CLI/MCP text contain exactly the accepted `Latest:` and `History:`
  vulnerability evidence and no `Inspect history` row.
- CLI help still names `githits pkg vulns <registry>:<name> --scope all`; the MCP
  descriptor explicitly names `pkg_vulns` with `advisory_scope: "all"` for package-wide
  history, without weakening descriptor first-sentence/first-80 contracts.
- The formatter surface discriminator and its entrypoint plumbing are removed rather
  than retained unused.
- Focused formatter/tool/command/parity tests, full tests, typecheck, lint, formatting,
  build, public-package validation, all source/built CLI/MCP smokes, live output review,
  and available targeted agent evaluations pass.

#### Correction verification

- Test-first focused coverage produced eight expected failures before the formatter
  change; the completed focused set passed 71 tests with no failures.
- The full suite passed 3,829 tests with no failures. Typecheck, lint, formatting,
  build, and public-package validation also passed.
- Source and built CLI/MCP smoke suites passed. The first source-smoke run reached the
  changed `pkg_info` assertions, then encountered an Express code snapshot actively
  indexing in a later step; an immediate full rerun passed all 93 CLI and 50 MCP steps.
- Live `npm:express` compact, verbose, and 40-column output was inspected with colors
  enabled: URLs use cyan, vulnerability evidence remains aligned, and no inline action
  appears.
- Final descriptor-only Codex evaluations passed both package overview and package-wide
  history workloads with high confidence. Both used `pkg_info` and `pkg_vulns` with
  `advisory_scope: "all"`; no isolation violation was reported. One history workload
  call combined the invalid `version: "latest"` sentinel with package-wide scope, then
  self-corrected to the documented no-version call and returned the correct result. The
  Claude eval harness remains unavailable because it is not logged in.
- Internal review found one ambiguous MCP routing sentence. The one-line wording fix and
  exact descriptor assertions make the two vulnerability routes explicit; the same
  reviewer then reported the correction clean. External review then found one
  low-severity argument-notation mismatch (`=` instead of the descriptor convention's
  `:`); source, assertions, and docs were corrected, focused tests and the targeted eval
  were repeated, and the retained reviewer reported the final correction clean.

### Phase 1 acceptance criteria

- Existing JSON keys retain their values and meanings.
- Additive fields accurately distinguish returned-version affectedness from
  package-wide history and preserve null-versus-zero.
- Compact text no longer juxtaposes zero latest risk and historical rows without a
  package-history count.
- Compact text does not fetch version count, download freshness, recent advisories,
  or recent changes; verbose/JSON do.
- CLI and MCP JSON deep-equal; package-summary text differs only in ANSI/width inputs.
- URL emphasis is non-dim, optional, and semantically redundant; `Inspect history` is
  absent from compact and verbose package-summary text.
- No new backend call, fallback, cache, or broad package-summary field dump is added.
- Required tests, smoke, build/package validation, docs, changes fragment, and
  available targeted agent evaluations complete successfully; any unavailable agent
  harness is verified and recorded explicitly.

## Phase 2 implemented result

Phase 2 is complete and merged in PR #351 at `16ecf75`. It delivered CLI
`--issues` and MCP `include_issues`, conditional issue and companion-graph
selection with full-graph versus depth-bounded cost, exact lossless issue/conflict
JSON requirements, bounded compact and complete wrapped verbose text, and
fail-closed validation for missing issue/graph data and edge-backed ordinary
transitive conflicts. Edge-free conflict summaries remain valid without a graph.
There was no backend change and no new infrastructure.

Live representative inspection covered `npm:express` (69 graph nodes and issue total
8) and `npm:is-number` (one root graph node and issue total 0). Final gates covered
3,976 tests plus typecheck, lint, format, build, and package validation; source smoke
passed with CLI 103 and MCP 54, and built smoke passed with CLI 23 and MCP 8.
The final Codex descriptor evaluation reported high confidence after 9 MCP calls,
with correct issue, importer, lifecycle, and full-versus-bounded routing. Claude
evaluation was unavailable because its harness was not logged in.

Internal full-delta review was clean. Three external Opus rounds found valid issues
and all were fixed; the round-3 graph fix received a final internal clean result, and
no round 4 was run because the review cap was reached. No unresolved findings remain.
The final review also corrected the earlier contradiction: edge-backed ordinary
transitive conflicts were added in Phase 2 and are now covered by both width and
graph validation.

Phase 2 commits, grouped compactly: feature work `56eed9f`, `ddde860`, `df37442`,
`942278d`, `e5d9e9e`, `003141f`; tests/smoke/docs `4e1900a`, `aa1a3af`, `258c352`;
corrections `07e11f5`, `e4fe879`, `01df950`, `2b4ef01`, `4bd9110`, `16dc4ca`,
`d38b8c3`. The implementation was merged by PR #351 and is not yet released or
deployed.

## Phase 2 detailed implementation plan

### Readiness recheck after Phase 1 merge

Reverified on 2026-09-03 against fresh `origin/main` at `9d267a2`. No merged change
altered the normal package-dependency request, response, tool, command, or service
paths. The local backend GraphQL schema still exposes lazy `dependencyIssues`, typed
`dependencyConflicts`, graph nodes, and indexed conflict edges with the shapes below.
A live `npm:express` dependency probe still reports one conflict without importer
detail, while a live upgrade-review probe with dependency issues successfully returned
current and target issue totals from the deployed backend. Phase 2 therefore remained
relevant and implementation-ready at that recheck, with no product decision or
missing contract detail; it is now merged as recorded above.

### Behavioral contract

Add one explicit issue-analysis option:

- CLI: `--issues`;
- MCP: optional `include_issues: boolean`.

Omission and explicit `false` preserve current behavior. `true` internally requests
transitive analysis, the lazy `dependencyIssues` result, and the companion graph used
to preserve current direct resolved versions and resolve conflict endpoints; it does
not require `max_depth` or `include_importers`. If `max_depth` is also supplied,
analysis and the selected graph cover only that bounded depth and the response echoes
the depth. Without a depth, issue analysis and its graph payload cover the full
resolved graph. This potentially large payload is an explicit opt-in cost.

Add this exact additive top-level lean contract. The scope discriminator makes an
uncapped resolved-graph analysis distinguishable from a caller-bounded one:

```ts
interface LeanDependencyIssueScope {
  mode: "full" | "depth_limited";
  maxDepth?: number; // present exactly when mode is "depth_limited"
}

interface LeanIssueCategory<T> {
  count: number;
  items: T[];
}

interface LeanDeprecatedDependencyIssue {
  registry: string;
  name: string;
  versions: string[];
  reasons: Array<{ version: string; reason?: string }>;
}

interface LeanOutdatedDependencyIssue {
  registry: string;
  name: string;
  latestVersion?: string;
  severity: string;
  versions: Array<{ version: string; severity: string }>;
  repositoryUrl?: string;
}

interface LeanDuplicateDependencyIssue {
  registry?: string;
  name: string;
  versions: string[];
}

interface LeanDependencyNodeIdentity {
  registry: string;
  name: string;
  version?: string;
  root?: true;
}

interface LeanConflictRequirement {
  constraint: string;
  dependencyType: string;
  importer: LeanDependencyNodeIdentity;
  target: LeanDependencyNodeIdentity;
}

interface LeanDependencyConflictIssue {
  registry?: string;
  name: string;
  versions: string[];
  requiredVersions: string[];
  requirements: LeanConflictRequirement[];
}

interface LeanDependencyIssues {
  total: number;
  scope: LeanDependencyIssueScope;
  deprecated: LeanIssueCategory<LeanDeprecatedDependencyIssue>;
  outdated: LeanIssueCategory<LeanOutdatedDependencyIssue>;
  duplicates: LeanIssueCategory<LeanDuplicateDependencyIssue>;
  conflicts: LeanIssueCategory<LeanDependencyConflictIssue>;
}
```

Category counts and item arrays map from their same-named backend facts; they are not
recomputed. Registry identities use the existing envelope convention of canonical
lowercase values; preserve package names, resolved versions, latest versions,
severity, repositories, reasons, and conflict-edge evidence exactly. Reasons remain
untrusted prose and outdated evidence does not become an upgrade recommendation.

The existing `LeanTypedConflict` keeps `name` and `requiredVersions` and adds required
`requirements: LeanConflictRequirement[]`. Issue conflicts use the fuller interface
above because their backend rows also carry registry and resolved target versions.

The dependency resolver does not expose resolved direct versions outside the graph:
the client needs root outgoing edges to map direct constraints to the correct node
when several versions of one package exist. Preserve the current single-query path
instead of adding a second depth-one alias/query merely to shrink issue-mode output.
The resulting wire contract is:

| Effective client view | `dependencyIssues` | Graph nodes | Graph edges | `vulnerabilitySummary` |
| --- | --- | --- | --- | --- |
| Direct/default | no | yes, depth 1 | yes, depth 1 | no |
| Transitive footprint and conflicts | no | yes, requested depth | yes, requested depth | no |
| Transitive importer provenance | no | yes, requested depth | yes, requested depth | no |
| Dependency issues | yes | yes, issue depth | yes, issue depth | no |
| Transitive vulnerability audit | no | no | no | yes |

Project conflict edges into stable importer evidence while the typed graph is present:

```text
content-type
  ^1.0.5 required by express@5.2.1
  ^2.0.0 required by body-parser@2.3.0, type-is@2.1.0
  ^2.1.0 required by negotiator@1.1.0
```

Use the same one-edge-to-one-requirement projection for existing
`transitive.conflicts` and issue-analysis conflicts so internal graph indices never
escape the shared client envelope. Retain existing `name` and `requiredVersions` keys;
add `requirements` additively. Each requirement preserves edge multiplicity,
`versionConstraint`, and `dependencyType`, replacing `fromIndex`/`toIndex` with the
complete referenced node identities. A null `fromIndex` becomes the inspected package
identity with `root: true`; no JSON deduplication is allowed. Deterministic sorting and
deduplication are presentation-only for compact text.

Default text shows category counts and bounded examples. Compact issue evidence stays
within the resolved terminal width with formatter-authored ASCII `...`; any shortened
row uses one caller-supplied complete-detail hint. CLI `--verbose` expands all selected
issue rows and importer details, wrapping long prose/lists without dropping evidence.
MCP compact text remains bounded and directs callers to `format:"json"` for complete
rows; no generic MCP verbose flag is added in this phase. Correct the existing CLI
`--verbose` help, which currently mentions only group metadata despite also controlling
importer and conflict detail.

### Likely affected components

- `packages/core-internal/src/services/package-intelligence-service.ts` and its test:
  add a neutral `includeDependencyIssues` package-dependency parameter, conditionally
  select the already-typed `dependencyIssues` subtree, retain the existing graph
  selection needed for direct versions/conflict endpoints, and prove issue omission on
  default requests. Do not route normal dependency callers through the
  upgrade-review-specific service method.
- `packages/mcp/src/shared/package-dependencies-request.ts` and its test: normalize
  `includeIssues`, make it imply internal graph analysis, and preserve current registry,
  depth, lifecycle, and version validation.
- `packages/mcp/src/shared/package-dependencies-response.ts` and its test: add the
  exact issue interfaces above, graph-index resolution, lossless JSON projection,
  text-only deduplication/sorting, and bounded text.
- `packages/mcp/src/tools/package-dependencies.ts` and its test: add `include_issues`,
  update selection/routing copy, and retain the first-sentence/first-80 contract.
- `src/commands/pkg/deps.ts` and its test: add `--issues`, correct verbose help, and
  pass the shared option.
- Shared service fixtures, parity tests, smoke assertions, docs, and one independent
  `changes/*.added.md` fragment.

### Ordered implementation steps

1. Add failing request/service tests proving `include_issues`/`--issues` requests
   `dependencyIssues` and uses the existing graph selection at the issue-analysis
   depth, while omission/false leaves issue computation and current graph depth
   unchanged. Cover default depth-one, issues-only unbounded/bounded, transitive, and
   combined selections independently.
2. Extend the neutral package-dependency service path with conditional issue selection;
   reuse existing schemas/normalizers and remove no upgrade-review behavior.
3. Add failing pure projection tests for the exact four category shapes, zero/empty
   categories, full versus depth-limited scope, multiple resolved versions, repeated
   edges, distinct lifecycle types, multiple importers per constraint, and
   synthetic-root edges.
4. Implement one graph-edge-to-importer projection helper owned by the dependency
   response module and use it for both current conflicts and issue conflicts.
5. Add the issue envelope and bounded formatter sections; update CLI/MCP options,
   descriptions, and surface-native detail hints.
6. Update parity/smoke fixtures, permanent docs, and the release fragment.
7. Run focused and full verification plus the package-dependencies agent workload.

### Edge cases and failure behavior

- Zero issues is positive checked evidence and emits `issues.total: 0` plus empty
  category shapes; it is not omitted after explicit issue analysis.
- Multiple versions of one dependency stay one registry/name row with all versions.
- Synthetic-root conflict edges have no dependency importer node; label the root from
  the inspected package identity rather than dropping the constraint.
- Treat the backend's documented conflict-edge indices as an invariant. Do not add a
  fallback for out-of-range indices without a reproduction; a verified violation belongs
  at the service/schema boundary rather than in presentation.
- Registry identities are canonical lowercase in the envelope; package names and
  versions plus every conflict edge's constraint and dependency type remain exact
  backend facts. Sorting/deduplication is text presentation only; JSON keeps one
  requirement per backend conflict edge.
- Unsupported dependency registries continue to fail in the existing request builder
  before a network call.

### Phase 2 verification

- Focused request/service/response/tool/command/parity tests.
- `bun test`.
- `bun run typecheck`, `bun run lint`, and `bun run format:check`.
- `bun run build` and `bun run validate:packages`.
- All four CLI/MCP source and built smoke commands.
- Targeted Claude and Codex agent evaluation with `package-dependencies.md`; inspect
  whether agents request issue analysis for deprecation/outdated/conflict questions,
  consume importer evidence, and avoid unsupported verdicts.

### Phase 2 acceptance criteria

- One uncoupled option requests issue analysis on both public surfaces.
- Default calls and explicit false do not select or compute `dependencyIssues`.
- Issue JSON follows the exact contract above and is additive, typed, deterministic,
  and complete for selected backend rows and conflict-edge evidence.
- Conflict output names contributing importers and constraints without exposing graph
  indices, while preserving existing keys for callers.
- Text stays bounded, surfaces verified zero, and provides a useful complete-detail
  action.
- Scope/depth is explicit.
- No upgrade-review-specific method becomes the owner of normal dependency analysis.
- Required deterministic tests, smoke, build/package validation, docs, changes
  fragment, and targeted evals complete successfully.

## Phase-boundary reorientation

After each phase merges, run `$next-steps` against current `origin/main` before
detailing or implementing the next phase. Record merged behavior and validation,
re-check the deployed backend schema and live representative outputs, update changed
assumptions/contracts, and add tactical detail only for the next one or two phases.

Do not continue if reorientation reports `REPLAN` or `PRODUCT INPUT NEEDED`. In
particular, Phase 3 must re-check transitive registry support, withdrawn semantics,
occurrence bounds, and any backend changes that landed with private issues #2211–#2214.

## Completion and plan cleanup

This effort is complete when all three client phases are merged, released behavior is
documented under `docs/implementation/`, relevant changes fragments remain available
for release preparation, default network cost is unchanged, and CLI/MCP parity plus
agent routing are verified.

Before deleting this plan:

1. transfer final request/response shapes, formatter anatomy, GraphQL selection rules,
   supported-registry caveats, and verification commands to permanent implementation
   documentation;
2. confirm no backend-owned work or review finding exists only in this temporary file;
3. leave private backend issues #2211–#2214 as the durable backlog for their excluded
   contracts; and
4. delete this plan in the final implementation PR rather than leaving stale phase
   instructions behind.
