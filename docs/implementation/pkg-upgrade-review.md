# Package Upgrade Review

## Purpose

Dependency-upgrade reviews are a distinct agent workflow. Agents should not infer acceptability from semver, especially for patch updates. The tool surface should make evidence collection cheaper than manually composing `pkg_changelog`, `pkg_vulns`, and `pkg_deps` calls for every package.

`pkg_upgrade_review` is the MCP/CLI-facing tool for this workflow. It answers: "What changed between the currently used version and the target version, and what evidence is available or missing?"

Original risk fields were verified against backend `priv/graphql/schema.graphql` and authenticated dev field selection on 2026-10-07. The #3072 additions are verified against branch SDL at bb3807cc; their dev verification is pending deployment notice. Dev disables introspection; the schema file confirms names, enums and nullability.

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

The CLI/MCP implementation must not fall back to composing `packageSummary`, `packageVulnerabilities`, `packageChangelog`, or `packageDependencies` calls. If the aggregate query is unavailable, surface the backend protocol error. The original aggregate and risk fields are deployed. The ambiguity flag and pre-cap counts added by backend #3072 require backend deployment before this PR can merge or release. Dev verification waits for the owner’s explicit deployment notice.

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
    itemsMustActConfident: number;
    itemsMustActAmbiguous: number;
    itemsShouldKnowConfident: number;
    itemsShouldKnowAmbiguous: number;
    itemsUnclassified: number;
    itemsOmitted: number;
  };
}

interface UpgradeChangelogRiskItem {
  version: string;
  tier: "must_act" | "should_know" | "unclassified";
  ambiguous: boolean;
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
headline and a triage table sorted by the backend coverage count of confident `must_act` statements before the item cap. The aggregate line labels the backend `withUnknowns` counter as reported
unknowns and independently counts reviews with not-assessed, missing-note or
unparseable classification coverage. This avoids claiming zero evidence gaps
while the classifier is still pending. Equal confident-action counts keep backend order; uncertain counts are never a secondary sort key. Totals are computed by the backend before its statement cap; returned quote counts may be smaller. Default batch output has one unwrapped row per package, including peer dependency
change and compatibility-note counts (or not checked when absent); `--verbose` adds the detailed reports in
that order. JSON preserves backend review order. Zero and one package omit it. The summary and package sections report
facts only; they never call an upgrade safe, risky, approved, or rejected.

The Changes section uses one version block in backend release-entry order,
then any statement-only versions outside the entry sample. Within each version,
Requires action precedes Possibly requires action, Should know and Too long to classify. All returned statements
remain visible. Sources from release notes and changelog files are combined
without claiming differently worded statements are equivalent.

```text
Changes
  0 require action (+8 uncertain) | 6 should know (+2 uncertain) | 0 too long to classify
  Classification versions: 4 classified | 0 not assessed | 0 without notes | 125 statements labeled no impact
  ... other versions, each once
  5.1.0
    Possibly requires action (6)
      * [runtime/platform] (uncertain) "build: Node.js 23.0 by @bjohansebas in [11]" [5]
      * (uncertain) "deps: remove safe-buffer" [12]
      ... remaining returned quotes
    Should know (1)
      * [security fix] "fix(securite): fix vulnerabilities by @Abdel-Monaam-Aouini in [13]" [5]
  Sources
    ... each source URL once
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
per version. Each statement and additional keyword quote starts with `*`. Confident Requires action and uncertain Possibly requires action quotes are full; Should know and Too long to classify
prefixes are up to 240 codepoints after Markdown link destinations become
numbered source references. Bullet, blockquote and inline-code syntax renders as
visible words; GitHub alert markers become e.g. `IMPORTANT:`. Words are not
paraphrased or semantically deduplicated. Local prefixes end in `...`, with one
expansion hint; backend truncation separately says `[statement truncated by
backend]`, including verbose. Verbose expands quotes and shows headings and
confidence. Kinds map to removal, behavior, runtime/platform, packaging/modules,
deprecation, security fix and notable change. Kind labels use brackets, such as
`[security fix]`, colored yellow only in color-enabled CLI output. A missing
kind means no confident category was returned; the tier still applies. Those
quotes retain a bullet and no invented kind label. Coverage and no-impact units
share one summary, wrapping naturally at the caller width.

Only backend `ambiguous` controls uncertainty. MUST_ACT with `ambiguous: true`
appears as Possibly requires action with a muted `(uncertain)` marker; false
appears as Requires action. SHOULD_KNOW retains its tier and marks true items
uncertain, after false items. Numeric tier confidence remains evidence in JSON
and verbose text and never drives a client policy. The backend can change its
ambiguity policy without a client release; ambiguous tiers may be raised or
unchanged. A supplied kind is rendered without a client threshold; missing
kinds still retain their tier.

UNCLASSIFIED means only a statement too large to classify; its section says
Too long to classify - read it. Null confidence normalizes to omission for that
case. Summary and batch counts use the backend coverage totals before the
50-item cap, not counts reconstructed from returned quotes. Confident and
ambiguous act/know totals stay separate; batch ranking uses only the confident
action total, preserving backend order on ties. Per-version section counts
refer to the quoted items actually shown. Positive omitted counts explain the
difference without guessing classifications of absent statements.


Every entry/link URL appears once in the Sources list, referenced by quotes.
Entry links require matching version and `detailSource`; a missing locator is
identified by its source type and never borrowed from another source. Quoted
HTTP(S) links are also available through references. Text identifies agent
classification without model/formulation identifiers, including verbose and
batch; JSON retains them and lower-case entry `detailSource`.

Keyword matching consumes `breakingSignals`, `migrationSignals` and entry
`signals`. A matched full chunk already contained in a statement with the same
version and defined source appears in a separate `Keyword matches` subsection
within that version as `[breaking] matched quoted statement [n]`, using the
statement source reference rather than repeating its quote. Distinct keyword
text or source is quoted in that subsection. These are lexical hints, separate
from the agent-assigned tiers and kinds. Commit-list
noise and generic headings stay excluded. Keywords already displayed with quotes
are not repeated in an aggregate footer; signals with no returned matching
excerpt remain explicit as `Keyword matches without excerpts`. Sampled/other/heuristic entry sections
are removed. All newly rendered strings use terminal sanitization; JSON stays
raw.

Coverage always shows classified, not-assessed and without-notes counts, plus
no-impact units. Positive unparseable and omitted counts are explicit. Pending
versions are still being classified by background jobs or the job may have failed. Rerun a few seconds to a minute later to retrieve completed stored labels without rerunning the model; this does not promise that a failed job completed. Missing/unparseable
notes or an empty item list never imply no risk. Package-version fallback and
entry/locator sampling limits remain visible when present; ordinary entry
sampling never bounds statement classification. Classification runs asynchronously in backend jobs; there are no client retries or polling.

Public JSON adds `changelog.riskItems` and `changelog.riskCoverage` on both CLI
and MCP, retaining the existing envelope, lower-case enums and null-to-omission
convention. Thus null tier confidence (too-large unclassified statements), kind,
kind confidence, heading or source are omitted. Confidence zero remains zero.
All quote text, truncation flags and per-item model/formulation values are preserved. Stored labels survive classifier changes, so a review may contain different models or formulations (for example s-hier-v2 and s-hier-v3); no review-level provenance assumption is made.

The original query measured 262 complexity units before the change, 281 with all risk
fields, and 284 including entry `detailSource` on the three existing entry
selections, with both optional evidence subtrees enabled. Measurement used 501
unique aliases of `summary.total`; dev rejected the probes with total operation
complexities 763, 782 and 785 respectively, without executing resolvers. Each
alias adds one unit. The original single-package 284 was below production’s 500 limit; no fields were trimmed or second query added in that original change. Current selection/batch measurements and the bounded large-batch correction are below. The historical near-494 number does
not describe the current operation.


## Dev verification (2026-10-07)

The following original measurements predate backend #3060/#3063/#3064. Updated confidence-contract measurements are recorded below.

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
CLI/MCP parity, handler and descriptor-catalog checks initially passed 55 tests /
769 assertions. Typecheck, build, public-package validation, both built smokes and
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


External UX review (round 3): direction sound. One low finding showed
note-authored numeric Markdown references could impersonate Sources citations
and keep an otherwise clipped link in the source list. Reference-style link
labels now render as words, and note-authored `[n]` markers render as `(n)`
before formatter citations are inserted. The same rendering covers statement
quotes, keyword excerpts, verbose note previews and headings; JSON remains raw.
The round limit prevents another external review of this fix. It is verified by
a regression covering these paths and a clean internal closure review; no unresolved
finding remains. Final focused checks passed 57 tests / 782 assertions, with
post-fix typecheck/build/package validation.


Owner follow-up: statement, keyword and verbose note items now use `*` bullets.
The redundant `Heuristic keywords` footer was removed; lexical evidence is
shown in a per-version `Keyword matches` subsection, and aggregate-only signals retain an
explicit missing-excerpt line. The old sampled-entry section also carried the Express 5.1.0 changelog URL,
which was lost when that section was removed because its classified quotes
came from releases. A version-level `Notes` reference now retains returned
entry URLs whose source is not represented by a quote. Missing-locator
references still describe absent exact version/source pairs; the notes link
is never attributed to a quote from another source. The real
Express fixture asserts all returned entry URLs remain visible and unique.

Follow-up validation: 58 focused formatter/parity/MCP tests passed with 800
assertions; typecheck, Biome, build and public-package validation passed. Source
auth-handling and built CLI/MCP smokes passed. Normal-auth dev CLI Express and
local stdio MCP four ranges plus batch passed. Express has 11 statement bullets,
a version-level 5.1.0 Notes reference, all three returned changelog URLs and no
repeated keyword footer. Internal follow-up review returned no findings; the
existing three-round external-review limit remains in effect.


Presentation refinement: coverage and no-impact counts share one summary;
optional kind labels use brackets and color, while lexical hints appear in a
separate section within each version. Before the backend lowered its kind threshold, the observed 5.2.0 `res.redirect` warning
had `should_know` tier confidence 0.95 but no kind; its quote receives no invented
category. Bullets remain because labels are optional.

Validation: 69 focused formatter/parity/MCP/release-boundary tests passed with
884 assertions; typecheck, Biome, build, package validation and all four
source/built smokes passed. Dev CLI and sequential local MCP four ranges plus
batch passed. One concurrent MCP probe hit the SDK 60-second timeout; the same
probe passed sequentially, and the cause is unconfirmed. Internal full-follow-up
review was clean; no additional external round under the existing limit.


## Historical background classification and confidence contract follow-up

Backend #3060/#3063/#3064 are deployed on dev; production deployment was pending
at verification. No production probes or backend edits were performed. Field
names and query selections are unchanged; the prior measured complexity remains
284/500 for that selection. The local backend checkout at #3041 predates the
changes, so its old descriptions are not used as current semantic evidence.
Normal-auth dev responses verified both stored s-hier-v2 and new s-hier-v3 labels.

| Range | Confident / uncertain act | Confident / uncertain know | Too long | Classified / not assessed / without notes / unparseable | No impact | Omitted | Formulation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| npm:express@5.0.0..5.2.1 | 0 / 8 | 6 / 2 | 0 | 4 / 0 / 0 / 0 | 125 | 0 | s-hier-v2 |
| npm:express@4.19.2..4.21.2 | 3 / 1 | 8 / 2 | 0 | 4 / 0 / 0 / 0 | 43 | 0 | s-hier-v3 |
| npm:@biomejs/biome@2.4.2..2.4.15 | 13 / 28 | 9 / 0 | 0 | 13 / 0 / 0 / 0 | 812 | 13 | s-hier-v2 |

These ranges were already fully classified; no cold-job completion claim is
made. The batch accepts both Express ranges independently. Biome's returned
statement counts exclude its 13 omitted items; their classifications are not
inferred. Source quotes, keyword evidence and all per-item JSON provenance stay
intact. No deployed data-contract contradiction was observed.


Follow-up verification: full `bun test` passed 5,645 tests / 22,680 assertions;
typecheck, Biome, build, public-package validation and all four source/built
CLI/MCP smokes passed. Source isolated live cohorts still skipped AUTH_REQUIRED
as recorded earlier. Direct normal-auth dev CLI and local stdio MCP checked all
three ranges in text/JSON and their batch. JSON risk fields matched between
surfaces, comparing fields without imposing order within backend tier ties.
The batch orders Biome (13 act +28 uncertain), Express 4.19.2..4.21.2 (3 +1),
then Express 5.0.0..5.2.1 (0 +8). A same-response comparison shows the 5.1.0
internal-dependency quotes move from Requires action (6) to Possibly requires
action (6) with `(uncertain)` markers, preserving the full quote.

Targeted Claude descriptor-only agent eval was attempted but the CLI reported
Not logged in, made zero tool calls and produced no final answer/grade. This is
an unavailable qualitative check, not a passing eval. No credentials were read
or exposed and no app login was started. Internal final review returned no findings; the existing external code-review round limit remains in effect.

Final confidence-contract review: direction sound, no findings. No deferred implementation or refactoring work. The working plan is removed after review closure; no additional external code round under the existing limit.


## Backend-owned ambiguity and pre-cap totals (#3072)

Implementation targets the backend PR schema. `ambiguous` is required per item;
false is preserved in JSON. Required coverage fields are
`itemsMustActConfident`, `itemsMustActAmbiguous`, `itemsShouldKnowConfident`,
`itemsShouldKnowAmbiguous` and `itemsUnclassified`. The confident counters
exclude ambiguous items; each classified tier total is confident plus ambiguous.
All five totals precede the50-item cap, and zero values are preserved. Summaries and batch ordering consume these
totals directly. Tier confidence is evidence only, with no client threshold.
The Express fixture adds explicit mocked ambiguity/totals to an earlier captured
response; these additions are not claimed as live dev observations.

Offline measurement used the exact query and SDL from backend
`bb3807cccee5b78d07aa865edccab2fc4f8e1c4b`, Absinthe 1.11.0 and the root field’s
actual complexity callback, without running resolvers or loading backend
configuration. All selected child fields use default complexity. The old
single-package baseline reproduced 284; adding the six fields gives 290 for one,
306 for three and 498 for 27 packages, with both optional sections enabled.

The root callback adds20 plus 8 per package to child complexity 262. A single
30-package operation would cost 522 (the prior query already cost 516). No
selected field can be removed while retaining every consumer. Core service
therefore splits only valid 28–30-package batches into27 plus remainder sequential
aggregate requests. It preserves each backend review, input order and duplicate
inputs, sums the six factual summary counters and rejects the whole call if
one request fails. <= 27 remains one request; > 30 remains one request for backend rejection without splitting; the public
request builder rejects it locally. GraphQL complexity may reject a direct-service
call before resolver validation. This measured budget is the reason for a second query;
there is no new public limit, retry, queue or backend change.

Dev verification and server corroboration wait for the owner’s explicit #3072
deployment notice. No dev or production query is authorized for
this follow-up before that notice; production support is required before merge
or release. PR #463 remains draft and unmerged.


Local follow-up validation: full `bun test` passed 5,652 tests / 22,738 assertions;
typecheck, Biome, build, public-package validation and all four secret-free
source/built CLI/MCP smokes passed. Built smoke launches initially overlapped
package validation rebuilding dist; both passed after that rebuild finished.
Stable ambiguity/counter implementation internal review is clean. External plan
review recommends a backend complexity correction instead of client splitting;
the bounded split is a tested draft proposal awaiting the owner’s route decision,
not a settled architecture decision. It would need a selection-complexity guard
if retained. No fourth external code round under the existing PR limit. Targeted
live agent evaluation also waits for deployment; the earlier Claude eval was
unavailable because its CLI was not logged in.
