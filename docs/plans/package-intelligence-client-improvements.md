# Plan: Deeper package-intelligence client evidence

## Status

- Overall: **COMPLETE**
- Phase 1 — package overview distinguishes current-version and package-history
  evidence: **COMPLETE — released in 0.12.1 after PR #350**
- Phase 2 — dependency analysis exposes actionable issue and conflict evidence:
  **COMPLETE — released in 0.12.1 after PR #351**
- Phase 3 — vulnerability inspection audits resolved transitive dependencies on
  explicit request: **COMPLETE — implementation and final verification finished**
- Last verified: 2026-09-04

## Problem and overall expected outcome

The package-intelligence backend exposes decision-relevant facts that the shared
CLI/MCP clients historically omitted. Phases 1 and 2 closed the package-summary and
dependency-issue gaps. The remaining gap is vulnerability inspection:
`pkg_vulns` can report advisories affecting one package version or its package-wide
history, but cannot answer which advisories affect the versions actually resolved in
that package's dependency graph.

When this plan is complete:

- `pkg_info` distinguishes latest-version risk from package-wide advisory history;
- `pkg_deps` exposes actionable dependency issues and conflict provenance across
  every registry the deployed dependency resolver supports; and
- `pkg_vulns` retains its direct-only default while an explicit transitive mode
  reports affected resolved dependency versions, matched ranges, severity, and the
  nearest known higher fix.

These are shared CLI/MCP contracts. JSON is additive and audit-grade; human text is
bounded, outcome-first, and backed by the same normalized service data.

## Verified current state and evidence

### Completed client behavior

- Reorientation is based on fresh `origin/main` at `3debd53` after PR #353.
- PR #350 merged the `pkg_info` advisory-scope, version-count, freshness, and final
  URL/action hierarchy contract.
- PR #351 merged `pkg_deps --issues` / MCP `include_issues`, typed issue rows,
  conflict importer provenance, and fail-closed companion-graph validation.
- PR #353 consumed both change fragments into the 0.12.1 changelog and package
  versions. npm reports `githits@0.12.1` and `@githits/mcp@0.12.1`; Phase 3 must
  create new fragments rather than reusing the released records.

### Direct vulnerability behavior

- CLI `pkg vulns <spec> --scope affected|non_affecting|all` and MCP
  `advisory_scope` already distinguish current affectedness from package history.
- `--severity` / `min_severity` maps labels to backend CVSS thresholds.
  `--include-withdrawn` / `include_withdrawn` applies to the direct package query.
- The service paginates direct advisory rows in pages of 100 and rejects incomplete
  pagination.
- The shared response module owns the lean JSON envelope and the only CLI/MCP text
  formatter. CLI and MCP JSON parity is already tested.
- A live `pkg vulns npm:express --scope all` call on 2026-09-04 resolved
  `express@5.2.1`, reported no active vulnerability for that version, and returned
  five historical package advisories.

### Phase 3 completion evidence

- The final `bun test` gate passed 4,044 tests.
- Targeted agent evaluation was unavailable: the isolated Claude environment was
  unauthenticated, and the dedicated Codex evaluation home was not provisioned.
  This is an unavailable-harness result, not a passing evaluation.

### Available transitive vulnerability contract

The backend at local commit `278cbb6d9` and the deployed GraphQL service expose the
lazy field:

```graphql
packageDependencies(..., includeTransitive: true) {
  dependencies {
    transitive {
      vulnerabilitySummary(minSeverity: $minSeverity) {
        affected { totalVulnerabilities ... }
        totalPackagesAnalyzed
        affectedPackageCount
        packages {
          registry
          name
          affectedCount
          advisoryOccurrences(
            scope: AFFECTED
            minSeverity: $minSeverity
          ) {
            version
            affectsResolvedVersion
            matchedAffectedVersionRanges
            fixVersionsAboveResolved
            nearestFixedVersion
            advisory { ... }
          }
        }
      }
    }
  }
}
```

Verified semantics:

- the inspected root package is excluded from resolved dependency totals;
- `affectedCount` and `totalVulnerabilities` count package-version/advisory
  occurrences, not merely unique advisory IDs;
- affected occurrences carry the resolved version, exact matching ranges, higher
  fixed-version candidates, and nearest candidate;
- `minSeverity` filters aggregates, package rows, and occurrences consistently;
- transitive analysis excludes withdrawn advisories unconditionally;
- `advisoryOccurrences` returns every matching row when `limit` is omitted; a
  supplied limit is capped at 500; and
- `packages` can contain non-affecting-only rows, so the client must retain only
  rows with positive `affectedCount` for the affected audit.

The current core client already validates and normalizes the broader transitive
summary for upgrade-review probes, but that query hard-caps affected occurrences at
five per package and selects additional upgrade evidence. It is not a complete audit
contract and is not the right normal `pkg_vulns` path.

Authenticated production probes on 2026-09-04 established the intended selection:

| Package | Resolved package versions checked | Affected packages | Affected occurrences | Observed duration |
| --- | ---: | ---: | ---: | ---: |
| `npm:express@4.17.1` | 49 | 6 | 11 | 0.6 s |
| `npm:webpack@5.75.0` | 101 | 0 | 0 | 3.1 s |
| `npm:react-scripts@5.0.1` | 1,235 | 9 | 21 | 23.7 s |

The uncapped `react-scripts` response included six occurrences for one package,
proving that omission of `limit` returns evidence the existing upgrade probe drops.
All three calls selected no dependency graph. These are representative observations,
not latency guarantees.

A Crates probe of `reqwest@0.11.20` returned one affected `h2@0.3.27`
occurrence keyed by `RUSTSEC-2026-0258` with `GHSA-q83h-524g-xf6h` as its alias,
not two occurrences. `cargo-edit@0.11.11` likewise returned each GHSA/RUSTSEC alias
pair once. This verifies that the backend transitive classifier performs the logical
alias deduplication that the direct client currently has to apply itself.

### Registry capability drift

The deployed dependency resolver now accepts npm, PyPI, Hex, Crates, vcpkg, Zig,
NuGet, Maven, Packagist, RubyGems, Go, and Swift. Live typed-client probes resolved:

- `nuget:Newtonsoft.Json@13.0.4`;
- `maven:org.apache.commons:commons-lang3@3.20.0`; and
- `packagist:monolog/monolog@3.11.0`.

Their transitive vulnerability summaries also completed successfully. The client
`pkg_deps` request builder and ecosystem audit still classify NuGet, Maven, and
Packagist as unsupported. This is stale client capability data, not a backend gap.

Direct vulnerability data remains unavailable for vcpkg and Zig. Therefore the
current transitive-vulnerability registry set is exactly the direct-vulnerability
set: npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, and Swift.

### Contradictions resolved by reorientation

- The earlier plan treated NuGet, Maven, and Packagist as unsupported dependency
  registries. That is now false in the deployed backend and must be corrected in the
  client, docs, and ecosystem audit.
- The earlier acceptance criterion required explicit occurrence truncation. The
  backend supports complete affected occurrences by omitting `limit`, and production
  probes verified that shape. Phase 3 will return complete JSON instead of inventing
  a client cap or truncation metadata.
- Reusing the upgrade-review dependency probe would silently retain its five-row
  limit and broader query. Phase 3 needs a dedicated minimal query.

## Scope

1. Add CLI `--transitive` and MCP `include_transitive: boolean` to
   `pkg_vulns`. Omission and explicit `false` retain direct-only behavior.
2. Return complete affected transitive occurrences in CLI `--json` and MCP
   `format: "json"`; bound only human-readable text.
3. Apply the existing severity threshold to both direct and transitive queries.
   Keep direct advisory scope and withdrawn controls direct-only and state that
   boundary in output metadata and text.
4. Add a field-minimal transitive vulnerability query that selects neither the
   dependency DAG nor direct/group/issue dependency data.
5. Centralize client registry capability ownership and enable NuGet, Maven, and
   Packagist for `pkg_deps`, matching the deployed resolver.
6. Preserve CLI/MCP parity, typed errors, smoke coverage, agent discoverability,
   permanent documentation, and per-artifact release fragments.

## Non-goals

- Changing the default direct advisory scope from affected to all.
- Reporting non-affecting transitive history or withdrawn transitive advisories.
- Adding an occurrence limit, pagination option, dependency depth option, or partial
  transitive result.
- Returning the raw dependency graph, dependency groups, dependency issues, or
  transitive license data from `pkg_vulns`.
- Reusing or changing `pkg_upgrade_review` behavior.
- Adding a backend aggregate query, cache, retry, queue, feature flag, or local
  version/vulnerability evaluator.
- Assigning safety, upgrade approval, compatibility, or risk verdicts.
- Version-aware `pkg_info`, code-index availability, repository-quality scoring,
  package comparison, or transitive licenses. Those remain outside this client phase.
- Changing a public REST/GraphQL API. This phase consumes the deployed GraphQL
  contract and changes the public CLI/MCP package surfaces only.

## Target architecture

### Boundaries and ownership

- **Registry capabilities:** a new
  `packages/mcp/src/shared/pkgseer-capabilities.ts` owns client-known
  dependency and vulnerability registry sets, predicates, and human-readable lists.
  Multiple package request builders and the ecosystem audit consume that source. This
  is the right level because these are client feature capabilities, not registry
  taxonomy and not formatter policy. Keeping a second set inside
  `package-vulnerabilities-request.ts` would preserve the drift already observed.
- **Request semantics:** `package-vulnerabilities-request.ts` owns
  `includeTransitive` normalization alongside existing version, severity, scope, and
  withdrawn inputs. CLI and MCP keep surface-native spellings but produce one
  `PackageVulnerabilitiesParams`.
- **Data access:** `PackageIntelligenceService.packageVulnerabilities` owns the
  complete direct-plus-optional-transitive vulnerability report. It first completes
  the existing direct query/pagination, then—only when requested—executes one
  dedicated transitive query using the exact backend-resolved root version. This
  prevents a latest-release race and preserves Swift's backend-owned version
  normalization.
- **Graph analysis:** the backend `packageDependencies` resolver continues to own
  dependency traversal and advisory classification. The client neither requests nor
  reconstructs the graph.
- **Presentation:** `package-vulnerabilities-response.ts` owns the additive lean
  transitive envelope, deterministic presentation ordering, and the shared
  CLI/MCP text formatter. Entrypoints remain thin.
- **Terminal-text safety:** `packages/mcp/src/shared/terminal-text.ts` owns the
  existing proven control-sequence sanitizer after it is extracted from the
  resolve-target response module. The vulnerability formatter sanitizes local
  display values before width measurement, wrapping, interpolation, or color; JSON
  builders remain lossless. This is the right shared boundary because terminal
  controls are a cross-formatter text concern. Importing the helper from a
  resolve-target module or duplicating its regex would preserve misplaced ownership.

The sequential second query is deliberate. Reusing
`PackageIntelligenceService.packageDependencies` would over-fetch direct
dependencies, groups, or graph data; combining the transitive root field with the
paginated direct query would either repeat expensive transitive work on later pages
or add page-dependent query behavior. One dedicated query after direct version
resolution is the smallest consistent boundary.

### Data flow

```text
CLI pkg vulns / MCP pkg_vulns
  -> shared request builder
  -> PackageIntelligenceService.packageVulnerabilities
       -> existing direct vulnerability query and pagination
       -> if includeTransitive === true:
            dedicated packageDependencies vulnerabilitySummary query
            using the resolved direct-package version
  -> VulnerabilityReport { package, security?, transitive? }
  -> shared lean response builder
  -> JSON, or shared text formatter with surface/width/color inputs
```

An explicit transitive request is atomic at the client boundary. If the second query
fails or violates its contract, the command/tool returns the existing mapped error;
it does not silently return direct-only evidence.

### Service contract

Extend the neutral types additively:

```ts
interface PackageVulnerabilitiesParams {
  // existing fields unchanged
  includeTransitive?: boolean;
}

interface TransitiveVulnerabilityAudit {
  /** Number of resolved package-version graph nodes checked. */
  totalPackagesAnalyzed: number;
  /** Number of registry/name dependency package rows with affected occurrences. */
  affectedPackageCount: number;
  affectedOccurrenceCount: number;
  calculatedAt?: string;
  packages: TransitiveVulnerabilityAuditPackage[];
}

interface TransitiveVulnerabilityAuditPackage {
  registry: string;
  name: string;
  affectedOccurrenceCount: number;
  occurrences: TransitiveDependencyVulnerability[];
}

interface VulnerabilityReport {
  package: PackageVersionIdentity;
  security?: VulnerabilitySecurityDetails;
  transitive?: TransitiveVulnerabilityAudit;
}
```

The dedicated GraphQL document selects:

- root package `name`, `registry`, and `version` for identity validation;
- affected total only, `totalPackagesAnalyzed`, `affectedPackageCount`, and
  `calculatedAt`;
- package `registry`, `name`, and `affectedCount`; and
- all `advisoryOccurrences(scope: AFFECTED, minSeverity: $minSeverity)` with no
  `limit`, including resolved version, affectedness proof, matched ranges, higher
  fix candidates, nearest fix, ID/aliases, summary, severity, dates, and malicious
  marker.

It does not select `nonAffecting`, `combined`, `versions`, `advisoryIds`,
`mostCritical`, advisory-wide affected/fixed arrays, dependency graph, direct
dependencies, groups, conflicts, issues, or cycles.

For an explicit audit, the service fails closed when:

- the nullable transitive summary is absent;
- returned root identity/version differs from the direct report;
- an affected occurrence claims `affectsResolvedVersion: false` or has no matched
  range;
- an affected package's complete occurrence length differs from its
  `affectedCount`;
- the retained positive-count package rows differ from
  `affectedPackageCount`; or
- their occurrence-count sum differs from the affected aggregate total.

Non-affecting-only package rows are valid backend output and are omitted from the
normalized affected audit. No fallback or partial-result state is added.

### Public JSON contract

Existing top-level fields and meanings remain unchanged. Explicit transitive mode
adds:

```ts
interface LeanTransitiveVulnerabilityAudit {
  scope: "resolved_dependencies";
  withdrawnAdvisoriesIncluded: false;
  summary: {
    totalPackagesAnalyzed: number;
    affectedPackageCount: number;
    affectedOccurrenceCount: number;
    bySeverity?: Partial<Record<VulnBucket, number>>;
  };
  calculatedAt?: string;
  packages: LeanTransitiveVulnerablePackage[];
}

interface LeanTransitiveVulnerablePackage {
  registry: string;
  name: string;
  affectedOccurrenceCount: number;
  occurrences: LeanTransitiveVulnerabilityOccurrence[];
}

interface LeanTransitiveVulnerabilityOccurrence {
  resolvedVersion: string;
  id?: string;
  aliases?: string[];
  summary?: string;
  severity?: number;
  severityLabel?: VulnSeverityLabel;
  matchedAffectedVersionRanges: string[];
  fixVersionsAboveResolved: string[];
  nearestFixedVersion?: string;
  publishedAt?: string;
  modifiedAt?: string;
  isMalicious?: true;
}

interface LeanVulnerabilityReport {
  // existing fields unchanged
  transitive?: LeanTransitiveVulnerabilityAudit;
}
```

`packages` is present as an empty array after a successful zero-result audit so
callers can distinguish checked-clean from not requested. Severity buckets partition
the complete affected occurrence rows using the existing disjoint
`malware | critical | high | medium | low | unrated` vocabulary; their sum equals
`affectedOccurrenceCount`. Backend aggregate and package counts remain the source
of truth and are validated against the complete selected rows. No transitive alias
deduplication is added because the backend advisory classifier already deduplicates
logical advisories before producing occurrences.

The existing top-level `filter` continues to echo caller input. Documentation and
text state that `advisoryScope` and `includeWithdrawn` affect direct package rows
only, while `minSeverity` affects both direct and transitive rows.

### Human-readable contract

Direct-only text remains byte-for-byte unchanged for control-free values. Hostile
control-bearing values are intentionally sanitized. With transitive mode, the
existing direct package evidence remains first, followed by one final section:

```text
Resolved dependencies
11 affected advisory occurrences in 6 dependency packages; 49 resolved package
versions checked
  4 high | 3 medium | 4 low

  high  body-parser@1.19.0  GHSA-...  summary
        matched      >=1.19.0 <1.20.3
        nearest fix  1.20.3

... (+6 more; use -v)
```

- A zero result says:
  `No affected advisory occurrences found; N resolved package versions checked.`
- Compact text shows at most five occurrence rows across all packages, ordered by
  malware/severity first and then stable package/advisory identity.
- `--verbose` / `verbose:true` shows every selected occurrence and all matched
  ranges/fix candidates.
- Each row states the nearest known higher fix, or explicitly says that no higher
  fixed version is known.
- Long summaries and range/fix lists wrap to the supplied terminal width without
  splitting package coordinates, versions, advisory IDs, or URLs.
- One surface-native completion hint appears after all truncated transitive evidence,
  not inside an evidence row.
- Formatter-authored punctuation remains ASCII, backend Unicode is preserved, and
  color never carries unique meaning.
- Every backend/caller-derived direct and transitive display value is sanitized for
  ANSI, OSC, C0, C1, and DEL controls before layout or formatter-owned color is
  applied. JSON preserves the original strings through normal JSON escaping.
- If direct `include_withdrawn` is active, the transitive section states once that
  withdrawn advisories are excluded from dependency analysis.

## Assumptions and unknowns

### Overall assumptions

- The deployed GraphQL contract and registry support verified on 2026-09-04 remain
  available through implementation.
- A complete transitive audit may be slow for very large graphs; explicit opt-in is
  the product cost boundary.
- `text-v1` may evolve in place while JSON remains additive.
- Phases remain separate merged increments; Phase 3 does not rewrite Phases 1 or 2.

### Overall unknowns or product decisions

None. Registry scope, option names, full-occurrence behavior, direct/transitive
filter semantics, error behavior, and public response shape are defined above.

## Cross-cutting considerations

### Security and trust

- Advisory summaries, package names, versions, ranges, aliases, and fix strings are
  untrusted backend text. Human/agent text strips terminal-control sequences before
  layout and never interpolates values into executable commands; JSON stays
  lossless.
- Counts and nearest fixed versions are evidence, not safety or upgrade
  recommendations. `nearestFixedVersion` is an advisory-level candidate above the
  resolved version, not proof that every matched range is fixed there.
- No credentials, raw authorization headers, or raw GraphQL bodies enter fixtures,
  diagnostics, documentation, or review evidence.

### Performance and compatibility

- Default and explicit-false requests execute only the existing direct query path;
  tests assert there is no transitive request.
- Explicit transitive mode performs one additional field-minimal request after
  direct pagination and may traverse the full resolved graph. No graph payload is
  returned.
- JSON is complete and can be large. Text is locally bounded without changing JSON.
- There is no state migration. CLI/MCP options and JSON fields are additive, and
  rollback is a normal code revert.
- The `pkg_deps` registry expansion removes only stale client-side rejections; its
  existing response contract is unchanged.

### Testing, documentation, and release

- All pure projection and formatting behavior is covered with deterministic fixtures;
  service tests mock GraphQL at the transport boundary.
- GraphQL tests assert both request sequencing and exact default/transitive field
  selections.
- Update `docs/implementation/tools.md`,
  `docs/implementation/cli-commands.md`, and
  `docs/implementation/mcp-cli-parity.md`. Record the shared text-output trust
  boundary in `docs/implementation/TOOL_GUARDRAILS.md`. Update ecosystem-audit
  documentation and fixtures to stop treating NuGet, Maven, and Packagist dependency
  calls as expected failures.
- Add a targeted `package-vulnerability-transitive.md` agent workload because the
  MCP schema and descriptor change.
- Add three independent release fragments: transitive vulnerability audit and
  dependency-registry parity each record pending minor impact for both `githits` and
  `@githits/mcp`; vulnerability terminal-text safety records pending patch impact for
  both. Do not edit `CHANGELOG.md` or package versions.

## Phase map

### Phase 1 — package overview distinguishes version risk from package history

- **Status:** COMPLETE — merged in PR #350 at `9d267a2`.
- **Expected outcome:** latest-version and package-history evidence is explicit;
  version/freshness facts are available; URL and action hierarchy is readable.
- **Assumptions:** merged backend summary fields remain available.
- **Unknowns or product decisions:** none.
- **Dependencies:** none remaining.
- **Acceptance criteria:** satisfied by the merged implementation and permanent
  documentation.

### Phase 2 — dependency issues and conflicts become actionable

- **Status:** COMPLETE — merged in PR #351 at `16ecf75`.
- **Expected outcome:** explicit issue analysis exposes deprecated, outdated,
  duplicate, and conflict evidence with importer provenance.
- **Assumptions:** merged dependency issue/graph contracts remain available.
- **Unknowns or product decisions:** none.
- **Dependencies:** none remaining.
- **Acceptance criteria:** satisfied by the merged implementation, 3,976-test final
  gate, source/built smoke suites, agent evaluation, and permanent documentation.

### Phase 3 — vulnerability inspection audits resolved dependencies

- **Status:** COMPLETE — implementation and final verification finished.
- **Expected outcome:** an explicit transitive mode reports complete vulnerability
  occurrences affecting resolved dependency versions while direct-only behavior and
  cost remain unchanged; `pkg_deps` accepts every deployed dependency registry.
- **Assumptions:** the verified deployed transitive summary, occurrence, and registry
  contracts remain stable during implementation.
- **Unknowns or product decisions:** none.
- **Dependencies:** Phases 1 and 2 merged; deployed GraphQL probes above passed.
- **Acceptance criteria:** the detailed criteria below.

## Phase 3 detailed implementation plan

### Likely affected components

- `packages/mcp/src/shared/pkgseer-capabilities.ts` and a focused test: establish
  one client capability source for dependency and vulnerability registries.
- `packages/mcp/src/shared/package-dependencies-request.ts` and tests: consume the
  shared dependency predicate/list and accept NuGet, Maven, and Packagist.
- `packages/mcp/src/shared/package-vulnerabilities-request.ts` and tests: consume
  the shared vulnerability predicate/list and normalize `includeTransitive`.
- `packages/core-internal/src/services/package-intelligence-service.ts` and tests:
  extend the neutral report, add the dedicated query and cross-field validation, and
  preserve the default wire path.
- `packages/mcp/src/shared/package-vulnerabilities-response.ts` and tests: build
  the exact additive JSON block and transitive text section, and sanitize every
  direct/transitive display value without mutating JSON.
- `packages/mcp/src/shared/terminal-text.ts`, its focused test, and existing sanitizer
  consumers: move the proven helper out of resolve-target ownership without changing
  existing output.
- `packages/mcp/src/tools/package-vulnerabilities.ts` and tests: add
  `include_transitive`, update first-sentence/first-80-safe discovery text, and pass
  the normalized option.
- `src/commands/pkg/vulns.ts` and tests: add `--transitive`, help, and formatter
  inputs.
- `packages/mcp/src/internal.ts`, test helpers, and
  `src/tools/package-vulnerabilities-parity.test.ts`: retain root CLI access and
  prove JSON/error parity.
- CLI/MCP smoke suites, `scripts/pkg-ecosystem-audit.ts`, permanent docs, the
  targeted agent workload, and three changes fragments.

No container or backend change is expected.

### Ordered implementation steps

1. Add failing capability/request tests for the deployed 12-registry dependency set,
   the 10-registry vulnerability set, transitive omission/false/true normalization,
   severity propagation, and version validation including Swift.
2. Introduce the shared capability module, re-export existing internal names where
   needed, migrate both request builders and the ecosystem audit, and make
   `pkg_deps` accept NuGet, Maven, and Packagist without changing its output.
3. Add failing core service tests for:
   - unchanged direct-only query count and variables;
   - direct pagination followed by exactly one transitive request;
   - use of the backend-resolved root version;
   - `minSeverity` propagation and direct-only withdrawn/scope variables;
   - absence of graph/direct/group/issue/non-affecting/limited occurrence fields;
   - zero-result normalization; and
   - every fail-closed identity/count/occurrence invariant above.
4. Extend `PackageVulnerabilitiesParams` / `VulnerabilityReport`, implement the
   dedicated query and normalizer, and keep all existing error classification and
   token-refresh behavior.
5. Extract `sanitizeTerminalText` into the neutral terminal-text module, migrate its
   existing consumers, and add focused helper regressions without changing their
   output. Add hostile direct/transitive vulnerability text fixtures proving every
   displayed untrusted field is sanitized before layout/color while JSON preserves
   the original strings. Preserve the order-sensitive normalize-then-sanitize-then-
   collapse contract and the `a\nb`, `a\tb`, and `a <BEL> b` cases specified in
   `docs/plans/terminal-text-sanitization.md`.
6. Add failing pure response tests for the exact JSON contract: positive and zero
   audits, lowercase registries, complete occurrences, severity/malware partitioning,
   missing nearest fixes, ISO date omission rules, filter-scope semantics, and stable
   ordering.
7. Implement the lean projection and shared formatter section. Cover 20/40/80/120
   column widths, Unicode preservation, no-color/color word parity, compact five-row
   cap, verbose completeness, one final surface-native hint, and direct-only text
   regression snapshots/structural assertions.
8. Wire the CLI and MCP options and update their descriptions. Test omitted, explicit
   false, explicit true, `--json`, `--verbose`, combined direct scope/withdrawn
   filters, cancellation/error mapping, and first-sentence/first-80 descriptor
   contracts.
9. Update parity fixtures, source/built smoke checks, ecosystem registry audit,
   permanent documentation, agent workload, and the three release fragments.
10. Run focused tests, then the full verification matrix and targeted agent
   evaluation. Inspect actual agent tool calls and final evidence use, not only
   harness exit status.

### Edge cases and failure behavior

- No dependencies: return a checked transitive block with zero package/occurrence
  counts and `packages: []`.
- Dependencies but no affected advisories: retain `totalPackagesAnalyzed` and show
  checked-clean text.
- Multiple affected versions of one dependency: preserve one package row with one
  occurrence per resolved version/advisory pair.
- Multiple advisories for one resolved version: preserve every backend occurrence.
- Missing higher fixed version: retain an empty `fixVersionsAboveResolved`, omit
  `nearestFixedVersion`, and state the absence in text.
- Null severity: classify as `unrated`; malicious rows use the disjoint
  `malware` bucket.
- Direct `advisory_scope=all|non_affecting`: affects only the direct advisory list;
  transitive remains affected-only.
- Direct `include_withdrawn=true`: withdrawn direct rows may appear; transitive
  metadata remains `withdrawnAdvisoriesIncluded: false`.
- Explicit transitive request with malformed/missing backend evidence: return the
  existing typed backend/protocol error, never a partial direct-only success.
- Known unsupported vulnerability registries vcpkg and Zig still fail before any
  network call. NuGet, Maven, and Packagist succeed for both dependency and
  vulnerability request construction.

### Verification

Run:

```bash
bun test packages/mcp/src/shared/pkgseer-capabilities.test.ts
bun test packages/mcp/src/shared/terminal-text.test.ts
bun test packages/mcp/src/shared/package-dependencies-request.test.ts
bun test packages/mcp/src/shared/package-vulnerabilities-request.test.ts
bun test packages/core-internal/src/services/package-intelligence-service.test.ts
bun test packages/mcp/src/shared/package-vulnerabilities-response.test.ts
bun test packages/mcp/src/tools/package-vulnerabilities.test.ts
bun test src/commands/pkg/vulns.test.ts
bun test src/tools/package-vulnerabilities-parity.test.ts
bun test
bun run typecheck
bun run lint
bun run format:check
bun run build
bun run validate:packages
bun run smoke:cli
bun run smoke:mcp
bun run smoke:cli:built
bun run smoke:mcp:built
```

When authenticated, re-run representative source CLI/MCP probes for:

- `npm:express@4.17.1` positive transitive evidence;
- a zero-result transitive audit;
- `--severity high` alignment across direct and transitive counts;
- direct `--scope all --include-withdrawn` plus transitive semantics;
- a Crates dependency with a GHSA/RUSTSEC alias pair, confirming one logical
  transitive occurrence; and
- NuGet, Maven, and Packagist `pkg_deps` calls.

Run the targeted `package-vulnerability-transitive.md` workload with Claude and
Codex when practical. Verify agents select transitive mode for dependency-tree/audit
questions, retain direct-only mode for root-package questions, distinguish history
from resolved affectedness, and cite matched-range/fix evidence without declaring the
package safe.

### Phase 3 acceptance criteria

- CLI `--transitive` and MCP `include_transitive:true` are one effective opt-in;
  omission and explicit false preserve direct-only behavior and network cost.
- Direct JSON fields, meanings, text, filters, pagination, and errors remain
  compatible.
- Explicit mode queries the exact resolved root version and returns complete affected
  occurrences without a graph payload, occurrence limit, or silent partial result.
- JSON matches the exact additive contract above, preserves empty checked evidence,
  and passes CLI/MCP deep-equality parity.
- Aggregate, package, and occurrence counts reconcile; malformed selected evidence
  fails closed.
- Severity applies to both scopes; direct advisory scope/withdrawn controls remain
  direct-only and that distinction is explicit.
- Compact text leads with direct outcome, follows with resolved-dependency evidence,
  stays width-bounded, and puts its single completion hint after evidence. Verbose
  text and JSON retain all selected occurrences.
- Direct and transitive text strips hostile terminal-control sequences before layout
  while JSON preserves the same source strings losslessly.
- `pkg_deps` accepts NuGet, Maven, and Packagist, and the shared capability source,
  docs, and ecosystem audit match the deployed registry sets.
- Focused/full tests, wire assertions, typecheck, lint, formatting, build, package
  validation, all four smoke modes, authenticated probes, permanent docs, and release
  fragments complete successfully. Targeted agent evaluation was unavailable because
  the isolated Claude environment was unauthenticated and the dedicated Codex
  evaluation home was not provisioned.

## Phase-boundary reorientation

Phase 3 is the final implementation phase. If backend schema or deployed behavior
changes before implementation begins, run `$next-steps` and replan rather than adding
a fallback. If Phase 3 is split during implementation because production code grows
past the repository's simplicity threshold, split only at the capability-parity
boundary: registry parity first, transitive audit second, with both preserving the
same target contract.

## Completion and plan cleanup

The effort is complete when Phase 3 merges, all final request/response, registry,
filter, fetching, formatter, and verification contracts are durable under
`docs/implementation/`, and pending changes fragments remain available for release
preparation.

Before deleting this temporary plan:

1. confirm the final code and permanent docs contain every active contract above;
2. confirm no backend-owned work or review finding exists only here;
3. retain private backend issues #2211–#2214 as the durable backlog for excluded
   package-summary/version/license/index work; and
4. delete this file in the final Phase 3 implementation PR.
