# Package Upgrade Review

## Purpose

Dependency-upgrade reviews are a distinct agent workflow. Agents should not infer acceptability from semver, especially for patch updates. The tool surface should make evidence collection cheaper than manually composing `pkg_changelog`, `pkg_vulns`, and `pkg_deps` calls for every package.

`pkg_upgrade_review` is the MCP/CLI-facing tool for this workflow. It answers: "What changed between the currently used version and the target version, and what evidence is available or missing?"

This report reflects the backend schema inspected at `/Users/jpl/.superset/worktrees/pkgseer-backend/best-maxilla/priv/graphql/schema.graphql`.

## Current Schema Fit

The existing GraphQL schema already has most primitives needed for a first version:

| Need | Current GraphQL support | Notes |
|---|---|---|
| Latest version and package identity | `packageSummary(registry, name)` | Gives `latestVersion`, repository metadata, license, downloads, latest changelogs, and latest-version security overview. It is latest-only. |
| Version-specific vulnerabilities | `packageVulnerabilities(registry, name, version, minSeverity, includeWithdrawn, deduplicate)` | Good fit for current and target direct-package advisory comparison. `security.advisories(scope: AFFECTED/NON_AFFECTING/ALL)` is the correct field. |
| Changelog range | `packageChangelog(registry, name, fromVersion, toVersion, limit)` | Good fit. Range mode returns all entries between versions. Package-addressed queries use registry versions as the spine and attach changelog details when available. |
| Direct and transitive dependencies | `packageDependencies(registry, name, version, includeTransitive, maxDepth, lifecycle)` | Good fit for target dependency graph and can also be run for current version to diff dependency graph client-side. |
| API/symbol change signals | `versionDiff(registry, packageName, fromVersion, toVersion, includePrivate, kind, category, fileIntent, limit)` | Future enhancement only. It requires code indexing and a new typed CLI service/error surface, so it is out of v1. |
| Version publish/deprecation metadata | `PackageVersionIdentity.publishedAt`, `deprecated`, `deprecationReason` | Available through version-specific package responses such as `packageVulnerabilities` and `packageDependencies`. `deprecated: null` means metadata unavailable; do not treat it as false. |
| Engines / runtime requirements | Not exposed | Intentionally out of v1. The backend removed the unstable `runtimeRequirements` API. Report engine-related changelog text signals until a stable schema exists. |
| Peer dependency compatibility | Partially represented in `dependencyGroups.lifecycle == "peer"` | Good enough to expose peer dependency changes, but not enough to validate against the local project without project dependency context. |
| Transitive vulnerability summary | `TransitiveDependencySummary.vulnerabilitySummary` | Available as a lazy nested field. Use non-deprecated fields: `affected`, `nonAffecting`, `combined`, `packages[].affectedCount`, `packages[].advisoryOccurrences(scope: AFFECTED)`. |
| Dependency issues summary | `TransitiveDependencySummary.dependencyIssues` | Available as a lazy nested field. Covers deprecated, outdated, duplicate, and conflict summaries. Rank outdated below vulnerabilities, deprecations, and conflicts in review text. |
| Yanked/withdrawn package versions | Not exposed | Out of v1. Do not mention yanked status except as unavailable. Advisory `withdrawnAt` is separate vulnerability metadata, not package-version yanking. |

## Proposed MCP Tool

Use one tool name for single and batch reviews. The schema accepts either one package (`registry` + `package_name`) or `packages[]`, but not both. This keeps the agent decision simple: use `pkg_upgrade_review` for dependency bump evidence.

```ts
pkg_upgrade_review({
  registry: "npm",
  package_name: "@modelcontextprotocol/sdk",
  current_version: "1.26.0",
  target_version: "1.29.0",
  include_transitive_security: true,
  include_dependency_issues: true,
  min_severity: "low" | "medium" | "high" | "critical",
  format: "text-v1" | "json"
})
```

Batch form:

```ts
pkg_upgrade_review({
  packages: [
    {
      registry: "npm",
      package_name: "zod",
      current_version: "4.3.6",
      target_version: "4.4.3"
    },
    {
      registry: "npm",
      package_name: "lint-staged",
      current_version: "16.2.7",
      target_version: "16.4.0"
    }
  ],
  include_transitive_security: true,
  include_dependency_issues: true,
  format: "text-v1"
})
```

Validation rules:

- Require either `packages` or the single-package fields.
- Reject `packages` combined with `registry`, `package_name`, `current_version`, or `target_version`.
- Reject tag-style `v` versions for package-addressed registry versions, matching `pkg_vulns`, `pkg_deps`, and `pkg_changelog`.
- Keep `include_transitive_security` default `true` because direct-only security hides important dependency-tree evidence. Allow callers to pass `false` when latency is more important than transitive vulnerability context.
- Keep `include_dependency_issues` default `false` initially for the same reason. Turn it on automatically only when the caller explicitly asks for lockfile/dependency-tree evidence, or document that agents should pass it for lockfile reviews.
- Changelog keyword detection scans the full backend range response and keyword-hit entries are surfaced separately so relevant signals are not hidden by the ordinary sample limit. The ordinary non-keyword sample cap is internal; agents should not need to tune it.
- `min_severity` maps to the same CVSS thresholds as `pkg_vulns` (`low=0`, `medium=4`, `high=7`, `critical=9`). It filters direct current/target vulnerability queries and transitive `vulnerabilitySummary(minSeverity:)` aggregates.

CLI shape:

```bash
githits pkg upgrade-review npm:@modelcontextprotocol/sdk@1.26.0 --to 1.29.0
githits pkg upgrade-review --package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0
```

The repeatable `--package` form is the CLI parity path for MCP `packages[]`. Use `..` as the CLI range delimiter because unquoted `>` is shell redirection in zsh/bash. The older `->` delimiter remains accepted when quoted for compatibility. A JSON input file can be added later if repeatable flags are too awkward in real use.

## JSON Shape

The JSON envelope should be data-first and structured for both single and batch output.

```ts
interface UpgradeReviewResponse {
  summary: {
    total: number;
    withUnknowns: number;
    withAddedAdvisories: number;
    withBreakingSignals: number;
    withDirectDependencyChanges: number;
    withTransitiveVulnerabilityAdditions: number;
  };
  reviews: UpgradeReview[];
}

interface UpgradeReview {
  registry: string;
  name: string;
  currentVersion: string;
  targetVersion: string;
  latestVersion?: string;
  versionDelta: "patch" | "minor" | "major" | "prerelease" | "downgrade" | "same" | "unknown";
  security: UpgradeSecurity;
  changelog: UpgradeChangelog;
  compatibility?: UpgradeCompatibility;
  dependencyChanges?: UpgradeDependencyChanges;
  dependencyIssues?: UpgradeDependencyIssues;
  unknowns: string[];
}
```

The summary contains factual counters only. `summary.total` is `reviews.length`; the other counters report evidence categories present in at least one review. The tool does not assign risk levels or make accept/reject recommendations.

Security block:

```ts
interface UpgradeSecurity {
  current: VersionVulnerabilitySummary;
  target: VersionVulnerabilitySummary;
  added: AdvisorySummary[];
  removed: AdvisorySummary[];
  notAddressed: AdvisorySummary[];
  fixed: AdvisorySummary[];
  introduced: AdvisorySummary[];
  unchanged: AdvisorySummary[];
  transitive?: TransitiveSecuritySummary;
}
```

Advisory diffs (`added`, `removed`, `notAddressed`) must reuse the existing vulnerability alias-cluster canonicalization from `package-vulnerabilities-response.ts`. Diff logical advisories over `osvId ∪ aliases[]`, not raw IDs, or GHSA/RUSTSEC duplicates will be misclassified. The legacy aliases (`introduced`, `fixed`, `unchanged`) remain in JSON for compatibility while the text output uses vulnerability-focused labels: `added`, `fixed`, and `still-present`.

Transitive vulnerability diffs are package/advisory-aware. Use `advisoryOccurrences[].advisory.osvId ∪ aliases[]` for alias-cluster identity when occurrence metadata is available, with `advisoryIds[]` as the fallback. A dependency version change with the same affected advisory remains `stillAffectedPackageDetails`, not a fixed plus introduced pair. A package can appear in both added and still-affected groups if the target keeps one advisory and adds another.

Version vulnerability summaries should include package-version metadata from `PackageVersionIdentity`:

```ts
interface VersionVulnerabilitySummary {
  version: string;
  publishedAt?: string;
  deprecated?: boolean;
  deprecationReason?: string;
  affectedCount: number;
  nonAffectingCount: number;
  allCount: number;
  advisories: AdvisorySummary[];
}
```

Preserve `deprecated: undefined` when GraphQL returns `null`; only `false` means verified not deprecated.

Changelog block:

```ts
interface UpgradeChangelog {
  source?: "releases" | "changelog_file" | "hexdocs";
  entries: Array<{
    version: string | null;
    publishedAt?: string;
    htmlUrl?: string;
    body?: string;
    bodyPreview?: string;
    headline?: string;
    signals?: string[];
  }>;
  sampledEntries: UpgradeChangelogEntry[];
  keywordEntries: UpgradeChangelogEntry[];
  totalKeywordEntries: number;
  totalEntries: number;
  truncated: boolean;
  breakingSignals: string[];
  migrationSignals: string[];
}
```

When backend `PackageChangelogResult.source` is `null`, render this as package-version fallback in text but keep JSON source omitted and set `fallback: "package_versions"` or equivalent explicit metadata if needed. Body-less entries are not release-note evidence and must be reported as missing evidence.

Compatibility block:

```ts
interface UpgradeCompatibility {
  peerDependencyChanges: string[];
  notes: string[];
}
```

Direct package deprecations can be populated from `PackageVersionIdentity.deprecated` / `deprecationReason`. Runtime engines are not exposed by the current schema; do not add an `engines` field in v1. Peer dependency changes can be partially populated from dependency groups today.

Dependency changes block:

```ts
interface UpgradeDependencyChanges {
  direct: UpgradeDependencyChangeGroup;
  transitive: UpgradeDependencyChangeGroup;
}

interface UpgradeDependencyChangeGroup {
  added: UpgradeDependencyChangeItem[];
  removed: UpgradeDependencyChangeItem[];
  changed: UpgradeDependencyChangeItem[];
}
```

Dependency changes are always requested by the upgrade-review dependency probe. Direct dependency set or constraint changes are reported as facts because they alter install behavior even when direct vulnerabilities and changelog checks are clean. Transitive dependency graph changes are rendered for context. The target/current root package node and synthetic nodes are excluded from transitive change rows.

## Text Shape

Default `text-v1` should be compact and evidence-first, but it must include concrete samples rather than only counters. Changelog text should show source/count/truncation and all keyword-hit entries in the reviewed range. If there are no keyword hits, show a small deterministic sample of ordinary entries. `--verbose` expands non-keyword rows from the current response, but changelog bodies still render filtered excerpts/headline paragraphs to avoid commit-list dumps.

```text
pkg_upgrade_review | 2 upgrades | unknowns=1 added-vulns=0 change-keywords=0 dependency-changes=1 transitive-vuln-additions=0

npm:@modelcontextprotocol/sdk 1.26.0 -> 1.29.0 | minor
vulnerabilities
  direct package advisories: current version affected=0, target version affected=0, fixed by target=0, added in target=0, still affects target=0
changes
  source: releases
  release entries: 3 total, 3 with release-note bodies
  keyword hits: 1 entries (removed); heuristic text match
  keyword hit entries:
    - 1.29.0
      [removed]: Removed deprecated transport helpers...
dependencies
  direct dependencies: added=1, removed=0, changed=2
  direct changed:
    - zod ^3.25.0 -> ^4.0.0
    - eventsource ^3.0.0 -> ^4.0.0

npm:zod 4.3.6 -> 4.4.3 | patch
vulnerabilities
  direct package advisories: current version affected=0, target version affected=0, fixed by target=0, added in target=0, still affects target=0
changes
  source: package_versions
  release entries: 2 total, 0 with release-note bodies
unknowns:
  - changelog source has no release-note bodies
```

The text renderer must not say an update is safe or risky. It reports evidence and explicit `unknowns:` only. For every non-empty count, the default text should include representative rows. `--verbose` expands row groups in place instead of forcing agents to reconstruct follow-up commands.

## Fact Reporting Rules

The tool reports facts and missing evidence. It does not assign `low` / `medium` / `high` risk, and it does not decide whether an upgrade should be accepted. The calling agent or human reviewer owns that assessment.

The factual evidence includes:

- Version relationship: major, prerelease, downgrade, same-version, or unknown version shape.
- Target deprecation metadata: verified deprecated, verified not deprecated, or unavailable.
- Direct advisory diff: added, fixed, and still-present vulnerabilities after alias-cluster deduplication.
- Changelog evidence: source, body availability, sampled headline paragraphs, and rudimentary keyword matches clearly labeled as hints.
- Peer dependency metadata changes.
- Direct and transitive dependency graph changes.
- Transitive vulnerability and dependency issue diffs when requested.
- Missing or filtered evidence in `unknowns[]`.

Keyword matching should be lexical and transparent, not hidden model inference. Treat matches only as sampling hints. Start with conservative terms in changelog bodies: `breaking`, `breaks`, `removed`, `drop support`, `migration`, `migrate`, `deprecated`, `renamed`. Avoid broad ecosystem terms such as `node`, `python`, `peer`, `requires`, `config`, or `engine`; real runs showed those produce false positives from CI/config mentions that are not compatibility changes. Handle obvious negations such as `no breaking changes`.

## Client-Side First Implementation

A first implementation does not require a new backend query.

For each package review:

1. Call `packageSummary(registry, name)` for `latestVersion`, repository metadata, and latest-version context. If this fails, continue the review without `latestVersion` and add an `unknowns[]` entry; do not fail the package unless all core calls fail.
2. Call `packageVulnerabilities(registry, name, version: currentVersion, advisory scope AFFECTED)` and select `package { publishedAt deprecated deprecationReason }`.
3. Call `packageVulnerabilities(registry, name, version: targetVersion, advisory scope AFFECTED)` and select `package { publishedAt deprecated deprecationReason }`.
4. Call `packageChangelog(registry, name, fromVersion: currentVersion, toVersion: targetVersion)`.
5. Call a dedicated upgrade-review dependency probe for current and target. It always selects direct dependencies, peer dependency groups, package-version metadata, the transitive dependency graph needed for dependency-change diffs, and transitive vulnerability summaries unless explicitly disabled. It selects lazy `dependencyIssues` only when `include_dependency_issues` is requested.
6. Diff current-vs-target dependency changes, peer groups, transitive vulnerability summaries, and dependency-issue summaries. Target-only unresolved issues can be shown as context but must not be reported as upgrade regressions.

Batching can initially be client-side concurrency with per-package isolation. Cap package-level concurrency at 3 by default because each package review can make several GraphQL calls. One package failure should produce a review item with `unknowns[]` instead of failing the entire batch unless request validation fails.

Version resolution failures should map to an `unknown` review with the structured `VERSION_NOT_FOUND` / `NOT_FOUND` details preserved where available. A missing current or target version is not retryable by the tool unless the backend supplies available versions for an actionable hint.

This is still a better MCP UX because the agent makes one tool call and receives one evidence-shaped result, even if the CLI internally composes multiple backend queries.

## Current Backend Surface

The current schema can support v1. The backend work should be treated as available surface, not future work, with one explicit omission: runtime/engine requirements are not stable and are intentionally not exposed.

### 1. Lazy Transitive Security on Dependency Reports

Use lazy nested fields under `TransitiveDependencySummary`. Do not add `includeTransitiveSecurity` as a GraphQL root argument. Absinthe resolves nested fields only when selected, so field selection is the right cost-control mechanism.

Current schema shape, using non-deprecated fields:

```graphql
type TransitiveDependencySummary {
  dependencyGraph: DependencyGraph
  dependencyConflicts: [DependencyConflict!]!
  circularDependencyCycles: [CircularDependencyCycle!]
  vulnerabilitySummary: TransitiveVulnerabilitySummary
  dependencyIssues: DependencyIssuesSummary
}

type TransitiveVulnerabilitySummary {
  affected: VulnerabilityCount!
  nonAffecting: VulnerabilityCount!
  combined: VulnerabilityCount!
  totalPackagesAnalyzed: Int!
  affectedPackageCount: Int!
  packages: [TransitiveVulnerablePackage!]!
  calculatedAt: String
}

type TransitiveVulnerablePackage {
  registry: DependencyGraphRegistry!
  name: String!
  versions: [String!]!
  affectedCount: Int!
  nonAffectingCount: Int!
  totalCount: Int!
  maxSeverityScore: Float
  maxSeverityLabel: String
  advisoryIds(scope: VulnerabilityScope): [String!]!
  mostCritical: VulnerabilitySummaryDetail
  advisoryOccurrences(scope: VulnerabilityScope, minSeverity: Float, limit: Int): [TransitiveDependencyVulnerability!]!
}
```

Do not put vulnerability data on every `DependencyGraphNode` in v1. That bloats graph responses and makes common dependency-tree queries more expensive. A summary with package rows fits the upgrade-review and CLI workflows better.

The resolver should be lazy:

- `packageDependencies` continues resolving direct deps and, when `includeTransitive: true`, the DAG.
- `dependencies.transitive.vulnerabilitySummary` has its own resolver and only executes when selected.
- The parent transitive map can carry internal non-schema keys such as `:_registry`, `:_package_name`, `:_version`, and `:_dag_data` so nested resolvers do not recompute or reverse-parse the graph.
- Add explicit GraphQL complexity cost to `vulnerabilitySummary` because it performs chunked package/version lookups and advisory aggregation.

For MCP/CLI wrappers, keep `include_transitive_security` as an ergonomic flag. The wrapper translates that flag into selecting `vulnerabilitySummary`; it should not imply a backend root argument.

### 2. Lazy Dependency Issues on Dependency Reports

Use the second lazy nested field for non-vulnerability dependency issue signals:

```graphql
type DependencyIssuesSummary {
  totalCount: Int!
  deprecatedCount: Int!
  outdatedCount: Int!
  duplicateCount: Int!
  conflictCount: Int!
  deprecatedPackages: [DeprecatedDependency!]!
  outdatedPackages: [OutdatedDependency!]!
  duplicatePackages: [DuplicateDependency!]!
  conflicts: [DependencyIssueConflict!]!
}

type DeprecatedDependency {
  registry: DependencyGraphRegistry!
  name: String!
  versions: [String!]!
  reasons: [DependencyDeprecationReason!]!
}

type DependencyDeprecationReason {
  version: String!
  reason: String
}

type OutdatedDependency {
  registry: DependencyGraphRegistry!
  name: String!
  latestVersion: String
  severity: DependencyOutdatedSeverity!
  versions: [OutdatedDependencyVersion!]!
  repositoryUrl: String
}

type OutdatedDependencyVersion {
  version: String!
  severity: DependencyOutdatedSeverity!
}

type DuplicateDependency {
  registry: DependencyGraphRegistry
  name: String!
  versions: [String!]!
}

enum DependencyOutdatedSeverity {
  PATCH
  MINOR
  MAJOR
  UNKNOWN
}
```

The resolver is lazy. Outdated is included in the backend surface, but CLI/MCP text should rank it below vulnerabilities, deprecations, duplicates, and conflicts.

### 3. Future Batch Vulnerability Query

Client-side batching is fine for v1. A backend batch security primitive may still be useful later for non-upgrade workflows, but it is not needed to implement `pkg_upgrade_review` because transitive security is now available under `packageDependencies` and direct current/target checks are two bounded calls per package.

```graphql
packageVulnerabilityBatch(packages: [PackageVersionInput!]!, minSeverity: Float, includeWithdrawn: Boolean): [VulnerabilityReport!]!

input PackageVersionInput {
  registry: Registry!
  name: String!
  version: String!
}
```

This is more generally useful than an upgrade-specific query.

### 4. Version Metadata

Version-level publish/deprecation metadata is available on `PackageVersionIdentity`:

```graphql
type PackageVersionIdentity {
  name: String
  registry: String
  version: String
  publishedAt: String
  deprecated: Boolean
  deprecationReason: String
}
```

Important caveat: `PackageVersionIdentity` is reused by vulnerability reports and dependency reports. Populate these fields only where the resolver already has verified package-version metadata, or resolve lazily. Do not fake defaults. `deprecated: false` should mean verified not deprecated, not unknown.

Engines/runtime requirements are intentionally absent. A separate metadata query remains an option if a stable runtime compatibility API is added later:

```graphql
packageVersionMetadata(registry: Registry!, name: String!, version: String!): PackageVersionMetadata
```

### 5. Future Version Diff / Aggregate Query

`versionDiff` is out of v1. It needs a typed service method, request/response schemas, indexing lifecycle handling, and package-intelligence error mapping before it can be safely exposed as an upgrade-review option.

A backend aggregate query is also not required for v1. Consider it only after the client-side composition proves the shape.

```graphql
packageUpgradeReview(
  registry: Registry!
  name: String!
  currentVersion: String!
  targetVersion: String!
  includeTransitiveSecurity: Boolean
  minSeverity: Float
): PackageUpgradeReviewResult!
```

This should remain a backend optimization, not the first design step. The tool contract should be designed at the MCP layer first because that is where the agent UX is clearest. If this query is added later, prefer field selection for optional expensive subtrees inside `PackageUpgradeReviewResult` rather than accumulating root booleans for every optional section.

## Client Implementation Steps

Suggested CLI sequence:

1. Extend service-level `PackageVersionIdentity` types and Zod schemas with optional `publishedAt`, `deprecated`, and `deprecationReason`.
2. Add a dedicated internal dependency probe for upgrade review instead of overloading the existing `packageDependencies(params)` method used by `pkg_deps`. The existing method intentionally fetches the full DAG for direct-version/importer enrichment; upgrade review needs separate sparse peer-group and transitive-evidence probes to avoid overfetching and regressions.
3. Add optional dependency query selection for `vulnerabilitySummary` and `dependencyIssues`, controlled by variables and GraphQL `@include` directives.
4. Add service-level types/Zod schemas for `VulnerabilityCount`, `TransitiveVulnerabilitySummary`, `TransitiveVulnerablePackage`, `TransitiveDependencyVulnerability`, `VulnerabilitySummaryDetail`, `DependencyIssuesSummary`, and issue row types.
5. Keep these dependency fields optional in normalised results because they are omitted unless selected and unavailable when `includeTransitive` is false.
6. Implement `packageUpgradeReview` composition in a small package-upgrade-review helper module that depends on existing service methods and the new internal dependency probe. Do not make `PackageIntelligenceService` the workflow orchestrator.
7. Add the MCP tool and CLI command using shared request/response modules and parity tests.
8. Update MCP instructions and package tool descriptions after the tool exists.

## Existing Tool Updates

Add instruction-level guidance now:

- Server MCP instructions: "Use `pkg_upgrade_review` when the user asks for evidence about dependency updates, outdated dependency bumps, or lockfile/package updates. Do not infer acceptability from semver alone; patch updates still require changelog and vulnerability checks. The tool reports facts only; the calling agent owns the final assessment."
- `pkg_changelog`: mention that range mode should be used for every upgrade review, including patches, unless `pkg_upgrade_review` is available.
- `pkg_vulns`: mention that upgrade reviews must check the target version explicitly, not just latest.
- `pkg_deps`: mention that `pkg_upgrade_review` is preferred for upgrade evidence; raw transitive vulnerability/issue fields are available through upgrade review rather than ordinary dependency listing unless we also add explicit `pkg_deps` flags.

## Implementation Notes for CLI

Add the tool in the same style as current package tools:

- `src/tools/package-upgrade-review.ts`
- `src/commands/pkg/upgrade-review.ts` if exposing a CLI command
- shared request/response modules under `src/shared/package-upgrade-review-*`
- service composition should live in a focused helper module that reuses existing service methods plus the dedicated internal dependency probe
- parity tests should assert CLI `--json` and MCP `format:"json"` equality
- text snapshot tests should cover vulnerability, changelog, dependency-change, and unknown-evidence cases
- unit fixtures should cover deprecated target, missing deprecation metadata (`deprecated: null`), malicious advisory, alias-linked advisory diffing, transitive vulnerability summary, dependency issues, body-less changelog package-version fallback, version-not-found errors, per-package failure isolation in batch mode, and unsupported-security registry path
- live smoke should cover a package with changelog entries, a package with package-version fallback, and a package with dependency issues when practical

## Acceptance Criteria

- MCP `pkg_upgrade_review` and CLI `githits pkg upgrade-review` expose equivalent JSON envelopes for single-package and repeatable-package batch input.
- JSON parity tests cover successful single-package, successful batch, per-package unknown failure, and validation errors.
- The tool never returns risk levels. It reports direct vulnerability check failures, missing changelog bodies, target deprecation metadata gaps, and introduced advisories as facts or `unknowns[]`.
- Advisory diffing uses alias-cluster canonicalization and does not double-count alias-linked advisories.
- Transitive vulnerability and dependency issue data are diffed current-vs-target; target-only evidence is labeled as context.
- `pkg_deps` existing JSON/text/parity tests continue to pass unchanged, proving the upgrade-review dependency probe did not regress the existing dependency command.
- Batch execution limits package-level concurrency to 3 by default.
- `include_transitive_security` defaults on and can be disabled; `include_dependency_issues` selects lazy backend fields only when requested.
- Text output keeps direct and transitive vulnerability counts aligned when `min_severity` is supplied.

## Resolved Decisions

- `packages[]` is part of `pkg_upgrade_review` v1 because batch upgrade review is the core agent UX problem.
- `include_transitive_security` defaults to `true` so vulnerability output includes dependency-tree evidence by default.
- `include_dependency_issues` is a separate flag and defaults to `false`.
- Direct/transitive dependency-change diffs are always requested and rendered as facts.
- `versionDiff` remains deferred until a dedicated typed service/error surface exists.
- Text mode shows compact summaries by default. `--verbose` / `verbose: true` adds dependency-change examples, including transitive version changes.
- Runtime/engine compatibility is not asserted because no stable backend field exists. Lexical changelog signals are reported only as sampled evidence hints unless later verified by schema data.

## Implementation Direction

Build `pkg_upgrade_review` client-side first using current schema primitives. The backend now provides the required direct deprecation metadata and lazy transitive vulnerability/issue summaries. Defer a dedicated `packageUpgradeReview` GraphQL query until real agent traces show the composed shape is stable and worth optimizing.
