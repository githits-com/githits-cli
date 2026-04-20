# CLI Commands

## Purpose

The CLI exposes three primary commands (`search`, `languages`, `feedback`) that mirror the public MCP tools for direct human and agent use. It also has a capability-gated `code search` command that searches indexed dependency source via the code-navigation backend. These commands share business logic with the MCP tools through the same service interfaces and shared utilities, but format output for terminal consumption instead of MCP tool results.

## Commands

| Command | Required Args | Options | Description |
|---|---|---|---|
| `init` | — | `-y, --yes`, `--skip-login` | Authenticate and set up MCP server for coding agents |
| `search <query>` | `-l, --lang <language>` | `--license <mode>`, `--explain`, `--json` | Search for code examples |
| `languages [query]` | — | `--json` | List or filter supported languages |
| `feedback <solution_id>` | `--accept` or `--reject` | `-m, --message <text>`, `--json` | Submit feedback on a search result |
| `code search <package> [query]` | package spec | `--keywords`, `--keyword`, `--match-mode`, `--category`, `--kind`, `--file`, `--intent`, `--limit`, `--wait`, `--json` | Search indexed dependency source code |
| `pkg info <spec>` | package spec | `--verbose`, `--json` | Show a package overview (latest version, downloads, license, vulnerabilities) |
| `pkg vulns <spec>` | package spec (optional `@version`) | `--severity`, `--include-withdrawn`, `--verbose`, `--json` | List known vulnerabilities for a package (npm/pypi/hex/crates) |
| `pkg deps <spec>` | package spec (optional `@version`) | `--groups`, `--lifecycle`, `--transitive`, `--depth`, `--verbose`, `--json` | Analyse dependencies: direct runtime deps, structured groups, optional transitive graph (npm/pypi/hex/crates/vcpkg/zig) |

### `githits init`

```
githits init              # Interactive: authenticate, scan, configure unconfigured agents
githits init --yes        # Non-interactive: authenticate, configure all unconfigured agents
githits init --skip-login # Skip authentication, configure tools only
```

Authenticates with GitHits (via OAuth in the browser), then scans for available coding agents, checks which are already configured, and sets up unconfigured ones with your confirmation. All agents are pre-checked before any setup begins, so the status display is fully resolved. CLI agents are considered available only when their executable is on `PATH`; related dot-directories alone do not count. Config-file agents remain filesystem-detected using their known app/config directories. If already authenticated, the login step is skipped automatically. If login fails, the user is prompted to continue with tool setup anyway. If all detected agents are already configured, exits early with a summary.

Supports Claude Code, Cursor, Windsurf, VS Code / Copilot, Cline, Claude Desktop, Codex CLI, Gemini CLI, and Google Antigravity. Uses plugin install (Claude Code), CLI commands (Codex, Gemini CLI), and atomic config file writes (Cursor, Windsurf, VS Code, Cline, Claude Desktop, Google Antigravity). CLI agents use read-only check commands (e.g., `claude plugin list`) to determine configuration status before prompting.

The command uses `createContainer()` lazily for the login step. Tool detection and configuration use lightweight dependencies that don't require auth.

**File structure:** The init command uses a subdirectory (`src/commands/init/`) because it has distinct submodules (agent definitions, setup handlers, orchestrator). This is an accepted variation for commands with significant internal complexity.

### `githits search`

```
githits search "how to use express middleware" --lang javascript
githits search "async file reading" -l python --license yolo
githits search "react hooks patterns" -l typescript --explain
githits search "react hooks patterns" -l typescript --json
```

Default output is markdown (the API response). With `--explain`, an AI-generated explanation is included alongside the code example. With `--json`, output is `{ "result": "<markdown>" }`. The MCP `search` tool always sends `include_explanation: false` since LLMs don't need the extra context.

### `githits languages`

```
githits languages              # list all supported languages
githits languages python       # filter by name/alias (top 5)
githits languages type --json  # JSON output for piping
```

Without a query, lists all languages. With a query, filters to top 5 matches using the same logic as the `search_language` MCP tool (case-insensitive substring match on name, display_name, and aliases). Default output uses colored terminal formatting. JSON output is `[{ "name": "...", "display_name": "..." }, ...]`.

### `githits feedback`

```
githits feedback abc123 --accept
githits feedback abc123 --reject -m "Example was outdated"
githits feedback abc123 --accept --message "Solved my problem" --json
```

`--accept` and `--reject` are mutually exclusive (enforced by Commander's `.conflicts()` API). At least one must be provided (validated in the action function). JSON output is `{ "success": true, "message": "..." }`.

### `githits code search`

```
githits code search npm:express middleware
githits code search npm:express middleware --intent all
githits code search pypi:requests timeout --category callable --limit 10
githits code search crates:serde Serialize --kind trait --limit 5
githits code search npm:@types/node Buffer --file src/ --json
githits code search npm:express --keywords "router,handler" --match-mode and
```

Finds functions, classes, modules, and doc sections inside an indexed dependency by exact-token matches. Unlike `githits search`, which performs natural-language code example search, `code search` is symbol-oriented and returns source chunks with line ranges.

**Package spec.** `<registry>:<name>[@<version>]`. Omit the registry to default to `npm`. Supported registries: `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `zig`, `vcpkg`, `packagist`. Scoped npm names are supported (`npm:@types/node`).

**Filtering by symbol shape.** Prefer `--category` for broad filtering (`callable`, `type`, `module`, `data`, `documentation`) — it works across the full 27-value kind taxonomy without enumerating individual kinds. Reach for `--kind` when you want a specific construct, e.g. `--kind trait` (Rust) or `--kind namespace` (C#/C++/PHP).

**Defaults.** `--intent production` filters to production source by default so top results are not dominated by tests, benchmarks, or examples. Use `--intent all` to include every file intent. `--wait` defaults to 20 seconds (above the p50 indexing time of ~11 s); first-time queries against an unindexed package may need `--wait 60` (the backend ceiling) to block until indexing completes. On an INDEXING error, the response message points out the retry options.

**Output.** Default terminal output leads each entry with `path:startLine-endLine [kind]`, followed by the symbol name and a 3-line dedented snippet. `--json` emits the shared success/error envelope also produced by the MCP `search_symbols` tool — see [`mcp-cli-parity.md`](./mcp-cli-parity.md) for the wire contract. The command is registered as `code search` with `code search-symbols` as a Commander alias.

**Capability gate.** The `code` group is registered only when the startup token advertises `code_navigation`, when `GITHITS_CODE_NAVIGATION=1` is set for local override, when `GITHITS_API_TOKEN` is present (opaque env token), or when stored auth is expired.

**Troubleshooting.** Set `GITHITS_DEBUG=code-nav` to emit single-line JSON diagnostics to stderr on error paths. Include the output when filing an issue. Debug payloads never contain query text, tokens, or response bodies.

### `githits pkg info`

```
githits pkg info npm:express
githits pkg info pypi:requests --verbose
githits pkg info crates:serde --json
githits pkg info npm:@types/node
```

Shows a concise overview for a single package: latest version, license, description, repository + homepage, publication date, download count, GitHub metadata, install command, and known vulnerabilities. Default output is a compact terminal block. `--verbose` adds usage snippet, recent advisories, topics, and a recent-changes list. `--json` emits the lean hand-crafted envelope — every null field is omitted, every block that carries no actionable data is omitted entirely.

**Package spec.** `<registry>:<name>`. Registries: `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `zig`, `vcpkg`, `packagist`. Scoped npm names (`npm:@types/node`) are supported.

**Always latest.** `pkg info` returns the latest published version regardless of input. Passing `<spec>@<version>` is rejected with `INVALID_ARGUMENT` and a clear message — the tool never silently swaps to latest. Use `pkg vulns` (supports `@version`) or `pkg deps` (future) for version-pinned queries.

**`--verbose` + `--json`.** `--verbose` has no effect under `--json` — the JSON envelope always carries every field the verbose terminal view exposes (and more). The flag only affects human-readable output.

**Output envelope.** Success payload is hand-crafted for agent token efficiency: `{registry, name, version, description?, license?, homepage?, repository?, publishedAt?, downloads?, github?, install?, usage?, vulnerabilities?, recentChanges?}`. Omitted fields reflect backend nulls, not dropped data. Error envelope: `{error, code, retryable, details?}` — same shape as `search_symbols`, same classifier family. Under `--json` the error envelope is written to **stderr** so stdout stays clean for `jq`.

**Capability gate.** Same as `code`: `code_navigation` capability on the token, `GITHITS_CODE_NAVIGATION=1` override, `GITHITS_API_TOKEN` env token, or expired stored auth.

**Troubleshooting.** `GITHITS_DEBUG=pkg-intel` emits PII-safe classified-error diagnostics (area, event, code, error class, detail keys). `GITHITS_DEBUG=pkg-graphql` emits transport-failure diagnostics from inside the POST helper. Use `GITHITS_DEBUG=*` to enable both.

### `githits pkg vulns`

```
githits pkg vulns npm:express
githits pkg vulns npm:express@4.17.0
githits pkg vulns pypi:requests --severity high
githits pkg vulns crates:serde --json
githits pkg vulns npm:minimatch --include-withdrawn --verbose
```

Lists known CVE / OSV advisories for a package: severity, affected version ranges, fix versions, and upgrade targets. Malicious-package advisories (supply-chain attacks flagged by OSV) surface in a separate `MALWARE` bucket that sorts above all CVE advisories.

**Package spec.** `<registry>:<name>[@<version>]`. Unlike `pkg info`, `pkg vulns` supports `@<version>` because the backend query accepts a concrete version (useful for checking an older pinned release). Only `npm`, `pypi`, `hex`, and `crates` support vulnerability data; other registries are rejected client-side with `pkg vulns only supports npm, pypi, hex, and crates. Got: ${registry}.`

**Filtering.** `--severity low|medium|high|critical` maps to a CVSS float threshold (`low=0.1, medium=4, high=7, critical=9`) and goes server-side. The backend's returned `vulnerabilityCount` reflects the filtered set — no client-side filtering, no dual-summary block. Callers wanting the full picture omit the flag. `--include-withdrawn` sends `includeWithdrawn: true` to the backend; withdrawn advisories bucket below active ones in the terminal list.

**Zero-vulns hot path.** The common case (clean package) renders as header + one-line summary body (`No known vulnerabilities.`) — no breakdown, no advisory list, no footer. Agents checking "am I safe?" pay minimal token cost on the happy path.

**Version validation.** `pkg vulns` expects canonical package versions. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` and an actionable message telling the caller to drop the leading `v`, instead of forwarding the request to the backend and surfacing its current generic failure.

**Malware marker.** Advisories with `isMalicious: true` render with a red/bold `MALWARE` column (optionally combined as `MALWARE · crit` when both flags exist). Count surfaces in the summary breakdown line as `N MALWARE · N crit · …`. Buckets partition every returned advisory: `MALWARE + crit + high + medium + low + unrated = advisories.length`, which equals `summary.total` when the backend keeps its count and list consistent. Non-malicious advisories without a CVSS score bucket under `unrated` so the breakdown reconciles with the header total (common for PyPI / Rust advisories where CVSS may be absent).

**Affected-range truncation (terminal-width aware).** The `affected` detail row under each advisory caps at 4 ranges on narrow terminals (≤119 cols), 6 on standard-wide (120–159 cols), and 8 on ultrawide (≥160 cols). The remainder collapses into a dim `… (+N more; use -v)` hint. Verbose mode (`-v`) shows every range. JSON output is never truncated — machine consumers get the full list.

**Unrated severity column.** Advisories with no CVSS score (common on RUSTSEC / PYSEC upstreams) render with a dim `unrated` label in the severity column rather than an empty gutter, matching the header-breakdown vocabulary. They sort below banded advisories within the active bucket.

**Placeholder summary stripping.** When the upstream advisory feed returns the literal string `No summary available` (an OSV convention), both the JSON envelope and the terminal row drop the field entirely — absence of `summary` is the signal, and the advisory row is shorter as a result.

**Upgrade-path ordering.** `upgradePaths` are de-duplicated and sorted ascending by semver-ish comparison (pre-release suffixes rank below the matching base release), so the footer presents the minimum-churn upgrade first: `Upgrade options: 3.11.0, 4.0.0-rc1, 4.5.0, 4.19.2, …` rather than the backend's advisory-iteration order.

**Output envelope.** `{registry, name, version, requestedVersion?, summary: {total, affected?, bySeverity?}, advisories?, upgradePaths?}`. Each advisory: `{id?, aliases?, summary?, severity?, severityLabel?, affectedRanges?, fixedIn?, publishedAt?, modifiedAt?, withdrawnAt?, isMalicious?}`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Exit codes.** 0 on success including zero-vulns; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Capability gate.** Same as `pkg info` (inherits from the `code_navigation` token capability).

**Troubleshooting.** Same debug areas as `pkg info` (`GITHITS_DEBUG=pkg-intel` for classified errors; `GITHITS_DEBUG=pkg-graphql` for transport failures).

### `githits pkg deps`

```
githits pkg deps npm:express
githits pkg deps npm:express --groups
githits pkg deps crates:tokio --lifecycle optional
githits pkg deps npm:express --lifecycle runtime,development
githits pkg deps npm:express --transitive
githits pkg deps npm:express --transitive --depth 2
githits pkg deps npm:express --json
```

Analyses dependencies for a package on npm, PyPI, Hex, Crates, vcpkg, or Zig. Default terminal output is a flat list of direct runtime dependencies with a hint summarising hidden groups.

**Package spec.** `<registry>:<name>[@<version>]`. `@<version>` is accepted (same as `pkg vulns`); defaults to latest. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` — callers must use the canonical version. Only `npm`, `pypi`, `hex`, `crates`, `vcpkg`, and `zig` are supported; other registries are rejected client-side with `pkg deps only supports npm, pypi, hex, crates, vcpkg, and zig. Got: ${registry}.`

**Two views.** The default runtime view collapses to a single-column list from `dependencies.direct` — the flat answer to "what does this pull in?". The structured groups view (`--groups`, or implicitly via `--lifecycle`) iterates `dependencyGroups.groups` and preserves registry-specific condition metadata (PyPI extras, Crates features). Dev / peer / build / optional deps live only in the groups view — the wire's `direct[]` is always runtime-only.

**Lifecycle filter.** `-l, --lifecycle <phases>` accepts a comma-separated list of canonical lowercase tokens (`runtime`, `development`, `build`, `peer`, `optional`). Uppercase and whitespace are tolerated. Filters server-side via the backend's `lifecycle: [String!]` input, which only affects `dependencyGroups`; `direct[]` and `transitive[]` are returned regardless. Unknown tokens are rejected with `INVALID_ARGUMENT` and the canonical list.

**Groups view (`--groups` or any `--lifecycle`).** Headings collapse to `name` when `conditionType === "always"` (e.g. `runtime`, `development`). Feature / TFM groups render `name (lifecycle, conditionType[: conditionValue])` — `conditionValue` is omitted when it equals `name` (the common case on Crates features and PyPI extras). Within each group, entries sort alphabetically. Duplicate `{name, constraint}` tuples inside a group collapse in the terminal for scannability; the JSON envelope preserves every duplicate the backend emitted.

**Transitive view (`--transitive`).** Replaces the direct-deps list with the full unique transitive closure (alphabetical, `name@version`, one per line). Summary row carries the aggregate counts + conflict / cycle counts, and `(max depth N)` only when `--depth` was applied — otherwise the backend's full-graph traversal is shown. `--depth <n>` (1–10) caps traversal; there is **no client-side default cap** (matches `npm ls` / `cargo tree` ergonomics).

**Verbose (`--verbose`).** In both plain and transitive modes, each dep expands to a multi-line block: the first line is `name@version`, followed by indented `- <constraint> required by <importer>@<importer-version>, …` bullets. Importers that share a constraint are collapsed onto one bullet with a comma-separated list. In plain mode each direct dep has exactly one importer (the root package itself); in transitive mode a popular leaf may list many importers grouped by constraint. Conflicts expand into a `Conflicts (N):` table (`name: range1, range2, …`, one row per package); circular dependencies expand into a `Circular dependencies (N):` list (`a → b → a` arrow chain).

**JSON envelope.** Preprocessed: `runtime.items[].version` surfaces the resolved version alongside the constraint. Under `--transitive`, `transitive.packages[]` carries `{name, version}` records by default; `--verbose` opts each entry into an `importers[]` array with importer name / version / constraint (roughly quadruples envelope size on heavy graphs, so it's off by default). `transitive.conflicts[]` and `transitive.circularDependencies[]` are typed (`{name, requiredVersions}` / `{cycle: string[]}`) when the observed backend shape decodes; raw passthrough otherwise. The raw DAG itself is deliberately **not** in the envelope — a future dedicated `pkg deps-dag` command will expose it under a typed contract for graph visualisation (mermaid / DOT / interactive viewer).

**Output envelope.** `{registry, name, version, requestedVersion?, runtime?, groups?, transitive?, filter?}`. Data-first: the `runtime` block emits whenever the backend returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages); the `groups` block emits whenever the backend returned `dependencyGroups` (including `{items: []}` when a lifecycle filter matched nothing, so agents distinguish "backend has no groups concept" from "filter excluded everything"). Each group carries its members under `items` (matches the top-level `runtime.items` naming so dependency lists share one key throughout the envelope). `filter.lifecycles` echoes the canonicalised, deduplicated, display-order-sorted list the backend received — not the raw CSV input.

**Exit codes.** 0 on success including zero-dep packages; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Capability gate.** Same as `pkg info` / `pkg vulns` (inherits from the `code_navigation` token capability).

**Troubleshooting.** Same debug areas as `pkg info` / `pkg vulns` (`GITHITS_DEBUG=pkg-intel` for classified errors; `GITHITS_DEBUG=pkg-graphql` for transport failures).

## Architecture

```
CLI command (src/commands/search.ts)
  └─ searchAction(query, options, deps)
       ├─ requireAuth(deps)
       └─ deps.githitsService.search(params)
            └─ GitHitsServiceImpl makes REST API call
```

Each command follows this pattern:

1. **Focused dependency interface** — Only the deps the action needs (e.g., `SearchDependencies`), not the full `Dependencies` container
2. **Testable action function** — Pure logic that accepts deps via parameter injection
3. **Registration function** — `registerXxxCommand(program)` handles Commander setup with lazy `createContainer()` inside the action callback

### Shared Code with MCP Tools

| Shared Module | Used By |
|---|---|
| `GitHitsService` (via container) | Public MCP tools + primary CLI commands |
| `CodeNavigationService` (via container) | Capability-gated `search_symbols` MCP tool + `githits code search` CLI command |
| `filterLanguages()` from `src/shared/language-filter.ts` | `search_language` MCP tool + `languages` CLI command |
| `requireAuth()` from `src/shared/require-auth.ts` | MCP server startup + all CLI commands |

## Adding a New CLI Command

1. **Create command file** — `src/commands/new-command.ts` with `XxxDependencies` interface, `xxxAction()`, and `registerXxxCommand()`
2. **Create test file** — `src/commands/new-command.test.ts` testing action directly via deps injection
3. **Export from barrel** — Add to `src/commands/index.ts`
4. **Register in CLI** — Import and call `registerXxxCommand(program)` in `src/cli.ts`
5. **Update help text** — If the command is a primary workflow, add it to the `addHelpText("after", ...)` block

For complex commands with multiple submodules, a subdirectory (`src/commands/xxx/`) with an `index.ts` barrel is acceptable (see `init` command for example).

## Error Handling

- **Auth errors** — `requireAuth()` prints instructions and calls `process.exit(1)`
- **Service errors** — Caught in action, printed to stderr via `console.error("Failed to <operation>: <message>")`, then `process.exit(1)`
- **Validation errors** — Checked before service call (e.g., feedback's neither-flag check), printed to stderr, `process.exit(1)`

## Output Modes

All commands support two output modes:

- **Default** — Human-readable terminal output (markdown for search, colored list for languages, plain text for feedback)
- **`--json`** — Machine-readable JSON for piping to `jq`, other tools, or agent consumption

## Global Flags

- **`--no-color`** — Disables colored output by setting `NO_COLOR=1` env var via a root-level `preAction` hook. All downstream `shouldUseColors()` calls pick it up automatically.

## Key Reference Files

| File | Purpose |
|---|---|
| `src/commands/search.ts` | Search command implementation |
| `src/commands/languages.ts` | Languages command with colored output |
| `src/commands/feedback.ts` | Feedback command with accept/reject validation |
| `src/shared/language-filter.ts` | Pure `filterLanguages()` shared with MCP tool |
| `src/shared/require-auth.ts` | Auth guard shared with MCP server |
| `src/shared/colors.ts` | ANSI color utilities and `shouldUseColors()` |
| `src/container.ts` | Dependency container with `githitsService` |
| `src/commands/init/init.ts` | Init command orchestrator |
| `src/commands/init/agent-definitions.ts` | Agent detection and setup config |
| `src/commands/init/setup-handlers.ts` | CLI exec and config file merge logic |
| `src/services/prompt-service.ts` | Interactive prompt abstraction |
| `src/services/exec-service.ts` | CLI command execution abstraction |

## Related Documentation

- [`tools.md`](./tools.md) — MCP tools that share business logic with these commands
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — DI and testing patterns
