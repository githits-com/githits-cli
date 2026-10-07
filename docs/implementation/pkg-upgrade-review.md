# Package Upgrade Review

## Purpose

Dependency-upgrade reviews are a distinct agent workflow. Agents should not infer acceptability from semver, especially for patch updates. The tool surface should make evidence collection cheaper than manually composing `pkg_changelog`, `pkg_vulns`, and `pkg_deps` calls for every package.

`pkg_upgrade_review` is the MCP/CLI-facing tool for this workflow. It answers: "What changed between the currently used version and the target version, and what evidence is available or missing?"

Risk fields were verified against the latest backend `priv/graphql/schema.graphql` and authenticated dev field selection on 2026-10-07. Dev disables introspection; the schema file confirms names, enums and nullability.

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

The CLI/MCP implementation must not fall back to composing `packageSummary`, `packageVulnerabilities`, `packageChangelog`, or `packageDependencies` calls. If the aggregate query is unavailable, surface the backend protocol error. The backend owner confirms aggregate and risk-field support is already deployed in production and dev; this change needs no backend deployment.

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
  format: "text" | "json"
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
  format: "text"
})
```

Validation rules:

- Require either `packages` or the single-package fields.
- Reject `packages` combined with `registry`, `package_name`, `current_version`, or `target_version`.
- Accept at most 30 nonblank `packages[]` rows. Blank rows are removed before applying the limit, and a larger batch is rejected by the shared CLI/MCP request builder before any package-intelligence service call.
- Normalize exact Go current/target versions to canonical lowercase-`v` form while accepting either input form. Reject tag-style `v` versions for other registries except Swift, matching `pkg_vulns`, `pkg_deps`, and `pkg_changelog`.
- Keep transitive security evidence enabled by default because direct-only security hides important dependency-tree evidence. Allow callers to pass `skip_transitive_security: true` when latency is more important than transitive vulnerability context.
- Keep `include_dependency_issues` default `false` initially for the same reason. Turn it on automatically only when the caller explicitly asks for lockfile/dependency-tree evidence, or document that agents should pass it for lockfile reviews.
- Changelog keyword detection scans the full backend range response and keyword-hit entries are surfaced separately so relevant signals are not hidden by the ordinary sample limit. The sampled-entry cap is internal; agents should not need to tune it.
- `min_severity` maps to the same CVSS thresholds as `pkg_vulns` (`low=0.1`, `medium=4`, `high=7`, `critical=9`). It filters direct current/target vulnerability queries and transitive `vulnerabilitySummary(minSeverity:)` aggregates.

CLI shape:

```bash
githits pkg upgrade-review npm:@modelcontextprotocol/sdk@1.26.0..1.29.0
githits pkg upgrade-review npm:@modelcontextprotocol/sdk@1.26.0 --to 1.29.0
githits pkg upgrade-review --package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0
```

The positional range is the concise single-package form. The positional
`<registry>:<name>@<current> --to <target>` form remains available when the
target is supplied separately, and repeatable `--package` entries remain the
batch form and the CLI parity path for MCP `packages[]`.

The CLI command owns parsing of positional compact ranges and normalises either
single-package spelling into the existing structured request. A positional
range already contains its target, so combining it with `--to` is rejected
locally with both valid alternatives. Any positional argument combined with a
repeatable `--package` entry is also rejected locally; choose one positional
single-package form or the batch form. Empty range sides, multiple or adjacent
delimiters, and explicit empty-current ranges receive positional range grammar
instead of `--package` guidance.

Range delimiters are interpreted only in the version suffix after the final
version-separating `@`; delimiter-like text in a package name remains opaque.

Use `..` as the range delimiter for positional and repeatable `--package`
forms. The legacy `->` delimiter is rejected locally with guidance to use
`..`. A JSON input file can be added later if repeatable flags are too awkward
in real use.

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

The summary contains factual counters only. `summary.total` is `reviews.length`; the other counters report evidence categories present in at least one review. The tool does not assign package-level risk levels or make accept/reject recommendations. Statement-level model labels remain quoted evidence with provenance.

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
  riskItems: UpgradeChangelogRiskItem[];
  riskCoverage: {
    versionsClassified: number;
    versionsNotAssessed: number;
    versionsWithoutNotes: number;
    versionsUnparseable: number;
    unitsNoImpact: number;
    itemsOmitted: number;
  };
}

interface UpgradeChangelogRiskItem {
  version: string;
  tier: "must_act" | "should_know" | "unclassified";
  tierConfidence?: number;
  kind?: string;
  kindConfidence?: number;
  text: string;
  textTruncated: boolean;
  heading?: string;
  source?: string;
  model: string;
  formulation: string;
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
headline and a triage table sorted by returned `must_act` statement count. The aggregate line labels the backend `withUnknowns` counter as reported
unknowns and independently counts reviews with not-assessed, missing-note or
unparseable classification coverage. This avoids claiming zero evidence gaps
while the classifier is still pending. Equal action counts keep backend order. Counts can include a statement from
multiple sources. Default batch output has one unwrapped row per package, including peer dependency
change and compatibility-note counts (or not checked when absent); `--verbose` adds the detailed reports in
that order. JSON preserves backend review order. Zero and one package omit it. The summary and package sections report
facts only; they never call an upgrade safe, risky, approved, or rejected.

Representative verbose batch output:

```text
Upgrade review - 2 packages
Across packages: 1 with reported unknowns | 1 with added direct vulnerabilities | 1
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
    - npm:left-pad@1.0.0 affected=1 medium(4)
      Advisories: GHSA-transitive
    - ... +1 more not returned by backend page

Deprecation
  Target: deprecated: bad release

Changes
  Repository releases | 1 entry | 1 with release notes
  Classification versions: 1 classified | 0 not assessed | 0 without notes | 0
    unparseable
  Statements: 0 returned | 0 labeled no impact
  Missing or unparseable notes are not evidence of no risk.
  Statement labels are model classifications. Not a compatibility verdict.
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
  Classification versions: 0 classified | 0 not assessed | 2 without notes | 0
    unparseable
  Statements: 0 returned | 0 labeled no impact
  Missing or unparseable notes are not evidence of no risk.
  Statement labels are model classifications. Not a compatibility verdict.
```

The formatter preserves stable follow-up locators and backend facts while
removing internal tool headers, repeated field labels, and dense key/value
rows. Formatter-authored punctuation is ASCII; backend Unicode is preserved.
Free prose wraps with hanging indentation at the supplied terminal width (80 by
default, clamped to a minimum of 20); package coordinates, versions, advisory
IDs, and URLs are not split. The CLI passes `process.stdout.columns` and enables
ANSI only when supported. MCP passes no ANSI and uses the 80-column default.

ANSI is semantic styling only: the outcome and section headings are bold, the
package identity is bold cyan, and yellow is limited to compact attention
summaries, labels, and matched signal terms. Heuristic section labels remain
plain; only the matched keyword and excerpt marker are yellow. Evidence detail
and locators remain plain instead of turning long excerpts into color blocks.
Provenance may be dimmed; trust limits, unknown details, and follow-up guidance
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
package details and dependency-issue locators show up to five rows per category,
peer changes up to ten, and dependency change details use the existing
compact/verbose limits. Changelog keyword evidence renders first, followed by
each distinct sampled release not already represented by keyword evidence, in
sample source order. Identity-only samples retain their available version,
publication date, URL, and headline without inventing a body. The existing
`changelogEntryKey` identity prevents repeats across keyword, sampled, and
verbose other tiers; verbose other entries remain body-preview-backed.
`--verbose` expands the bounded row groups in place without changing the JSON
response. Backend truncation and unknown evidence remain explicit rather than
being presented as complete.

## Fact Reporting Rules

The tool reports facts and missing evidence. It does not assign package-level `low` / `medium` / `high` risk, an overall score, or an accept/reject verdict. Per-statement model classifications are evidence: the quoted release-note statement, tier, optional kind, version, source, model and formulation. Labels describe the model's reading of that statement, never compatibility of the package with the caller's code. The calling agent or human reviewer owns that assessment.

The factual evidence includes:

- Version relationship: major, prerelease, downgrade, same-version, or unknown version shape.
- Target deprecation metadata: verified deprecated, verified not deprecated, or unavailable.
- Direct advisory diff: added, fixed, and still-present vulnerabilities after alias-cluster deduplication.
- Changelog evidence: source, body availability, sampled headline paragraphs, rudimentary keyword hints, and per-statement model labels with provenance and explicit coverage.
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
- The CLI command owns positional range parsing and normalisation; the shared
  request builder continues to receive structured single-package fields or
  `packages[]` and does not parse CLI shorthand.
- `packages/mcp/src/shared/package-upgrade-review-request.ts` owns validation and backend param construction.
- `packages/mcp/src/shared/package-upgrade-review-response.ts` owns backend response normalisation and text/JSON formatting.
- `packages/core-internal/src/services/package-intelligence-service.ts` owns the aggregate GraphQL query and typed service method.
- Parity tests assert CLI `--json` and MCP `format:"json"` equality for single, batch, backend unknown-evidence, and validation-error paths.

## Acceptance Criteria

- MCP `pkg_upgrade_review` and CLI `githits pkg upgrade-review` expose equivalent JSON envelopes for single-package and repeatable-package batch input.
- The tool calls the aggregate backend `packageUpgradeReview` operation once per request.
- The tool has no fallback to `packageSummary`, `packageVulnerabilities`, `packageChangelog`, `packageDependencies`, or the old upgrade dependency probe.
- The tool never returns package-level risk levels or compatibility verdicts. Changelog statement labels include the quote and model/formulation provenance; all other evidence remains factual.
- Backend enum casing is normalised to the existing public JSON/text contract.
- Transitive security defaults on and can be disabled with `skip_transitive_security` / `--no-transitive-security`; `include_dependency_issues` selects the backend `dependencyIssues` subtree only when requested.
- Backend schema mismatch surfaces a protocol error; the owner confirms the aggregate and risk fields are already deployed.

## Resolved Decisions

- `packages[]` is part of `pkg_upgrade_review` v1 because batch upgrade review is the core agent UX problem.
- Transitive security evidence defaults on so vulnerability output includes dependency-tree evidence by default.
- `include_dependency_issues` is a separate flag and defaults to `false`.
- Direct/transitive dependency-change diffs are backend-provided and rendered as facts.
- `versionDiff` remains deferred until a dedicated typed service/error surface exists.
- Text mode shows compact summaries by default. `--verbose` / `verbose: true` adds dependency-change examples, including transitive version changes.
- Runtime/engine compatibility is not asserted because no stable backend field exists. Lexical changelog signals are reported only as sampled evidence hints unless later verified by schema data.


## Model-classified release-note statements

`riskItems` and `riskCoverage` are selected in the same aggregate operation,
independently of `changelogLimit`. The backend returns up to 50 statements per
review, ordered `MUST_ACT`, `SHOULD_KNOW`, `UNCLASSIFIED`, cutting lower-priority
items first. No-impact statements appear only in `unitsNoImpact`. Keep existing
`breakingSignals`, `migrationSignals` and entry `signals`: these remain lexical
hints, separate from model labels.

Single-package text shows Requires action quotes in full, Should know excerpts
up to 240 characters, and Unclassified excerpts up to 120. These are quoted
prefixes, not generated paraphrases. Local excerpts say `[excerpt; expand with
verbose]`; backend truncation at 1,000 characters separately says `[statement
truncated by backend]`, including in verbose mode. Verbose expands returned
quotes and shows headings and confidence. Kinds map to removal, behavior,
runtime/platform, packaging/modules, deprecation, security fix and notable
change; missing kinds add no invented category. Source, model and formulation
are preserved. Entry `detailSource` is also exposed in lower-case JSON. Match entry `version`,
not `sourceVersion`: statements belong to the reviewed version. Links use
returned entry URLs only when the version and
`detailSource` match the statement; absent source links are not fabricated.
Each returned version/source locator is listed once beneath the statement
groups, rather than repeating its URL per quote. New terminal strings use the
existing sanitizer; JSON keeps source text.

Coverage always includes classified, not-assessed, without-notes and unparseable
versions, plus the no-impact statement count. Omitted items are explicit and
returned tier counts are not presented as complete when the backend cap applies.
Not-assessed versions say to rerun: later requests fill stored classification
labels. Missing notes, unparseable notes or an empty item list never mean no risk.
A cold range can take a few seconds under the backend's shared six-second batch
deadline and 20-version-per-package cap; the client does not add retries.

Public JSON adds `changelog.riskItems` and `changelog.riskCoverage` on both CLI
and MCP, retaining the existing envelope, lower-case enums and null-to-omission
convention. Thus null tier confidence (too-large unclassified statements), kind,
kind confidence, heading or source are omitted. Confidence zero remains zero.
All quote text, truncation flags and model/formulation values are preserved.

The query measured 262 complexity units before the change, 281 with all risk
fields, and 284 including entry `detailSource` on the three existing entry
selections, with both optional evidence subtrees enabled. Measurement used 501
unique aliases of `summary.total`; dev rejected the probes with total operation
complexities 763, 782 and 785 respectively, without executing resolvers. Each
alias adds one unit. The final 284 is below production's 500 limit; no fields
were trimmed and no second query was added. The historical near-494 number does
not describe the current operation.


## Dev verification (2026-10-07)

All authenticated calls used the normal CLI auth configuration with
`GITHITS_ENV=dev`, `GITHITS_API_URL=https://api-dev.githits.com`,
`GITHITS_MCP_URL=https://mcp-dev.githits.com`, and
`GITHITS_CODE_NAV_URL=https://pkgseer-backend-dev.fly.dev`. No credential material was exposed or extracted by the agent.

Initial label requests (cold attempts) and subsequent CLI/MCP warm requests
returned the same counts below. Initial storage state cannot be proven from the
response, so these three ranges are not claimed to have been cold.

| Range | Act / know / unclassified | Classified / not assessed / without notes / unparseable | No impact | Omitted |
| --- | --- | --- | --- | --- |
| npm:axios@0.27.2..1.0.0 | 6 / 1 / 3 | 1 / 0 / 0 / 0 | 83 | 0 |
| npm:express@4.21.2..5.0.0 | 14 / 2 / 6 | 1 / 0 / 0 / 0 | 63 | 0 |
| pypi:fastapi@0.109.2..0.110.0 | 3 / 0 / 0 | 1 / 0 / 0 / 0 | 26 | 0 |

`bun run src/cli.ts pkg upgrade-review <range>` and `--json` passed for these
ranges. A three-package repeatable `--package` batch rendered Express, Axios,
FastAPI in action-count order. A local stdio `bun run src/cli.ts mcp start`
session called `pkg_upgrade_review` for each range in JSON, for the three-package
batch in text, and for Axios with `verbose: true`; JSON matched the CLI exactly.

Validation: `bun test` passed 5,635 tests / 22,556 assertions across 235 files;
`bun run typecheck`, changed-TypeScript Biome, `bun run build`,
`bun run validate:packages`, `bun run plugins:generate` and
`bun run plugins:check` passed. Both built secret-free CLI/MCP smokes passed.
Source CLI/MCP smokes passed their unauthenticated paths with
`GITHITS_AUTH_STORAGE=file`; isolated live cohorts reported `AUTH_REQUIRED` and
skipped. With default auth, their empty config roots selected an unavailable
system keychain and failed before upgrade-review. Authenticated validation of
the changed surfaces used the real config in the direct calls above.

Targeted `bun run agent:e2e --agent codex --server local --guidance-profile
descriptors --workload eval/agentic/workloads/package-upgrade-safety.md` used
the existing dedicated eval home. Neutral intent finished with high confidence
and no GitHits calls, so it does not validate tool use. With
`--intent-profile githits`, the same workload completed five logical MCP calls,
including a seven-package upgrade-review batch with `verbose: true` and a
single SDK rerun, with medium final confidence and no isolation violations.
The SDK batch returned 0 classified / 4 not assessed; the later single request
returned 4 classified / 0 not assessed, 9 statements and 17 no-impact units,
exercising the rerun guidance. No quality grading stage ran; no answer-quality
claim is made.

Backend observations: dev rejects introspection, so deployed field validation
was paired with the owner-supplied schema. Axios includes near-duplicate removal
statements from releases and changelog_file; both are preserved. The eval also
showed transient SDK transitive-security counts changing between batch and
single requests. An immediate raw aggregate replay with identical options
returned equal zero-valued transitive blocks for both shapes; the cause is
unconfirmed and outside the new risk fields. No backend changes were made.

After the batch-compatibility review fix, shared formatter/CLI-MCP parity
tests passed 35 tests / 241 assertions; typecheck/build, package validation,
plugin checks and both built smokes were rerun.

Integration retained main PRs #460 and #461 plus release metadata #462; changelog/source-diff follow-up
guidance and all existing catalog assertions remain in place.

Implementation review: internal full-delta review passed. External Claude round
1 identified default-batch compatibility evidence being suppressed; peer-change
and compatibility-note counts now retain it, including explicit missing evidence.
Round 2 and its fresh full-delta check returned no findings. Wire validation
retains the verified three-tier, seven-kind and 0-1 confidence contract. No
deferred implementation or refactoring work was identified.
