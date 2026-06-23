# MCP ↔ CLI Parity

## Purpose

Users and agents should be able to cross the surface boundary without
learning a new request or error contract. Parameter names can differ per
surface convention, but request defaults and error behaviour do not.
Human/agent default rendering may differ from JSON envelopes: MCP tools
default to compact `text-v1` where available, while CLI has human
terminal output and `--json`. Structured parity is enforced through CLI
`--json` and MCP `format: "json"`.

Live smoke coverage runs through `scripts/mcp-smoke.ts` and
`scripts/cli-smoke.ts` via `bun run smoke:mcp` and `bun run smoke:cli`. The MCP
smoke invariants live in `packages/mcp/src/smoke-test.ts` and are exported as
`@githits/mcp/smoke-test` so remote MCP servers can reuse the same validation.
These suites intentionally avoid exact-output snapshots because backend ranking
and release metadata can change. They assert durable UX invariants instead:
server/command startup, registered tools, auth handling, compact default text,
parseable JSON opt-in, MCP-native hints, CLI terminal affordances, and JSON
envelope shape. When adding or changing a dual-surface tool, update the shared
MCP smoke runner and CLI smoke script if the covered live UX contract changes.

The dual-surface tools today are:

- `get_example` ↔ `githits example`
- `search_language` ↔ `githits languages`
- `feedback` ↔ `githits feedback`
- `search` ↔ `githits search`
- `search_status` ↔ `githits search-status`
- `code_files` ↔ `githits code files`
- `code_read` ↔ `githits code read`
- `code_grep` ↔ `githits code grep`
- `pkg_info` ↔ `githits pkg info`
- `pkg_vulns` ↔ `githits pkg vulns`
- `pkg_deps` ↔ `githits pkg deps`
- `pkg_changelog` ↔ `githits pkg changelog`
- `pkg_upgrade_review` ↔ `githits pkg upgrade-review`
- `docs_list` ↔ `githits docs list`
- `docs_read` ↔ `githits docs read`

`feedback` is mutating, so smoke coverage exercises registration and
validation/auth paths only. It does not submit fake feedback to the live
backend.

One deliberate exception: `search_status` does not echo the original
structured request because the backend follow-up endpoint does not
expose the caller's original targets or filters.

## Rule IDs

Rule IDs are cited from parity tests in file header comments so the
test suite anchors the doc.

### `PARITY-NAMING`

- **MCP arguments** use `snake_case`. They are the wire contract agents
  see; the JSON-schema description is the primary UX.
- **CLI flags** use `--kebab-case`. They are the user-facing surface.
  `allow_partial_results` maps to CLI `--allow-partial` because the CLI
  name reads better as a command flag while preserving the same behaviour.
- **Public enum values** are lowercase strings on both surfaces
  (`production`, `test`, `summary`, `all`).
- **Service coercion** from lowercase enum values to the internal
  request enums lives in `packages/mcp/src/shared/code-navigation.ts`
  (`toFileIntent`, `toSymbolKind`, `toSymbolCategory`).

### `PARITY-DEFAULTS`

- Both surfaces import defaults from
  `packages/mcp/src/shared/code-navigation-defaults.ts`. They never diverge
  silently.
- Cross-tool defaults (e.g. `DEFAULT_WAIT_TIMEOUT_MS`) live without a
  prefix. Tool-local sentinels live there too so both surfaces translate
  them the same way.
- When a surface fills in a default for the caller, that default value
  is applied at the shared request builder — not at the surface — so
  both surfaces apply defaults at the same point and under the same
  conditions.

### `PARITY-REQUEST`

- Request construction for a dual-surface tool routes through a single
  shared helper at `packages/mcp/src/shared/<tool>-request.ts`. The helper fills in
  defaults and translates user-facing sentinel values into wire-level
  equivalents.
- Cross-tool helpers (error classification, target resolution) live in
  `packages/mcp/src/shared/` without a tool-name prefix.

### `PARITY-JSON-KEYS`

- The CLI `--json` payload and the MCP `format: "json"` payload,
  parsed as JSON, must `deepEqual` for equivalent inputs.
- String-equal is explicitly not the contract. Key ordering,
  whitespace, and trailing newlines are free.
- **No leading-underscore keys.** `warning`, `hint`, and all other
  status fields are plain.
- Empty arrays and default-valued scalars are omitted in favour of
  field absence wherever that does not change agent semantics.
- Initial unified `search` responses include the full compiled request
  echo. Follow-up `search_status` responses intentionally omit that
  echo and return only backend-known fields:
  `{completed, searchRef?, progress?, result?}`.
- Unified `search` is complete-by-default (`allowPartialResults: false`).
  `allow_partial_results` / `--allow-partial` opt into backend partial
  payloads while indexing continues; incomplete JSON envelopes may then
  carry non-empty `results` plus the `searchRef`.

### `PARITY-ERROR-ENVELOPE`

- Every error result, on both surfaces, carries
  `{ error: string, code: MappedErrorCode, retryable?: boolean, details?: object }`.
- `code` is mandatory. `UNKNOWN` is a last resort — every named error
  class in the code-navigation and package-intelligence stacks maps to a
  specific code. The classifier is tested by table in
  `packages/mcp/src/shared/code-navigation-error-map.test.ts`; that test is the
  enforcement mechanism, not a convention.
- MCP error text is always valid JSON. A client that parses
  `content[0].text` on error gets the same envelope as CLI `--json`.

### `PARITY-SHARED-TEXT-FORMATTER`

- Terminal rendering and MCP text rendering may share formatter code when
  the output is useful to both humans and agents.
- Shared formatters must accept surface-specific hints so MCP never emits
  CLI-only instructions like `--verbose` or `--lifecycle all`.
- Default MCP success output should be compact `text-v1`; programmatic
  parity tests must pass `format: "json"` explicitly.

## Checklist for adding a new dual-surface tool

When a new tool lands with both MCP and CLI surfaces:

- [ ] Tool-specific defaults added to
  `packages/mcp/src/shared/code-navigation-defaults.ts` with a `TOOLNAME_` prefix.
- [ ] Request builder at `packages/mcp/src/shared/<tool>-request.ts`. Both surfaces
  import it.
- [ ] Error classifier reused (`mapCodeNavigationError` /
  `mapPackageIntelligenceError`). Add new `MappedErrorCode` variants
  only when a genuinely new error class exists; cover the new branch
  in the table test.
- [ ] Response builder at `packages/mcp/src/shared/<tool>-response.ts` emitting the
  shared success and error envelopes. JSON shape matches
  `PARITY-JSON-KEYS` rules.
- [ ] Parity test at `src/tools/<tool>-parity.test.ts` that cites the
  rule IDs it enforces (in a file header comment). Covers at minimum:
  successful query, zero-result, two error codes.
- [ ] MCP tool description mirrored across every shipped MCP surface
  before public release.

## Non-goals

- **Forcing identical default prose.** CLI terminal output and MCP text
  are related products, not identical products. Share formatters only
  when the shape is useful on both surfaces and hints can be made
  surface-native.
- **Shared MCP description copy.** Each tool's description targets a
  different decision the agent is making. Copy is not reusable.

## Related files

| File | Role |
|---|---|
| `packages/mcp/src/shared/code-navigation-defaults.ts` | Canonical cross-surface defaults and sentinels. |
| `packages/mcp/src/shared/code-navigation-error-map.ts` | `mapCodeNavigationError` classifier and `MappedError` union. |
| `packages/core-internal/src/shared/pkgseer-graphql.ts` | Low-level authenticated package/source POST helper shared by the service clients. |
| `packages/core-internal/src/shared/pkgseer-registry.ts` | Registry taxonomy (registry union type + lowercase↔uppercase converters). |
| `packages/mcp/src/shared/unified-search-request.ts` | Shared request builder for unified `search`; compiles structured query fields and applies defaulting. |
| `packages/mcp/src/shared/unified-search-response.ts` | Shared JSON envelope builders for unified `search` and follow-up `search_status`. |
| `packages/mcp/src/shared/package-summary-request.ts` | Shared request builder for `pkg_info`. |
| `packages/mcp/src/shared/package-summary-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_info`. |
| `packages/mcp/src/shared/package-vulnerabilities-request.ts` | Shared request builder for `pkg_vulns`. |
| `packages/mcp/src/shared/package-vulnerabilities-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_vulns`. |
| `packages/mcp/src/shared/package-dependencies-request.ts` | Shared request builder for `pkg_deps`. |
| `packages/mcp/src/shared/package-dependencies-response.ts` | Lean JSON envelope builder and shared text/terminal formatter for `pkg_deps`. |
| `packages/mcp/src/shared/package-changelog-request.ts` | Shared request builder for `pkg_changelog`. |
| `packages/mcp/src/shared/package-changelog-response.ts` | JSON envelope builder and shared text/terminal formatter for `pkg_changelog`. |
| `packages/mcp/src/shared/list-files-request.ts` | Shared request builder for `code_files`. |
| `packages/mcp/src/shared/list-files-response.ts` | JSON envelope builder for `code_files`. |
| `packages/mcp/src/shared/read-file-request.ts` | Shared request builder for `code_read`. |
| `packages/mcp/src/shared/read-file-response.ts` | JSON envelope builder for `code_read`. Normalises envelope key to `path` (not `filePath`) so `code_files` -> `code_read` chains without renames. |
| `packages/mcp/src/shared/grep-repo-request.ts` | Shared request builder for `code_grep`. Exports `GREP_REPO_PATTERN_NOTE` referenced by MCP description, MCP `pattern` describe, and CLI help. |
| `packages/mcp/src/shared/grep-repo-response.ts` | JSON envelope builder for `code_grep`. |
| `packages/mcp/src/shared/list-package-docs-request.ts` / `list-package-docs-response.ts` | Shared request and envelope for `docs_list`. |
| `packages/mcp/src/shared/read-package-doc-request.ts` / `read-package-doc-response.ts` | Shared request and envelope for `docs_read`. |
| `packages/mcp/src/shared/code-navigation-error-map.ts` | Owns the `INDEXING` / `FILE_NOT_FOUND` / `NOT_FOUND` codes shared across all code-nav tools. |
| `packages/mcp/src/shared/package-intelligence-error-map.ts` | `mapPackageIntelligenceError` classifier (reuses `MappedError` from the code-nav map). |
| `packages/core-internal/src/services/promote-version-not-found.ts` | Shared helper that promotes generic backend errors with "no matching version" messages into typed `VERSION_NOT_FOUND`. |
| `packages/mcp/src/tools/code-navigation-shared.ts` | `codeTargetSchema` + `resolveCodeTarget` — the addressing primitive used by `code_files`, `code_read`, `code_grep`, and unified `search`. |
| `packages/mcp/src/tools/search.ts` | MCP tool definition for unified `search`. |
| `packages/mcp/src/tools/search-status.ts` | MCP tool definition for `search_status`. |
| `packages/mcp/src/tools/package-summary.ts` | MCP tool definition for `pkg_info`. |
| `packages/mcp/src/tools/package-vulnerabilities.ts` | MCP tool definition for `pkg_vulns`. |
| `packages/mcp/src/tools/package-dependencies.ts` | MCP tool definition for `pkg_deps`. |
| `packages/mcp/src/tools/package-changelog.ts` | MCP tool definition for `pkg_changelog`. |
| `packages/mcp/src/tools/list-files.ts` | MCP tool definition for `code_files`. |
| `packages/mcp/src/tools/read-file.ts` | MCP tool definition for `code_read`. |
| `packages/mcp/src/tools/grep-repo.ts` | MCP tool definition for `code_grep`. |
| `packages/mcp/src/tools/list-package-docs.ts` / `read-package-doc.ts` | MCP tool definitions for the docs surface. |
| `src/commands/search.ts` | Top-level CLI commands for unified `search` and `search-status`. |
| `src/commands/pkg/info.ts` / `vulns.ts` / `deps.ts` / `changelog.ts` | CLI commands for the `pkg` group. |
| `src/commands/code/files.ts` / `read.ts` / `grep.ts` | CLI commands for the `code` group. |
| `src/commands/docs/list.ts` / `read.ts` | CLI commands for the `docs` group. |
| `src/tools/*-parity.test.ts` | Parity tests; each cites the rule IDs it enforces. |

## Per-tool notes

### `pkg_info`

- **Permissive MCP schema + in-handler validation.**
  `buildPackageSummaryParams` is the single validator used by both
  surfaces; raw Zod errors never surface in the envelope.
- **`@version` rejection.** CLI-only. The MCP tool has no `version`
  input. The CLI's `pkg info` throws `InvalidPackageSpecError` on
  any non-null parsed version — never silently swaps to latest.

### `pkg_vulns`

- **Permissive MCP schema + in-handler validation.**
  `buildPackageVulnerabilitiesParams` is the single validator.
- **Filter-aware summary.** `minSeverity` + `includeWithdrawn` go
  straight to the service; the returned `vulnerabilityCount`
  reflects the filtered set. No client-side filtering.
- **Partitioning bySeverity buckets.** `summary.bySeverity` carries
  a `malware` key for `isMalicious === true` advisories; severity
  bands for non-malicious advisories with a positive CVSS score;
  and `unrated` for non-malicious advisories with no score. Every
  returned advisory lands in exactly one bucket — `MALWARE + crit
  + high + medium + low + unrated = advisories.length`. Malware
  advisories sort first regardless of severity score; `unrated`
  advisories sort last within the active bucket.
- **Typed `VERSION_NOT_FOUND`.**
  `PackageIntelligenceVersionNotFoundError` carries structured
  fields (`packageName`, `requestedVersion`, `availableVersions`).
  The classifier emits structured `details` in the error envelope.
- **Client-side `v`-prefix rejection.** Tag-style inputs like
  `v4.18.0` are rejected as `INVALID_ARGUMENT` with an actionable
  message before the service call.

### `pkg_deps`

- **Data-first envelope.** `runtime`, `groups`, and `transitive` are
  three independent blocks emitted based on what the backend
  returned and what the caller asked for, not on additional caller
  flags.
- **No `include_groups` input.** The data-first envelope emits the
  `groups` block unconditionally when the backend returned
  `dependencyGroups`, so an `include_groups: true` input would be a
  silently ignored no-op.
- **Dependency list naming.** Every list of dependencies in the
  envelope uses the `items` key: `runtime.items`, `groups.items`
  (array of groups), each group's nested `items` (array of member
  deps).
- **Lifecycle filter echo.** `filter.lifecycles` is the
  canonicalised, deduplicated, display-order-sorted array the
  backend actually received. Emitted only when the caller supplied
  a non-empty input.
- **Null vs empty matters.** `groups` is omitted entirely when the
  backend returned `dependencyGroups: null`; emitted with
  `items: []` when the backend returned a non-null
  `dependencyGroups` with zero groups (filter matched nothing).
- **Terminal-only dedup.** Crates feature groups can contain
  duplicate `{name, constraint}` tuples (target-cfg branching). The
  terminal formatter collapses them; the JSON envelope preserves
  every duplicate the backend emitted.
- **Preprocessed transitive.** `transitive.packages[]` carries
  `{name, version, importers[]}` records; `conflicts[]` is typed
  `{name, requiredVersions}` when decodable; `circularDependencies[]`
  is typed `{cycle: string[]}` when decodable. The raw DAG is
  deliberately dropped from this tool's envelope.

### `pkg_changelog`

- **Dual addressing — the only pkg-intel tool with it.** `registry`
  + `package_name` XOR `repo_url` on both surfaces, because
  `packageChangelog` is intrinsically repo-level.
- **`<spec>@<version>` rejected.** Other `pkg` commands give
  `@version` a meaning, but changelog has no single-version query
  — remapping to `to_version` would be a client-invented semantic
  shift. Both surfaces redirect callers to `--to` / `to_version`.
- **Mode mutex enforced client-side.** `--from` / `from_version` +
  `--limit` / `limit` together → `INVALID_ARGUMENT`.
- **`filter.*` echo tracks explicit fields only.** Backend-default
  values never round-trip as caller intent.
- **`entries: { count, items }` shape.** Mirrors `runtime: {count,
  items}` from `pkg_deps`.
- **Missing source with entries succeeds.** Package-version entries can
  arrive with null or empty `source` when no concrete changelog text
  exists for that version. Both surfaces omit `source` in the success
  envelope and keep the version entries. Missing source plus no entries
  is promoted to `PackageIntelligenceChangelogSourceNotFoundError` with
  a message naming the sources tried (GitHub Releases, CHANGELOG.md,
  HexDocs).
- **`--verbose` / `--no-body` / `--json` interaction.** Default
  terminal output truncates each entry's body at 10 lines.
  `--verbose` lifts the cap (terminal-only). `--no-body` mirrors
  MCP's `omit_bodies: true` and affects both terminal and
  `--json`. `--no-body` + `--verbose` is rejected.

### `code_files` / `code_read` / `code_grep` (file-exploration bundle)

All three reuse `codeTargetSchema` + `resolveCodeTarget` from
`packages/mcp/src/tools/code-navigation-shared.ts`. The indexing lifecycle is
shared (see `tools.md` "Indexing lifecycle" section). Parity tests
cover dual addressing, default + explicit filter echoes, INDEXING
error envelope, NOT_FOUND envelope, and INVALID_ARGUMENT with full
envelope shape.

- **`code_files`**: `filter.path_prefix` / `filter.limit` echo only
  when explicit. Default `limit: 200` never round-trips. Backend
  returns `total` capped at returned count when `hasMore: true`;
  terminal formatter renders `N+`.
- **`code_read`**: envelope uses `path` (not `filePath`) to match
  `code_files.files[].path`. Binary files: `isBinary: true` +
  `content` omitted (not `null`). `fetchCodeContext` on the
  backend doesn't return `availableVersions` on INDEXING responses,
  so its `details` block carries only `indexingRef`.
- **`code_grep`**: `GREP_REPO_PATTERN_NOTE` (exported from
  `grep-repo-request.ts`) keeps the literal-vs-regex disclosure
  identical across MCP description, MCP `pattern` describe, and
  CLI help. The shared request builder compiles `path`,
  `path_prefix`, and `globs` into backend `pathSelectors`, defaults
  grep to whole-target literal ASCII case-insensitive matching;
  whole-target regexes must include at least one literal substring.
  `symbol_fields` / `--symbol-field` passes backend symbol
  hydration through to `symbolFields`; the response envelope
  carries `matches[].symbol` when the backend hydrates it.
