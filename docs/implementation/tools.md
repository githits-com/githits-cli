# MCP Tools

## Purpose

The CLI exposes MCP tools that mirror the backend's MCP server. This document explains the tool architecture, the parity requirement with the backend, and how to add or modify tools.

## Background

GitHits has two MCP server implementations:

- **Backend** (`githits-backend`) — Python/FastMCP, runs as hosted MCP services. Production exposes both the core example-search workflow (`get_example`, `search_language`, `feedback`) and indexed package/source tooling.
- **CLI** (`githits-cli`) — TypeScript/MCP SDK, runs locally via `githits mcp start`. Surfaces the same public tool families, including unified `search`, package intelligence (`pkg_*`), docs (`docs_*`), and code navigation (`code_*`).

The CLI mirrors the production MCP tool contract where equivalent tools exist. Core example-search tool descriptions are kept aligned with GitHits backend wording; indexed package/source tool descriptions are kept aligned with the backend contract.

## Tool-selection contract

MCP clients may receive only a truncated catalog before loading a tool
definition. Every tool description therefore starts with a compact,
benefit-specific verb/object phrase. Do not spend that prefix on generic
phrasing such as “Use when the user asks” or “Use when the user needs”. The
first 80 characters prioritize the user's likely question and the tool's
distinct role; treat that boundary as a ceiling, not a target. Keep registry
counts and enumerations in the loaded definition because they crowd out trigger
language and can imply incomplete or inconsistent catalog boundaries. The
loaded definition owns the complete use/avoid boundary, argument constraints,
and the exact name of each immediate follow-up tool; repeat those handoffs on
both sides of a workflow so a client can recover when it loads only one tool.

The 80-character boundary comes from an August 2026 Claude Desktop connector
session with no GitHits memories or user instruction to use GitHits. Its
unguided selection context contained the tool name and first 80 description
characters; the connector description and MCP server instructions were absent.
That observation is host-specific rather than an MCP protocol guarantee, but it
defines the minimum catalog surface GitHits designs and tests. Other clients
may expose different amounts or kinds of discovery context; 80 characters is
GitHits' verified Claude Desktop design target, not a cross-client guarantee.

Write the prefix as the answer to “why would an agent choose this tool now?”:

- Match natural questions such as “is this version vulnerable?” or “what does
  this package depend on?”, rather than catalog taxonomy or implementation
  mechanics.
- Distinguish sibling tools before adding shared corpus terms. For example,
  package health, advisory detail, dependency graphs, changelog history, and
  upgrade review need visibly different openings.
- Make every prefix stand alone. Do not assume ordering, adjacency, a shared
  connector description, `quick_start`, or server instructions supply context.
- Keep exhaustive registry coverage, schemas, limits, handoffs, and safety
  detail in the remainder of the loaded definition. Do not fill unused prefix
  characters merely because the client permits 80.

GitHits intentionally omits MCP initialize instructions because clients treat
them inconsistently: some hide them, some promote them, and some repeat them
with every tool. Guidance has two delivery paths: a loaded `githits-mcp` skill
already carries the stable guide and skips a normal `quick_start` call, while
plain MCP clients use the no-argument, read-only `quick_start` tool as their
fallback. Current tool descriptions remain authoritative; a material mismatch
with a stale skill snapshot or an exposed `Experimental` descriptor can still
require `quick_start` for runtime-specific guidance. The stable guide is owned
by `packages/mcp/src/mcp/instructions.ts`; the terminal skill section must stay
byte-for-byte aligned under `src/skills-packaging.test.ts`. Local
`buildLocalMcpQuickStart()` appendices are runtime-only and excluded from that
public copy. Individual tool descriptions remain self-contained so direct
tool selection does not depend on the bootstrap.

Use the tools in these roles:

- **Known-target discovery:** Start with `search` for relevance-ranked,
  open-ended investigation across documentation, specifications, source,
  symbols, tests, and examples. Omit `source` for broad discovery.
- **Exact source matching:** Use `code_grep` when the literal, regex,
  identifier, or call-site pattern is already known. It returns deterministic,
  paginated matches. Use `search` for conceptual discovery, `code_read` for a
  focused matched-file window, and `code_files` for path enumeration.
- **Navigation and documentation:** Use `code_files` to enumerate paths,
  `code_read` to read an exact source window, `docs_list` to browse package
  pages, and `docs_read` to read a page by ID. These tools advertise their
  immediate exact-name handoffs reciprocally. `get_example` is for canonical
  cross-project examples and unknown-target/global patterns; for a known
  package or repository, use `search`, `docs_*`, or `code_*` instead.
- **Conditional search continuation:** Call `search_status` only when the
  preceding `search` response explicitly supplies both a `searchRef` and a
  `search_status` action. The initial `search` call can complete, and reissuing
  the same search is valid while it waits on the same underlying work. A
  terminal or unrecognized status ends that reference; start a later search
  when a fresh session is needed.
- **Package intelligence:** Use `pkg_info` for a latest-version health and
  adoption overview, `pkg_vulns` for CVEs/advisories and affected or fixed
  versions, `pkg_deps` for dependency graphs, `pkg_changelog` for release and
  changelog evidence, and `pkg_upgrade_review` for current-versus-target
  evidence. Each package description advertises the nearest alternatives.
  `pkg_changelog` does not promise newest-first ordering or any other date
  ordering; callers should use the returned dates and versions.
- **Language and feedback:** Use `search_language` only to resolve a
  supported language name for `get_example`, not to search source. Use
  `feedback` after a GitHits result when bounded feedback is warranted.

## Current Tools

| Tool | Parameters | Description |
|---|---|---|
| `quick_start` | none | Load the canonical guide for public GitHub/package search, grep, code, docs, examples, routing, and external-content safety without querying GitHits evidence. Plain MCP clients call it once per session before other GitHits tools; skip it when the loaded `githits-mcp` skill already carries the guide. |
| `get_example` | `query`, `language?`, `license_mode?`, `format?` | Find canonical cross-project examples when no single target is the answer or target-scoped search came up short. For a known package or repository, use `search`, `docs_*`, or `code_*`. Defaults to markdown with source provenance and an optional `solution_id` for `feedback`; pass `format: "json"` for `{result, solution_id?}`. |
| `search_language` | `query`, `format?` | Resolve a supported language name or alias for `get_example`; do not use it for source search. Defaults to one compact line per match; pass `format: "json"` for structured matches. |
| `feedback` | `solution_id?`, `accepted`, `feedback_text?`, `tool_name?` | Submit feedback when a GitHits result or the overall experience was helpful, unhelpful, wrong, incomplete, slow, or confusing. Pass `solution_id` to rate an example or `tool_name` to identify a result. |
| `search` | `query`, `target?`, `targets?`, `source?`, `category?`, `kind?`, `path_prefix?`, `file_intent?`, `public_only?`, `name?`, `language?`, `allow_partial_results?`, `limit?`, `offset?`, `wait_timeout_ms?`, `format?` | Discover relevant evidence in a known target before exact grep: docs, specs, code, symbols, tests, and examples ranked by relevance. Open-ended “how does”, “where is”, “find”, “locate”, or loosely phrased “grep the source” questions start here; omit `source` for broad discovery. A `search` call can return complete results directly; use `search_status` only when the response explicitly supplies a `searchRef` and action. |
| `search_status` | `search_ref`, `wait_timeout_ms?`, `format?` | Continue an explicit `search` reference only after that response supplies a `searchRef` and `search_status` action. Inspect progress or retrieve interim, partial, or final hits; terminal and unrecognized statuses end that reference, so use a later `search` for a fresh session. |
| `docs_list` | `registry`, `package_name`, `version?`, `limit?`, `after?`, `format?` | List package documentation pages and hand off to `docs_read`; use `search` for topic discovery. Repo-backed entries include exact source metadata for `code_read` when available. |
| `docs_read` | `page_id`, `start_line?`, `end_line?`, `format?` | Read a package documentation page by ID; use `docs_list` to browse and `search` to find topics. Text output returns 150 lines by default or up to 300 with an explicit range; repo-backed pages include exact `code_read` metadata. |
| `pkg_info` | `registry`, `package_name`, `verbose?`, `format?` | Assess latest package health and adoption through license, downloads, and activity. Use `pkg_vulns` for advisory detail, `pkg_deps` for dependency graphs, `pkg_changelog` for release evidence, or `pkg_upgrade_review` for current-vs-target comparison. |
| `pkg_vulns` | `registry`, `package_name`, `version?`, `min_severity?`, `advisory_scope?`, `include_withdrawn?`, `verbose?`, `format?` | Check whether a package version is vulnerable and find affected and fixed versions. Use `pkg_info` for a latest health overview or `pkg_upgrade_review` for current-vs-target evidence. |
| `pkg_deps` | `registry`, `package_name`, `version?`, `lifecycle?`, `include_importers?`, `max_depth?`, `format?` | Inspect what a package depends on, directly or transitively. Use `pkg_info` for health, `pkg_vulns` for advisories, or `pkg_upgrade_review` for current-vs-target evidence. |
| `pkg_changelog` | `registry?`, `package_name?`, `repo_url?`, `from_version?`, `to_version?`, `limit?`, `git_ref?`, `omit_bodies?`, `verbose?`, `body_lines?`, `format?` | Find release notes and changelog history for a package or public GitHub repository. Latest mode returns recent entries without promising date order; range mode covers `(from_version, to_version]`. Use latest mode with `to_version` and `limit: 1` for one exact release. Use `pkg_info` for a quick health view or `pkg_upgrade_review` for upgrade evidence. |
| `pkg_upgrade_review` | `registry?`, `package_name?`, `current_version?`, `target_version?`, `packages?`, `skip_transitive_security?`, `include_dependency_issues?`, `min_severity?`, `verbose?`, `format?` | Review a package upgrade using vulnerability, release, peer, and dependency-change evidence. Use `pkg_info` for health, `pkg_changelog` for release notes, `pkg_vulns` for advisory detail, or `pkg_deps` for dependency graphs. |
| `code_files` | `target`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `file_types?`, `languages?`, `file_intent?`, `file_intents?`, `exclude_file_intents?`, `exclude_doc_files?`, `exclude_test_files?`, `include_hidden?`, `limit?`, `wait_timeout_ms?`, `format?` | List indexed files and paths in any public GitHub repository or package, then hand off to `code_read` or `code_grep`. Selectors narrow the listing; `INDEXING` errors expose available retry candidates when known. |
| `code_read` | `target`, `path`, `start_line?`, `end_line?`, `wait_timeout_ms?`, `format?` | Read an exact indexed file or focused window in any public GitHub repository or package. Reads return 150 lines by default or up to 300 with an explicit range; request only the needed lines. |
| `code_grep` | `target`, `pattern`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `pattern_type?`, `case_sensitive?`, `exclude_doc_files?`, `exclude_test_files?`, `context_lines?`, `context_lines_before?`, `context_lines_after?`, `max_matches?`, `max_matches_per_file?`, `cursor?`, `symbol_fields?`, `wait_timeout_ms?`, `format?` | Enumerate text, regex, or identifier matches in any public GitHub repository or package; results are deterministic and paginated. `max_matches_per_file` defaults to `max_matches`. |

`quick_start`, `search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`, `code_read`, and `code_grep` are registered by default. The package/source service URL defaults to the GitHits-managed endpoint and can be overridden via `GITHITS_CODE_NAV_URL` for local development.

## Ecosystem Audit

Use `bun run audit:pkg-ecosystems` to run a live CLI audit across representative packages from every package registry supported by package metadata tools. The script checks `pkg_info`, `pkg_changelog`, `pkg_vulns`, and `pkg_deps` with JSON output so ecosystem regressions are visible without hand-running dozens of commands.

The fixture matrix lives in `scripts/pkg-ecosystem-audit.ts` and covers npm, PyPI, Hex, Crates, NuGet, Maven, Zig, vcpkg, Packagist, RubyGems, Go, and Swift. Each registry has three representative packages. `pkg_vulns` failures for vcpkg and Zig are expected and are reported as `expected-unsupported`; `pkg_deps` failures for NuGet, Maven, and Packagist are expected and are reported the same way. Any other failure exits non-zero, including backend data anomalies that should be fixed and rechecked later.

Useful invocations:

```bash
bun run audit:pkg-ecosystems
bun run audit:pkg-ecosystems --registry zig
bun run audit:pkg-ecosystems --tool pkg_vulns
bun run audit:pkg-ecosystems --limit-packages-per-registry 1
bun run audit:pkg-ecosystems --out tmp/pkg-ecosystem-audit.jsonl
```

Treat failures as live backend or contract findings, not deterministic unit-test failures. Before filing a backend issue, reproduce the failing package with `npx githits@latest` and include the command, JSON error envelope, registry/package name, and whether comparable packages in the same registry pass.

**Unified `search` query syntax.** The `search.query` field is the backend discovery query syntax, not a raw pass-through to a per-source search engine. It supports implicit `AND`, uppercase `OR`, parentheses, unary `-`, quoted phrases, semantic qualifiers (`kind:`, `category:`, `path:`, `lang:`, `name:`, `intent:`), and routing qualifiers (`registry:`, `package:`, `version:`, `repo:`). The backend parses the query once and compiles it per source. Structured `name` and `language` inputs are compiled into `name:` / `lang:` qualifiers and AND-ed with the query before sending. Per-source support, ignored features, and incompatibilities are reported in `sourceStatus`.

**Partial-result truth.** Every result-bearing initial `search` payload and stored `search_status.result` carries the backend's exact `partialResults: boolean`, including `false` for an atomic serveable interim snapshot and `true` for a subset of requested evidence. A progress-only response with no result snapshot omits the field. This additive field is retained unchanged in CLI `--json` and MCP `format: "json"`; text-v1 uses it only to label active results as interim or partial.

**Promoted `warnings[]`.** Noteworthy `sourceStatus` entries — sources reporting `incompatibleQueryFeatures`, `ignoredQueryFeatures`, `incompatibleFilters`, `ignoredFilters`, lifecycle anomalies (`indexingStatus`, `codeIndexState`), or a free-form `note` — are also surfaced as a top-level `warnings: string[]` in the completed/incomplete payloads (and appended after parser warnings inside the `search_status` result block). The structured detail still lives in `sourceStatus`; `warnings[]` is the agent-visible signal that something about execution did not match the request. On completed empty results, healthy non-contributor source entries are also retained with zero `resultCount` and served identity; requested/fresh labels emit only when they materially differ from served. Contributor-bearing DOCS rows retain their physical contributors instead of duplicating healthy served/current resolution metadata. Healthy `INDEXED` / `CURRENT` / non-divergent `STALE` states never become warnings. `PROVISIONAL` is queryable but remains a visible non-healthy indexing signal, including on completed responses. Successful non-empty responses keep the prior compact projection. JSON keeps promoted warnings and source-status detail lossless; MCP text classifies parser/query and structured constraint facts once below the outcome and does not repeat promoted lifecycle/freshness warning prose or opaque notes. Implementation in `buildSourceStatusWarnings` and empty-result compaction (`packages/mcp/src/shared/unified-search-response.ts`).

**Standalone-site recovery.** `search` accepts exact documentation targets as `site:<host[/path]>`. Backend-owned `sourceStatus[].suggestedSiteTargets` labels are preserved in order for missing or ambiguous sites, together with the exact `suggestedSiteTargetsTruncated` Boolean. The compact source-status row becomes actionable even when it has no note or lifecycle warning, and MCP text-v1 renders replayable target labels plus an omitted-candidates notice when truncated. Suggestions are advisory rather than aliases: active known sessions keep polling their current `searchRef`, while completed or terminal recovery can expose one explicit site-retry action without selecting a label automatically. Terminal missing or ambiguous results can omit `searchRef` and instead expose recovery guidance.

**Documentation sources.** DOCS `sourceStatus` rows retain bounded physical
`contributors` and coverage in JSON. Text places the user-meaningful readiness
state under its target, using `Indexing`, `Searched`, `Available now`, `Unavailable`,
`Using`, or `Status` details as applicable. `Status` appears only when the
backend supplies an explicit current, pending, indexing, provisional, or stale
target state; session activity alone does not invent target state. Site identity,
stale/provisional qualifiers, and partial or capped coverage remain attached to
that target; internal reason codes and indexing references stay in JSON.
Partial/capped coverage is published evidence, not a progress or retry signal.

`evidenceNotice` is carried once on initial and stored result envelopes. JSON
retains that exact backend-owned notice; default text does not render it or replace
it with a generic mutable-evidence slogan. Instead, concrete stale, provisional,
pending, and coverage facts remain grouped under the affected target. A
`searchRef` is actionable only when rendered output supplies a status follow-up.
Reissuing the same search is valid and waits on the same underlying work. Terminal
status and unknown-status handling remains conservative, while
`search_status(includeResults: true)` uses the same result projection and
formatter—contributors are never copied onto generic progress targets, and
`allowPartialResults` retains its separate pair-omission meaning.

### `pkg_info` response shape

**Default MCP text + JSON opt-in.** `pkg_info` defaults to compact triage text for agent turns: identity/license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when available), publish age, downloads, and explicit vulnerability status. `verbose: true` adds GitHub language/topics/last-pushed, recent advisories, and recent changes. `format: "json"` returns a lean payload designed for programmatic consumers. Fields that do not add caller value are deliberately omitted. Null scalars are omitted; blocks (`github`, `downloads`, `recentChanges`) are omitted entirely when they carry no actionable data. `vulnerabilities` is emitted whenever the backend reports a numeric vulnerability count, including `total: 0`, so callers can distinguish "no active vulnerabilities in latest" from unavailable data; when present, recent advisory severity values include a CVSS-banded `severityLabel` (`critical` ≥9, `high` ≥7, `medium` ≥4, else `low`) for agent convenience.

**No quickstart.** `pkg_info` intentionally does not expose install commands or usage snippets. Those values are package-manager-specific and not verified enough for dependency evaluation. Use `docs_*`, `search`, or `get_example` when usage guidance is needed.

**Validation.** The MCP schema is permissive (`registry: z.string()`, `package_name: z.string()`) — validation happens in-handler via `buildPackageSummaryParams`, producing the same structured `{error, code, retryable}` envelope as CLI. Raw Zod errors are never surfaced to agents.

**Always latest.** The query exposes no `version` input because the upstream `packageSummary` resolver always returns the latest published version. The CLI `githits pkg info` rejects `<spec>@<version>` with `INVALID_ARGUMENT` rather than silently swapping — a silent-swap would break security-testing workflows that pin to an older vulnerable release.

`pkg_info` shares its envelope builder, text formatter, and error classifier with the CLI `githits pkg info` command via `packages/mcp/src/shared/package-summary-request.ts`, `packages/mcp/src/shared/package-summary-response.ts`, and `packages/mcp/src/shared/package-intelligence-error-map.ts`. The parity test (`src/tools/package-summary-parity.test.ts`) passes `format: "json"` and asserts `toEqual` between CLI `--json` and MCP JSON output for service-sourced fixtures, and `toMatchObject` for the `INVALID_ARGUMENT` fixture where surface-specific error text is acceptable.

### `pkg_vulns` response shape

**Filter-aware summary.** `min_severity`, `advisory_scope`, and `include_withdrawn` are passed straight through to the service. `summary.total` always means advisories affecting the inspected version, preserving the risk signal even when `advisory_scope:"non_affecting"` returns only historical rows. `advisory_scope` defaults to `affected`; `non_affecting` lists historical package advisories that do not affect the inspected version; `all` lists affected + historical rows. Explicit filters and non-default scope are echoed as top-level `filter` in JSON (`{minSeverity?, advisoryScope?, includeWithdrawn?: true}`) and as `Filter` / `Scope` lines in text. Defaults and explicit `include_withdrawn:false` do not echo.

**Compact text vs verbose/JSON.** Default text caps the advisory list at 5 rendered rows and appends a surface-native hint (`use -v` on CLI, `use verbose=true or format=json` on MCP). Hidden-advisory counts are derived from the rendered advisory array, not backend summary counts. `--verbose` / `verbose:true` shows all advisory rows and full detail rows. JSON is never capped and ignores `verbose`.

**Partitioning buckets.** Advisories with `isMalicious: true` count **only** under `summary.bySeverity.malware`; severity bands (`critical`/`high`/`medium`/`low`) count non-malicious advisories with a positive CVSS score; non-malicious advisories with no score count under `summary.bySeverity.unrated`. Every returned advisory lands in exactly one bucket. For default affected scope, the bucket sum equals `summary.total`. For `non_affecting` / `all`, the bucket sum describes the selected advisory rows while `summary.total` still describes affected-version risk. The malware bucket sorts to the top of the advisory list regardless of score. The `unrated` bucket keeps Rust / PyPI packages with missing CVSS values explicit.

**Alias-cluster dedup.** Some registries (most visibly Crates) return the GHSA-prefixed and the RUSTSEC-prefixed entry for the same underlying vulnerability as separate advisories, cross-linked via `aliases[]`. The shared envelope builder unions clusters over `id ∪ aliases[]`, picks one canonical advisory per cluster (severity-bearing entries first, then `GHSA-*` over `RUSTSEC-*`, then lexicographic `id` ascending), and merges the rest under the canonical's `aliases`. `affectedRanges`, `fixedIn`, malware/withdrawn flags, and the latest `modifiedAt` are unioned across the cluster; a withdrawal only sticks if every cluster member is withdrawn. `summary.total` and `summary.bySeverity` are recomputed from the deduped list so the partition invariant holds. This is a client-side mitigation for backend issue B3 (https://app.githits.com — eval report 2026-04-28); remove `dedupAdvisoriesByAlias` from `packages/mcp/src/shared/package-vulnerabilities-response.ts` once the backend dedups upstream.

**Version validation.** `pkg_vulns` accepts canonical package versions only. Tag-style refs with a leading `v` (for example `v4.18.0`) are rejected client-side with `INVALID_ARGUMENT` before the backend call. This avoids the current production backend's unhelpful generic error for that input shape. This is intentionally narrow: proper ecosystem-aware version parsing and typed invalid-version errors belong in the backend, not in ad hoc CLI normalization rules.

**Typed `VERSION_NOT_FOUND`.** Mirrors the code-nav precedent: a dedicated `PackageIntelligenceVersionNotFoundError` carries structured `{ packageName, requestedVersion, availableVersions? }` fields. Classifier routes it to `VERSION_NOT_FOUND` with a structured `details` block. When the service only gets a generic "no matching version" error, it promotes that into the typed error so CLI / MCP surfaces still render an actionable envelope. `availableVersions` remains undefined in the fallback path unless the service supplied them.

**Omission rules.** Null scalars omitted; empty arrays dropped; zero-count `bySeverity` keys dropped; the `bySeverity` block itself dropped when `total === 0`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Registry coverage.** npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, and Swift have vulnerability data. vcpkg and Zig are rejected client-side with a tool-specific message (`pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: ${registry}.`) — rejection predicate lives in `packages/mcp/src/shared/package-vulnerabilities-request.ts` rather than the shared registry module, since it is a tool-specific capability matrix.

`pkg_vulns` shares its envelope builder and text formatter with the CLI `githits pkg vulns` command via `packages/mcp/src/shared/package-vulnerabilities-request.ts` and `packages/mcp/src/shared/package-vulnerabilities-response.ts`. MCP defaults to compact text and uses `format: "json"` for structured output. The shared text formatter is surface-aware so MCP hints never mention CLI flags. The parity test (`src/tools/package-vulnerabilities-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across the service-sourced success/filter/typed-error fixtures, and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT` fixtures such as unsupported registries and tag-style `v`-prefixed versions.

### `pkg_deps` response shape

**Data-first envelope.** `runtime`, `groups`, and `transitive` are three independent blocks emitted based on what the backend returned and what the caller asked for, not on additional caller flags. Agents branch on the envelope's shape rather than inferring from inputs.

- `runtime` block: emitted whenever the service returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages). `runtime.count` is computed client-side from `runtime.items.length`. The source `direct[]` is always runtime-only: dev / peer / build / optional deps live in the groups block instead.
- `groups` block: emitted when the caller requested a lifecycle view and the service returned `dependencyGroups` — including when a lifecycle filter matched nothing (`{items: []}`). Omitted when the service returned `dependencyGroups: null` (e.g. on zero-dep packages), or when the caller used the default runtime view. Each group carries its members under `items`, matching `runtime.items` so dependency lists share one key throughout the envelope. Duplicate `{name, constraint}` entries inside a group are preserved verbatim; the terminal formatter dedups for scannability but JSON is lossless.
- `transitive` block: emitted only when the caller set `max_depth` or requested importer provenance. Carries aggregates (`edges`, `uniquePackages`, `depth?`) plus preprocessed arrays: `packages[]` (each `{name, version, importers[]}` with importer name / version / constraint pulled from the service graph), `conflicts[]` (typed `{name, requiredVersions}`), `circularDependencies[]` (typed `{cycle: string[]}`). The raw graph is not exposed — the preprocessing happens in the envelope builder so agents consume the same signal the terminal `--verbose` renderer reads without re-implementing the decoder.

**`filter.lifecycles` echo.** Canonicalised lowercase array (deduplicated, sorted in canonical display order: `runtime` → `development` → `build` → `peer` → `optional`). Emitted only when the caller supplied a non-empty lifecycle input. Matches what the backend actually received — the raw CSV string is not echoed.

**Lifecycle scope.** `lifecycle: [String!]` on the wire filters `dependencyGroups.groups` only; `direct[]` and `transitive[]` are returned regardless. Documented on the backend schema and verified in live smoke.

**Typed dependency graph projection.** Backend exposes typed `dependencyGraph`, `dependencyConflicts`, `circularDependencyCycles`, and `environmentMarkers`; `pkg_deps` consumes those typed fields and projects them into a lean agent-facing envelope. Deprecated raw fields (`dag`, `conflicts`, `circularDependencies`, `environmentConstraints`) are intentionally not queried. The raw graph is deliberately not exposed by this tool.

**Registry coverage.** npm, PyPI, Hex, Crates, vcpkg, Zig, RubyGems, Go, and Swift support the `packageDependencies` query. NuGet / Maven / Packagist are rejected client-side with a tool-specific message (`pkg deps only supports npm, pypi, hex, crates, vcpkg, zig, rubygems, go, swift. Got: ${registry}.`). Predicate lives in `packages/mcp/src/shared/package-dependencies-request.ts`.

**Version validation.** Same rule as `pkg_vulns`: tag-style `v`-prefixed inputs are rejected client-side with `INVALID_ARGUMENT` before the backend call.

**MCP schema notes.** Permissive (`registry: z.string()`, `package_name: z.string()`, …) with validation in-handler via `buildPackageDependenciesParams`. Deliberately no `include_groups` input — with the data-first envelope emitting `groups` unconditionally when the backend returns `dependencyGroups`, the flag would be a silently ignored no-op. `max_depth` / CLI `--depth` is optional; when omitted the surface shows direct dependencies only while still fetching depth 1 on the wire to resolve direct dependency versions. Passing `max_depth` requests the transitive block and caps traversal. `include_importers` adds importer provenance; if used without `max_depth`, it also requests transitive output.

`pkg_deps` shares its envelope builder and text formatter with the CLI `githits pkg deps` command via `packages/mcp/src/shared/package-dependencies-request.ts` and `packages/mcp/src/shared/package-dependencies-response.ts`. MCP defaults to compact text and uses MCP-native hints such as `pass lifecycle="all"`; CLI hints remain CLI-native. The parity test (`src/tools/package-dependencies-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across every service-sourced success / error fixture (runtime, zero-dep, full-view, optional-lifecycle, multi-lifecycle, filter-matched-nothing, Crates-target-cfg dedup round-trip, transitive, versioned match / diff, NOT_FOUND, VERSION_NOT_FOUND, BACKEND_ERROR), and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT` (unsupported registry, tag-style version, unknown lifecycle).

### `pkg_changelog` response shape

**Data-first envelope.** The top level carries addressing (`registry` + `name` for spec addressing, or `repoUrl` for repo-URL addressing), optional `source` (`"releases"` / `"changelog_file"` / `"hexdocs"`) when a concrete changelog source exists, and `mode` (`"latest"` or `"range"`). Entries live under `entries: { count, items }` — matching the `{count, items}` shape used by `pkg_deps.runtime`. `count` is computed client-side from `items.length`, so the invariant holds regardless of backend drift.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept in the envelope even when `null` so agents can write `items.map(e => e.version)` without guarding; every other nullable field is stripped when absent. `body` is additionally stripped when the caller set `omit_bodies: true`. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope in v1 — revisit via agent feedback.

**Dual addressing (`registry` + `package_name` XOR `repo_url`).** `pkg_changelog` is the only metadata-side MCP tool with dual addressing. `pkg_info` / `pkg_vulns` / `pkg_deps` all accept only `registry` + `package_name` because they are registry-metadata lookups without repo-URL alternatives. `pkg_changelog` is intrinsically repo-level — its sources are GitHub Releases, CHANGELOG.md, and HexDocs — so `repoUrl` is a peer addressing mode, not a bolt-on. Future tool authors should not cargo-cult the asymmetry without reading this rationale.

**Mode selection.** `from_version` triggers range mode (returns every entry in `(fromVersion, toVersion]` with no cap). The lower bound is exclusive, so an equal start/end range has no entries. Latest mode is the default, capped by `limit` (1–50, backend default 10); use `to_version` with `limit: 1` to fetch one exact release. `from_version` + `limit` is rejected client-side with `INVALID_ARGUMENT` rather than silently routed to one mode.

**`omit_bodies` lever and body previews.** Release bodies on large packages (Kubernetes, Node) can run 10 KB+ per entry; a 100-entry range could produce a multi-hundred-KB envelope. `omit_bodies: true` opts out explicitly in JSON and text — not silent truncation. Other fields (version / normalizedVersion / publishedAt / htmlUrl) remain so agents still get the release timeline. Text mode caps each body preview at 10 lines by default. MCP adds text-only `body_lines` (1-50) to tune the cap and `verbose:true` to uncap text bodies; both are ignored for JSON. `verbose:true` conflicts with `omit_bodies:true` and `body_lines`. CLI terminal output uses the same default preview cap and gives the CLI-native `--verbose` hint; `--verbose` uncaps terminal previews but does not change `--json` output.

**`filter.*` echo.** `filter` is emitted only when the caller explicitly supplied at least one of `from_version`, `to_version`, `limit`, or `git_ref`. Backend-default `limit: 10` / `toVersion: <latest>` is never echoed. The request builder tracks explicit-vs-defaulted via an `explicitFilterFields` set so defaults don't round-trip as caller intent.

**Version validation.** Same rule as `pkg_vulns` / `pkg_deps`: tag-style `v`-prefixed inputs on `from_version` / `to_version` are rejected client-side with `INVALID_ARGUMENT`. `<spec>@<version>` is also rejected — the `pkg changelog` family has no single-version query, and silently remapping to `to_version` would be a client-invented semantic shift. Hint text redirects callers to `--to` / `to_version`.

**NOT_FOUND semantics.** Backend `source === null` or `source === ""` means there is no concrete changelog source for the returned package versions. If entries are present, this is a success and the envelope omits `source`; terminal output labels it `source: package versions`. If both source and entries are absent, the service promotes the response to `PackageIntelligenceChangelogSourceNotFoundError`, which the shared classifier routes to the `NOT_FOUND` envelope with a message naming the sources that were tried. Empty `entries.items: []` with a valid `source` is also a success — "no entries in this range" is a legitimate neutral outcome.

**Overlap with `pkg_info`.** `pkg_info` already surfaces a short-form `recentChanges` block (from the backend's `latestChangelogs` field on `PackageSummaryResult`). For a quick "what shipped recently" glance embedded in a package overview, use `pkg_info`. For the full range-capable, body-rich, `omit_bodies`-toggleable changelog with `--no-body` timeline mode and repo-URL addressing, use `pkg_changelog`.

`pkg_changelog` shares its envelope builder and text formatter with the CLI `githits pkg changelog` command via `packages/mcp/src/shared/package-changelog-request.ts` and `packages/mcp/src/shared/package-changelog-response.ts`. MCP defaults to compact text with MCP-native `verbose=true`, `body_lines=<n>`, and `format="json"` hints for full bodies. The parity test (`src/tools/package-changelog-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across every service-sourced success / error fixture (happy latest, range mode, repo-URL addressing, no-source package-version entries, `--no-body` / `omit_bodies: true`, default bodies, empty entries, NOT_FOUND, PackageIntelligenceTargetNotFoundError, VERSION_NOT_FOUND, BACKEND_ERROR), and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT`.

### `pkg_upgrade_review` response shape

The JSON envelope is the stable structured boundary: it preserves the existing
`summary` and `reviews` fields, normalized evidence categories, bounded backend
metadata, and unknown evidence without adding assessment fields. CLI
`--json` and MCP `format: "json"` use this same envelope and are compared by
the package-upgrade-review parity test. `text-v1` evolves in place and is not a
byte-stable contract.

Default text is one shared formatter for CLI and MCP. It leads with
`Upgrade review - N package(s)`, then groups each package as identity,
`Security`, with direct and optional transitive summary rows before non-empty
advisory groups, target `Deprecation`, `Changes`,
`Compatibility`, `Dependencies`, returned `Dependency issues`, and final
`Unknown evidence`. A batch adds one `Across packages:` summary; zero and one
package omit it. The formatter removes internal tool headers and repeated
field scaffolding while retaining concrete samples, stable package/advisory
locators, truncation facts, and follow-up guidance.

The formatter accepts ANSI and width as inputs. CLI supplies its current
terminal width and enables ANSI when supported; MCP uses no ANSI and the
80-column default. Outcome and section headings are bold-only, package identity
is bold cyan, and attention facts are yellow; prose remains meaningful without
color. Free prose uses hanging indentation and a minimum width of 20, while
coordinates, versions, advisory IDs, and URLs remain unsplit. Changelog labels
are exact (`Repository releases`, `Package versions (no release notes)`, or
the normalized non-empty source verbatim). A defined zero-valued dependency
comparison renders both direct and transitive zero counts; undefined evidence
is omitted. Existing sample caps and `verbose` expansion remain unchanged except
that dependency-issue locators are capped at five rows per category in default
text with an explicit remainder; `verbose` expands them fully.

### `code_files` / `code_read` / `code_grep` response shapes

These three indexed tools share an addressing and lifecycle contract (documented below) and then each projects its own data-first envelope. All three reuse the shipped `codeTargetSchema` + `resolveCodeTarget` from `packages/mcp/src/tools/code-navigation-shared.ts` — no parallel addressing module.

**`code_files` envelope**: `{registry?|repoUrl?+gitRef?, total, hasMore, indexedVersion?, resolution?, targetResolution?, files: [{path, name?, language?, fileType?, byteSize?}], hint?, filter?}`. `fileType` values preserve the service vocabulary (`CONFIG`, `SOURCE`, `DOC`, `TEST`). `total` is capped at returned count when `hasMore: true` — the terminal formatter renders `N+ files` in that case to avoid misleading users. `filter` echoes only explicit caller filters (`path`, `pathPrefix`, `globs`, `extensions`, `fileTypes`, `languages`, file-intent filters, booleans, and `limit`); default limit (200) never round-trips.

**`code_read` envelope**: `{registry?|repoUrl?+gitRef?, path, language?, totalLines?, startLine?, endLine?, content?, isBinary?, hint?, targetResolution?}`. `path` (not `filePath`) so the key matches `code_files.files[].path` and `code_grep.filter.path` when exact-file grep is used. Binary files set `isBinary: true` and **omit** `content` (not `null`); agents branch on the flag. `hint` is emitted only when the MCP span cap actually truncated the response — see "code_read span cap" below.

**`code_grep` envelope**: `{registry?|name?|repoUrl?+gitRef?, pattern, patternType?, caseSensitive?, matches: [{filePath, line, matchStartByte, matchEndByte, lineContent, contextBefore?, contextAfter?, fileContentHash?, fileIntent?, symbol?}], nextCursor?, hasMore, truncatedReason?, filesScanned, filesInScope, binaryFilesSkipped?, filesTooLargeSkipped?, totalMatches, uniqueFilesMatched, indexedVersion?, resolution?, targetResolution?, filter?}`. Default-valued fields (`patternType: literal`, `caseSensitive: false`, zero skipped counters, `truncatedReason: none`) are omitted. `filter` echoes only explicit caller filters. Match entries carry `filePath` so grep output chains directly into `code_read`.

`targetResolution` is additive provenance. It explains requested, resolved-requested, and served artifacts plus `freshness` (`current`, `fallback_recent`, `indexing`, `provisional`, or `unavailable`), `freshnessReason`, `indexingRef`, `availableVersions`, `availableRefs`, and `suggestedRefs`. A `provisional` / `exact_provisional` Discovery result is queryable while indexing continues; code-navigation text uses the exact served identity and `indexingRef` and does not substitute a requested ref. Unified search text-v1 instead keeps internal `indexingRef` and reason codes out of default text while retaining the user-meaningful served identity and bounded alternatives. `availableVersions` and `availableRefs` are already-indexed artifacts that can be queried immediately. `suggestedRefs` are fuzzy upstream candidates and may require indexing before use. Existing `indexedVersion`, `resolution`, and locator fields remain served-identity compatibility fields. Text mode renders actionable notes such as `Using recent indexed snapshot`, `Serving an older indexed snapshot; current target is still being indexed`, `Requested ref is being indexed`, `provisional (still indexing)`, `Fresh target is being indexed`, `Target unavailable`, `queryable now`, or `suggested refs`; a code-navigation indexing note includes the exact `served=` identity whenever results came from a queryable snapshot. JSON mode carries the structured object. A `current` resolution is authoritative on every code-navigation surface and suppresses alternative-target remediation; waited search completion is one case where earlier candidates can remain in structured provenance without becoming warnings.

### Indexing lifecycle (shared across `code_files`, `code_read`, `code_grep`)

All three code-navigation tools share the same indexing-retry contract. The state can arrive through either an error response or a success sentinel (`codeIndexState: "INDEXING"`), and the service layer collapses both to the same typed `CodeNavigationIndexingError` before the envelope builder runs. Agents therefore never see a `codeIndexState` field in a success envelope; they branch on the error path instead. Discovery `search` / `search_status` may additionally expose `codeIndexState: "PROVISIONAL"` with queryable hits and a `searchRef`; complete-only file/list/grep navigation remains on the existing `INDEXING` error contract.

**`INDEXING` error envelope**:
```json
{
  "error": "Target is indexing",
  "code": "INDEXING",
  "retryable": true,
  "details": {
    "indexingRef": "ref_…",
    "availableVersions": [{"version": "4.21.0", "ref": "v4.21.0"}],
    "availableRefs": [{"ref": "main"}],
    "hint": "Backend says this ref is queued. Wait until ready with CLI `--wait 60000` or MCP `wait_timeout_ms: 60000`.",
    "indexingEstimate": {
      "lowerSeconds": 7,
      "upperSeconds": 19,
      "elapsedSeconds": 12,
      "sampleCount": 9,
      "source": "same_repository_refs"
    }
  }
}
```

Backend GraphQL errors preserve the backend message verbatim and carry its `hint`, `indexingEstimate`, and available artifacts in `details`; client prose does not replace them. CLI terminal errors render a preserved backend hint beneath the message, and human `search` / `search-status` indexing errors use the same detail formatter as `code files` / `code read` / `code grep`. A `PACKAGE_INDEXING` error receives appended CLI `--wait` / MCP `wait_timeout_ms` fallback guidance only when neither the backend message nor hint names a wait argument; the backend text remains intact. Data-path indexing sentinels have no backend message or hint, so the client supplies the same wait guidance while structured detail lines carry the indexing ref and estimate. `details.availableVersions` and `details.availableRefs` are already indexed and immediately queryable. `details.suggestedRefs` appears on `REF_NOT_FOUND` and inside `details.targetResolution`; these are fuzzy suggestions and may require indexing. The client never fabricates candidates.

**Follow-up — error metadata carrier consolidation.** Target, version, and ref errors currently carry available artifacts both as legacy constructor fields and in common error metadata; `CodeNavigationIndexingError` also carries `hint` as a standalone constructor field. Consolidate those carriers in a dedicated refactor; changing the internal error API is outside this response-formatting slice and has no user-visible anti-looping benefit.

**Retry default**: `DEFAULT_WAIT_TIMEOUT_MS = 20_000` (shared, defined in `packages/mcp/src/shared/code-navigation-defaults.ts`). Applied inside each request builder so both CLI and MCP surfaces get the same default by construction. CLI's `--wait <ms>` and MCP's `wait_timeout_ms` override.

**Exact-path authority errors**: `code_read` / `code_grep` distinguish a missing path (`FILE_NOT_FOUND`) from a path deliberately omitted from the index (`FILE_PATH_EXCLUDED`) and an index whose source-file inventory cannot authoritatively answer the path query (`SOURCE_FILE_INVENTORY_UNKNOWN`). The latter two become stable top-level CLI/MCP codes and preserve `filePath`, optional `exclusionReason`, retryability, and target-resolution metadata. All three preserve the backend message and add surface-native `details.action` guidance for inspecting indexed paths. MCP names `code_files`, `path_prefix`, `code_read`, and `code_grep`; CLI JSON names `githits code files`, a path-prefix positional, `githits code read`, and `githits code grep --path`. CLI terminal output names `code files`. `code_read` still supports generic `NOT_FOUND` from older/backend paths, and its structured recovery is likewise rendered with MCP or CLI-native names without classifying unrelated target misses as file errors.

**`code_read` span bounds (MCP-only)**: real session traces showed agents requesting 300-600 line windows (and occasional unbounded full-file reads) which dominated context cost, while a later Claude Desktop session showed that a fixed 150-line ceiling can waste context by forcing pagination for a known 248-line file. Calls without `end_line` therefore remain bounded to `MCP_READ_DEFAULT_SPAN` (150 lines), while deliberate explicit ranges may request up to `MCP_READ_MAX_SPAN` (300 lines). Both are defined in `packages/mcp/src/tools/read-file.ts` and enforced before the backend call.

The `hint` field is emitted only when the cap *actually truncated* the response — i.e., the returned range comes up short of available content. `shouldEmitCappedHint` (in `packages/mcp/src/tools/read-file.ts`) suppresses the hint in three cases the agent doesn't need it: (a) the cap clamp didn't fire (caller's range was already within the cap); (b) the file fits within the cap, so the response is the whole file even though the request was clamped; (c) the returned range reaches end of file. Binary files always skip the hint. When emitted, the hint reads from `payload.startLine` / `endLine` / `totalLines` (the actual returned range, not the pre-clamp request) and includes the original request for the agent to learn from. The CLI command `githits code read` does not apply the cap; humans piping whole files to disk continue to work.

## Text response format (`format: "text-v1"`)

`get_example`, `search_language`, `search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`, `code_read`, and `code_grep` accept a `format` parameter on the MCP surface. The default is `"text-v1"` — a compact line-oriented format that drops JSON scaffolding to stay lean in agent context. Programmatic callers (parity tests, scripts that parse responses) pass `format: "json"` explicitly. `"text"` is accepted as an alias for `"text-v1"` to keep agent prompts terse.

**Why text-v1 default.** A 10-hit `search` JSON envelope runs 5–7 KB after compaction; the same hits in `text-v1` land around 3–4 KB. The savings come from dropped quoting, dropped key repetition, and dropped fields that an agent does not need at the per-call decision point (highlights byte offsets, repeated locator scaffolding). The token budget belongs to the agent's reasoning, not to JSON structure.

**In-place evolution.** `text-v1` names the compact line-oriented representation; it is not an exact-prose compatibility boundary. Search and `search_status` may tighten human/agent copy in place as long as their structural lifecycle, ordering, action, and hit-anatomy invariants remain covered by tests (`packages/mcp/src/shared/unified-search-text.test.ts`, `packages/mcp/src/tools/search-status.test.ts`). JSON is the stable structured boundary for programmatic callers. Other text-v1 renderers retain their own contracts and are not changed by the search presentation work.

**Compact punctuation.** Formatter-authored punctuation is ASCII, including the ` | ` and ` - ` separators; ellipsis is `...`; no box-drawing or decorative punctuation. Unicode in backend payloads (titles, summaries, paths, URLs, and notes) passes through unchanged. Tokenizer behavior for multi-byte UTF-8 varies across BPE variants, and the format runs into Claude, Codex CLI, OpenCode, Cline, Cursor, etc. — the small fixed vocabulary keeps it predictable.

**Example-search anatomy.** `get_example` text mode returns markdown directly, followed by `solution_id: <id>` when the REST response includes an app URL. This avoids JSON-wrapped markdown while preserving the `feedback` workflow. `search_language` text mode returns one match per line as `name (Display Name) aliases: a, b`; agents should pass the `name` value to `get_example.language`.

**Package metadata anatomy.** `pkg_info`, `pkg_vulns`, `pkg_deps`, and `pkg_changelog` text mode reuse their shared no-color terminal formatters and inject surface-native hints where needed. `pkg_upgrade_review` uses one shared CLI/MCP formatter with caller width and ANSI as inputs. `pkg_deps` hides non-runtime groups by default and says `pass lifecycle="all"` when groups exist. `pkg_changelog` caps body previews and says `pass verbose=true`, `body_lines=<n>`, or `format="json"` when text omitted lines. Package tools keep JSON errors in all formats because agents can reliably branch on `{error, code, retryable, details?}`.

**Unified search outcome-first anatomy** (CLI human search/search-status and MCP
`search` / `search_status` text-v1). One shared presentation model owns target
groups and trust facts; one shared text renderer owns wording, wrapping, hit
anatomy, and ordering. Callers supply only ANSI enablement and surface-native
action syntax. The order is:

1. outcome headline;
2. one compact `Sources:` row for ordinary completed current results, or target blocks with identity plus grouped readiness and usable alternatives when trust facts require them;
3. warnings and results;
4. an optional session summary; and
5. one positive next action, when applicable.

Active lifecycle labels remain `Preparing`, `Indexing`, and `Searching` for
`PENDING`, `INDEXING`, and `SEARCHING`. The exact active empty wording is
`Indexing - no results yet`; when no snapshot exists it is
`Indexing - no result snapshot yet`, with the corresponding lifecycle label for
other active states. Active hits are labelled `interim` when `partialResults` is
false and `partial` when it is true. Progress-only responses show only derivable
target readiness and alternatives; they never synthesize source or contributor
facts.

When session facts exist, text may include one optional session row composed from
the facts available: `Search <ref>` when a reference exists, aggregate
`<ready>/<total> target(s) ready` when progress exists, and a lifecycle summary
when a reference has no progress. The combined form is
`Search <ref> | <ready>/<total> target(s) ready`; completed output without
session facts may omit the row. A reference appears once in that row when
available and once in the follow-up action when the action carries it; raw
diagnostic fields are not rendered. MCP renders
`Next: search_status search_ref="..." wait_timeout_ms=20000`; CLI renders
`Next: githits search-status ... --wait 20`. Text emits no negative repeat or poll
policy directive: reissuing the same search is valid and waits on the same
underlying work. Suggested site targets retain backend order and an omitted-
candidates signal, but remain advisory labels rather than automatic retries.

`evidenceNotice` stays exact in JSON and is not rendered in default text. The
renderer keeps concrete stale, provisional, pending, and capped-coverage facts
under their target, while raw reason codes, indexing references, promoted
duplicate warnings, and opaque evidence prose remain in JSON. Query/filter and
structured-constraint facts appear once below the outcome. Surface-native pivots
name `source="symbol"` / `code_grep` in MCP and `--source symbol` /
`githits code grep` in CLI.

The representative CLI n8n example is maintained in
`docs/implementation/cli-commands.md` as the output source of truth.

**Hit anatomy within unified search text-v1:**

```
[1] <target> <path:line-range> [repo doc] - <title>
  <summary line 1>
  <summary line 2 (wrapped at output width)>
[blank]
[2] <page-id> [docs page] <target> - <host/path#anchor> - <title>
  <summary, when informative>
```

Hit headers are numbered so ranked results can be referenced as `[1]` through
`[N]`. Repository and code hits keep the exact target and file location needed
for `code_read` before a bracketed type tag (`[repo doc]`, `[repo code]`, or
`[repo symbol]`); their free-form title is the final header tail. Documentation
hits keep the actual `page-id` needed for `docs_read`, a stable package target,
human-readable source URL, and title in that order. The docs URL uses
`host/path#anchor` without the protocol; unavailable fields are rendered as
explicit `page ID unavailable`, `target unavailable`, `source URL unavailable`,
or `title unavailable` values. Executable `docs_read` / `code_read` command
lines, qualified non-follow-up internal result IDs, and kind/category tails are
omitted from default text; the documentation page ID remains because it is the
`docs_read` follow-up locator, and JSON keeps the full locator and follow-up
fields unchanged. Repository hits without a file path use the explicit
`location unavailable` value and do not claim to be follow-up readable. A
summary's first line is omitted when it repeats the title
after removing Markdown heading markers, as is an immediately following
setext underline. Source indentation is retained when summaries wrap, with a
consistent two-space hit-body indent. If a title does not fit on the header
line, the fixed locator prefix stays unwrapped with a trailing ` -`, and only
the title continues on two-space-indented lines.

Result headlines combine count, type breakdown when completed, and pagination
when known, for example `10 results | 5 repo docs, 5 docs pages | next_offset=10`.
Breakdowns use `repo code hit(s)` and `repo symbol(s)` alongside `repo doc(s)`
and `docs page(s)`. When more results exist without a next offset, the final field is
`more available`. Pagination is not repeated as a bottom paragraph.

**Follow-up — crawled-doc section anchors.** Unified search can label a crawled documentation hit with a matching section title while returning only its page ID. Without a line anchor, `docs_read` must start at the beginning of the page. Carrying section ranges through search results requires backend/search-location support and is outside the CLI response-formatting slice.

Completed empty search uses the model's applicable action: generic query pivots are
suppressed for evidence-limited or unsearched sources, which instead direct the
caller to rerun the search later. Indexing/provisional evidence prefers waiting
or an indexed alternative, standalone site searches expose only a
shorter/broader site query, and filter removal or symbol/code-grep pivots appear
only when applicable. Surface-native pivots name
`source="symbol"` / `code_grep` in MCP and `--source symbol` /
`githits code grep` in CLI. A result with both an evidence notice and
`searchRef` emits one status continuation. Terminal `DEFERRED`, `FAILED`, and
`TIMEOUT` preserve disclosed evidence and their lifecycle state; unknown statuses
preserve the raw value without inferred semantics. Promoted lifecycle/freshness
warning prose, opaque evidence text, and the exact notice remain in JSON but are
not repeated in default text; parser/query and structured constraint facts appear
once below the outcome.

**Listing anatomy** (`code_files` text-v1):

```
code_files | <N>[+] paths | <identity> [path="..."] [path_prefix="..."] [globs=...] [exts=...] [...]
[blank]
<path1>
<path2>
...
[blank]
More files available. Pass limit=N or refine the filter.
```

`<identity>` is `<registry>:<name>@<version>` for spec addressing or `<repoUrl>@<gitRef>` for repo addressing. Filter echoes appear in the header only when the caller supplied them explicitly (defaults never echo).

**Grep anatomy** (`code_grep` text-v1):

```
code_grep | <N> matches in <M> files | pattern="..." [regex,case-sensitive]
[blank]
<filePath> (<count>)
  142: matching line content
  287: another match
[blank]
<filePath2> (<count>)
  140- context-before line
  141- context-before line
  142: matching line
  143- context-after line
[blank]
[Truncated: time limit reached. Pass narrower path/path_prefix/globs or increase max_matches.]
[More matches available. Pass cursor=<token> for the next page.]
```

Standard grep -A/-B notation: `:` separator on match lines, `-` on context lines. Non-adjacent blocks within the same file are separated by `--`. The `(<count>)` after the file path is the per-file match count; the header sums across files. Header flags (`regex`, `case-sensitive`) appear only when the request used them. Scope filters are not echoed in text mode; agents already have the tool call arguments in context, and `format: "json"` preserves exact request/filter metadata for programmatic use. Match-line offsets, file content hashes, file intent, and symbol metadata are dropped in text mode — agents that need them can request `format: "json"`.

Empty grep adds scanned/in-scope counts, served target/ref context when known, and `Do not repeat this grep unchanged.` Positive equal counts collapse to `files scanned: N (full scope)`; zero scope says `no files in scope`. When the content index prunes candidates before verification, unequal counts explicitly identify the smaller value as `content-scanned after index pruning`, so it cannot be mistaken for an incomplete whole-target scan. Zero in-scope files direct the caller to loosen selectors; a nonzero scope directs it to change the pattern or switch to conceptual `search`. A case-sensitive request also suggests disabling case sensitivity. MCP guidance uses structured argument names while CLI guidance uses positional/flag syntax. The same decision text is shared with CLI terminal stderr while plain CLI stdout remains grep-compatible and empty. Backend truncation enums are normalized to lowercase in JSON and rendered as `match limit reached`, `per-file match limit reached`, or `time limit reached` in text.

`max_matches_per_file` defaults to the resolved `max_matches` value, replacing the backend's smaller hidden per-file default on both default and explicitly widened requests. This can let one match-heavy file consume the page; callers can set a lower per-file limit when result diversity matters. Truncation guidance names `max_matches`, `max_matches_per_file`, `--limit`, or `--per-file-limit` according to the actual producer reason; deadline truncation only recommends narrowing scope.

`context_lines`, `context_lines_before`, and `context_lines_after` accept integers from 0 through 10. The MCP JSON Schema advertises the range so agent clients reject invalid calls before dispatch; direct CLI/internal callers retain the same request-builder validation. The asymmetric fields override the corresponding side of `context_lines`.

**Docs read bounds.** `docs_read` text output returns 150 lines when `end_line` is omitted and honors explicit ranges up to 300 lines. Its response reports the actual returned range and total line count for the next bounded read; JSON mode preserves explicitly requested ranges.

The current package-doc backend returns the complete page and `docs_read` applies
the text range locally. Move this slicing into the backend when that API is next
revised so large pages are not transferred in full; preserve the same range and
total-line response contract.

**Errors in text mode.** `search` errors render as text in `text-v1` mode: `search | ERROR | code=<CODE> [| retryable]\n<message>` followed by an indented `details:` block when present. `code_files` and `code_grep` keep errors JSON-formatted in either mode for now — revisit if agent feedback warrants.

## Quick-start guide

The MCP server deliberately omits protocol-level `instructions`. Clients have
handled that field as hidden guidance, privileged guidance, namespace metadata,
or a prefix repeated on every tool. Plain MCP clients use the `quick_start`
tool to expose shared guidance once, on demand. The loaded `githits-mcp` skill
contains the same stable guide and therefore needs no normal bootstrap call;
current tool descriptions remain the source of truth for tool-specific
routing, arguments, output, and recovery.

The concrete Codex failure was verified in August 2026. Codex PR
[#21053](https://github.com/openai/codex/pull/21053) intentionally preserved
plain MCP server instructions as deferred-tool namespace descriptions. In the
runtime catalog inspected for this work, the 5,691-character local GitHits
instruction block plus its separator appeared as the same 5,693-character
prefix on each of 17 tools. Codex issue
[#29097](https://github.com/openai/codex/issues/29097) separately tracks that
MCP instructions are not reliably exposed as server-wide agent guidance. The
portable response is to leave the protocol field absent, not to optimize a
payload whose privilege, visibility, and repetition vary by host.

`packages/mcp/src/mcp/instructions.ts` owns the `quick_start` guide sections:

- **Core block** — always loaded. Introduces GitHits, defines its public-only scope, expands trigger criteria to include comparative cross-OSS questions and "how does X actually implement this" archaeology, and walks through the `get_example` / `search_language` / `feedback` workflow.
- **External-content block** — included by default from `packages/mcp/src/tools/guardrails.ts`; tells agents to treat third-party prose as data, not instructions.
- **Package-tools block** — always appended. Contains a preamble plus one bullet
  per package/code tool and a reference-first strategy: source, symbols, tests,
  and call sites beat docs prose; enumerate paths first, locate symbols or
  lines, then read focused windows.
- **Local experimental block** — appended only by the workspace-internal local
  composer when the host policy enables experimental tools. It names only the
  registered local `resolve_target`/`code_diff` subset, routes fuzzy identity
  before canonical diff evidence, and permits direct reuse of a resolved target
  only for a non-ambiguous `EXACT` or `HIGH` best result with `CLEAR` or
  `NOT_APPLICABLE` malicious-content status. `CLEAR` is not a vulnerability-free
  claim. Other or missing statuses are non-actionable; `MEDIUM`, `LOW`, and
  ambiguous results require narrowing or an explicit actionable choice. Site candidates
  are routed into `search` with `source:"docs"`, followed by `docs_read`; exact
  `site:<host[/path]>` targets skip resolution. The block also
  states public-OSS/privacy limits and adds opt-in negative-feedback guidance
  only for the configured reporting scope.
  Disabled or dormant reporting returns the public builder's exact baseline;
  public and remote servers never receive this block.

The stable guide embedded in `skills/githits-mcp/SKILL.md` is an exact copy of
`buildMcpQuickStart()` and is checked by `src/skills-packaging.test.ts`. The
local experimental appendices from `buildLocalMcpQuickStart()` are not copied
into the public skill; an exposed local `Experimental` descriptor or a material
stale-snapshot mismatch is the bounded case where that client may call
`quick_start` after loading the skill.

The reporting contract is validated structurally in the focused instruction
tests: one concise `accepted: false` report per distinct issue, exact enabled
tool scope, redacted context, non-defect suppression, and no
retry or recursive report when feedback fails. Evaluations keep reporting off;
production feedback is never synthesized for validation.

Host users configure the local policy in `config.toml` with
`[experimental] tools = true` and may optionally set
`report_tool_issues = "experimental"` or `"all"`; omission means off. The
reporting value is dormant while tools are disabled. The hidden
`githits mcp start --experimental-tools` eval override enables the local tools
for one process and forces reporting off without changing host config. The
stable public and hosted/remote MCP inventories remain unchanged.

When adding a new package tool, extend the quick-start composer with a one-line bullet (`\`tool_name\` — one-sentence purpose`) in the same PR that registers the tool. Keep the bullet terse; argument and response detail belong in the tool's `description`. `mcp-instructions.test.ts` enforces both directions of the mention↔registration invariant.

## Entry Points

The `githits mcp` command has two modes:

- **`githits mcp`** (no subcommand) — Detects TTY. When run interactively, shows setup instructions for configuring AI assistants. When run via stdio (non-TTY), starts the MCP server.
- **`githits mcp start`** — Always starts the MCP server. Use this in MCP configuration files.

The MCP server starts without a synchronous auth check; auth errors surface per-tool-call inside each tool's handler. See `src/commands/mcp.ts` for the TTY detection logic.

## Architecture

```
CLI stdio wrapper (src/commands/mcp.ts)
  └─ loads local policy and creates extended local services
       └─ workspace-internal local composer (@githits/mcp/internal)
            └─ shared factory engine (packages/mcp/src/mcp/server.ts)
                 └─ registers each tool: createXxxTool(service)
                      └─ ToolDefinition { name, description, schema, handler, annotations? }
                           └─ handler calls GitHitsService / CodeNavigationService / PackageIntelligenceService
                                └─ service implementation makes HTTP calls

Public/remote createMcpServer()
  └─ shared factory engine with stable McpToolServices and public tool inventory
```

The layering is intentional:

- **Tool definitions** (`packages/mcp/src/tools/*.ts`) own the MCP contract: names, descriptions, schemas, and response formatting
- **GitHitsService / CodeNavigationService / PackageIntelligenceService** own the HTTP transport contracts and live in `packages/core-internal`
- **Shared factory engine** (`packages/mcp/src/mcp/server.ts`) owns MCP SDK registration, per-call provider resolution, and auth/trace wrapping
- **Workspace-internal local composer** (`packages/mcp/src/mcp/local-server.ts`) combines the local policy with extended local services and composes the matching experimental instruction subset while keeping those requirements out of the public package
- **Public/remote server setup** (`createMcpServer()` from `@githits/mcp`) uses stable `McpToolServices` and the stable public inventory
- **CLI MCP command** (`src/commands/mcp.ts`) owns local stdio startup: loads policy only for an actual server start, creates services from the CLI container, sets request-header mode, connects `StdioServerTransport`, and prints TTY setup instructions

This separation means tool logic can be tested without HTTP calls, and service logic can be tested without MCP SDK dependencies.

## Browser-callable surface

`@githits/mcp/tools` is a deliberately narrow public entry for a frontend
proof of concept. It currently exports the `get_example` factory, its
search-only `GetExampleService` contract, `toCallableTool()`, and the callable
metadata/result types. The service seam is structural: callers provide only
`search(params, options?)`, so a browser service can use its own backend
endpoint without importing `@githits/core-internal` or the MCP server.

`toCallableTool()` creates a plain callable object with `name`, `description`,
`annotations`, input-mode JSON Schema, and `execute(input, options?)`. It wraps
the tool's Zod shape in `z.object()`, emits the schema with
`z.toJSONSchema(..., { io: "input" })`, and parses input before invoking the
handler. This means required fields, optional fields, enum values, and Zod
defaults are reflected in the schema and enforced before the service call.
The handler returns the existing serializable `ToolResult` envelope; successful
text and structured error results therefore remain the same as the MCP tool
path. The initial callable surface is not a second tool protocol or a generic
protocol-conversion layer.

The callable execution options carry only a browser-standard `AbortSignal`.
When present, the signal is forwarded unchanged to `GetExampleService.search`.
Caller cancellation rejects the execution with its cancellation reason rather
than being converted to a `ToolResult`; service deadlines and ordinary service
errors retain their existing mapping behavior.

The public `/tools` entry exports the neutral `AuthenticationError`,
`ApiRateLimitError`, `FetchTimeoutError`, and `TermsAcceptanceRequiredError`
constructors. An injected browser service should throw one of these exact
constructors when it wants `get_example` to produce the corresponding
structured `AUTH_REQUIRED`, `RATE_LIMITED`, `TIMEOUT`, or
`TERMS_ACCEPTANCE_REQUIRED` `ToolResult`. This is an explicit service-error
contract, not automatic HTTP response classification. Callable execution
supplies the host-neutral authentication action `Authenticate with GitHits,
then retry.`; terms errors use their canonical `acceptanceUrl` action, and
arbitrary errors remain `UNKNOWN`.

MCP execution has a different boundary. The MCP SDK callback receives raw
callback state (`extra`) in the server adapter. The adapter extracts only the
explicit `ToolExecutionContext` fields (`authAction`, paired
`termsRemediation`, and `signal`) before invoking a tool handler. Tool
definitions never read raw MCP callback state, so direct callers can omit the
context and concurrent requests do not share ambient state.

The frontend owns the WebMCP host integration: registration through
`document.modelContext`, authentication and login UI, request transport, CORS
policy, and user-facing recovery. The `/tools` entry provides no filesystem,
environment/config discovery, auth storage, or Node service implementation.
Only its selected resolved runtime graph is browser-safe; installing the full
`@githits/mcp` package still includes the MCP SDK and Node-oriented dependency
tree, and the root and `/client` entries remain Node-oriented.

## Tool Definition Pattern

Each tool follows the same structure. See `packages/mcp/src/tools/search.ts` for the canonical example:

1. Define an `Args` interface for the handler input
2. Define a `schema` object with Zod validators (these become the MCP tool's input schema)
3. Define a `DESCRIPTION` constant whose first 80 characters satisfy the
   standalone selection contract above and whose complete text matches the
   backend tool description
4. Export a `createXxxTool(service)` factory function returning a `ToolDefinition`
5. The handler calls the service and wraps the result with `textResult()` or lets `withErrorHandling()` catch errors

> **Descriptions are kept in sync with the backend MCP server.** Changes happen through coordinated PRs — the frontend may lead wording, but the backend mirrors before public release. Add an exact first-80 catalog test in `packages/mcp/src/mcp/server.test.ts`, then use descriptor-only agent evals to inspect discovery and actual calls. Even small wording differences can change tool selection behaviour.

## Adding a New Tool

When the backend adds a new tool, follow this checklist:

1. **Create tool file** — `packages/mcp/src/tools/new-tool.ts` with `Args` interface, `schema`, `DESCRIPTION`, and `createNewTool(service)` factory
2. **Add service method** — Add the method to the relevant service interface and implementation in `packages/core-internal/src/services/`
3. **Export from tools barrel** — Add `export { createNewTool } from "./new-tool.js"` to `packages/mcp/src/tools/index.ts`
4. **Register in MCP server** — In `packages/mcp/src/mcp/server.ts`, import the factory and add it to `getMcpToolDefinitions()`
5. **Add tests** — Create `packages/mcp/src/tools/new-tool.test.ts` with metadata, service call, success, and error path tests
6. **Update mock service** — Add the new method to the mock factories in `packages/mcp/src/services/test-helpers.ts`
7. **Add CLI command** — Create a corresponding CLI command in `src/commands/` (see `docs/implementation/cli-commands.md`)
8. **Update registration smoke** — Add the tool name to `EXPECTED_MCP_TOOLS` in `packages/mcp/src/smoke-test.ts`
9. **Update CLI structure smoke** — If this adds a top-level CLI command, add it to `EXPECTED_TOP_LEVEL_COMMANDS` in `scripts/cli-smoke.ts`

## Behavioral Differences from Backend

While the contract (names, params, descriptions) is identical, some implementation details differ:

| Aspect | Backend | CLI |
|---|---|---|
| `search_language` | Server-side search via `mcp_service.search_language()` | Client-side substring filter: fetches all languages from `/languages`, filters locally by name/display_name/aliases using case-insensitive `includes()` |
| `get_example` response | Backend builds markdown from structured `McpSearchResponse` | CLI receives pre-formatted markdown from REST `/search` endpoint |
| unified `search` response | Backend returns structured indexed-search hits and follow-up refs | CLI and MCP share JSON envelope builders over the code-navigation service result |
| `feedback` response | Backend returns different messages for accepted/rejected | CLI hard-codes "Feedback submitted successfully" on success; the REST API response body is not used for the message |
| Error handling | Catches specific exception types, logs to PostHog | Uses shared mapped-error helpers for consistent `ToolResult` errors |

These differences exist because the CLI hits the REST API (which does its own formatting) rather than calling internal backend services directly.

## Testing Tools

Each tool has a co-located test file (for example `packages/mcp/src/tools/get-example.test.ts`, `packages/mcp/src/tools/search.test.ts`, `packages/mcp/src/tools/search-status.test.ts`). Tests use mock factories from `packages/mcp/src/services/test-helpers.ts` to mock the service layer.

Test categories for each tool:
- **Metadata** — tool name and description are correct
- **Service calls** — correct parameters passed to the service
- **Success path** — result formatted correctly
- **Error path** — errors wrapped in `ToolResult` with `isError: true`

See `docs/guidelines/TESTING.md` for the full testing pattern.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `packages/mcp/src/tools/get-example.ts` | Example-search MCP tool definition |
| `packages/mcp/src/tools/search.ts` | Unified indexed-search MCP tool definition |
| `packages/mcp/src/tools/search-status.ts` | Follow-up MCP tool for incomplete unified searches |
| `packages/mcp/src/tools/search-language.ts` | Tool with client-side filtering logic |
| `packages/mcp/src/tools/feedback.ts` | Simplest tool (direct service delegation) |
| `packages/mcp/src/tools/types.ts` | `ToolDefinition` interface, `textResult`/`errorResult` helpers |
| `packages/mcp/src/tools/shared.ts` | Shared MCP error/action helpers |
| `packages/mcp/src/services/test-helpers.ts` | Mock service factories |
| `packages/mcp/src/mcp/server.ts` | Transport-neutral MCP server construction and tool registration |
| `packages/mcp/src/mcp/instructions.ts` | Stable guide builder returned by `quick_start` and copied into the loaded `githits-mcp` skill |
| `src/commands/mcp.ts` | CLI stdio startup, request-header mode setup, and TTY setup instructions |
| `packages/core-internal/src/services/githits-service.ts` | REST API client for example search, languages, and feedback |
| `packages/core-internal/src/services/code-navigation-service.ts` | Package/source service client for unified `search`, `search_status`, `code_files`, `code_read`, and `code_grep` |
| `packages/mcp/src/shared/language-filter.ts` | Pure `filterLanguages()` function shared between MCP tool and CLI |

## Related Documentation

- Backend tool definitions: `githits-backend/githits/api/mcp/server.py`
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- [`cli-commands.md`](./cli-commands.md) — CLI commands that mirror these MCP tools
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — service isolation and testing patterns
