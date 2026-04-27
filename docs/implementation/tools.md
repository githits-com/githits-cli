# MCP Tools

## Purpose

The CLI exposes MCP tools that mirror the backend's MCP server. This document explains the tool architecture, the parity requirement with the backend, and how to add or modify tools.

## Background

GitHits has two MCP server implementations:

- **Backend** (`githits-backend`) — Python/FastMCP, runs as a hosted service at `mcp.githits.com`
- **CLI** (`githits-cli`) — TypeScript/MCP SDK, runs locally via `githits mcp start`

Both expose the same tools with identical names, parameters, and descriptions. The backend handles auth, analytics, and AI orchestration server-side. The CLI delegates to the REST API, which is a simpler path that still benefits from the backend's processing pipeline.

> **Tools must stay in sync with the backend.** When the backend adds or modifies a tool, the CLI must be updated to match. The tool names, parameter names, descriptions, and schema constraints should be identical across both implementations.

## Current Tools

| Tool | Parameters | Description |
|---|---|---|
| `get_example` | `query`, `language?`, `license_mode?` | Search for canonical code examples. Returns markdown-formatted results. If `language` is omitted, the backend infers it from the query. |
| `search_language` | `query` | Find supported programming language names before searching. |
| `feedback` | `solution_id`, `accepted`, `feedback_text?` | Submit feedback on a search result to improve quality. |
| `search` | `query`, `target?`, `targets?`, `sources?`, `category?`, `kind?`, `path_prefix?`, `file_intent?`, `public_only?`, `name?`, `language?`, `allow_partial_results?`, `limit?`, `offset?`, `wait_timeout_ms?` | Unified indexed dependency/repository discovery search across code, docs, and symbols. Omit `file_intent` to search across all intents; set it only when you want to narrow results, and note that some sources may ignore it and report that in `sourceStatus`. Prefer `sources:["symbol"]` for symbol-shaped unified search. Complete-by-default; set `allow_partial_results: true` to receive available partial hits while indexing continues. |
| `search_status` | `search_ref` | Check progress, fetch partial hits when the original request used `allow_partial_results: true`, or fetch final results for a prior unified search. |
| `pkg_info` | `registry`, `package_name` | Package overview: latest version, license, description, repository, downloads, GitHub metadata, install command, and known vulnerabilities. Always returns the latest published version. |
| `pkg_vulns` | `registry`, `package_name`, `version?`, `min_severity?`, `include_withdrawn?` | Known vulnerabilities for a package on npm, PyPI, Hex, or Crates. Count summary, per-advisory OSV ID + severity + affected/fix ranges, and upgrade paths. Malware is surfaced in a disjoint bucket. |
| `pkg_deps` | `registry`, `package_name`, `version?`, `lifecycle?`, `include_transitive?`, `include_importers?`, `max_depth?` | Direct runtime dependency list (each `{name, version, constraint}` — the backend resolves each constraint to a concrete version) plus, when the backend has them, structured groups for dev / peer / build / optional with registry-specific condition metadata (PyPI extras, Crates features). Optional transitive block with aggregate edge counts, the preprocessed install footprint as `{name, version}`, typed conflicts and circular-dependency cycles; opt into per-package importer provenance with `include_importers`. |
| `pkg_changelog` | `registry?`, `package_name?`, `repo_url?`, `from_version?`, `to_version?`, `limit?`, `git_ref?`, `include_bodies?` | Release notes or changelog entries for a package or GitHub repo. Default latest mode returns the ten most recent entries; `from_version` switches to range mode (no count cap). Dual addressing (spec vs repo URL) mutually exclusive. Response always includes `source` (`"releases"` / `"changelog_file"` / `"hexdocs"`), `mode` (`"latest"` / `"range"`), and `entries: { count, items }` with full markdown bodies by default; set `include_bodies: false` for a lean version / date / URL timeline. |
| `code_files` | `target`, `path_prefix?`, `limit?`, `wait_timeout_ms?` | List files in an indexed dependency. Returns `{total, hasMore, files: [{path, name, language, fileType, byteSize}], resolution, indexedVersion}`. Dual addressing via `target.registry + target.package_name` (spec) or `target.repo_url + target.git_ref` (repo). `path_prefix` is a literal directory prefix — NOT a glob (`*.ts` won't match); glob / pattern filtering is an upstream enhancement. Emits an `INDEXING` error envelope when the dependency is being indexed on-demand — retry with a longer `wait_timeout_ms` or pick a version from `details.availableVersions`. |
| `code_read` | `target`, `path`, `start_line?`, `end_line?`, `wait_timeout_ms?` | Read a file from an indexed dependency. Default full file; use `start_line` / `end_line` for a bounded range. Binary files set `isBinary: true` and omit `content` — agents branch on the flag. On `NOT_FOUND` / `FILE_NOT_FOUND` call `code_files` to discover the actual path. |
| `code_grep` | `target`, `pattern`, `path?`, `path_prefix?`, `globs?`, `extensions?`, `pattern_type?`, `case_sensitive?`, `exclude_doc_files?`, `exclude_test_files?`, `context_lines?`, `context_lines_before?`, `context_lines_after?`, `max_matches?`, `max_matches_per_file?`, `cursor?`, `symbol_fields?`, `wait_timeout_ms?` | Deterministic text grep over indexed dependency or repository source. Defaults to literal, ASCII case-insensitive matching across the whole target; non-ASCII letters match case-sensitively. Narrow with `path`, `path_prefix`, `globs`, or `extensions`. `pattern_type: "regex"` uses RE2 syntax; whole-target regexes must include at least one literal substring for index pre-filtering. Returns matches plus pagination and scan counters; `symbol_fields` hydrates enclosing symbol metadata on each match. |

`search`, `search_status`, `pkg_info`, `pkg_vulns`, `pkg_deps`, `pkg_changelog`, `code_files`, `code_read`, and `code_grep` are only registered when the current token explicitly carries the `code_navigation` feature flag. The package/source service URL defaults to `https://pkgseer.dev` in the default production environment and can be overridden via `GITHITS_CODE_NAV_URL` for local development.

**Unified `search` query syntax.** The `search.query` field is the backend discovery query syntax, not a raw pass-through to a per-source search engine. It supports implicit `AND`, uppercase `OR`, parentheses, unary `-`, quoted phrases, semantic qualifiers (`kind:`, `category:`, `path:`, `lang:`, `name:`, `intent:`), and routing qualifiers (`registry:`, `package:`, `version:`, `repo:`). The backend parses the query once and compiles it per source. Structured `name` and `language` inputs are compiled into `name:` / `lang:` qualifiers and AND-ed with the query before sending. Per-source support, ignored features, and incompatibilities are reported in `sourceStatus`.

### `pkg_info` response shape

**Hand-crafted JSON envelope.** `pkg_info` returns a lean JSON payload designed for agent token efficiency. Fields that do not add caller value are deliberately omitted. Null scalars are omitted; blocks (`github`, `vulnerabilities`, `downloads`, `recentChanges`) are omitted entirely when they carry no actionable data. `vulnerabilities` is omitted when `total === 0` or missing; when present, severity values include a CVSS-banded `severityLabel` (`critical` ≥9, `high` ≥7, `medium` ≥4, else `low`) for agent convenience.

**Validation.** The MCP schema is permissive (`registry: z.string()`, `package_name: z.string()`) — validation happens in-handler via `buildPackageSummaryParams`, producing the same structured `{error, code, retryable}` envelope as CLI. Raw Zod errors are never surfaced to agents.

**Always latest.** The query exposes no `version` input because the upstream `packageSummary` resolver always returns the latest published version. The CLI `githits pkg info` rejects `<spec>@<version>` with `INVALID_ARGUMENT` rather than silently swapping — a silent-swap would break security-testing workflows that pin to an older vulnerable release.

`pkg_info` shares its envelope builder, terminal formatter, and error classifier with the CLI `githits pkg info` command via `src/shared/package-summary-request.ts`, `src/shared/package-summary-response.ts`, and `src/shared/package-intelligence-error-map.ts`. The parity test (`src/tools/package-summary-parity.test.ts`) asserts `toEqual` between CLI `--json` and MCP `content[0].text` for service-sourced fixtures, and `toMatchObject` for the `INVALID_ARGUMENT` fixture where surface-specific error text is acceptable.

### `pkg_vulns` response shape

**Filter-aware summary.** `min_severity` and `include_withdrawn` are passed straight through to the service. The returned `vulnerabilityCount` reflects the filtered set — there is no client-side filtering and no `summary.filtered` dual-block. Callers wanting the unfiltered view omit the flag.

**Partitioning buckets.** Advisories with `isMalicious: true` count **only** under `summary.bySeverity.malware`; severity bands (`critical`/`high`/`medium`/`low`) count non-malicious advisories with a positive CVSS score; non-malicious advisories with no score count under `summary.bySeverity.unrated`. Every returned advisory lands in exactly one bucket — the client-side guarantee is `MALWARE + crit + high + medium + low + unrated = advisories.length`. The sum also equals `summary.total` whenever the backend keeps `vulnerabilityCount` and `vulnerabilities[]` consistent (the expected case on all shipped registries). The malware bucket sorts to the top of the advisory list regardless of score. The `unrated` bucket ensures the terminal breakdown line reconciles with the header total on Rust / PyPI packages where a non-trivial fraction of advisories ship without a CVSS score.

**Version validation.** `pkg_vulns` accepts canonical package versions only. Tag-style refs with a leading `v` (for example `v4.18.0`) are rejected client-side with `INVALID_ARGUMENT` before the backend call. This avoids the current production backend's unhelpful generic error for that input shape. This is intentionally narrow: proper ecosystem-aware version parsing and typed invalid-version errors belong in the backend, not in ad hoc CLI normalization rules.

**Typed `VERSION_NOT_FOUND`.** Mirrors the code-nav precedent: a dedicated `PackageIntelligenceVersionNotFoundError` carries structured `{ packageName, requestedVersion, availableVersions? }` fields. Classifier routes it to `VERSION_NOT_FOUND` with a structured `details` block. When the service only gets a generic "no matching version" error, it promotes that into the typed error so CLI / MCP surfaces still render an actionable envelope. `availableVersions` remains undefined in the fallback path unless the service supplied them.

**Omission rules.** Null scalars omitted; empty arrays dropped; zero-count `bySeverity` keys dropped; the `bySeverity` block itself dropped when `total === 0`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Registry coverage.** Only npm, PyPI, Hex, and Crates have vulnerability data. The CLI + MCP reject the other five registries client-side with a tool-specific message (`pkg vulns only supports npm, pypi, hex, and crates. Got: ${registry}.`) — rejection predicate lives in `src/shared/package-vulnerabilities-request.ts` rather than the shared registry module, since it is a tool-specific capability matrix.

`pkg_vulns` shares its envelope builder with the CLI `githits pkg vulns` command via `src/shared/package-vulnerabilities-request.ts` and `src/shared/package-vulnerabilities-response.ts`. The terminal formatter is CLI-only (MCP always emits JSON). The parity test (`src/tools/package-vulnerabilities-parity.test.ts`) asserts `toEqual` across the service-sourced success and typed-error fixtures, and `toMatchObject` for builder-sourced `INVALID_ARGUMENT` fixtures such as unsupported registries and tag-style `v`-prefixed versions.

### `pkg_deps` response shape

**Data-first envelope.** `runtime`, `groups`, and `transitive` are three independent blocks emitted based on what the backend returned and what the caller asked for, not on additional caller flags. Agents branch on the envelope's shape rather than inferring from inputs.

- `runtime` block: emitted whenever the service returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages). `runtime.count` is computed client-side from `runtime.items.length`. The source `direct[]` is always runtime-only: dev / peer / build / optional deps live in the groups block instead.
- `groups` block: emitted whenever the service returned `dependencyGroups` — including when a lifecycle filter matched nothing (`{items: []}`). Omitted entirely when the service returned `dependencyGroups: null` (e.g. on zero-dep packages), so agents can tell "groups unavailable" apart from "filter excluded everything". Each group carries its members under `items`, matching `runtime.items` so dependency lists share one key throughout the envelope. Duplicate `{name, constraint}` entries inside a group are preserved verbatim; the terminal formatter dedups for scannability but JSON is lossless.
- `transitive` block: emitted only when the caller set `include_transitive: true`. Carries aggregates (`edges`, `uniquePackages`, `depth?`) plus preprocessed arrays: `packages[]` (each `{name, version, importers[]}` with importer name / version / constraint pulled from the service graph), `conflicts[]` (typed `{name, requiredVersions}` when decodable), `circularDependencies[]` (typed `{cycle: string[]}` when decodable). The raw graph is not exposed — the preprocessing happens in the envelope builder so agents consume the same signal the terminal `--verbose` renderer reads without re-implementing the decoder. A future dedicated `pkg deps-dag` command will expose the full graph under a typed contract for graph-visualisation tooling.

**`filter.lifecycles` echo.** Canonicalised lowercase array (deduplicated, sorted in canonical display order: `runtime` → `development` → `build` → `peer` → `optional`). Emitted only when the caller supplied a non-empty lifecycle input. Matches what the backend actually received — the raw CSV string is not echoed.

**Lifecycle scope.** `lifecycle: [String!]` on the wire filters `dependencyGroups.groups` only; `direct[]` and `transitive[]` are returned regardless. Documented on the backend schema and verified in live smoke.

**Typed decoder on GenericJSON payloads.** Backend declares `transitive.conflicts`, `transitive.circularDependencies`, and the DAG as `GenericJSON`. We ship best-effort decoders in the envelope builder that promote the two observed shapes (`{package_name, required_versions, conflicting_edges}` for conflicts; `{cycle: string[]}` for cycles) into typed arrays in the envelope. If any entry fails to decode against the expected shape, the field falls back to raw passthrough for that response — agents discriminate by checking `"name" in entry` / `Array.isArray(entry.cycle)` on the first element. `groups.environmentConstraints` remains raw `GenericJSON[]` (no observed live shape yet). The raw DAG is deliberately not exposed in this PR; a follow-up `pkg deps-dag` command will provide a typed graph surface for visualisation tooling.

**Registry coverage.** Only npm, PyPI, Hex, Crates, vcpkg, and Zig support the `packageDependencies` query. NuGet / Maven / Packagist are rejected client-side with a tool-specific message (`pkg deps only supports npm, pypi, hex, crates, vcpkg, and zig. Got: ${registry}.`). Predicate lives in `src/shared/package-dependencies-request.ts`.

**Version validation.** Same rule as `pkg_vulns`: tag-style `v`-prefixed inputs are rejected client-side with `INVALID_ARGUMENT` before the backend call.

**MCP schema notes.** Permissive (`registry: z.string()`, `package_name: z.string()`, …) with validation in-handler via `buildPackageDependenciesParams`. Deliberately no `include_groups` input — with the data-first envelope emitting `groups` unconditionally when the backend returns `dependencyGroups`, the flag would be a silently ignored no-op. Neither the MCP surface nor the CLI applies a depth default: `max_depth` / `--depth` is optional and, when omitted, the backend's full-graph traversal is used. `include_importers` requires `include_transitive: true`; `max_depth` and CLI `--depth` require the transitive view — passing them alone is rejected with `INVALID_ARGUMENT` rather than silently ignored.

`pkg_deps` shares its envelope builder with the CLI `githits pkg deps` command via `src/shared/package-dependencies-request.ts` and `src/shared/package-dependencies-response.ts`. The terminal formatter is CLI-only. The parity test (`src/tools/package-dependencies-parity.test.ts`) asserts `toEqual` across every service-sourced success / error fixture (runtime, zero-dep, full-view, optional-lifecycle, multi-lifecycle, filter-matched-nothing, Crates-target-cfg dedup round-trip, transitive, versioned match / diff, NOT_FOUND, VERSION_NOT_FOUND, BACKEND_ERROR) and `toMatchObject` for builder-sourced `INVALID_ARGUMENT` (unsupported registry, tag-style version, unknown lifecycle).

### `pkg_changelog` response shape

**Data-first envelope.** The top level carries addressing (`registry` + `name` for spec addressing, or `repoUrl` for repo-URL addressing), `source` (`"releases"` / `"changelog_file"` / `"hexdocs"`), and `mode` (`"latest"` or `"range"`). Entries live under `entries: { count, items }` — matching the `{count, items}` shape used by `pkg_deps.runtime`. `count` is computed client-side from `items.length`, so the invariant holds regardless of backend drift.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept in the envelope even when `null` so agents can write `items.map(e => e.version)` without guarding; every other nullable field is stripped when absent. `body` is additionally stripped when the caller set `include_bodies: false`. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope in v1 — revisit via agent feedback.

**Dual addressing (`registry` + `package_name` XOR `repo_url`).** `pkg_changelog` is the only metadata-side MCP tool with dual addressing. `pkg_info` / `pkg_vulns` / `pkg_deps` all accept only `registry` + `package_name` because they are registry-metadata lookups without repo-URL alternatives. `pkg_changelog` is intrinsically repo-level — its sources are GitHub Releases, CHANGELOG.md, and HexDocs — so `repoUrl` is a peer addressing mode, not a bolt-on. Future tool authors should not cargo-cult the asymmetry without reading this rationale.

**Mode selection.** `from_version` triggers range mode (returns every entry in `[fromVersion, toVersion]` with no cap). Latest mode is the default, capped by `limit` (1–50, backend default 10). `from_version` + `limit` is rejected client-side with `INVALID_ARGUMENT` rather than silently routed to one mode.

**`include_bodies` lever.** Release bodies on large packages (Kubernetes, Node) can run 10 KB+ per entry; a 100-entry range could produce a multi-hundred-KB envelope. `include_bodies: false` opts out explicitly — not silent truncation. Other fields (version / normalizedVersion / publishedAt / htmlUrl) remain so agents still get the release timeline. CLI's `--no-body` mirrors this flag and affects both terminal rendering and `--json` output. The CLI terminal separately caps each body at 10 lines by default for readability (with a `… (+N more — use --verbose …)` footer); `--verbose` uncaps that preview but does not change `--json` output.

**`filter.*` echo.** `filter` is emitted only when the caller explicitly supplied at least one of `from_version`, `to_version`, `limit`, or `git_ref`. Backend-default `limit: 10` / `toVersion: <latest>` is never echoed. The request builder tracks explicit-vs-defaulted via an `explicitFilterFields` set so defaults don't round-trip as caller intent.

**Version validation.** Same rule as `pkg_vulns` / `pkg_deps`: tag-style `v`-prefixed inputs on `from_version` / `to_version` are rejected client-side with `INVALID_ARGUMENT`. `<spec>@<version>` is also rejected — the `pkg changelog` family has no single-version query, and silently remapping to `to_version` would be a client-invented semantic shift. Hint text redirects callers to `--to` / `to_version`.

**NOT_FOUND semantics.** Backend `source === null` is promoted to a typed `PackageIntelligenceChangelogSourceNotFoundError` at the service boundary, which the shared classifier routes to the `NOT_FOUND` envelope with a message naming the sources that were tried. Empty `entries.items: []` with a valid `source` is a success, not an error — "no entries in this range" is a legitimate neutral outcome.

**Overlap with `pkg_info`.** `pkg_info` already surfaces a short-form `recentChanges` block (from the backend's `latestChangelogs` field on `PackageSummaryResult`). For a quick "what shipped recently" glance embedded in a package overview, use `pkg_info`. For the full range-capable, body-rich, `include_bodies`-toggleable changelog with `--no-body` timeline mode and repo-URL addressing, use `pkg_changelog`.

`pkg_changelog` shares its envelope builder with the CLI `githits pkg changelog` command via `src/shared/package-changelog-request.ts` and `src/shared/package-changelog-response.ts`. The terminal formatter is CLI-only. The parity test (`src/tools/package-changelog-parity.test.ts`) asserts `toEqual` across every service-sourced success / error fixture (happy latest, range mode, repo-URL addressing, `--no-body` / `include_bodies: false`, default bodies, empty entries, NOT_FOUND, PackageIntelligenceTargetNotFoundError, VERSION_NOT_FOUND, BACKEND_ERROR) and `toMatchObject` for builder-sourced `INVALID_ARGUMENT`.

### `code_files` / `code_read` / `code_grep` response shapes

These three indexing-gated tools share an addressing and lifecycle contract (documented below) and then each projects its own data-first envelope. All three reuse the shipped `codeTargetSchema` + `resolveCodeTarget` from `src/tools/code-navigation-shared.ts` — no parallel addressing module.

**`code_files` envelope**: `{registry?|repoUrl?+gitRef?, total, hasMore, indexedVersion?, resolution?, files: [{path, name?, language?, fileType?, byteSize?}], hint?, filter?}`. `fileType` values preserve the service vocabulary (`CONFIG`, `SOURCE`, `DOC`, `TEST`). `total` is capped at returned count when `hasMore: true` — the terminal formatter renders `N+ files` in that case to avoid misleading users. `filter.pathPrefix` / `filter.limit` echo only when the caller supplied them explicitly; default limit (200) never round-trips.

**`code_read` envelope**: `{registry?|repoUrl?+gitRef?, path, language?, totalLines?, startLine?, endLine?, content?, isBinary?}`. `path` (not `filePath`) so the key matches `code_files.files[].path` and `code_grep.filter.path` when exact-file grep is used. Binary files set `isBinary: true` and **omit** `content` (not `null`); agents branch on the flag.

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

## Server instructions

The MCP server advertises a short, cross-tool orientation via the protocol's server-level `instructions` field. This is distinct from per-tool `description` text: instructions cover rationale, workflow glue, and decisions that span multiple tools, while per-tool descriptions remain the source of truth for arguments, output shape, and tool-specific constraints.

`src/commands/mcp-instructions.ts` owns two sections:

- **Core block** — always loaded. Introduces GitHits and the `get_example` / `search_language` / `feedback` workflow.
- **Package-tools block** — appended when `isPackageToolsCapabilityOpen(deps)` is true. Contains a preamble plus one bullet per package tool whose backing service is actually wired, so half-open service configurations never advertise a tool that was not registered.

`isPackageToolsCapabilityOpen` is the single source of truth for whether package tools should surface in the current session. Both `getMcpToolDefinitions` and `buildMcpInstructions` import it so tool registration and the instruction text cannot drift.

When adding a new package tool, extend the composer with a one-line bullet (`\`tool_name\` — one-sentence purpose`) in the same PR that registers the tool, and gate the bullet on the tool's backing service. Keep the bullet terse; argument and response detail belong in the tool's `description`. `mcp-instructions.test.ts` enforces both directions of the mention↔registration invariant across gate-open, gate-closed, and half-open scenarios.

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
