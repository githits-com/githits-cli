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
- Changelog keyword detection scans the full backend range response and keyword-hit evidence is retained within each version group so relevant signals are not hidden by the ordinary sample limit. The sampled-entry cap is internal; agents should not need to tune it.
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

The Changes section uses one version block in backend release-entry order,
then any statement-only versions outside the entry sample. Within each version,
Requires action precedes Should know and Unclassified. All returned statements
remain visible. Sources from release notes and changelog files are combined
without claiming differently worded statements are equivalent.

```text
Changes
  0 require action | 6 should know | 5 unclassified
  Classification versions: 4 classified | 0 not assessed | 0 without notes
  130 statements labeled no impact
  5.2.1
    Unclassified - read if relevant (2)
      "Revert security fix for CVE-2024-51999 [2] (GHSA-pj86-cfqh-vqx6 [3])" [1]
      "IMPORTANT: The prior release ..." [4]
        Heuristic: breaking
  5.2.0
    Should know (4)
      security fix "Security fix for CVE-2024-51999 [2] (GHSA-pj86-cfqh-vqx6 [3])" [5]
      ... remaining quotes in the same block
  ... remaining versions, each once
  Sources
    [1] Changelog (entry URL not returned)
    [2] https://www.cve.org/CVERecord?id=CVE-2024-51999
    [3] https://github.com/expressjs/express/security/advisories/GHSA-pj86-cfqh-vqx6
    [4] Release notes: https://github.com/expressjs/express/releases/tag/v5.2.1
    ... each remaining URL once
  Classified by an agent. Not a compatibility verdict.
```

The abbreviated example illustrates grouping; live output quotes every returned
item. Default omits unrelated sampled headlines and versions with no statement
or keyword evidence. No-impact stays a count. `--verbose` includes returned note
previews and locators for those otherwise-hidden versions, within the same
version grouping. Coverage remains visible in both modes; aggregate counts
cannot identify which specific versions are pending.

The formatter preserves backend Unicode and uses ASCII for its own punctuation.
Free prose wraps at the caller width (80 by default, minimum 20), while locators
remain intact. CLI supplies terminal width and optional ANSI; MCP uses 80 and
no ANSI. Headings and identity are styled, attention labels and matched keywords
may be yellow; removing ANSI preserves words and hierarchy.

Other compact evidence limits remain: five advisories, transitive package
details and dependency-issue locators per group, ten peer changes, and bounded
dependency examples. Verbose expands these. Defined zero-valued dependency
comparisons remain visible; omitted comparisons stay omitted. Missing target
security retains `Target: deprecation unknown`.

## Fact Reporting Rules

The tool reports facts and missing evidence. It does not assign package-level `low` / `medium` / `high` risk, an overall score, or an accept/reject verdict. Per-statement agent classifications are evidence: the quoted release-note statement, tier, optional kind, version and referenced source. JSON additionally preserves model and formulation provenance. Labels describe the classifier's reading of that statement, never compatibility of the package with the caller's code. The calling agent or human reviewer owns that assessment.

The factual evidence includes:

- Version relationship: major, prerelease, downgrade, same-version, or unknown version shape.
- Target deprecation metadata: verified deprecated, verified not deprecated, or unavailable.
- Direct advisory diff: added, fixed, and still-present vulnerabilities after alias-cluster deduplication.
- Changelog evidence: source, body availability, version-grouped quotes, lexical keyword hints, agent labels and explicit coverage; raw model provenance stays in JSON.
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
- The tool never returns package-level risk levels or compatibility verdicts. Changelog statement labels include the quote and agent attribution, with model/formulation provenance in JSON; all other evidence remains factual.
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

Single-package text combines evidence from different sources under one heading
per version. Requires action quotes are full; Should know and Unclassified
prefixes are up to 240 codepoints after Markdown link destinations become
numbered source references. Bullet, blockquote and inline-code syntax renders as
visible words; GitHub alert markers become e.g. `IMPORTANT:`. Words are not
paraphrased or semantically deduplicated. Local prefixes end in `...`, with one
expansion hint; backend truncation separately says `[statement truncated by
backend]`, including verbose. Verbose expands quotes and shows headings and
confidence. Kinds map to removal, behavior, runtime/platform, packaging/modules,
deprecation, security fix and notable change; missing kinds add no category.

Every entry/link URL appears once in the Sources list, referenced by quotes.
Entry links require matching version and `detailSource`; a missing locator is
identified by its source type and never borrowed from another source. Quoted
HTTP(S) links are also available through references. Text identifies agent
classification without model/formulation identifiers, including verbose and
batch; JSON retains them and lower-case entry `detailSource`.

Keyword matching consumes `breakingSignals`, `migrationSignals` and entry
`signals`. A matched full chunk already contained in a statement with the same
version and defined source becomes a heuristic tag on that statement. Distinct
keyword text or source remains separate in the same version block. Commit-list
noise and generic headings stay excluded. Sampled/other/heuristic entry sections
are removed. All newly rendered strings use terminal sanitization; JSON stays
raw.

Coverage always shows classified, not-assessed and without-notes counts, plus
no-impact units. Positive unparseable and omitted counts are explicit. Pending
versions prompt a rerun: later requests fill stored labels. Missing/unparseable
notes or an empty item list never imply no risk. Package-version fallback and
entry/locator sampling limits remain visible when present; ordinary entry
sampling never bounds statement classification. A cold range can take a few
seconds under the backend six-second batch deadline and 20-version package cap;
there are no client retries.

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

## Version-grouped UX revision (2026-10-07)

The owner reviewed real Express `5.0.0..5.2.1` output and found repeated sources,
versions and entry previews. The shared formatter now combines returned evidence
under one version heading, replaces Markdown destinations with unique source
references, removes the sampled/heuristic entry sections and keeps classifier
identifiers exclusively in JSON. The same saved dev response's default Changes
section went from 4,212 bytes / 69 lines to 2,717 bytes / 52 lines at width 80;
this is an output-size observation, not a runtime performance claim.

The full Bun suite passed 5,638 tests / 22,598 assertions. Focused formatter,
CLI/MCP parity, handler and descriptor-catalog checks passed 55 tests / 769
assertions. Typecheck, build, public-package validation, both built smokes and
source auth-handling smokes passed. Source isolated live cohorts still skipped
with AUTH_REQUIRED as described above. Normal-auth dev CLI verified the Express
example; local stdio MCP verified that example, all three original requested
ranges and their batch, with one heading per version, no model identifiers and
no repeated entry sections. Query selections and JSON projection are unchanged,
so complexity remains 284 / 500. The model owner remains the backend; no backend
or remote-MCP changes were needed.

Targeted descriptor-only Codex eval with GitHits intent completed successfully
with medium confidence and nine logical MCP calls, including three
`pkg_upgrade_review` calls. Trace/final/metrics were inspected; no isolation
violation artifact was emitted. No quality grading ran. Internal review found
that excerpts could leave unreferenced link URLs in Sources; filtering the
source list to rendered references closes that gap for statements and keyword
quotes. The final affected checks passed 56 tests / 774 assertions, with
post-fix typecheck/build/package validation. The full-suite count above predates
that final focused source-list regression.
