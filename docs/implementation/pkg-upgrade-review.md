# Package Upgrade Review

## Purpose

Dependency-upgrade reviews are a distinct agent workflow. Agents should not infer acceptability from semver, especially for patch updates. The tool surface should make evidence collection cheaper than manually composing `pkg_changelog`, `pkg_vulns`, and `pkg_deps` calls for every package.

`pkg_upgrade_review` is the MCP/CLI-facing tool for this workflow. It answers: "What changed between the currently used version and the target version, and what evidence is available or missing?"

This report reflects the backend schema inspected at `/Users/jpl/.superset/worktrees/af856079-3997-4271-af85-b1901f8a2119/forest-reference/priv/graphql/schema.graphql`.

## Current Schema Fit

The backend now exposes the aggregate query the CLI/MCP tool should call directly:

```graphql
packageUpgradeReview(
  packages: [PackageUpgradeReviewPackageInput!]!
  includeTransitiveSecurity: Boolean
  minSeverity: Float
  changelogLimit: Int
): PackageUpgradeReviewResponse!
```

The CLI/MCP implementation must not fall back to composing `packageSummary`, `packageVulnerabilities`, `packageChangelog`, or `packageDependencies` calls. If the aggregate query is unavailable, surface the backend protocol error. Release should wait until the backend aggregate support is deployed.

Optional evidence is controlled by GraphQL field selection and local query variables:

- `includeTransitiveSecurity` is sent to the backend root field and also controls the selected `security.transitive` subtree.
- `include_dependency_issues` / `--dependency-issues` controls the selected `dependencyIssues @include(...)` subtree. It is not a backend root argument.
- `changelogLimit` caps ordinary changelog entries per package.
- `min_severity` maps to CVSS thresholds and is omitted for `low`, matching the existing upgrade-review request builder behavior.

Out-of-scope evidence remains unchanged: `versionDiff` and runtime/engine compatibility are future enhancements, and the tool must not infer accept/reject recommendations.

## Proposed MCP Tool

Use one tool name for single and batch reviews. The schema accepts either one package (`registry` + `package_name`) or `packages[]`, but not both. This keeps the agent decision simple: use `pkg_upgrade_review` for dependency bump evidence.

```ts
pkg_upgrade_review({
  registry: "npm",
  package_name: "@modelcontextprotocol/sdk",
  current_version: "1.26.0",
  target_version: "1.29.0",
  skip_transitive_security: false,
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
  skip_transitive_security: false,
  include_dependency_issues: true,
  format: "text-v1"
})
```

Validation rules:

- Require either `packages` or the single-package fields.
- Reject `packages` combined with `registry`, `package_name`, `current_version`, or `target_version`.
- Reject tag-style `v` versions for package-addressed registry versions, matching `pkg_vulns`, `pkg_deps`, and `pkg_changelog`.
- Keep transitive security evidence enabled by default because direct-only security hides important dependency-tree evidence. Allow callers to pass `skip_transitive_security: true` when latency is more important than transitive vulnerability context.
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

Advisory diffs (`added`, `removed`, `notAddressed`) are now backend-provided. The backend must diff logical advisories over `id ∪ aliases[]`, not raw IDs, or GHSA/RUSTSEC duplicates will be misclassified. The legacy aliases (`introduced`, `fixed`, `unchanged`) remain in JSON for compatibility while the text output uses vulnerability-focused labels: `added`, `fixed`, and `still-present`.

Transitive vulnerability diffs are backend-provided and package/advisory-aware. A dependency version change with the same affected advisory remains `stillAffectedPackageDetails`, not a fixed plus introduced pair. A package can appear in both added and still-affected groups if the target keeps one advisory and adds another. Detail pages preserve backend `totalCount` / `truncated` metadata so JSON and text output do not present capped samples as complete evidence.

```ts
interface TransitiveSecuritySummary {
  currentAffected: number;
  targetAffected: number;
  introducedPackages: string[];
  fixedPackages: string[];
  introducedPackageDetails: TransitiveVulnerablePackage[];
  introducedPackageDetailsTotalCount: number;
  introducedPackageDetailsTruncated: boolean;
  fixedPackageDetails: TransitiveVulnerablePackage[];
  fixedPackageDetailsTotalCount: number;
  fixedPackageDetailsTruncated: boolean;
  stillAffectedPackageDetails: TransitiveVulnerablePackage[];
  stillAffectedPackageDetailsTotalCount: number;
  stillAffectedPackageDetailsTruncated: boolean;
}
```

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

Dependency changes are backend-provided by the aggregate upgrade-review response. Direct dependency set or constraint changes are reported as facts because they alter install behavior even when direct vulnerabilities and changelog checks are clean. Transitive dependency graph changes are rendered for context. The backend excludes the target/current root package node and synthetic nodes from transitive change rows.

## Text Shape

`text-v1` is an in-place, unstable text contract. It is a compact product
surface for humans and agents, not a serialization of the JSON fields. The
default output leads with the outcome and groups each package in this order:

1. package identity and version relationship;
2. `Security`, with direct and optional transitive summary rows first, followed
   by non-empty advisory groups;
3. `Deprecation` when target deprecation is known or target evidence is missing;
4. `Changes`;
5. `Compatibility` when it has evidence;
6. `Dependencies` when the comparison object was returned;
7. `Dependency issues` when that object was returned; and
8. `Unknown evidence` last.

A batch of more than one package adds one `Across packages:` summary after the
headline. Zero and one package omit it. The summary and package sections report
facts only; they never call an upgrade safe, risky, approved, or rejected.

Representative output:

```text
Upgrade review - 2 packages
Across packages: 1 with evidence gaps | 1 with added direct vulnerabilities | 1
                 with added transitive vulnerabilities | 1 without transitive
                 security evidence | 1 with heuristic change signals | 1 with
                 direct dependency changes

npm:zod 4.3.6 -> 4.4.3 (minor)

Security
  Direct: 0 affected -> 1 affected | 0 fixed | 1 added | 0 still present
  Transitive: 0 affected packages -> 1 | 0 fixed | 2 added | 0 still affected
  Added direct advisories
    - GHSA-new high(7.5): new advisory | fixed in 4.4.4
  Added transitive vulnerable packages
    - npm:left-pad@1.0.0 affected=1 medium(4) advisories: GHSA-transitive
    - ... +1 more not returned by backend page

Deprecation
  Target: deprecated: bad release

Changes
  Repository releases | 1 entry | 1 with release notes
  Heuristic signals: breaking | 1 matching entry
  Heuristic release entries
    - 4.4.3
      [breaking]: Breaking: removed an API.

Dependencies
  Direct: 1 added | 0 removed | 0 changed
  Direct added
    - npm:left-pad@1.0.0
  Transitive: 0 added | 0 removed | 0 changed

Dependency issues
  1 introduced | current total: 0 | target total: 1
  Introduced deprecated
    - npm:left-pad@1.0.0

Unknown evidence
  - changelog evidence incomplete

npm:express 5.0.0 -> 5.2.1 (patch)

Security
  Direct: 0 affected -> 0 affected | 0 fixed | 0 added | 0 still present
  Transitive: not checked

Changes
  Package versions (no release notes) | 2 entries | 0 with release notes
```

The formatter preserves stable follow-up locators and backend facts while
removing internal tool headers, repeated field labels, and dense key/value
rows. Formatter-authored punctuation is ASCII; backend Unicode is preserved.
Free prose wraps with hanging indentation at the supplied terminal width (80 by
default, clamped to a minimum of 20); package coordinates, versions, advisory
IDs, and URLs are not split. The CLI passes `process.stdout.columns` and enables
ANSI only when supported. MCP passes no ANSI and uses the 80-column default.

ANSI is semantic styling only: the outcome and section headings are bold, the
package identity is bold cyan, and attention evidence is explicitly worded and
yellow. Provenance may be dimmed; trust limits, unknowns, and follow-up guidance
are not. Removing ANSI leaves the same words and hierarchy.

Changelog source labels are exact: `releases` renders as `Repository releases`,
`package_versions` fallback renders as `Package versions (no release notes)`,
and any other non-empty normalized source is rendered verbatim without guessing
a provider. A returned zero-valued `dependencyChanges` object remains visible as
both `Direct: 0 added | 0 removed | 0 changed` and
`Transitive: 0 added | 0 removed | 0 changed`; an undefined object is omitted.
Likewise, zero-valued `dependencyIssues` says `none introduced` with current and
target totals, while undefined evidence is omitted. Missing target security
summary retains `Target: deprecation unknown`.

Default samples remain bounded: direct advisories and transitive vulnerable
package details show up to five rows, peer changes up to ten, and dependency
change details use the existing compact/verbose limits. Changelog keyword hits
remain visible; ordinary entries are sampled. `--verbose` expands the bounded
row groups in place without changing the JSON response. Backend truncation and
unknown evidence remain explicit rather than being presented as complete.

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

## Current Implementation

The CLI/MCP implementation has one active backend path:

1. `buildPackageUpgradeReviewRequest` validates single-package vs batch mode, normalises registry values to backend enum casing, maps `min_severity` to CVSS thresholds, and keeps `low` unfiltered.
2. `buildPackageUpgradeReview` calls `PackageIntelligenceService.packageUpgradeReview` exactly once with the full package batch.
3. `PackageIntelligenceServiceImpl.packageUpgradeReview` posts the aggregate GraphQL query, validates the typed response with Zod, strips `null` fields to the existing JSON omission convention, and reuses standard package-intelligence transport/auth/error handling.
4. The shared response module normalises backend enum strings to the existing CLI/MCP JSON/text casing (`NPM` -> `npm`, `MAJOR` -> `major`, `HIGH` -> `high`) and owns the grouped terminal/text-v1 formatter described above.

There is deliberately no compatibility fallback to the old client-side fanout. Backend schema mismatch, missing resolver, or deployment skew should surface as the normal package-intelligence backend/protocol error. This prevents the CLI from silently making many backend calls after the aggregate tool exists.

## Implementation Notes For CLI/MCP

- `packages/mcp/src/tools/package-upgrade-review.ts` is the MCP entrypoint.
- `src/commands/pkg/upgrade-review.ts` is the CLI entrypoint.
- `packages/mcp/src/shared/package-upgrade-review-request.ts` owns validation and backend param construction.
- `packages/mcp/src/shared/package-upgrade-review-response.ts` owns backend response normalisation and text/JSON formatting.
- `packages/core-internal/src/services/package-intelligence-service.ts` owns the aggregate GraphQL query and typed service method.
- Parity tests assert CLI `--json` and MCP `format:"json"` equality for single, batch, backend unknown-evidence, and validation-error paths.

## Acceptance Criteria

- MCP `pkg_upgrade_review` and CLI `githits pkg upgrade-review` expose equivalent JSON envelopes for single-package and repeatable-package batch input.
- The tool calls the aggregate backend `packageUpgradeReview` operation once per request.
- The tool has no fallback to `packageSummary`, `packageVulnerabilities`, `packageChangelog`, `packageDependencies`, or the old upgrade dependency probe.
- The tool never returns risk levels. It reports vulnerability, changelog, compatibility, dependency-change, dependency-issue, and unknown evidence as facts.
- Backend enum casing is normalised to the existing public JSON/text contract.
- Transitive security defaults on and can be disabled with `skip_transitive_security` / `--no-transitive-security`; `include_dependency_issues` selects the backend `dependencyIssues` subtree only when requested.
- Release waits until the backend aggregate resolver is deployed to production; smoke suites fail with a backend protocol mismatch before that deployment.

## Resolved Decisions

- `packages[]` is part of `pkg_upgrade_review` v1 because batch upgrade review is the core agent UX problem.
- Transitive security evidence defaults on so vulnerability output includes dependency-tree evidence by default.
- `include_dependency_issues` is a separate flag and defaults to `false`.
- Direct/transitive dependency-change diffs are backend-provided and rendered as facts.
- `versionDiff` remains deferred until a dedicated typed service/error surface exists.
- Text mode shows compact summaries by default. `--verbose` / `verbose: true` adds dependency-change examples, including transitive version changes.
- Runtime/engine compatibility is not asserted because no stable backend field exists. Lexical changelog signals are reported only as sampled evidence hints unless later verified by schema data.
