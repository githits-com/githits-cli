# MCP ↔ CLI Parity

## Purpose

This document started with `search_symbols` ↔ `githits code search`,
then expanded into the parity pattern used by the rest of the hidden
package/code tooling. Users and agents should be able to cross the
surface boundary without learning a new payload shape — parameter names
can differ per surface convention, but defaults, error behaviour, and
the serialised envelopes do not.

`search_symbols` / `githits code search` remain a valid parity pair, but
they are no longer the preferred product entry point for symbol-shaped
search. New user-facing guidance should prefer unified top-level
`search` with `source=symbol` / `sources:["symbol"]` unless the older
dedicated symbol-search contract is specifically required.

Top-level unified `search` and `search_status` follow the same pattern,
with one deliberate exception: `search_status` does not echo the
original structured request because the backend follow-up endpoint does
not expose the caller's original targets, filters, or defaulted fields.

This document is **the pattern and checklist derived from
`search_symbols`**, not a permanent contract for every future
code-navigation tool. When tool #2 lands with a good reason to break a
rule, extend the rule or add a new one here rather than bending tool
#1's shape to fit.

## Rule IDs

Rule IDs are cited from parity tests (e.g.
`src/tools/search-symbols-parity.test.ts`) in file header comments so
the test suite anchors the doc.

### `PARITY-NAMING`

- **MCP arguments** use `snake_case`. They are the wire contract agents
  see; the JSON-schema description is the primary UX.
- **CLI flags** use `--kebab-case`. They are the user-facing surface.
  `allow_partial_results` maps to CLI `--allow-partial` because the CLI
  name reads better as a command flag while preserving the same behavior.
- **Public enum values** are lowercase strings on both surfaces
  (`production`, `test`, `summary`, `all`).
- **Service coercion** from lowercase enum values to the internal
  request enums lives in `src/shared/code-navigation.ts`
  (`toSearchSymbolsFileIntent`, `toSearchSymbolsKind`,
  `toSearchSymbolsMatchMode`).

### `PARITY-DEFAULTS`

- Both surfaces import defaults from
  `src/shared/code-navigation-defaults.ts`. They never diverge
  silently.
- Cross-tool defaults (e.g. `DEFAULT_WAIT_TIMEOUT_MS`) live without a
  prefix. Tool-local sentinels that affect request shaping (for example
  `FILE_INTENT_ALL`) also live there so both surfaces translate them the
  same way.
- When a surface fills in a default for the caller, that default value
  is applied at the shared request builder
  (`buildSearchSymbolsParams`) — not at the surface — so both
  surfaces apply defaults at the same point and under the same
  conditions.

### `PARITY-REQUEST`

- Request construction for a dual-surface tool routes through a single
  shared helper (`buildSearchSymbolsParams`). The helper:
  1. Fills in defaults,
  2. Translates user-facing sentinel values (e.g. `FILE_INTENT_ALL`)
     into their wire-level equivalents,
  3. Returns a `defaulted` array naming the fields that were
     client-applied, which feeds the response `query.defaulted` echo.
- Cross-tool helpers (error classification, target resolution) live in
  `src/shared/` without a tool-name prefix. Per-tool request builders
  live in `src/shared/<tool>-request.ts`.

### `PARITY-JSON-KEYS`

- The CLI `--json` payload and the MCP tool text payload, parsed as
  JSON, must `deepEqual` for equivalent inputs.
- String-equal is explicitly not the contract. Key ordering,
  whitespace, and trailing newlines are free.
- **No leading-underscore keys.** `warning`, `hint`, and all other
  status fields are plain.
- `query` echoes the resolved request parameters. `query.defaulted` is
  a string array naming the fields whose values the client filled in.
  Empty array when every field was caller-set.
- `fileIntent` is echoed as a lowercase enum value, or the literal
  `"all"` when no file-intent filter was applied.
- `returnedCount` is an explicit echo of `results.length`.
- `totalMatches` is the service-provided total (equal to
  `returnedCount` today).
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
  `{ error: string, code: MappedErrorCode, details?: object }`.
- `code` is mandatory. `UNKNOWN` is a last resort — every named error
  class in the code-navigation stack maps to a specific code. The
  classifier is tested by table in
  `src/shared/code-navigation-error-map.test.ts`; that test is the
  enforcement mechanism, not a convention.
- MCP error text is always valid JSON. A client that parses
  `content[0].text` gets the same envelope whether the result is
  success or error.

### `PARITY-NO-SHARED-TERMINAL-FORMATTER`

- Terminal rendering is CLI-local.
- MCP emits JSON text only; there is no equivalent pretty-print.
- Small semantic helpers that happen to be reused (e.g. a zero-result
  message template) may move into `src/shared/` once two tools need
  them. Default: keep formatting surface-local.

## Checklist for adding a new dual-surface tool

When a new tool lands with both MCP and CLI surfaces:

- [ ] Tool-specific defaults added to
  `src/shared/code-navigation-defaults.ts` with a `TOOLNAME_` prefix.
- [ ] Request builder at `src/shared/<tool>-request.ts`. Both surfaces
  import it.
- [ ] Error classifier reused (`mapCodeNavigationError`). Add new
  `MappedErrorCode` variants only when a genuinely new error class
  exists; cover the new branch in the table test.
- [ ] Response builder at `src/shared/<tool>-response.ts` emitting the
  shared success and error envelopes. JSON shape matches
  `PARITY-JSON-KEYS` rules.
- [ ] Parity test at `src/tools/<tool>-parity.test.ts` that cites the
  rule IDs it enforces (in a file header comment). Covers at minimum:
  successful search, zero-result, two error codes.
- [ ] MCP tool description mirrored across every shipped MCP surface
  before public release.

## Non-goals

- **Shared terminal formatter.** CLI terminal output and MCP JSON are
  different products. A shared prose-rendering layer is premature
  until at least two tools prove the shape is common.
- **Shared MCP description copy.** Each tool's description targets a
  different decision the agent is making. Copy is not reusable.

## When to extend this document

- A new rule ID is added when a future tool exposes a pattern that is
  genuinely cross-tool (naming, shared helper location, JSON shape).
- An existing rule is revised when the tool that originally
  established it (`search_symbols`) turns out to be the outlier.
- The checklist grows by exactly one bullet per rule. Keep it short.

## Related files

| File | Role |
|---|---|
| `src/shared/code-navigation-defaults.ts` | Canonical cross-surface defaults and sentinels. |
| `src/shared/code-navigation-error-map.ts` | `mapCodeNavigationError` classifier and `MappedError` union. |
| `src/shared/pkgseer-graphql.ts` | Low-level authenticated package/source POST helper shared by the service clients. |
| `src/shared/pkgseer-registry.ts` | Registry taxonomy (`PkgseerRegistry` union + lowercase↔uppercase converters). |
| `src/shared/search-symbols-request.ts` | Shared request builder for `search_symbols`. |
| `src/shared/search-symbols-response.ts` | Shared JSON envelope builders for `search_symbols`. |
| `src/shared/unified-search-request.ts` | Shared request builder for top-level unified `search`; compiles structured query fields and applies defaulting. |
| `src/shared/unified-search-response.ts` | Shared JSON envelope builders for top-level unified `search` and follow-up `search_status`. |
| `src/shared/package-summary-request.ts` | Shared request builder for `package_summary`. |
| `src/shared/package-summary-response.ts` | Lean JSON envelope builder and terminal formatter for `package_summary`. |
| `src/shared/package-vulnerabilities-request.ts` | Shared request builder for `package_vulnerabilities`; owns the tool-local `supportsVulnerabilitiesRegistry` predicate and the severity-label → CVSS float map. |
| `src/shared/package-vulnerabilities-response.ts` | Lean JSON envelope builder for `package_vulnerabilities` (shared); terminal formatter (CLI-only). |
| `src/shared/package-dependencies-request.ts` | Shared request builder for `package_dependencies`; owns `supportsDependenciesRegistry` + lifecycle / depth validation. |
| `src/shared/package-dependencies-response.ts` | Lean JSON envelope builder for `package_dependencies` (shared); terminal formatter (CLI-only). |
| `src/shared/package-changelog-request.ts` | Shared request builder for `package_changelog`; owns spec-XOR-repo-URL validation, `<spec>@<version>` rejection, `--from` / `--limit` mutex, tag-style version rejection, and the `explicitFilterFields` tracker. |
| `src/shared/package-changelog-response.ts` | JSON envelope builder for `package_changelog` (shared); terminal formatter (CLI-only). |
| `src/shared/list-files-request.ts` | Shared request builder for `list_files`; applies the shared `DEFAULT_WAIT_TIMEOUT_MS`, enforces limit bounds, tracks explicit-filter fields. |
| `src/shared/list-files-response.ts` | JSON envelope builder for `list_files` (shared); terminal formatter (CLI-only). Resolves the `hasMore` → `N+` header behaviour. |
| `src/shared/read-file-request.ts` | Shared request builder for `read_file`; trims filePath, validates start/end line positive-integer rules, rejects reversed ranges. |
| `src/shared/read-file-response.ts` | JSON envelope builder for `read_file` (shared); terminal formatter (CLI-only). Normalises the envelope key to `path` (not `filePath`) so `list_files` → `read_file` chains without renames. |
| `src/shared/grep-repo-request.ts` | Shared request builder for `grep_repo`; exports `GREP_REPO_PATTERN_NOTE` referenced by MCP description, MCP `pattern` describe, and CLI help. Compiles public scope inputs into backend `pathSelectors` and applies internal `allowUnscoped` when no scope filters are given. |
| `src/shared/grep-repo-response.ts` | JSON envelope builder for `grep_repo` (shared); terminal formatter (CLI-only) renders plain `file:line:text` or verbose grouped output and surfaces pagination via stderr. |
| `src/shared/code-navigation-error-map.ts` | `mapCodeNavigationError` classifier. Owns the `INDEXING` / `FILE_NOT_FOUND` / `NOT_FOUND` codes shared across all four code-nav tools. |
| `src/shared/code-navigation-defaults.ts` | `DEFAULT_WAIT_TIMEOUT_MS = 20_000` + `MAX_WAIT_TIMEOUT_MS = 60_000`. Both CLI and MCP request builders import these so defaults never diverge. |
| `src/tools/code-navigation-shared.ts` | `codeTargetSchema` + `resolveCodeTarget` — the single addressing primitive used by `search_symbols`, `list_files`, `read_file`, `grep_repo`. |
| `src/shared/package-intelligence-error-map.ts` | `mapPackageIntelligenceError` classifier (reuses `MappedError` from the code-nav map). |
| `src/services/promote-version-not-found.ts` | Shared helper that promotes generic backend errors with "no matching version" messages into typed `VERSION_NOT_FOUND`. Used by the `packageVulnerabilities`, `packageDependencies`, and `packageChangelog` executors. Handles both `version` (single-version queries) and `fromVersion` / `toVersion` (range queries), and skips `details.package` synthesis when registry/name aren't available (repo-URL mode). |
| `src/tools/search-symbols.ts` | MCP tool definition for `search_symbols`. |
| `src/tools/search.ts` | MCP tool definition for unified `search`. |
| `src/tools/search-status.ts` | MCP tool definition for `search_status`. |
| `src/tools/package-summary.ts` | MCP tool definition for `package_summary`. |
| `src/tools/package-vulnerabilities.ts` | MCP tool definition for `package_vulnerabilities`. |
| `src/tools/package-dependencies.ts` | MCP tool definition for `package_dependencies`. |
| `src/tools/package-changelog.ts` | MCP tool definition for `package_changelog`. |
| `src/tools/list-files.ts` | MCP tool definition for `list_files`. |
| `src/tools/read-file.ts` | MCP tool definition for `read_file`. |
| `src/tools/grep-repo.ts` | MCP tool definition for `grep_repo`. |
| `src/commands/code/search-symbols.ts` | CLI command. |
| `src/commands/search.ts` | Top-level CLI commands for unified `search` and `search-status`. |
| `src/commands/pkg/info.ts` | CLI command for `pkg info`. |
| `src/commands/pkg/vulns.ts` | CLI command for `pkg vulns`. |
| `src/commands/pkg/deps.ts` | CLI command for `pkg deps`. |
| `src/commands/pkg/changelog.ts` | CLI command for `pkg changelog`. |
| `src/commands/code/files.ts` | CLI command for `code files`. |
| `src/commands/code/read.ts` | CLI command for `code read`. |
| `src/commands/code/grep.ts` | CLI command for `code grep`. |
| `src/tools/search-symbols-parity.test.ts` | Parity tests (cite rule IDs). |
| `src/tools/package-summary-parity.test.ts` | Parity tests for `package_summary` (cite rule IDs). |
| `src/tools/package-vulnerabilities-parity.test.ts` | Parity tests for `package_vulnerabilities` (cite rule IDs). |
| `src/tools/package-dependencies-parity.test.ts` | Parity tests for `package_dependencies` (cite rule IDs). |
| `src/tools/package-changelog-parity.test.ts` | Parity tests for `package_changelog` (cite rule IDs). |
| `src/tools/list-files-parity.test.ts` | Parity tests for `list_files` (cite rule IDs). |
| `src/tools/read-file-parity.test.ts` | Parity tests for `read_file` (cite rule IDs). |
| `src/tools/grep-repo-parity.test.ts` | Parity tests for `grep_repo` (cite rule IDs). |

## Per-tool notes

### `package_summary`

- **Permissive MCP schema + in-handler validation.** Matches the
  `search_symbols` precedent. `buildPackageSummaryParams` is the
  single validator used by both surfaces; raw Zod errors never
  surface in the envelope.
- **Parity assertion policy** (coded in
  `src/tools/package-summary-parity.test.ts`):
  - `toEqual` for service-sourced fixtures (happy, minimal-fields,
    `NOT_FOUND`, `BACKEND_ERROR`) — envelopes are byte-identical
    because both surfaces route through the same classifier and
    response builder.
  - `toMatchObject` for the `INVALID_ARGUMENT` fixture. CLI's
    `parsePackageSpec` and MCP's in-handler
    `buildPackageSummaryParams` produce surface-specific error text;
    same envelope shape, different message.
- **`@version` rejection.** CLI-only. The MCP tool has no `version`
  input. The CLI's `pkg info` throws `InvalidPackageSpecError` on
  any non-null parsed version — never silently swaps to latest.

### `package_vulnerabilities`

- **Permissive MCP schema + in-handler validation.** Same pattern as
  `package_summary`. `buildPackageVulnerabilitiesParams` is the
  single validator used by both surfaces; raw Zod errors never
  surface in the envelope.
- **Filter-aware summary.** `minSeverity` + `includeWithdrawn` go
  straight to the service; the returned `vulnerabilityCount`
  reflects the filtered set. No client-side filtering, no
  `summary.filtered` dual-block.
- **Partitioning bySeverity buckets.** `summary.bySeverity` carries
  a `malware` key for `isMalicious === true` advisories; severity
  bands for non-malicious advisories with a positive CVSS score;
  and `unrated` for non-malicious advisories with no score. Every
  returned advisory lands in exactly one bucket — client-side
  guarantee `MALWARE + crit + high + medium + low + unrated =
  advisories.length`. The sum also equals `summary.total` whenever
  the backend keeps `vulnerabilityCount` and `vulnerabilities[]`
  consistent. Malware advisories sort first in the advisory list
  regardless of severity score; `unrated` advisories sort last
  within the active bucket.
- **Scope of the shared helper.** `buildPackageVulnerabilitiesSuccessPayload`
  is shared between CLI `--json` and MCP `content[0].text` — that's
  what enforces envelope parity. The terminal formatter
  `formatPackageVulnerabilitiesTerminal` is CLI-only (MCP always
  emits JSON). The parity doc's default rule (CLI-local rendering)
  still applies to the formatter; the envelope builder is the
  explicit shared-helper exception.
- **Parity assertion policy** (coded in
  `src/tools/package-vulnerabilities-parity.test.ts`):
  - `toEqual` for the service-sourced fixtures: happy, zero-vulns,
    filtered-success, versioned-match (no `requestedVersion`),
    versioned-real-diff (`requestedVersion` present), `NOT_FOUND`,
    `VERSION_NOT_FOUND` (with structured details), `BACKEND_ERROR`.
  - `toMatchObject` for builder-sourced `INVALID_ARGUMENT` cases
    such as unsupported registry (`vcpkg`) and tag-style version
    input (`v4.18.0`).
- **Typed `VERSION_NOT_FOUND`.** Mirrors the code-nav precedent:
  `PackageIntelligenceVersionNotFoundError` carries structured
  fields sourced from the service response (`packageName`,
  `requestedVersion`, `availableVersions`). The classifier emits
  structured `details` in the error envelope.
- **Client-side `v`-prefix rejection.** `package_vulnerabilities`
  validates version strings before the service call. Tag-style
  inputs like `v4.18.0` are rejected as `INVALID_ARGUMENT` with an
  actionable message instead of relying on the current production
  backend, which returns a generic error for that input.

### `package_dependencies`

- **Data-first envelope.** `runtime`, `groups`, and `transitive` are
  three independent blocks emitted based on what the backend
  returned and what the caller asked for, not on additional caller
  flags. An MCP agent decides what to read based on what's in the
  envelope — no branching on invocation inputs.
- **No `include_groups` input.** The data-first envelope emits the
  `groups` block unconditionally when the backend returned
  `dependencyGroups`, so an `include_groups: true` input would be a
  silently ignored no-op. Deliberately absent from the MCP schema.
- **Dependency list naming.** Every list of dependencies in the
  envelope uses the `items` key: `runtime.items`, `groups.items`
  (array of groups), each group's nested `items` (array of member
  deps). Symmetric and easy to parse.
- **Lifecycle filter echo.** `filter.lifecycles` is the
  canonicalised, deduplicated, display-order-sorted array the
  backend actually received (never the raw CSV). Emitted only when
  the caller supplied a non-empty input.
- **Null vs empty matters.** `groups` is omitted entirely when the
  backend returned `dependencyGroups: null` (zero-dep packages);
  emitted with `items: []` when the backend returned a non-null
  `dependencyGroups` with zero groups (filter matched nothing).
  `runtime` is omitted when `dependencies: null` or `direct: null`;
  emitted with `count: 0, items: []` when `direct: []`.
- **Terminal-only dedup.** Crates feature groups can contain
  duplicate `{name, constraint}` tuples (target-cfg branching). The
  terminal formatter collapses them; the JSON envelope preserves
  every duplicate the backend emitted. A parity fixture exercises
  the round-trip.
- **Preprocessed transitive.** Backend declares `transitive.conflicts`,
  `transitive.circularDependencies`, and the DAG as `GenericJSON`,
  but the envelope builder decodes them using best-effort shape
  detectors so agents see typed data. `transitive.packages[]` carries
  `{name, version, importers[]}` records (importer name / version /
  constraint pulled from the DAG); `conflicts[]` is typed
  `{name, requiredVersions}` when decodable; `circularDependencies[]`
  is typed `{cycle: string[]}` when decodable. When a decoder can't
  match, that field falls back to raw `GenericJSON[]` so no data is
  lost. The raw DAG itself is deliberately dropped from this tool's
  envelope — a future `pkg deps-dag` command will expose it under a
  typed contract. `groups.environmentConstraints` remains raw
  `GenericJSON[]` (no live shape observed yet).
- **Parity assertion policy** (coded in
  `src/tools/package-dependencies-parity.test.ts`):
  - `toEqual` across the service-sourced success fixtures: happy
    flat-runtime, zero-dep (omits `groups`), full-view, optional-
    lifecycle (tokio features), multi-lifecycle filter,
    filter-matched-nothing (`groups: {items: []}`),
    Crates-target-cfg dedup round-trip, versioned match / diff,
    `NOT_FOUND`, `VERSION_NOT_FOUND` with structured details,
    `BACKEND_ERROR`.
  - `toMatchObject` for builder-sourced `INVALID_ARGUMENT` cases:
    unsupported registry (`nuget`), tag-style version (`v4.18.0`),
    unknown lifecycle token (`dev`).

### `package_changelog`

- **Dual addressing — the only pkg-intel tool with it.** `registry`
  + `package_name` XOR `repo_url` on both surfaces. Justified because
  `packageChangelog` is intrinsically repo-level (its
  sources are GitHub Releases, CHANGELOG.md, HexDocs); repo-URL
  isn't a bolt-on, it's a peer addressing mode on the service
  signature. `package_summary` / `package_vulnerabilities` /
  `package_dependencies` omit it because their queries are
  registry-metadata APIs without repo-URL alternatives. Future
  pkg-intel tool authors should not cargo-cult the asymmetry.
- **`<spec>@<version>` rejected.** Other `pkg` commands give
  `@version` a meaning (`for this exact version`), but changelog
  has no single-version query — remapping to `to_version` would be
  a client-invented semantic shift. Both CLI and MCP reject with
  `INVALID_ARGUMENT` and redirect callers to `--to` / `to_version`.
- **Mode mutex enforced client-side.** `--from` / `from_version` +
  `--limit` / `limit` together → `INVALID_ARGUMENT`. The backend's
  same-shape rejection is generic; we catch it with a specific hint
  before the wire.
- **`filter.*` echo tracks explicit fields only.** Request builder
  exposes an `explicitFilterFields` set (`fromVersion`, `toVersion`,
  `limit`, `gitRef`). The envelope builder consults the set before
  emitting `filter.*`, so backend-default values
  (e.g. `limit: 10` from the wire echo) never round-trip as caller
  intent.
- **`entries: { count, items }` shape.** Matches the `runtime:
  { count, items }` convention from `package_dependencies`.
  `entries.count === entries.items.length` by construction; the
  backend's count field is never selected on the wire.
- **`version` kept when null, other per-entry nullables stripped.**
  `version` is the primary key agents index by, so the slot is
  always present (possibly `null`). Other nullable fields
  (`normalizedVersion`, `publishedAt`, `htmlUrl`, `body`) are
  stripped when absent to keep the envelope lean. `body` is
  additionally stripped when `include_bodies: false`.
- **`metadata` dropped.** `ChangelogEntry.metadata` is backend
  `GenericJSON`; v1 envelope drops it entirely rather than
  guessing at its shape. Revisit via agent feedback
  (`TODO(backend)` anchor on the service type).
- **`source: null` promoted to `NOT_FOUND`.** The service layer
  promotes the null-source case to a typed
  `PackageIntelligenceChangelogSourceNotFoundError` which the
  shared classifier routes to `NOT_FOUND` with a message naming
  the sources tried (GitHub Releases, CHANGELOG.md, HexDocs).
  `source: "releases"` + `entries.items: []` is success — "no
  entries in this range" is a legitimate neutral outcome.
- **`--verbose` vs `--no-body` vs `--json` interaction.**
  Default terminal output shows each entry's body truncated at
  10 lines with a `… (+N more lines — use --verbose …)` footer.
  `--verbose` lifts the cap (terminal-only — does not change
  `--json` output). `--no-body` mirrors MCP's `include_bodies:
  false` and affects both terminal (no body preview, no footer)
  and `--json` (entry objects lose the `body` field) — explicit
  opt-out, not silent truncation. `--no-body` + `--verbose` is
  rejected with a specific hint because the two flags contradict.
- **`promoteGenericVersionNotFound` extension.** The shared helper
  now recognises `fromVersion` / `toVersion` in addition to
  `version`. Preference order: `version → fromVersion → toVersion`.
  In repo-URL mode (no `registry` / `packageName`),
  `details.package` is omitted; the error-map handles
  `details.package === undefined` gracefully.
- **Parity assertion policy** (coded in
  `src/tools/package-changelog-parity.test.ts`):
  - `toEqual` across service-sourced fixtures: happy latest mode,
    range mode (`--from` / `from_version`), repo-URL addressing,
    `--no-body` / `include_bodies: false`, default bodies, empty
    entries, `NOT_FOUND` (no source), `PackageIntelligenceTargetNotFoundError`
    (package missing), `VERSION_NOT_FOUND` with structured details,
    `BACKEND_ERROR`.
  - `toMatchObject` for builder-sourced `INVALID_ARGUMENT` cases:
    `<spec>@<version>` rejection, `--from` + `--limit` mutex.

### `list_files` / `read_file` / `grep_repo` (file-exploration bundle)

All three reuse `codeTargetSchema` + `resolveCodeTarget` from
`src/tools/code-navigation-shared.ts`. The indexing lifecycle is
shared (see `tools.md` "Indexing lifecycle" section). Parity
tests cover dual addressing, default + explicit filter echoes,
INDEXING error envelope, NOT_FOUND envelope, and INVALID_ARGUMENT
with full envelope shape (`{error, code, retryable}`) — the
partial-match policy is deliberately *not* used on INVALID_ARGUMENT
so envelope-drift surfaces in the test rather than at an agent.

- **`list_files`**: `filter.path_prefix` / `filter.limit` echo
  only when explicit. Default `limit: 200` never round-trips.
  Backend returns `total` capped at returned count when
  `hasMore: true`; terminal formatter renders `N+` to avoid
  misleading users.
- **`read_file`**: envelope uses `path` (not `filePath`) to
  match `list_files.files[].path`, so agent chains mechanically.
  Binary files: `isBinary: true` + `content` omitted (not
  `null`). Parity fixture locks this in. `fetchCodeContext`
  on the backend doesn't return `availableVersions` on
  INDEXING responses, so its `details` block carries only
  `indexingRef` — MCP description calls this out explicitly.
- **`grep_repo`**: `GREP_REPO_PATTERN_NOTE` constant
  (exported from `grep-repo-request.ts`) ensures the
  literal-vs-regex disclosure is identical in the MCP
  description, MCP `pattern` field describe, and CLI help text.
  The shared request builder compiles `path`, `path_prefix`, and
  `globs` into backend `pathSelectors`, keeps `allowUnscoped`
  internal-only, and defaults grep to whole-target, literal,
  ASCII case-insensitive matching; non-ASCII letters match
  case-sensitively. Whole-target regexes must include at least one
  literal substring the backend index can use for pre-filtering.
  `symbol_fields` / `--symbol-field` passes backend symbol hydration
  field names through to `symbolFields` and the response envelope
  carries `matches[].symbol` when the backend hydrates it. The shared
  response builder keeps CLI `--json` and MCP payloads byte-identical
  for equivalent inputs.

- **Parity assertion policy** (coded in the three parity
  tests):
  - `toEqual` across service-sourced fixtures: happy (package
    and repo-URL addressing), filter echoes, INDEXING, NOT_FOUND,
    and (for `read_file`) the binary fixture; (for
    `read_file`) FILE_NOT_FOUND and line range.
  - `toMatchObject` with explicit `retryable: false` assertion
    for builder-sourced `INVALID_ARGUMENT` — both surfaces
    must emit the same envelope keys so drift is loud.
