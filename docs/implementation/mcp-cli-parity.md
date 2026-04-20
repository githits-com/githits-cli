# MCP ↔ CLI Parity

## Purpose

Both the MCP tool (`search_symbols`) and the CLI command (`githits code
search`) expose the code-navigation feature. Users and agents should be
able to cross the surface boundary without learning a new shape —
parameter names differ per surface convention, but defaults, error
behaviour, and the serialised payload do not.

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
- **Public enum values** are lowercase strings on both surfaces
  (`production`, `test`, `summary`, `all`).
- **Backend coercion** from lowercase enum values to the uppercase
  GraphQL enum variants lives in `src/shared/code-navigation.ts`
  (`toSearchSymbolsFileIntent`, `toSearchSymbolsKind`,
  `toSearchSymbolsMatchMode`).

### `PARITY-DEFAULTS`

- Both surfaces import defaults from
  `src/shared/code-navigation-defaults.ts`. They never diverge
  silently.
- Cross-tool defaults (e.g. `DEFAULT_WAIT_TIMEOUT_MS`) live without a
  prefix. Tool-specific defaults carry a tool-name prefix
  (`SEARCH_SYMBOLS_DEFAULT_FILE_INTENT`) so tool #2 declaring its own
  defaults in the same file does not cause naming churn.
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
  `"all"` when the caller chose the all-intents sentinel.
- `returnedCount` is an explicit echo of `results.length`.
  `totalMatches` is the backend-provided total (equal to
  `returnedCount` today; see backend request B2 for the future
  upgrade).

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
- [ ] MCP tool description mirrored in the backend MCP server before
  public release (coordination point — the CLI may lead; the backend
  PR URL is recorded in the plan doc before the frontend PR merges).

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
| `src/shared/code-navigation-defaults.ts` | Canonical defaults and sentinels. |
| `src/shared/code-navigation-error-map.ts` | `mapCodeNavigationError` classifier and `MappedError` union. |
| `src/shared/pkgseer-graphql.ts` | Low-level authenticated POST helper shared by every service that talks to the upstream endpoint. |
| `src/shared/pkgseer-registry.ts` | Registry taxonomy (`PkgseerRegistry` union + lowercase↔uppercase converters). |
| `src/shared/search-symbols-request.ts` | Shared request builder for `search_symbols`. |
| `src/shared/search-symbols-response.ts` | Shared JSON envelope builders for `search_symbols`. |
| `src/shared/package-summary-request.ts` | Shared request builder for `package_summary`. |
| `src/shared/package-summary-response.ts` | Lean JSON envelope builder and terminal formatter for `package_summary`. |
| `src/shared/package-vulnerabilities-request.ts` | Shared request builder for `package_vulnerabilities`; owns the tool-local `supportsVulnerabilitiesRegistry` predicate and the severity-label → CVSS float map. |
| `src/shared/package-vulnerabilities-response.ts` | Lean JSON envelope builder for `package_vulnerabilities` (shared); terminal formatter (CLI-only). |
| `src/shared/package-dependencies-request.ts` | Shared request builder for `package_dependencies`; owns `supportsDependenciesRegistry` + lifecycle / depth validation. |
| `src/shared/package-dependencies-response.ts` | Lean JSON envelope builder for `package_dependencies` (shared); terminal formatter (CLI-only). |
| `src/shared/package-intelligence-error-map.ts` | `mapPackageIntelligenceError` classifier (reuses `MappedError` from the code-nav map). |
| `src/services/promote-version-not-found.ts` | Shared helper that promotes generic backend errors with "no matching version" messages into typed `VERSION_NOT_FOUND`. Used by `packageVulnerabilities` and `packageDependencies` executors. |
| `src/tools/search-symbols.ts` | MCP tool definition for `search_symbols`. |
| `src/tools/package-summary.ts` | MCP tool definition for `package_summary`. |
| `src/tools/package-vulnerabilities.ts` | MCP tool definition for `package_vulnerabilities`. |
| `src/tools/package-dependencies.ts` | MCP tool definition for `package_dependencies`. |
| `src/commands/code/search-symbols.ts` | CLI command. |
| `src/commands/pkg/info.ts` | CLI command for `pkg info`. |
| `src/commands/pkg/vulns.ts` | CLI command for `pkg vulns`. |
| `src/commands/pkg/deps.ts` | CLI command for `pkg deps`. |
| `src/tools/search-symbols-parity.test.ts` | Parity tests (cite rule IDs). |
| `src/tools/package-summary-parity.test.ts` | Parity tests for `package_summary` (cite rule IDs). |
| `src/tools/package-vulnerabilities-parity.test.ts` | Parity tests for `package_vulnerabilities` (cite rule IDs). |
| `src/tools/package-dependencies-parity.test.ts` | Parity tests for `package_dependencies` (cite rule IDs). |

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
  straight to the GraphQL query; the backend's `vulnerabilityCount`
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
  fields sourced from GraphQL `extensions` (`packageName`,
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
