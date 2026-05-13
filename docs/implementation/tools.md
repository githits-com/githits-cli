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
| `search` | `query`, `target?`, `targets?`, `sources?`, `category?`, `kind?`, `path_prefix?`, `file_intent?`, `public_only?`, `name?`, `language?`, `allow_partial_results?`, `limit?`, `offset?`, `wait_timeout_ms?`, `format?` | Unified indexed dependency/repository discovery search across code, docs, and symbols. Omit `file_intent` to search across all intents; set it only when you want to narrow results, and note that some sources may ignore it and report that in `sourceStatus`. Prefer `sources:["symbol"]` for symbol-shaped unified search. Complete-by-default; `limit` defaults to 10 to keep agent output compact. Set `allow_partial_results: true` to receive available partial hits while indexing continues. `format` defaults to `text-v1` for compact agent output; pass `format: "json"` for the structured envelope. |
| `search_status` | `search_ref`, `format?` | Check progress, fetch partial hits when the original request used `allow_partial_results: true`, or fetch final results for a prior unified search. Defaults to compact `text-v1`; pass `format: "json"` for the structured envelope. |
| `docs_list` | `registry`, `package_name`, `version?`, `limit?`, `after?`, `format?` | List hosted/crawled and repository-backed documentation pages for a package. Defaults to compact `text-v1` with ready-to-call `docs_read` follow-ups; repo-backed entries include exact source metadata for `code_read` follow-up when available. |
| `docs_read` | `page_id`, `start_line?`, `end_line?`, `format?` | Read a documentation page by page ID. Defaults to `text-v1` with a 150-line MCP text cap; explicit line ranges are supported. `format: "json"` preserves full-document default while still honoring explicit ranges. Repo-backed pages include exact file follow-up metadata. |
| `pkg_info` | `registry`, `package_name`, `verbose?`, `format?` | Latest-version package triage: license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when applicable), downloads, publish age, and vulnerability status. Example: `{registry:"npm", package_name:"express"}`. Set `verbose: true` for GitHub language/topics/last-pushed, recent advisories, and recent changes. Pass `format: "json"` for structured fields. |
| `pkg_vulns` | `registry`, `package_name`, `version?`, `min_severity?`, `advisory_scope?`, `include_withdrawn?`, `verbose?`, `format?` | Known vulnerabilities for a package on npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, or Go. vcpkg and Zig are not supported for vulnerability data. Example: `{registry:"npm", package_name:"lodash", version:"4.17.20", min_severity:"high"}`. Defaults to compact text capped at 5 affected advisory rows with active filter echo; set `advisory_scope:"non_affecting"` for historical advisories, `advisory_scope:"all"` for affected + historical rows, `verbose:true` to show all selected text rows, or `format:"json"` for the complete per-advisory envelope. |
| `pkg_deps` | `registry`, `package_name`, `version?`, `lifecycle?`, `include_transitive?`, `include_importers?`, `max_depth?`, `format?` | Direct runtime dependency list by default with resolved versions. Non-runtime groups are hidden with an MCP-native hint (`pass lifecycle="all"`). Use `lifecycle: "runtime"` for explicit runtime-only, a concrete non-runtime lifecycle for runtime plus matching groups, or `lifecycle: "all"` for all available groups. Optional transitive output includes aggregate edge counts, the preprocessed install footprint, typed conflicts and circular-dependency cycles; opt into importer provenance with `include_importers`. Pass `format: "json"` for the lean structured envelope. |
| `pkg_changelog` | `registry?`, `package_name?`, `repo_url?`, `from_version?`, `to_version?`, `limit?`, `git_ref?`, `include_bodies?`, `verbose?`, `body_lines?`, `format?` | Release notes or changelog entries for a package or GitHub repo. Example: `{registry:"npm", package_name:"express", limit:2}`. Defaults to compact text with newest-first entries and 10-line body previews; set `body_lines` to tune text previews, `verbose:true` for full text bodies, `include_bodies:false` for a lean timeline, or `format:"json"` for the complete envelope. `from_version` switches to range mode (no count cap). Dual addressing (spec vs repo URL) is mutually exclusive. |
| `code_files` | `target`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `file_types?`, `languages?`, `file_intent?`, `file_intents?`, `exclude_file_intents?`, `exclude_doc_files?`, `exclude_test_files?`, `include_hidden?`, `limit?`, `wait_timeout_ms?`, `format?` | List files in an indexed dependency. Returns `{total, hasMore, files: [{path, name, language, fileType, byteSize}], resolution, indexedVersion}` in JSON mode. Dual addressing via `target.registry + target.package_name` (spec) or `target.repo_url + target.git_ref` (repo). Selectors (`path`, `path_prefix`, `globs`) are OR-ed; the other filters intersect on top. Emits an `INDEXING` error envelope when the dependency is being indexed on-demand — retry with a longer `wait_timeout_ms` or pick a version from `details.availableVersions`. `format` defaults to `text-v1` (paths-only listing); pass `format: "json"` for the structured envelope. |
| `code_read` | `target`, `path`, `start_line?`, `end_line?`, `wait_timeout_ms?`, `format?` | Read a file from an indexed dependency. `target` accepts the structured object or compact string (`npm:react@18.2.0`, `https://github.com/facebook/react#HEAD`). **MCP per-call span cap: 150 lines** — broader requests (or no range) are silently truncated to the first 150 lines from the caller's start, with a hint explaining the cap and the original request. Defaults to `text-v1` with line-numbered content; pass `format: "json"` for the structured envelope. Use `start_line` / `end_line` to pick a focused window — typical 80-150 lines around a known symbol from `search` / `code_grep`. Binary files set `isBinary: true` and omit `content`. On `NOT_FOUND` / `FILE_NOT_FOUND` call `code_files` to discover the actual path. The cap is MCP-only; the CLI command `githits code read` honors arbitrary ranges. |
| `code_grep` | `target`, `pattern`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `pattern_type?`, `case_sensitive?`, `exclude_doc_files?`, `exclude_test_files?`, `context_lines?`, `context_lines_before?`, `context_lines_after?`, `max_matches?`, `max_matches_per_file?`, `cursor?`, `symbol_fields?`, `wait_timeout_ms?`, `format?` | Deterministic text grep over indexed dependency or repository source. Defaults to literal, ASCII case-insensitive matching across the whole target; non-ASCII letters match case-sensitively. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. `pattern_type: "regex"` uses RE2 syntax; whole-target regexes must include at least one literal substring for index pre-filtering. Returns matches plus pagination and scan counters; `symbol_fields` hydrates enclosing symbol metadata on each match. `format` defaults to `text-v1` (matches grouped by file, grep -A/-B notation for context); pass `format: "json"` for the structured envelope. |

`search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `code_files`, `code_read`, and `code_grep` are registered by default. The package/source service URL defaults to the GitHits-managed endpoint and can be overridden via `GITHITS_CODE_NAV_URL` for local development.

## Ecosystem Audit

Use `bun run audit:pkg-ecosystems` to run a live CLI audit across representative packages from every package registry supported by package metadata tools. The script checks `pkg_info`, `pkg_changelog`, `pkg_vulns`, and `pkg_deps` with JSON output so ecosystem regressions are visible without hand-running dozens of commands.

The fixture matrix lives in `scripts/pkg-ecosystem-audit.ts` and covers npm, PyPI, Hex, Crates, NuGet, Maven, Zig, vcpkg, Packagist, RubyGems, and Go. Each registry has three representative packages. `pkg_vulns` failures for vcpkg and Zig are expected and are reported as `expected-unsupported`; `pkg_deps` failures for NuGet, Maven, and Packagist are expected and are reported the same way. Any other failure exits non-zero, including backend data anomalies that should be fixed and rechecked later.

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

**Promoted `warnings[]`.** Noteworthy `sourceStatus` entries — sources reporting `incompatibleQueryFeatures`, `ignoredQueryFeatures`, `incompatibleFilters`, `ignoredFilters`, lifecycle anomalies (`indexingStatus`, `codeIndexState`), or a free-form `note` — are also surfaced as a top-level `warnings: string[]` in the completed/incomplete payloads (and appended after parser warnings inside the `search_status` result block). The structured detail still lives in `sourceStatus`; `warnings[]` is the agent-visible signal that something about execution did not match the request. Mitigates backend issue B5: `sources: ["docs"]` plus a `kind:`/`lang:` qualifier returns `results: []` with the only diagnostic buried inside `sourceStatus[].note`. The text-v1 renderer prints the warnings as a `warnings:` preamble. Implementation in `buildSourceStatusWarnings` (`src/shared/unified-search-response.ts`); remove once the backend surfaces these at the top level itself.

### `pkg_info` response shape

**Default MCP text + JSON opt-in.** `pkg_info` defaults to compact triage text for agent turns: identity/license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when available), publish age, downloads, and explicit vulnerability status. `verbose: true` adds GitHub language/topics/last-pushed, recent advisories, and recent changes. `format: "json"` returns a lean payload designed for programmatic consumers. Fields that do not add caller value are deliberately omitted. Null scalars are omitted; blocks (`github`, `downloads`, `recentChanges`) are omitted entirely when they carry no actionable data. `vulnerabilities` is emitted whenever the backend reports a numeric vulnerability count, including `total: 0`, so callers can distinguish "no active vulnerabilities in latest" from unavailable data; when present, recent advisory severity values include a CVSS-banded `severityLabel` (`critical` ≥9, `high` ≥7, `medium` ≥4, else `low`) for agent convenience.

**No quickstart.** `pkg_info` intentionally does not expose install commands or usage snippets. Those values are package-manager-specific and not verified enough for dependency evaluation. Use `docs_*`, `search`, or `get_example` when usage guidance is needed.

**Validation.** The MCP schema is permissive (`registry: z.string()`, `package_name: z.string()`) — validation happens in-handler via `buildPackageSummaryParams`, producing the same structured `{error, code, retryable}` envelope as CLI. Raw Zod errors are never surfaced to agents.

**Always latest.** The query exposes no `version` input because the upstream `packageSummary` resolver always returns the latest published version. The CLI `githits pkg info` rejects `<spec>@<version>` with `INVALID_ARGUMENT` rather than silently swapping — a silent-swap would break security-testing workflows that pin to an older vulnerable release.

`pkg_info` shares its envelope builder, text formatter, and error classifier with the CLI `githits pkg info` command via `src/shared/package-summary-request.ts`, `src/shared/package-summary-response.ts`, and `src/shared/package-intelligence-error-map.ts`. The parity test (`src/tools/package-summary-parity.test.ts`) passes `format: "json"` and asserts `toEqual` between CLI `--json` and MCP JSON output for service-sourced fixtures, and `toMatchObject` for the `INVALID_ARGUMENT` fixture where surface-specific error text is acceptable.

### `pkg_vulns` response shape

**Filter-aware summary.** `min_severity`, `advisory_scope`, and `include_withdrawn` are passed straight through to the service. `summary.total` always means advisories affecting the inspected version, preserving the risk signal even when `advisory_scope:"non_affecting"` returns only historical rows. `advisory_scope` defaults to `affected`; `non_affecting` lists historical package advisories that do not affect the inspected version; `all` lists affected + historical rows. Explicit filters and non-default scope are echoed as top-level `filter` in JSON (`{minSeverity?, advisoryScope?, includeWithdrawn?: true}`) and as `Filter` / `Scope` lines in text. Defaults and explicit `include_withdrawn:false` do not echo.

**Compact text vs verbose/JSON.** Default text caps the advisory list at 5 rendered rows and appends a surface-native hint (`use -v` on CLI, `use verbose=true or format=json` on MCP). Hidden-advisory counts are derived from the rendered advisory array, not backend summary counts. `--verbose` / `verbose:true` shows all advisory rows and full detail rows. JSON is never capped and ignores `verbose`.

**Partitioning buckets.** Advisories with `isMalicious: true` count **only** under `summary.bySeverity.malware`; severity bands (`critical`/`high`/`medium`/`low`) count non-malicious advisories with a positive CVSS score; non-malicious advisories with no score count under `summary.bySeverity.unrated`. Every returned advisory lands in exactly one bucket. For default affected scope, the bucket sum equals `summary.total`. For `non_affecting` / `all`, the bucket sum describes the selected advisory rows while `summary.total` still describes affected-version risk. The malware bucket sorts to the top of the advisory list regardless of score. The `unrated` bucket keeps Rust / PyPI packages with missing CVSS values explicit.

**Alias-cluster dedup.** Some registries (most visibly Crates) return the GHSA-prefixed and the RUSTSEC-prefixed entry for the same underlying vulnerability as separate advisories, cross-linked via `aliases[]`. The shared envelope builder unions clusters over `id ∪ aliases[]`, picks one canonical advisory per cluster (severity-bearing entries first, then `GHSA-*` over `RUSTSEC-*`, then lexicographic `id` ascending), and merges the rest under the canonical's `aliases`. `affectedRanges`, `fixedIn`, malware/withdrawn flags, and the latest `modifiedAt` are unioned across the cluster; a withdrawal only sticks if every cluster member is withdrawn. `summary.total` and `summary.bySeverity` are recomputed from the deduped list so the partition invariant holds. This is a client-side mitigation for backend issue B3 (https://app.githits.com — eval report 2026-04-28); remove `dedupAdvisoriesByAlias` from `src/shared/package-vulnerabilities-response.ts` once the backend dedups upstream.

**Version validation.** `pkg_vulns` accepts canonical package versions only. Tag-style refs with a leading `v` (for example `v4.18.0`) are rejected client-side with `INVALID_ARGUMENT` before the backend call. This avoids the current production backend's unhelpful generic error for that input shape. This is intentionally narrow: proper ecosystem-aware version parsing and typed invalid-version errors belong in the backend, not in ad hoc CLI normalization rules.

**Typed `VERSION_NOT_FOUND`.** Mirrors the code-nav precedent: a dedicated `PackageIntelligenceVersionNotFoundError` carries structured `{ packageName, requestedVersion, availableVersions? }` fields. Classifier routes it to `VERSION_NOT_FOUND` with a structured `details` block. When the service only gets a generic "no matching version" error, it promotes that into the typed error so CLI / MCP surfaces still render an actionable envelope. `availableVersions` remains undefined in the fallback path unless the service supplied them.

**Omission rules.** Null scalars omitted; empty arrays dropped; zero-count `bySeverity` keys dropped; the `bySeverity` block itself dropped when `total === 0`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Registry coverage.** npm, PyPI, Hex, Crates, NuGet, Maven, Packagist, RubyGems, and Go have vulnerability data. vcpkg and Zig are rejected client-side with a tool-specific message (`pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, and go. Got: ${registry}.`) — rejection predicate lives in `src/shared/package-vulnerabilities-request.ts` rather than the shared registry module, since it is a tool-specific capability matrix.

`pkg_vulns` shares its envelope builder and text formatter with the CLI `githits pkg vulns` command via `src/shared/package-vulnerabilities-request.ts` and `src/shared/package-vulnerabilities-response.ts`. MCP defaults to compact text and uses `format: "json"` for structured output. The shared text formatter is surface-aware so MCP hints never mention CLI flags. The parity test (`src/tools/package-vulnerabilities-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across the service-sourced success/filter/typed-error fixtures, and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT` fixtures such as unsupported registries and tag-style `v`-prefixed versions.

### `pkg_deps` response shape

**Data-first envelope.** `runtime`, `groups`, and `transitive` are three independent blocks emitted based on what the backend returned and what the caller asked for, not on additional caller flags. Agents branch on the envelope's shape rather than inferring from inputs.

- `runtime` block: emitted whenever the service returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages). `runtime.count` is computed client-side from `runtime.items.length`. The source `direct[]` is always runtime-only: dev / peer / build / optional deps live in the groups block instead.
- `groups` block: emitted when the caller requested a lifecycle view and the service returned `dependencyGroups` — including when a lifecycle filter matched nothing (`{items: []}`). Omitted when the service returned `dependencyGroups: null` (e.g. on zero-dep packages), or when the caller used the default runtime view. Each group carries its members under `items`, matching `runtime.items` so dependency lists share one key throughout the envelope. Duplicate `{name, constraint}` entries inside a group are preserved verbatim; the terminal formatter dedups for scannability but JSON is lossless.
- `transitive` block: emitted only when the caller set `include_transitive: true`. Carries aggregates (`edges`, `uniquePackages`, `depth?`) plus preprocessed arrays: `packages[]` (each `{name, version, importers[]}` with importer name / version / constraint pulled from the service graph), `conflicts[]` (typed `{name, requiredVersions}`), `circularDependencies[]` (typed `{cycle: string[]}`). The raw graph is not exposed — the preprocessing happens in the envelope builder so agents consume the same signal the terminal `--verbose` renderer reads without re-implementing the decoder.

**`filter.lifecycles` echo.** Canonicalised lowercase array (deduplicated, sorted in canonical display order: `runtime` → `development` → `build` → `peer` → `optional`). Emitted only when the caller supplied a non-empty lifecycle input. Matches what the backend actually received — the raw CSV string is not echoed.

**Lifecycle scope.** `lifecycle: [String!]` on the wire filters `dependencyGroups.groups` only; `direct[]` and `transitive[]` are returned regardless. Documented on the backend schema and verified in live smoke.

**Typed dependency graph projection.** Backend exposes typed `dependencyGraph`, `dependencyConflicts`, `circularDependencyCycles`, and `environmentMarkers`; `pkg_deps` consumes those typed fields and projects them into a lean agent-facing envelope. Deprecated raw fields (`dag`, `conflicts`, `circularDependencies`, `environmentConstraints`) are intentionally not queried. The raw graph is deliberately not exposed by this tool.

**Registry coverage.** npm, PyPI, Hex, Crates, vcpkg, Zig, RubyGems, and Go support the `packageDependencies` query. NuGet / Maven / Packagist are rejected client-side with a tool-specific message (`pkg deps only supports npm, pypi, hex, crates, vcpkg, zig, rubygems, and go. Got: ${registry}.`). Predicate lives in `src/shared/package-dependencies-request.ts`.

**Version validation.** Same rule as `pkg_vulns`: tag-style `v`-prefixed inputs are rejected client-side with `INVALID_ARGUMENT` before the backend call.

**MCP schema notes.** Permissive (`registry: z.string()`, `package_name: z.string()`, …) with validation in-handler via `buildPackageDependenciesParams`. Deliberately no `include_groups` input — with the data-first envelope emitting `groups` unconditionally when the backend returns `dependencyGroups`, the flag would be a silently ignored no-op. Neither the MCP surface nor the CLI applies a depth default: `max_depth` / `--depth` is optional and, when omitted, the backend's full-graph traversal is used. `include_importers` requires `include_transitive: true`; `max_depth` and CLI `--depth` require the transitive view — passing them alone is rejected with `INVALID_ARGUMENT` rather than silently ignored.

`pkg_deps` shares its envelope builder and text formatter with the CLI `githits pkg deps` command via `src/shared/package-dependencies-request.ts` and `src/shared/package-dependencies-response.ts`. MCP defaults to compact text and uses MCP-native hints such as `pass lifecycle="all"`; CLI hints remain CLI-native. The parity test (`src/tools/package-dependencies-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across every service-sourced success / error fixture (runtime, zero-dep, full-view, optional-lifecycle, multi-lifecycle, filter-matched-nothing, Crates-target-cfg dedup round-trip, transitive, versioned match / diff, NOT_FOUND, VERSION_NOT_FOUND, BACKEND_ERROR), and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT` (unsupported registry, tag-style version, unknown lifecycle).

### `pkg_changelog` response shape

**Data-first envelope.** The top level carries addressing (`registry` + `name` for spec addressing, or `repoUrl` for repo-URL addressing), optional `source` (`"releases"` / `"changelog_file"` / `"hexdocs"`) when a concrete changelog source exists, and `mode` (`"latest"` or `"range"`). Entries live under `entries: { count, items }` — matching the `{count, items}` shape used by `pkg_deps.runtime`. `count` is computed client-side from `items.length`, so the invariant holds regardless of backend drift.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept in the envelope even when `null` so agents can write `items.map(e => e.version)` without guarding; every other nullable field is stripped when absent. `body` is additionally stripped when the caller set `include_bodies: false`. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope in v1 — revisit via agent feedback.

**Dual addressing (`registry` + `package_name` XOR `repo_url`).** `pkg_changelog` is the only metadata-side MCP tool with dual addressing. `pkg_info` / `pkg_vulns` / `pkg_deps` all accept only `registry` + `package_name` because they are registry-metadata lookups without repo-URL alternatives. `pkg_changelog` is intrinsically repo-level — its sources are GitHub Releases, CHANGELOG.md, and HexDocs — so `repoUrl` is a peer addressing mode, not a bolt-on. Future tool authors should not cargo-cult the asymmetry without reading this rationale.

**Mode selection.** `from_version` triggers range mode (returns every entry in `[fromVersion, toVersion]` with no cap). Latest mode is the default, capped by `limit` (1–50, backend default 10). `from_version` + `limit` is rejected client-side with `INVALID_ARGUMENT` rather than silently routed to one mode.

**`include_bodies` lever and body previews.** Release bodies on large packages (Kubernetes, Node) can run 10 KB+ per entry; a 100-entry range could produce a multi-hundred-KB envelope. `include_bodies: false` opts out explicitly in JSON and text — not silent truncation. Other fields (version / normalizedVersion / publishedAt / htmlUrl) remain so agents still get the release timeline. Text mode caps each body preview at 10 lines by default. MCP adds text-only `body_lines` (1-50) to tune the cap and `verbose:true` to uncap text bodies; both are ignored for JSON. `verbose:true` conflicts with `include_bodies:false` and `body_lines`. CLI terminal output uses the same default preview cap and gives the CLI-native `--verbose` hint; `--verbose` uncaps terminal previews but does not change `--json` output.

**`filter.*` echo.** `filter` is emitted only when the caller explicitly supplied at least one of `from_version`, `to_version`, `limit`, or `git_ref`. Backend-default `limit: 10` / `toVersion: <latest>` is never echoed. The request builder tracks explicit-vs-defaulted via an `explicitFilterFields` set so defaults don't round-trip as caller intent.

**Version validation.** Same rule as `pkg_vulns` / `pkg_deps`: tag-style `v`-prefixed inputs on `from_version` / `to_version` are rejected client-side with `INVALID_ARGUMENT`. `<spec>@<version>` is also rejected — the `pkg changelog` family has no single-version query, and silently remapping to `to_version` would be a client-invented semantic shift. Hint text redirects callers to `--to` / `to_version`.

**NOT_FOUND semantics.** Backend `source === null` or `source === ""` means there is no concrete changelog source for the returned package versions. If entries are present, this is a success and the envelope omits `source`; terminal output labels it `source: package versions`. If both source and entries are absent, the service promotes the response to `PackageIntelligenceChangelogSourceNotFoundError`, which the shared classifier routes to the `NOT_FOUND` envelope with a message naming the sources that were tried. Empty `entries.items: []` with a valid `source` is also a success — "no entries in this range" is a legitimate neutral outcome.

**Overlap with `pkg_info`.** `pkg_info` already surfaces a short-form `recentChanges` block (from the backend's `latestChangelogs` field on `PackageSummaryResult`). For a quick "what shipped recently" glance embedded in a package overview, use `pkg_info`. For the full range-capable, body-rich, `include_bodies`-toggleable changelog with `--no-body` timeline mode and repo-URL addressing, use `pkg_changelog`.

`pkg_changelog` shares its envelope builder and text formatter with the CLI `githits pkg changelog` command via `src/shared/package-changelog-request.ts` and `src/shared/package-changelog-response.ts`. MCP defaults to compact text with MCP-native `verbose=true`, `body_lines=<n>`, and `format="json"` hints for full bodies. The parity test (`src/tools/package-changelog-parity.test.ts`) passes `format: "json"`, asserts `toEqual` across every service-sourced success / error fixture (happy latest, range mode, repo-URL addressing, no-source package-version entries, `--no-body` / `include_bodies: false`, default bodies, empty entries, NOT_FOUND, PackageIntelligenceTargetNotFoundError, VERSION_NOT_FOUND, BACKEND_ERROR), and uses `toMatchObject` for builder-sourced `INVALID_ARGUMENT`.

### `code_files` / `code_read` / `code_grep` response shapes

These three indexed tools share an addressing and lifecycle contract (documented below) and then each projects its own data-first envelope. All three reuse the shipped `codeTargetSchema` + `resolveCodeTarget` from `src/tools/code-navigation-shared.ts` — no parallel addressing module.

**`code_files` envelope**: `{registry?|repoUrl?+gitRef?, total, hasMore, indexedVersion?, resolution?, files: [{path, name?, language?, fileType?, byteSize?}], hint?, filter?}`. `fileType` values preserve the service vocabulary (`CONFIG`, `SOURCE`, `DOC`, `TEST`). `total` is capped at returned count when `hasMore: true` — the terminal formatter renders `N+ files` in that case to avoid misleading users. `filter` echoes only explicit caller filters (`path`, `pathPrefix`, `globs`, `extensions`, `fileTypes`, `languages`, file-intent filters, booleans, and `limit`); default limit (200) never round-trips.

**`code_read` envelope**: `{registry?|repoUrl?+gitRef?, path, language?, totalLines?, startLine?, endLine?, content?, isBinary?, hint?}`. `path` (not `filePath`) so the key matches `code_files.files[].path` and `code_grep.filter.path` when exact-file grep is used. Binary files set `isBinary: true` and **omit** `content` (not `null`); agents branch on the flag. `hint` is emitted only when the MCP span cap actually truncated the response — see "code_read span cap" below.

**`code_grep` envelope**: `{registry?|name?|repoUrl?+gitRef?, pattern, patternType?, caseSensitive?, matches: [{filePath, line, matchStartByte, matchEndByte, lineContent, contextBefore?, contextAfter?, fileContentHash?, fileIntent?, symbol?}], nextCursor?, hasMore, truncatedReason?, filesScanned, filesInScope, binaryFilesSkipped?, filesTooLargeSkipped?, totalMatches, uniqueFilesMatched, indexedVersion?, resolution?, filter?}`. Default-valued fields (`patternType: literal`, `caseSensitive: false`, zero skipped counters, `truncatedReason: none`) are omitted. `filter` echoes only explicit caller filters. Match entries carry `filePath` so grep output chains directly into `code_read`.

### Indexing lifecycle (shared across `code_files`, `code_read`, `code_grep`)

All three code-navigation tools share the same indexing-retry contract. The state can arrive through either an error response or a success sentinel (`codeIndexState: "INDEXING"`), and the service layer collapses both to the same typed `CodeNavigationIndexingError` before the envelope builder runs. Agents therefore never see a `codeIndexState` field in a success envelope; they branch on the error path instead.

**`INDEXING` error envelope**:
```json
{
  "error": "Target is still indexing. …",
  "code": "INDEXING",
  "retryable": true,
  "details": {
    "indexingRef": "ref_…",
    "availableVersions": [{"version": "4.21.0", "ref": "v4.21.0"}]
  }
}
```

`details.availableVersions` is populated when the backend returned a list of already-indexed versions alongside the sentinel. Agents can pick one to retry against immediately without waiting. `code_read` / `fetchCodeContext` on the backend doesn't emit `availableVersions` on INDEXING responses, so its error detail carries only `indexingRef` — the MCP description calls this out so agents know to rely on the `wait_timeout_ms` retry path.

**Retry default**: `DEFAULT_WAIT_TIMEOUT_MS = 20_000` (shared, defined in `src/shared/code-navigation-defaults.ts`). Applied inside each request builder so both CLI and MCP surfaces get the same default by construction. CLI's `--wait <ms>` and MCP's `wait_timeout_ms` override.

**`FILE_NOT_FOUND` vs `NOT_FOUND`**: `code_read` / `code_grep` can hit "path doesn't resolve" errors when an exact path scope is invalid. The classifier is pre-wired to emit `FILE_NOT_FOUND` when the backend sends `extensions.code: "FILE_NOT_FOUND"`, but today the backend emits generic `NOT_FOUND` for both "package missing" and "path missing". The distinction is filed upstream. CLI terminal output for `code read` / `code grep` emits the hint "Use `code files` to list available paths." on both codes so users have an actionable next step regardless of classification.

**`code_read` span cap (MCP-only)**: real session traces showed agents requesting 300-600 line windows (and occasional unbounded full-file reads) which dominated context cost. The MCP surface caps each `code_read` call at `MCP_READ_MAX_SPAN` (150 lines, defined in `src/tools/read-file.ts`). The cap is enforced *before* the backend call — `deriveBoundedRange` clamps the request, so the service does not transfer bytes that will be discarded.

The `hint` field is emitted only when the cap *actually truncated* the response — i.e., the returned range comes up short of available content. `shouldEmitCappedHint` (in `src/tools/read-file.ts`) suppresses the hint in three cases the agent doesn't need it: (a) the cap clamp didn't fire (caller's range was already within the cap); (b) the file fits within the cap, so the response is the whole file even though the request was clamped; (c) the returned range reaches end of file. Binary files always skip the hint. When emitted, the hint reads from `payload.startLine` / `endLine` / `totalLines` (the actual returned range, not the pre-clamp request) and includes the original request for the agent to learn from. The CLI command `githits code read` does not apply the cap; humans piping whole files to disk continue to work.

## Text response format (`format: "text-v1"`)

`get_example`, `search_language`, `search`, `search_status`, `docs_list`, `docs_read`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `code_files`, `code_read`, and `code_grep` accept a `format` parameter on the MCP surface. The default is `"text-v1"` — a compact line-oriented format that drops JSON scaffolding to stay lean in agent context. Programmatic callers (parity tests, scripts that parse responses) pass `format: "json"` explicitly. `"text"` is accepted as an alias for `"text-v1"` to keep agent prompts terse.

**Why text-v1 default.** A 10-hit `search` JSON envelope runs 5–7 KB after compaction; the same hits in `text-v1` land around 3–4 KB. The savings come from dropped quoting, dropped key repetition, and dropped fields that an agent does not need at the per-call decision point (highlights byte offsets, repeated locator scaffolding). The token budget belongs to the agent's reasoning, not to JSON structure.

**Format stability.** The text format is a public contract, locked with snapshot-style tests (`src/shared/unified-search-text.test.ts`, `src/shared/list-files-text.test.ts`). The `text-v1` version tag exists so we can evolve the format without silently breaking downstream parsers — future incompatible changes ship as `text-v2`.

**ASCII-only.** Separators are ` | `; ellipsis is `...`; no box-drawing or Latin-1 punctuation. Tokenizer behavior for multi-byte UTF-8 varies across BPE variants, and the format runs into Claude, Codex CLI, OpenCode, Cline, Cursor, etc. — ASCII keeps it predictable.

**Example-search anatomy.** `get_example` text mode returns markdown directly, followed by `solution_id: <id>` when the REST response includes an app URL. This avoids JSON-wrapped markdown while preserving the `feedback` workflow. `search_language` text mode returns one match per line as `name (Display Name) aliases: a, b`; agents should pass the `name` value to `get_example.language`.

**Package metadata anatomy.** `pkg_info`, `pkg_vulns`, `pkg_deps`, and `pkg_changelog` text mode reuse the shared no-color terminal formatters but inject MCP-native hints. `pkg_deps` hides non-runtime groups by default and says `pass lifecycle="all"` when groups exist. `pkg_changelog` caps body previews and says `pass verbose=true`, `body_lines=<n>`, or `format="json"` when text omitted lines. Package tools keep JSON errors in all formats because agents can reliably branch on `{error, code, retryable, details?}`.

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
[Truncated: limit. Pass narrower path/path_prefix/globs or increase max_matches.]
[More matches available. Pass cursor=<token> for the next page.]
```

Standard grep -A/-B notation: `:` separator on match lines, `-` on context lines. Non-adjacent blocks within the same file are separated by `--`. The `(<count>)` after the file path is the per-file match count; the header sums across files. Header flags (`regex`, `case-sensitive`) appear only when the request used them. Scope filters are not echoed in text mode; agents already have the tool call arguments in context, and `format: "json"` preserves exact request/filter metadata for programmatic use. Match-line offsets, file content hashes, file intent, and symbol metadata are dropped in text mode — agents that need them can request `format: "json"`.

**Errors in text mode.** `search` errors render as text in `text-v1` mode: `search | ERROR | code=<CODE> [| retryable]\n<message>` followed by an indented `details:` block when present. `code_files` and `code_grep` keep errors JSON-formatted in either mode for now — revisit if agent feedback warrants.

## Server instructions

The MCP server advertises a short, cross-tool orientation via the protocol's server-level `instructions` field. This is distinct from per-tool `description` text: instructions cover rationale, workflow glue, and decisions that span multiple tools, while per-tool descriptions remain the source of truth for arguments, output shape, and tool-specific constraints.

`src/commands/mcp-instructions.ts` owns two sections:

- **Core block** — always loaded. Introduces GitHits, expands trigger criteria to include comparative cross-OSS questions and "how does X actually implement this" archaeology, and walks through the `get_example` / `search_language` / `feedback` workflow.
- **Package-tools block** — always appended. Contains a preamble plus one bullet per package/code tool, plus three cross-tool tips:
  - **Reference-first, content-second**: locate symbols and lines first, then read narrowly with `code_read` using `start_line` / `end_line` windows around the match.
  - **Multi-turn discovery**: anticipate 3+ calls? Delegate to a sub-task / sub-agent and ask for a compact synthesis rather than pulling raw `code_read` / `code_files` output into the main conversation.
  - **Tool-selection tip**: contrasts `get_example` vs unified `search` vs `code_grep`/`code_read`.

When adding a new package tool, extend the composer with a one-line bullet (`\`tool_name\` — one-sentence purpose`) in the same PR that registers the tool. Keep the bullet terse; argument and response detail belong in the tool's `description`. `mcp-instructions.test.ts` enforces both directions of the mention↔registration invariant.

## Entry Points

The `githits mcp` command has two modes:

- **`githits mcp`** (no subcommand) — Detects TTY. When run interactively, shows setup instructions for configuring AI assistants. When run via stdio (non-TTY), starts the MCP server.
- **`githits mcp start`** — Always starts the MCP server. Use this in MCP configuration files.

The MCP server starts without a synchronous auth check; auth errors surface per-tool-call inside each tool's handler. See `src/commands/mcp.ts` for the TTY detection logic.

## Architecture

```
MCP SDK Server (src/commands/mcp.ts)
  └─ registers tools using deps.githitsService from container
       └─ each tool: createXxxTool(service)
            └─ ToolDefinition { name, description, schema, handler, annotations? }
                 └─ handler calls GitHitsService or CodeNavigationService methods
                      └─ service implementation makes HTTP calls
```

The layering is intentional:

- **Tool definitions** (`src/tools/*.ts`) own the MCP contract: names, descriptions, schemas, and response formatting
- **GitHitsService / CodeNavigationService** own the HTTP transport: endpoints, headers, error mapping
- **MCP server setup** (`src/commands/mcp.ts`) owns wiring: creates the service, registers tools with the MCP SDK

This separation means tool logic can be tested without HTTP calls, and service logic can be tested without MCP SDK dependencies.

## Tool Definition Pattern

Each tool follows the same structure. See `src/tools/search.ts` for the canonical example:

1. Define an `Args` interface for the handler input
2. Define a `schema` object with Zod validators (these become the MCP tool's input schema)
3. Define a `DESCRIPTION` constant (must match the backend's tool description)
4. Export a `createXxxTool(service)` factory function returning a `ToolDefinition`
5. The handler calls the service and wraps the result with `textResult()` or lets `withErrorHandling()` catch errors

> **Descriptions are kept in sync with the backend MCP server.** Changes happen through coordinated PRs — the frontend may lead wording, but the backend mirrors before public release. The description is what LLM clients see when deciding whether to use a tool; even small wording differences could change tool selection behaviour.

## Adding a New Tool

When the backend adds a new tool, follow this checklist:

1. **Create tool file** — `src/tools/new-tool.ts` with `Args` interface, `schema`, `DESCRIPTION`, and `createNewTool(service)` factory
2. **Add service method** — Add the method to `GitHitsService` interface and `GitHitsServiceImpl` in `src/services/githits-service.ts`
3. **Export from tools barrel** — Add `export { createNewTool } from "./new-tool.js"` to `src/tools/index.ts`
4. **Register in MCP server** — In `src/commands/mcp.ts`:
   - Add the tool name to the `ToolName` type union
   - Import and add the factory to `TOOL_FACTORIES`
   - Add the name to `ALL_TOOLS`
   - Update the "Available tools" text in both command descriptions
5. **Add tests** — Create `src/tools/new-tool.test.ts` with metadata, service call, success, and error path tests
6. **Update mock service** — Add the new method to `createMockGitHitsService()` in `src/services/test-helpers.ts`
7. **Add CLI command** — Create a corresponding CLI command in `src/commands/` (see `docs/implementation/cli-commands.md`)

## Behavioral Differences from Backend

While the contract (names, params, descriptions) is identical, some implementation details differ:

| Aspect | Backend | CLI |
|---|---|---|
| `search_language` | Server-side search via `mcp_service.search_language()` | Client-side substring filter: fetches all languages from `/languages`, filters locally by name/display_name/aliases using case-insensitive `includes()` |
| `get_example` response | Backend builds markdown from structured `McpSearchResponse` | CLI receives pre-formatted markdown from REST `/search` endpoint |
| unified `search` response | Backend returns structured indexed-search hits and follow-up refs | CLI and MCP share JSON envelope builders over the code-navigation service result |
| `feedback` response | Backend returns different messages for accepted/rejected | CLI hard-codes "Feedback submitted successfully" on success; the REST API response body is not used for the message |
| Error handling | Catches specific exception types, logs to PostHog | Uses `withErrorHandling()` wrapper for consistent `ToolResult` errors |

These differences exist because the CLI hits the REST API (which does its own formatting) rather than calling internal backend services directly.

## Testing Tools

Each tool has a co-located test file (for example `src/tools/get-example.test.ts`, `src/tools/search.test.ts`, `src/tools/search-status.test.ts`). Tests use `createMockGitHitsService()` or `createMockCodeNavigationService()` from `src/services/test-helpers.ts` to mock the service layer.

Test categories for each tool:
- **Metadata** — tool name and description are correct
- **Service calls** — correct parameters passed to the service
- **Success path** — result formatted correctly
- **Error path** — errors wrapped in `ToolResult` with `isError: true`

See `docs/guidelines/TESTING.md` for the full testing pattern.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/tools/get-example.ts` | Example-search MCP tool definition |
| `src/tools/search.ts` | Unified indexed-search MCP tool definition |
| `src/tools/search-status.ts` | Follow-up MCP tool for incomplete unified searches |
| `src/tools/search-language.ts` | Tool with client-side filtering logic |
| `src/tools/feedback.ts` | Simplest tool (direct service delegation) |
| `src/tools/types.ts` | `ToolDefinition` interface, `textResult`/`errorResult` helpers |
| `src/tools/shared.ts` | `withErrorHandling()` wrapper |
| `src/services/test-helpers.ts` | `createMockGitHitsService()` and `createMockCodeNavigationService()` factories |
| `src/commands/mcp.ts` | Tool registration, MCP server setup, and TTY detection |
| `src/services/githits-service.ts` | REST API client for example search, languages, and feedback |
| `src/services/code-navigation-service.ts` | Package/source service client for unified `search`, `search_status`, `code_files`, `code_read`, and `code_grep` |
| `src/shared/language-filter.ts` | Pure `filterLanguages()` function shared between MCP tool and CLI |

## Related Documentation

- Backend tool definitions: `githits-backend/githits/api/mcp/server.py`
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- [`cli-commands.md`](./cli-commands.md) — CLI commands that mirror these MCP tools
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — service isolation and testing patterns
