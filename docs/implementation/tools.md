# MCP Tools

## Purpose

The CLI exposes MCP tools that mirror the backend's MCP server. This document explains the tool architecture, the parity requirement with the backend, and how to add or modify tools.

## Background

GitHits has two MCP server implementations:

- **Backend** (`githits-backend` / PkgSeer MCP) — Python/FastMCP, runs as hosted MCP services. Production exposes both the core example-search workflow (`get_example`, `search_language`, `feedback`) and indexed package/source tooling.
- **CLI** (`githits-cli`) — TypeScript/MCP SDK, runs locally via `githits mcp start`. Surfaces the same public tool families, including unified `search`, package intelligence (`pkg_*`), docs (`docs_*`), and code navigation (`code_*`).

The CLI mirrors the production MCP tool contract where equivalent tools exist. Core example-search tool descriptions are kept aligned with GitHits backend wording; indexed package/source tool descriptions are kept aligned with the PkgSeer/GitHits indexed-service contract.

## Current Tools

| Tool | Parameters | Description |
|---|---|---|
| `get_example` | `query`, `language?`, `license_mode?`, `format?` | Search for canonical code examples. Defaults to markdown with a trailing `solution_id: ...` line for `feedback`; pass `format: "json"` for `{result, solution_id?}`. If `language` is omitted, the backend infers it from the query. |
| `search_language` | `query`, `format?` | Find supported programming language names before searching. Defaults to one compact line per match (`name (Display Name) aliases: ...`); pass `format: "json"` for structured matches. |
| `feedback` | `solution_id?`, `accepted`, `feedback_text?`, `tool_name?` | Submit feedback on a `get_example` result, another GitHits tool result, or the current GitHits session. |
| `search` | `query`, `target?`, `targets?`, `source?`, `category?`, `kind?`, `path_prefix?`, `file_intent?`, `public_only?`, `name?`, `language?`, `allow_partial_results?`, `limit?`, `offset?`, `wait_timeout_ms?`, `format?` | Unified indexed dependency/repository discovery search across code, docs, and symbols. Required inputs are `query` plus either `target` or `targets`; every other argument is optional. Omit `source` to let GitHits select the best sources; use `source:"docs"` for guides/reference pages, `source:"code"` for source and tests, and `source:"symbol"` for exact API/entity lookup. Omit `file_intent` to search across all intents; set it only when you want to narrow code results. For docs-only search, code/symbol-only filters (`category`, `kind`, `file_intent`, `public_only`) are ignored client-side because the backend docs source rejects them. Complete-by-default; `limit` defaults to 10. An incomplete response can carry an atomic interim result when every runnable target/source pair is serveable. Set `allow_partial_results: true` only on the initial call to permit a serveable subset while other pairs remain unavailable. A deferred response must be continued with `search_status`, not a repeated or fingerprint-modified `search`. Completed empty text gives bounded query/filter/source pivots unless a pending-evidence notice says the result may change. `format` defaults to `text-v1`; pass `format: "json"` for the structured envelope. |
| `search_status` | `search_ref`, `wait_timeout_ms?`, `format?` | Check progress, fetch atomic interim hits or an opted-in serveable subset, and fetch final results for a prior unified search. `wait_timeout_ms` waits up to 60 seconds for progress or completion and defaults to 20 seconds, preventing tight status polling. Defaults to compact `text-v1`; pass `format: "json"` for the structured envelope. |
| `docs_list` | `registry`, `package_name`, `version?`, `limit?`, `after?`, `format?` | List hosted/crawled and repository-backed documentation pages for a package. Defaults to compact `text-v1` with ready-to-call `docs_read` follow-ups; repo-backed entries include exact source metadata for `code_read` follow-up when available. |
| `docs_read` | `page_id`, `start_line?`, `end_line?`, `format?` | Read a documentation page by page ID. Defaults to `text-v1` with a 150-line MCP text cap; explicit line ranges are supported. `format: "json"` preserves full-document default while still honoring explicit ranges. Repo-backed pages include exact file follow-up metadata. |
| `pkg_info` | `registry`, `package_name`, `verbose?`, `format?` | Latest-version package triage: license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when applicable), downloads, publish age, and vulnerability status. Example: `{registry:"npm", package_name:"express"}`. Set `verbose: true` for GitHub language/topics/last-pushed, recent advisories, and recent changes. Pass `format: "json"` for structured fields. |
| `pkg_vulns` | `registry`, `package_name`, `version?`, `min_severity?`, `advisory_scope?`, `include_withdrawn?`, `verbose?`, `format?` | Known vulnerabilities for a package on npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, Go, or Swift. vcpkg and Zig are not supported for vulnerability data. Example: `{registry:"npm", package_name:"lodash", version:"4.17.20", min_severity:"high"}`. Defaults to compact text capped at 5 affected advisory rows with active filter echo; set `advisory_scope:"non_affecting"` for historical advisories, `advisory_scope:"all"` for affected + historical rows, `verbose:true` to show all selected text rows, or `format:"json"` for the complete per-advisory envelope. |
| `pkg_deps` | `registry`, `package_name`, `version?`, `lifecycle?`, `include_importers?`, `max_depth?`, `format?` | Direct runtime dependency list by default with resolved versions. Non-runtime groups are hidden with an MCP-native hint (`pass lifecycle="all"`). Use `lifecycle: "runtime"` for explicit runtime-only, a concrete non-runtime lifecycle for runtime plus matching groups, or `lifecycle: "all"` for all available groups. `max_depth` requests capped transitive output with aggregate edge counts, the preprocessed install footprint, typed conflicts and circular-dependency cycles; opt into importer provenance with `include_importers`. Pass `format: "json"` for the lean structured envelope. |
| `pkg_changelog` | `registry?`, `package_name?`, `repo_url?`, `from_version?`, `to_version?`, `limit?`, `git_ref?`, `omit_bodies?`, `verbose?`, `body_lines?`, `format?` | Release notes or changelog entries for a package or GitHub repo. Example: `{registry:"npm", package_name:"express", limit:2}`. Defaults to compact text with newest-first entries and 10-line body previews; set `body_lines` to tune text previews, `verbose:true` for full text bodies, `omit_bodies:true` for a lean timeline, or `format:"json"` for the complete envelope. `from_version` switches to range mode (no count cap). Dual addressing (spec vs repo URL) is mutually exclusive. |
| `pkg_upgrade_review` | `registry?`, `package_name?`, `current_version?`, `target_version?`, `packages?`, `skip_transitive_security?`, `include_dependency_issues?`, `min_severity?`, `verbose?`, `format?` | Evidence for dependency upgrades. Accepts a single package or repeatable batch, compares current vs target direct vulnerabilities, changelog range evidence, target deprecation metadata, peer dependency changes, dependency changes, and transitive security evidence by default. `skip_transitive_security:true` disables transitive vulnerability evidence when latency matters. Reports facts only; callers decide whether to accept the upgrade. |
| `code_files` | `target`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `file_types?`, `languages?`, `file_intent?`, `file_intents?`, `exclude_file_intents?`, `exclude_doc_files?`, `exclude_test_files?`, `include_hidden?`, `limit?`, `wait_timeout_ms?`, `format?` | List files in an indexed dependency. Returns `{total, hasMore, files: [{path, name, language, fileType, byteSize}], resolution, indexedVersion, targetResolution?}` in JSON mode. Dual addressing via `target.registry + target.package_name` (spec) or `target.repo_url + target.git_ref?` (repo, omitted ref means default branch intent). Selectors (`path`, `path_prefix`, `globs`) are OR-ed; the other filters intersect on top. `INDEXING` errors include immediate retry candidates in `details.availableVersions` / `details.availableRefs` when available; repository ref suggestions use `suggestedRefs` and are not immediate retry guarantees. `format` defaults to `text-v1` (paths-only listing); pass `format: "json"` for the structured envelope. |
| `code_read` | `target`, `path`, `start_line?`, `end_line?`, `wait_timeout_ms?`, `format?` | Read a file from an indexed dependency. `target` accepts the structured object or compact string (`npm:react@18.2.0`, `github:facebook/react#HEAD`, `github.com/facebook/react#HEAD`, `https://github.com/facebook/react#HEAD`, `github:facebook/react@HEAD`, or any repo form without `#ref`/`@ref` for default branch intent). User-facing output canonicalizes repo targets as `github:owner/repo#ref` so refs can contain `@` safely. Package compact strings require an explicit registry prefix. **MCP per-call span cap: 150 lines** — broader requests (or no range) are silently truncated to the first 150 lines from the caller's start, with a hint explaining the cap and the original request. Defaults to `text-v1` with line-numbered content; pass `format: "json"` for the structured envelope. Binary files set `isBinary: true` and omit `content`; `targetResolution` may explain fallback/indexing provenance. On `FILE_NOT_FOUND`, `FILE_PATH_EXCLUDED`, `SOURCE_FILE_INVENTORY_UNKNOWN`, or a legacy `NOT_FOUND` that specifically describes a missing file path, follow `details.action` to inspect indexed paths through `code_files`. The cap is MCP-only; the CLI command `githits code read` honors arbitrary ranges. |
| `code_grep` | `target`, `pattern`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `pattern_type?`, `case_sensitive?`, `exclude_doc_files?`, `exclude_test_files?`, `context_lines?`, `context_lines_before?`, `context_lines_after?`, `max_matches?`, `max_matches_per_file?`, `cursor?`, `symbol_fields?`, `wait_timeout_ms?`, `format?` | Deterministic text grep over indexed dependency or repository source. Defaults to literal, ASCII case-insensitive matching across the whole target; non-ASCII letters match case-sensitively. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. `pattern_type: "regex"` uses RE2 syntax; whole-target regexes must include at least one literal substring for index pre-filtering. Returns matches plus pagination and scan counters; `symbol_fields` hydrates enclosing symbol metadata on each match. Empty text reports scanned/in-scope counts and served identity, then branches between loosening selectors (zero files in scope) and changing the literal/pattern or using conceptual `search`. Disabling case sensitivity is suggested only when the failed call enabled it. `format` defaults to `text-v1`; pass `format: "json"` for the structured envelope. |

`search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`, `code_read`, and `code_grep` are registered by default. The package/source service URL defaults to the GitHits-managed endpoint and can be overridden via `GITHITS_CODE_NAV_URL` for local development.

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

**Promoted `warnings[]`.** Noteworthy `sourceStatus` entries — sources reporting `incompatibleQueryFeatures`, `ignoredQueryFeatures`, `incompatibleFilters`, `ignoredFilters`, lifecycle anomalies (`indexingStatus`, `codeIndexState`), or a free-form `note` — are also surfaced as a top-level `warnings: string[]` in the completed/incomplete payloads (and appended after parser warnings inside the `search_status` result block). The structured detail still lives in `sourceStatus`; `warnings[]` is the agent-visible signal that something about execution did not match the request. On completed empty results, healthy non-contributor source entries are also retained with zero `resultCount` and served identity; requested/fresh labels emit only when they materially differ from served. Contributor-bearing DOCS rows retain their physical contributors instead of duplicating healthy served/current resolution metadata. Healthy `INDEXED` / `CURRENT` / non-divergent `STALE` states never become warnings. Successful non-empty responses keep the prior compact projection. The text-v1 renderer prints backend warnings and source notes before empty-result advice. Implementation in `buildSourceStatusWarnings` and empty-result compaction (`packages/mcp/src/shared/unified-search-response.ts`).

**Standalone-site recovery.** `search` accepts exact documentation targets as `site:<host[/path]>`. Backend-owned `sourceStatus[].suggestedSiteTargets` labels are preserved in order for missing or ambiguous sites, together with the exact `suggestedSiteTargetsTruncated` Boolean. The compact source-status row becomes actionable even when it has no note or lifecycle warning, and text-v1 renders replayable target labels plus an omitted-candidates notice when truncated. Suggestions are advisory rather than aliases; neither `search` nor `search_status` rewrites or retries the target automatically. Active admitted-site crawls and repairs participate in ordinary discovery sessions: incomplete responses carry a `searchRef` and progress, while stale-but-serveable evidence can remain available during refresh. Terminal missing or ambiguous results can omit `searchRef` and instead expose recovery guidance.

**Documentation sources.** DOCS `sourceStatus` rows retain bounded physical `contributors` even when otherwise healthy. Repository contributors expose normalized `repositoryUrl`, full `commitSha`, freshness, and current-page `resultCount`; docpacks expose stable `siteKey` and selected published coverage. The JSON projection preserves meaningful zero/null values and every selected docpack coverage field, but omits duplicate pair-level count/coverage and incidental healthy resolution metadata. Text-v1 optimizes for interpretation instead of mirroring that structure: directly below the result count and before the hits, fully current searched sources collapse to `searched: site ...; repo ... @ <commit>`, with no repeated hit counts or coverage totals. The target label is omitted for one target and retained only when multiple targets need disambiguation. Stale, partial, capped, ready-but-unused, pending, unavailable, and coverage-undisclosed sources instead expand into a `documentation sources` block in the same pre-result position, explaining the exceptional state and whether the source was searched. In mixed blocks, healthy contributors explicitly say `searched`; a searched docpack without coverage says that published coverage details are unavailable. When any disclosed contributor was not searched, an empty headline scopes the claim to searched evidence. Pending-evidence notices suppress query pivots; otherwise the ordinary empty-result guidance still applies to the evidence that was searched. Opaque site keys are replaced by an unambiguous returned-page host when one is available and otherwise omitted from text; multiple site sources are numbered. JSON remains the exact source for stable keys and all coverage fields. Partial/capped coverage is published evidence, not a progress or retry signal.

`evidenceNotice` is carried once on initial and stored result envelopes and rendered once in text. A present `searchRef` supplies the initial-search `search_status` follow-up; completed status output does not direct callers back to the same terminal session. Without a reference, the notice is the only retry-variability guidance. `search_status(includeResults: true)` uses the same result projection and formatter—contributors are never copied onto generic progress targets, and `allowPartialResults` retains its separate pair-omission meaning.

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

**Mode selection.** `from_version` triggers range mode (returns every entry in `[fromVersion, toVersion]` with no cap). Latest mode is the default, capped by `limit` (1–50, backend default 10). `from_version` + `limit` is rejected client-side with `INVALID_ARGUMENT` rather than silently routed to one mode.

**`omit_bodies` lever and body previews.** Release bodies on large packages (Kubernetes, Node) can run 10 KB+ per entry; a 100-entry range could produce a multi-hundred-KB envelope. `omit_bodies: true` opts out explicitly in JSON and text — not silent truncation. Other fields (version / normalizedVersion / publishedAt / htmlUrl) remain so agents still get the release timeline. Text mode caps each body preview at 10 lines by default. MCP adds text-only `body_lines` (1-50) to tune the cap and `verbose:true` to uncap text bodies; both are ignored for JSON. `verbose:true` conflicts with `omit_bodies:true` and `body_lines`. CLI terminal output uses the same default preview cap and gives the CLI-native `--verbose` hint; `--verbose` uncaps terminal previews but does not change `--json` output.

**`filter.*` echo.** `filter` is emitted only when the caller explicitly supplied at least one of `from_version`, `to_version`, `limit`, or `git_ref`. Backend-default `limit: 10` / `toVersion: <latest>` is never echoed. The request builder tracks explicit-vs-defaulted via an `explicitFilterFields` set so defaults don't round-trip as caller intent.

**Version validation.** Same rule as `pkg_vulns` / `pkg_deps`: tag-style `v`-prefixed inputs on `from_version` / `to_version` are rejected client-side with `INVALID_ARGUMENT`. `<spec>@<version>` is also rejected — the `pkg changelog` family has no single-version query, and silently remapping to `to_version` would be a client-invented semantic shift. Hint text redirects callers to `--to` / `to_version`.

**NOT_FOUND semantics.** Backend `source === null` or `source === ""` means there is no concrete changelog source for the returned package versions. If entries are present, this is a success and the envelope omits `source`; terminal output labels it `source: package versions`. If both source and entries are absent, the service promotes the response to `PackageIntelligenceChangelogSourceNotFoundError`, which the shared classifier routes to the `NOT_FOUND` envelope with a message naming the sources that were tried. Empty `entries.items: []` with a valid `source` is also a success — "no entries in this range" is a legitimate neutral outcome.

**Overlap with `pkg_info`.** `pkg_info` already surfaces a short-form `recentChanges` block (from the backend's `latestChangelogs` field on `PackageSummaryResult`). For a quick "what shipped recently" glance embedded in a package overview, use `pkg_info`. For the full range-capable, body-rich, `omit_bodies`-toggleable changelog with `--no-body` timeline mode and repo-URL addressing, use `pkg_changelog`.

`pkg_changelog` shares its envelope builder and text formatter with the CLI `githits pkg changelog` command via `packages/mcp/src/shared/package-changelog-request.ts` and `packages/mcp/src/shared/package-changelog-response.ts`. MCP defaults to compact text with MCP-native `verbose=true`, `body_lines=<n>`, and `format="json"` hints for full bodies. The parity test (`src/tools/package-changelog-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across every service-sourced success / error fixture (happy latest, range mode, repo-URL addressing, no-source package-version entries, `--no-body` / `omit_bodies: true`, default bodies, empty entries, NOT_FOUND, PackageIntelligenceTargetNotFoundError, VERSION_NOT_FOUND, BACKEND_ERROR), and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT`.

### `code_files` / `code_read` / `code_grep` response shapes

These three indexed tools share an addressing and lifecycle contract (documented below) and then each projects its own data-first envelope. All three reuse the shipped `codeTargetSchema` + `resolveCodeTarget` from `packages/mcp/src/tools/code-navigation-shared.ts` — no parallel addressing module.

**`code_files` envelope**: `{registry?|repoUrl?+gitRef?, total, hasMore, indexedVersion?, resolution?, targetResolution?, files: [{path, name?, language?, fileType?, byteSize?}], hint?, filter?}`. `fileType` values preserve the service vocabulary (`CONFIG`, `SOURCE`, `DOC`, `TEST`). `total` is capped at returned count when `hasMore: true` — the terminal formatter renders `N+ files` in that case to avoid misleading users. `filter` echoes only explicit caller filters (`path`, `pathPrefix`, `globs`, `extensions`, `fileTypes`, `languages`, file-intent filters, booleans, and `limit`); default limit (200) never round-trips.

**`code_read` envelope**: `{registry?|repoUrl?+gitRef?, path, language?, totalLines?, startLine?, endLine?, content?, isBinary?, hint?, targetResolution?}`. `path` (not `filePath`) so the key matches `code_files.files[].path` and `code_grep.filter.path` when exact-file grep is used. Binary files set `isBinary: true` and **omit** `content` (not `null`); agents branch on the flag. `hint` is emitted only when the MCP span cap actually truncated the response — see "code_read span cap" below.

**`code_grep` envelope**: `{registry?|name?|repoUrl?+gitRef?, pattern, patternType?, caseSensitive?, matches: [{filePath, line, matchStartByte, matchEndByte, lineContent, contextBefore?, contextAfter?, fileContentHash?, fileIntent?, symbol?}], nextCursor?, hasMore, truncatedReason?, filesScanned, filesInScope, binaryFilesSkipped?, filesTooLargeSkipped?, totalMatches, uniqueFilesMatched, indexedVersion?, resolution?, targetResolution?, filter?}`. Default-valued fields (`patternType: literal`, `caseSensitive: false`, zero skipped counters, `truncatedReason: none`) are omitted. `filter` echoes only explicit caller filters. Match entries carry `filePath` so grep output chains directly into `code_read`.

`targetResolution` is additive provenance. It explains requested, resolved-requested, and served artifacts plus `freshness` (`current`, `fallback_recent`, `indexing`, or `unavailable`), `freshnessReason`, `indexingRef`, `availableVersions`, `availableRefs`, and `suggestedRefs`. `availableVersions` and `availableRefs` are already-indexed artifacts that can be queried immediately. `suggestedRefs` are fuzzy upstream candidates and may require indexing before use. Existing `indexedVersion`, `resolution`, and locator fields remain served-identity compatibility fields. Text mode renders actionable notes such as `Using recent indexed snapshot`, `Serving an older indexed snapshot; current target is still being indexed`, `Requested ref is being indexed`, `Fresh target is being indexed`, `Target unavailable`, `queryable now`, or `suggested refs`; JSON mode carries the structured object. A `current` resolution is authoritative on every code-navigation surface and suppresses alternative-target remediation; waited search completion is one case where earlier candidates can remain in structured provenance without becoming warnings.

### Indexing lifecycle (shared across `code_files`, `code_read`, `code_grep`)

All three code-navigation tools share the same indexing-retry contract. The state can arrive through either an error response or a success sentinel (`codeIndexState: "INDEXING"`), and the service layer collapses both to the same typed `CodeNavigationIndexingError` before the envelope builder runs. Agents therefore never see a `codeIndexState` field in a success envelope; they branch on the error path instead.

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

**`code_read` span cap (MCP-only)**: real session traces showed agents requesting 300-600 line windows (and occasional unbounded full-file reads) which dominated context cost. The MCP surface caps each `code_read` call at `MCP_READ_MAX_SPAN` (150 lines, defined in `packages/mcp/src/tools/read-file.ts`). The cap is enforced *before* the backend call — `deriveBoundedRange` clamps the request, so the service does not transfer bytes that will be discarded.

The `hint` field is emitted only when the cap *actually truncated* the response — i.e., the returned range comes up short of available content. `shouldEmitCappedHint` (in `packages/mcp/src/tools/read-file.ts`) suppresses the hint in three cases the agent doesn't need it: (a) the cap clamp didn't fire (caller's range was already within the cap); (b) the file fits within the cap, so the response is the whole file even though the request was clamped; (c) the returned range reaches end of file. Binary files always skip the hint. When emitted, the hint reads from `payload.startLine` / `endLine` / `totalLines` (the actual returned range, not the pre-clamp request) and includes the original request for the agent to learn from. The CLI command `githits code read` does not apply the cap; humans piping whole files to disk continue to work.

## Text response format (`format: "text-v1"`)

`get_example`, `search_language`, `search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `pkg_upgrade_review`, `code_files`, `code_read`, and `code_grep` accept a `format` parameter on the MCP surface. The default is `"text-v1"` — a compact line-oriented format that drops JSON scaffolding to stay lean in agent context. Programmatic callers (parity tests, scripts that parse responses) pass `format: "json"` explicitly. `"text"` is accepted as an alias for `"text-v1"` to keep agent prompts terse.

**Why text-v1 default.** A 10-hit `search` JSON envelope runs 5–7 KB after compaction; the same hits in `text-v1` land around 3–4 KB. The savings come from dropped quoting, dropped key repetition, and dropped fields that an agent does not need at the per-call decision point (highlights byte offsets, repeated locator scaffolding). The token budget belongs to the agent's reasoning, not to JSON structure.

**Format stability.** The text format is a public contract, locked with snapshot-style tests (`packages/mcp/src/shared/unified-search-text.test.ts`, `packages/mcp/src/tools/search-status.test.ts`, `packages/mcp/src/shared/list-files-text.test.ts`, `packages/mcp/src/shared/grep-repo-text.test.ts`). The `text-v1` version tag exists so incompatible evolution can ship as `text-v2`.

**ASCII-only.** Separators are ` | `; ellipsis is `...`; no box-drawing or Latin-1 punctuation. Tokenizer behavior for multi-byte UTF-8 varies across BPE variants, and the format runs into Claude, Codex CLI, OpenCode, Cline, Cursor, etc. — ASCII keeps it predictable.

**Example-search anatomy.** `get_example` text mode returns markdown directly, followed by `solution_id: <id>` when the REST response includes an app URL. This avoids JSON-wrapped markdown while preserving the `feedback` workflow. `search_language` text mode returns one match per line as `name (Display Name) aliases: a, b`; agents should pass the `name` value to `get_example.language`.

**Package metadata anatomy.** `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, and `pkg_upgrade_review` text mode reuse the shared no-color terminal formatters but inject MCP-native hints. `pkg_deps` hides non-runtime groups by default and says `pass lifecycle="all"` when groups exist. `pkg_changelog` caps body previews and says `pass verbose=true`, `body_lines=<n>`, or `format="json"` when text omitted lines. Package tools keep JSON errors in all formats because agents can reliably branch on `{error, code, retryable, details?}`.

**Hit anatomy** (`search` text-v1):

```
search | <N> hits | query="..."
[blank]
[1] <target>  <type>  <score>
    <locator-line>
    <title?>
    <summary line 1>
    <summary line 2 (wrapped at ~76 cols)>
[blank]
[2] ...
[blank]
More hits available. Pass offset=N for the next page or limit=N to widen.
```

`<type>` compacts to `code` / `symbol` / `docs` / `repo-docs`. `<locator-line>` is a ready-to-call follow-up when possible: `code_read target="npm:pkg@version" path="..." start_line=N end_line=M` for code/symbol hits and `docs_read page_id="..."` for documentation hits. If a code/symbol hit lacks a file path, text mode prints `follow-up unavailable: missing filePath` rather than fabricating a path.

**Follow-up — crawled-doc section anchors.** Unified search can label a crawled documentation hit with a matching section title while returning only its page ID. Without a line anchor, `docs_read` must start at the beginning of the page. Carrying section ranges through search results requires backend/search-location support and is outside the CLI response-formatting slice.

Completed empty search renders backend warnings/source notes first, then served target/freshness context and `Do not repeat this search unchanged.` Generic pivots are conditional: filter removal appears only when filters exist, symbol search is omitted when already selected, and standalone site searches do not suggest `code_grep`. If the completed source is still indexing, query rewriting is suppressed in favor of a larger `wait_timeout_ms` or an indexed alternative labelled `queryable now`. Active deferred search reports ready/total counts, says `Do not repeat search.`, and gives the exact bounded continuation `next: call search_status with search_ref="..." and wait_timeout_ms=20000.` Terminal `FAILED` and `TIMEOUT` sessions prohibit further status calls and direct the caller to rerun `search` instead. The response never suggests changing `allow_partial_results` after deferral.

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

`context_lines`, `context_lines_before`, and `context_lines_after` accept integers from 0 through 10. The MCP JSON Schema advertises the range so agent clients reject invalid calls before dispatch; direct CLI/internal callers retain the same request-builder validation. The asymmetric fields override the corresponding side of `context_lines`.

**Docs read cap.** `docs_read` text output is capped at 150 lines per call, including explicit larger ranges. Its response reports the actual returned range and total line count for the next bounded read; JSON mode preserves explicitly requested ranges.

**Errors in text mode.** `search` errors render as text in `text-v1` mode: `search | ERROR | code=<CODE> [| retryable]\n<message>` followed by an indented `details:` block when present. `code_files` and `code_grep` keep errors JSON-formatted in either mode for now — revisit if agent feedback warrants.

## Server instructions

The MCP server advertises a short, cross-tool orientation via the protocol's server-level `instructions` field. This is distinct from per-tool `description` text: instructions cover rationale, workflow glue, and decisions that span multiple tools, while per-tool descriptions remain the source of truth for arguments, output shape, and tool-specific constraints.

`packages/mcp/src/mcp/instructions.ts` owns the server-level instruction sections:

- **Core block** — always loaded. Introduces GitHits, defines its public-only scope, expands trigger criteria to include comparative cross-OSS questions and "how does X actually implement this" archaeology, and walks through the `get_example` / `search_language` / `feedback` workflow.
- **External-content block** — included by default from `packages/mcp/src/tools/guardrails.ts`; tells agents to treat third-party prose as data, not instructions.
- **Package-tools block** — always appended. Contains a preamble plus one bullet per package/code tool, plus two cross-tool tips:
  - **Delegate multi-call work**: anticipate 3+ code-navigation calls? Use a sub-agent and ask for a compact synthesis.
  - **Strategy / reference-first**: source, symbols, tests, and call sites beat docs prose; enumerate paths first, locate symbols or lines, then read focused windows.
- **Local experimental block** — appended only by the workspace-internal local
  composer when the host policy enables experimental tools. It names only the
  registered local `resolve_target`/`code_diff` subset, routes fuzzy identity
  before canonical diff evidence, states public-OSS/privacy limits, and adds
  opt-in negative-feedback guidance only for the configured reporting scope.
  Disabled or dormant reporting returns the public builder's exact baseline;
  public and remote servers never receive this block.

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

When adding a new package tool, extend the composer with a one-line bullet (`\`tool_name\` — one-sentence purpose`) in the same PR that registers the tool. Keep the bullet terse; argument and response detail belong in the tool's `description`. `mcp-instructions.test.ts` enforces both directions of the mention↔registration invariant.

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

## Tool Definition Pattern

Each tool follows the same structure. See `packages/mcp/src/tools/search.ts` for the canonical example:

1. Define an `Args` interface for the handler input
2. Define a `schema` object with Zod validators (these become the MCP tool's input schema)
3. Define a `DESCRIPTION` constant (must match the backend's tool description)
4. Export a `createXxxTool(service)` factory function returning a `ToolDefinition`
5. The handler calls the service and wraps the result with `textResult()` or lets `withErrorHandling()` catch errors

> **Descriptions are kept in sync with the backend MCP server.** Changes happen through coordinated PRs — the frontend may lead wording, but the backend mirrors before public release. The description is what LLM clients see when deciding whether to use a tool; even small wording differences could change tool selection behaviour.

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
| `packages/mcp/src/mcp/instructions.ts` | Server-level MCP instructions advertised to clients |
| `src/commands/mcp.ts` | CLI stdio startup, request-header mode setup, and TTY setup instructions |
| `packages/core-internal/src/services/githits-service.ts` | REST API client for example search, languages, and feedback |
| `packages/core-internal/src/services/code-navigation-service.ts` | Package/source service client for unified `search`, `search_status`, `code_files`, `code_read`, and `code_grep` |
| `packages/mcp/src/shared/language-filter.ts` | Pure `filterLanguages()` function shared between MCP tool and CLI |

## Related Documentation

- Backend tool definitions: `githits-backend/githits/api/mcp/server.py`
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- [`cli-commands.md`](./cli-commands.md) — CLI commands that mirror these MCP tools
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — service isolation and testing patterns
