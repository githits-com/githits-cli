# CLI Commands

## Purpose

The CLI exposes three always-on top-level commands: `example`, `languages`, and `feedback`. Indexed dependency/package surfaces are capability-gated: top-level `search` / `search-status` plus the `code` and `pkg` command groups are shown only when the startup token explicitly carries `code_navigation`, or when `GITHITS_CODE_NAVIGATION=1` is set locally for development. All of these commands share business logic with the MCP tools through the same service interfaces and shared utilities, but format output for terminal consumption instead of MCP tool results.

## Commands

| Command | Required Args | Options | Description |
|---|---|---|---|
| `init` | — | `-y, --yes`, `--skip-login` | Authenticate and set up MCP server for coding agents |
| `example <query>` | `-l, --lang <language>` | `--license <mode>`, `--explain`, `--json` | Search for code examples |
| `search <query>` | `--in <target>` | `--source <source>`, `--kind <kind>`, `--category <category>`, `--path-prefix <prefix>`, `--intent <intent>`, `--public`, `--name <name>`, `--lang <language>`, `--allow-partial`, `--limit <n>`, `--offset <n>`, `--wait <seconds>`, `--json` | Unified indexed search across dependency/repository code, docs, and symbols |
| `search-status <search-ref>` | `<search-ref>` | `--json` | Check progress, fetch partial hits, or fetch final results for a prior unified search |
| `languages [query]` | — | `--json` | List or filter supported languages |
| `feedback <solution_id>` | `--accept` or `--reject` | `-m, --message <text>`, `--json` | Submit feedback on a search result |
| `code search <package> [query]` | package spec | `--keywords`, `--keyword`, `--match-mode`, `--category`, `--kind`, `--file`, `--intent`, `--limit`, `--wait`, `--json` | Search indexed dependency source code |
| `pkg info <spec>` | package spec | `--verbose`, `--json` | Show a package overview (latest version, downloads, license, vulnerabilities) |
| `pkg vulns <spec>` | package spec (optional `@version`) | `--severity`, `--include-withdrawn`, `--verbose`, `--json` | List known vulnerabilities for a package (npm/pypi/hex/crates) |
| `pkg deps <spec>` | package spec (optional `@version`) | `--groups`, `--lifecycle`, `--transitive`, `--depth`, `--verbose`, `--json` | Analyse dependencies: direct runtime deps, structured groups, optional transitive graph (npm/pypi/hex/crates/vcpkg/zig) |
| `pkg changelog [spec]` | package spec OR `--repo-url` | `--from`, `--to`, `--limit`, `--git-ref`, `--no-body`, `--verbose`, `--json` | Release notes / changelog entries for a package or GitHub repo (GitHub Releases, CHANGELOG.md, or HexDocs). Default shows each entry with a 10-line body preview; `--verbose` uncaps, `--no-body` drops. |
| `code files [spec] [path-prefix]` | package spec OR `--repo-url` + `--git-ref`; optional `[path-prefix]` | `--limit`, `--wait`, `--verbose`, `--json` | List files in an indexed dependency. `[path-prefix]` is a literal directory prefix (not a glob). Plain output is one path per line; `--verbose` adds language / type / size annotations. Indexing-retry via `--wait` or the `availableVersions` hint in the error envelope. |
| `code read <spec?> <path>` | package spec OR `--repo-url` + `--git-ref`; plus `<path>` | `--lines`, `--start`, `--end`, `--wait`, `--verbose`, `--json` | Read a file's contents. Plain output is the raw file bytes (pipe-friendly); `--verbose` adds a header and a line-number gutter. `--lines 10-40` concise form; `--start`/`--end` equivalent. Binary files show a sentinel line. |
| `code grep [spec] <pattern> [path-prefix]` | package spec OR `--repo-url` + `--git-ref`; plus `<pattern>` and optional `[path-prefix]` | `--path`, repeatable `--glob`, repeatable `--ext`, `--regex`, `--case-sensitive`, `-C/-A/-B`, `--exclude-docs`, `--exclude-tests`, `--limit`, `--per-file-limit`, `--cursor`, `--symbol-field`, `--wait`, `--verbose`, `--json` | Deterministic text grep over indexed dependency or repository source. Defaults to whole-target, literal, ASCII case-insensitive matching; non-ASCII letters match case-sensitively. Narrow with `[path-prefix]`, `--path`, `--glob`, or `--ext`. Plain output is `file:line:text`; `--verbose` groups matches by file. |

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

### `githits example`

```
githits example "how to use express middleware" --lang javascript
githits example "async file reading" -l python --license yolo
githits example "react hooks patterns" -l typescript --explain
githits example "react hooks patterns" -l typescript --json
```

Default output is markdown (the API response). With `--explain`, an AI-generated explanation is included alongside the code example. With `--json`, output is `{ "result": "<markdown>" }`. The MCP `get_example` tool always sends `include_explanation: false` since LLMs don't need the extra context.

### `githits search`

```
githits search "router middleware" --in npm:express
githits search '"body parser" OR multer' --in npm:express --source docs
githits search "compose" --in npm:lodash --source code --kind function
githits search "debounce" --in npm:lodash --source symbol
githits search "composeArgs" --in npm:lodash --name composeArgs --json
```

Unified search spans indexed dependency and repository code, docs, and explicit symbols. The positional query is the backend discovery syntax, not a raw pass-through to a per-source search engine. It supports implicit `AND`, uppercase `OR`, parentheses, unary `-`, quoted phrases, semantic qualifiers (`kind:`, `category:`, `path:`, `lang:`, `name:`, `intent:`), and routing qualifiers (`registry:`, `package:`, `version:`, `repo:`). Structured flags are compiled together with the query using `AND` semantics before the request reaches the backend.

**Decision guide.** Use `githits example` for canonical cross-project examples. Use `githits search` for indexed dependency/repository search. Use `githits search --source symbol` when you want symbol-shaped unified search without dropping to the older dedicated `code search` surface.

**Targets.** `--in <target>` is repeatable and required. Package targets use `registry:name[@version]` (for example `npm:express`, `pypi:requests@2.32.3`). Repo targets use `https://github.com/org/repo[#ref]`; omitted refs default to `HEAD`. Exact duplicate targets are deduplicated while preserving order. Mixing package and repo targets in the same request is rejected client-side.

**Sources and filters.** `--source docs|code|symbol` is repeatable; omitting it delegates source selection to backend AUTO. Use `--source symbol` when you want symbol-shaped search results without dropping down to the older `code search` surface. `--category` is the broad filter (`callable`, `type`, `module`, `data`, `documentation`); `--kind` is the precise taxonomy. `--path-prefix`, `--intent`, and `--public` narrow the result set further. `--name` and `--lang` compile into query qualifiers instead of becoming separate backend fields.

**Production intent by default.** When `--intent` is omitted, unified search defaults to `production` intent for AUTO, code, and symbol searches. This removes test / benchmark / example noise where the backend supports the filter. Explicit docs-only searches do not get a file-intent default because docs do not support that filter. Some sources can still ignore `fileIntent`; when they do, the JSON `sourceStatus` block and terminal notes report that explicitly.

**Complete-by-default results.** The CLI sends `allowPartialResults: false` unless `--allow-partial` is passed. If indexing does not complete within the wait window, the default behavior returns a `searchRef` and progress summary instead of partial hits. With `--allow-partial`, available hits are included while remaining sources continue indexing. `--wait` is in seconds (0-60, default 20).

**Output.** Plain output preserves backend ranking order. It starts with a lightweight per-type count summary, then shows one result per block. The header line is optimized for scanning and copy-paste follow-up: `target path:range [type] - title`. For file-backed hits, that header can be turned directly into a `githits code read` call because `code read` accepts `path:start-end` suffixes. Summaries are rendered verbatim from the backend response. Labels are: `docs page` (hosted package docs), `repo doc` (documentation-like block from a repository file), `repo code` (code block from a repository file), and `repo symbol` (explicit symbol hit from the repository index). `--json` emits the shared success/error envelope used by the MCP `search` tool, including a full `query` echo for initial searches.

**Highlighting.** The CLI currently highlights headers and badges structurally, but does **not** attempt query-term match highlighting inside summaries. Unified search receives compiled query strings, not structured match spans, so robust highlighting should come from backend-provided match metadata rather than fragile client-side substring guesses.

### `githits search-status`

```
githits search-status ref_abc123
githits search-status ref_abc123 --json
```

Follow-up for a prior unified search. Use the `searchRef` returned by `githits search` when the initial request could not complete inside the wait window. If the original request used `--allow-partial`, `search-status` can return updated partial hits before final completion.

`search-status` deliberately does **not** reconstruct the original structured request echo. The backend status API exposes progress, final results, and the backend-normalized query string, but it does not expose the original target/filter/defaulting inputs. The JSON payload therefore contains only fields the follow-up endpoint can actually know: `{completed, searchRef?, progress?, result?}`.

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

This is now the older symbol-search surface. Prefer top-level `githits search --source symbol` for new flows unless you specifically need the legacy code-search UX or its exact JSON contract.

```
githits code search npm:express middleware
githits code search npm:express middleware --intent all
githits code search pypi:requests timeout --category callable --limit 10
githits code search crates:serde Serialize --kind trait --limit 5
githits code search npm:@types/node Buffer --file src/ --json
githits code search npm:express --keywords "router,handler" --match-mode and
```

Finds functions, classes, modules, and doc sections inside an indexed dependency by exact-token matches. Top-level `githits search --source symbol` is the preferred unified surface for symbol-shaped search. `code search` remains available for the older dedicated symbol-search UX and parity contract.

**Package spec.** `<registry>:<name>[@<version>]`. Omit the registry to default to `npm`. Supported registries: `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `zig`, `vcpkg`, `packagist`. Scoped npm names are supported (`npm:@types/node`).

**Filtering by symbol shape.** Prefer `--category` for broad filtering (`callable`, `type`, `module`, `data`, `documentation`) — it works across the full 27-value kind taxonomy without enumerating individual kinds. Reach for `--kind` when you want a specific construct, e.g. `--kind trait` (Rust) or `--kind namespace` (C#/C++/PHP).

**Defaults.** `--intent production` filters to production source by default so top results are not dominated by tests, benchmarks, or examples. Use `--intent all` to include every file intent. `--wait` defaults to 20 seconds (above the p50 indexing time of ~11 s); first-time queries against an unindexed package may need `--wait 60` (the backend ceiling) to block until indexing completes. On an INDEXING error, the response message points out the retry options.

**Output.** Default terminal output leads each entry with `path:startLine-endLine [kind]`, followed by the symbol name and a 3-line dedented snippet. `--json` emits the shared success/error envelope also produced by the MCP `search_symbols` tool — see [`mcp-cli-parity.md`](./mcp-cli-parity.md) for the wire contract. The command is registered as `code search` with `code search-symbols` as a Commander alias.

**Capability gate.** The `code` group is registered only when the startup token explicitly carries `code_navigation`, or when `GITHITS_CODE_NAVIGATION=1` is set for local override.

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

**Always latest.** `pkg info` returns the latest published version regardless of input. Passing `<spec>@<version>` is rejected with `INVALID_ARGUMENT` and a clear message — the tool never silently swaps to latest. Use `pkg vulns` or `pkg deps` for version-pinned queries.

**`--verbose` + `--json`.** `--verbose` has no effect under `--json` — the JSON envelope always carries every field the verbose terminal view exposes (and more). The flag only affects human-readable output.

**Output envelope.** Success payload is hand-crafted for agent token efficiency: `{registry, name, version, description?, license?, homepage?, repository?, publishedAt?, downloads?, github?, install?, usage?, vulnerabilities?, recentChanges?}`. Omitted fields reflect backend nulls, not dropped data. Error envelope: `{error, code, retryable, details?}` — same shape as `search_symbols`, same classifier family. Under `--json` the error envelope is written to **stderr** so stdout stays clean for `jq`.

**Capability gate.** Same as `code`.

**Troubleshooting.** `GITHITS_DEBUG=pkg-intel` emits PII-safe classified-error diagnostics (area, event, code, error class, detail keys). Use `GITHITS_DEBUG=*` to enable all package/source diagnostics.

### `githits pkg vulns`

```
githits pkg vulns npm:express
githits pkg vulns npm:express@4.17.0
githits pkg vulns pypi:requests --severity high
githits pkg vulns crates:serde --json
githits pkg vulns npm:minimatch --include-withdrawn --verbose
```

Lists known CVE / OSV advisories for a package: severity, affected version ranges, fix versions, and upgrade targets. Malicious-package advisories (supply-chain attacks flagged by OSV) surface in a separate `MALWARE` bucket that sorts above all CVE advisories.

**Package spec.** `<registry>:<name>[@<version>]`. Unlike `pkg info`, `pkg vulns` supports `@<version>` so callers can inspect older pinned releases. Only `npm`, `pypi`, `hex`, and `crates` support vulnerability data; other registries are rejected client-side with `pkg vulns only supports npm, pypi, hex, and crates. Got: ${registry}.`

**Filtering.** `--severity low|medium|high|critical` maps to a CVSS float threshold (`low=0.1, medium=4, high=7, critical=9`) and is applied by the service. The returned `vulnerabilityCount` reflects the filtered set — no client-side filtering, no dual-summary block. Callers wanting the full picture omit the flag. `--include-withdrawn` includes retracted advisories; withdrawn advisories bucket below active ones in the terminal list.

**Zero-vulns hot path.** The common case (clean package) renders as header + one-line summary body (`No known vulnerabilities.`) — no breakdown, no advisory list, no footer. Agents checking "am I safe?" pay minimal token cost on the happy path.

**Version validation.** `pkg vulns` expects canonical package versions. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` and an actionable message telling the caller to drop the leading `v`, instead of forwarding the request and surfacing an opaque upstream failure.

**Malware marker.** Advisories with `isMalicious: true` render with a red/bold `MALWARE` column (optionally combined as `MALWARE · crit` when both flags exist). Count surfaces in the summary breakdown line as `N MALWARE · N crit · …`. Buckets partition every returned advisory: `MALWARE + crit + high + medium + low + unrated = advisories.length`, which equals `summary.total` when the upstream count and list stay consistent. Non-malicious advisories without a CVSS score bucket under `unrated` so the breakdown reconciles with the header total (common for PyPI / Rust advisories where CVSS may be absent).

**Affected-range truncation (terminal-width aware).** The `affected` detail row under each advisory caps at 4 ranges on narrow terminals (≤119 cols), 6 on standard-wide (120–159 cols), and 8 on ultrawide (≥160 cols). The remainder collapses into a dim `… (+N more; use -v)` hint. Verbose mode (`-v`) shows every range. JSON output is never truncated — machine consumers get the full list.

**Unrated severity column.** Advisories with no CVSS score (common on RUSTSEC / PYSEC upstreams) render with a dim `unrated` label in the severity column rather than an empty gutter, matching the header-breakdown vocabulary. They sort below banded advisories within the active bucket.

**Placeholder summary stripping.** When the upstream advisory feed returns the literal string `No summary available` (an OSV convention), both the JSON envelope and the terminal row drop the field entirely — absence of `summary` is the signal, and the advisory row is shorter as a result.

**Upgrade-path ordering.** `upgradePaths` are de-duplicated and sorted ascending by semver-ish comparison (pre-release suffixes rank below the matching base release), so the footer presents the minimum-churn upgrade first: `Upgrade options: 3.11.0, 4.0.0-rc1, 4.5.0, 4.19.2, …` rather than the backend's advisory-iteration order.

**Output envelope.** `{registry, name, version, requestedVersion?, summary: {total, affected?, bySeverity?}, advisories?, upgradePaths?}`. Each advisory: `{id?, aliases?, summary?, severity?, severityLabel?, affectedRanges?, fixedIn?, publishedAt?, modifiedAt?, withdrawnAt?, isMalicious?}`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Exit codes.** 0 on success including zero-vulns; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Capability gate.** Same as `pkg info`.

**Troubleshooting.** Same debug areas as `pkg info`.

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

**Lifecycle filter.** `-l, --lifecycle <phases>` accepts a comma-separated list of canonical lowercase tokens (`runtime`, `development`, `build`, `peer`, `optional`). Uppercase and whitespace are tolerated. The filter only affects `dependencyGroups`; `direct[]` and `transitive[]` are returned regardless. Unknown tokens are rejected with `INVALID_ARGUMENT` and the canonical list.

**Groups view (`--groups` or any `--lifecycle`).** Headings collapse to `name` when `conditionType === "always"` (e.g. `runtime`, `development`). Feature / TFM groups render `name (lifecycle, conditionType[: conditionValue])` — `conditionValue` is omitted when it equals `name` (the common case on Crates features and PyPI extras). Within each group, entries sort alphabetically. Duplicate `{name, constraint}` tuples inside a group collapse in the terminal for scannability; the JSON envelope preserves every duplicate the backend emitted.

**Transitive view (`--transitive`).** Replaces the direct-deps list with the full unique transitive closure (alphabetical, `name@version`, one per line). Summary row carries the aggregate counts + conflict / cycle counts, and `(max depth N)` only when `--depth` was applied — otherwise the full traversal is shown. `--depth <n>` (1–10) caps traversal; there is **no client-side default cap** (matches `npm ls` / `cargo tree` ergonomics).

**Verbose (`--verbose`).** In both plain and transitive modes, each dep expands to a multi-line block: the first line is `name@version`, followed by indented `- <constraint> required by <importer>@<importer-version>, …` bullets. Importers that share a constraint are collapsed onto one bullet with a comma-separated list. In plain mode each direct dep has exactly one importer (the root package itself); in transitive mode a popular leaf may list many importers grouped by constraint. Conflicts expand into a `Conflicts (N):` table (`name: range1, range2, …`, one row per package); circular dependencies expand into a `Circular dependencies (N):` list (`a → b → a` arrow chain).

**JSON envelope.** Preprocessed: `runtime.items[].version` surfaces the resolved version alongside the constraint. Under `--transitive`, `transitive.packages[]` carries `{name, version}` records by default; `--verbose` opts each entry into an `importers[]` array with importer name / version / constraint (roughly quadruples envelope size on heavy graphs, so it's off by default). `transitive.conflicts[]` and `transitive.circularDependencies[]` are typed (`{name, requiredVersions}` / `{cycle: string[]}`) when the observed backend shape decodes; raw passthrough otherwise. The raw DAG itself is deliberately **not** in the envelope — a future dedicated `pkg deps-dag` command will expose it under a typed contract for graph visualisation (mermaid / DOT / interactive viewer).

**Output envelope.** `{registry, name, version, requestedVersion?, runtime?, groups?, transitive?, filter?}`. Data-first: the `runtime` block emits whenever the backend returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages); the `groups` block emits whenever the backend returned `dependencyGroups` (including `{items: []}` when a lifecycle filter matched nothing, so agents distinguish "backend has no groups concept" from "filter excluded everything"). Each group carries its members under `items` (matches the top-level `runtime.items` naming so dependency lists share one key throughout the envelope). `filter.lifecycles` echoes the canonicalised, deduplicated, display-order-sorted list the backend received — not the raw CSV input.

**Exit codes.** 0 on success including zero-dep packages; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Capability gate.** Same as `pkg info` / `pkg vulns`.

**Troubleshooting.** Same debug areas as `pkg info` / `pkg vulns`.

### `githits pkg changelog`

```
githits pkg changelog npm:express
githits pkg changelog npm:express --from 4.0.0
githits pkg changelog npm:express --to 4.18.0 --limit 5
githits pkg changelog --repo-url https://github.com/expressjs/express --git-ref main
githits pkg changelog npm:express --json
githits pkg changelog pypi:requests --no-body --json       # lean timeline
```

Fetches release notes or changelog entries for a package or GitHub repository. Output is a newest-first list with a summary header identifying the source (GitHub Releases, CHANGELOG.md, or HexDocs).

**Addressing.** `<spec>` (`registry:name`, same parser as `pkg info` / `pkg vulns` / `pkg deps`) **or** `--repo-url <url>`, mutually exclusive. Unlike the other `pkg` commands, `pkg changelog` is intrinsically repo-level, so repo-URL addressing is a first-class peer mode.

**`<spec>@<version>` rejected.** `pkg vulns` and `pkg deps` both treat `@version` as "for this exact version", but `pkg changelog` has no single-version query: all entries live on a timeline. Remapping `@version` to `--to` would be a silent semantic shift. CLI rejects with `INVALID_ARGUMENT` and a hint pointing to `--to <version>` (or `--from <version>` for range mode).

**Two modes.** Latest mode is the default; `--limit <n>` (1–50, default 10) caps entry count. `--from <version>` switches to range mode — returns every entry between `--from` and `--to` (or latest) with no count cap. `--to <version>` works in either mode. `--from` + `--limit` together is rejected client-side with a hint.

**Pre-release versions.** Normalised versions flow through unchanged (`5.0.0-rc.1`, `2.32.0.dev0`, `1.7.0-rc.5` round-trip cleanly on `--from` / `--to`). Tag-style `v`-prefixed inputs are rejected on any version flag, consistent with `pkg vulns` / `pkg deps`.

**Default terminal output.** Summary header (`name · registry · source · mode · entry count`) followed by each entry's `version  date  url` header plus the first 10 lines of its markdown body, indented and dimmed. Bodies longer than the cap show a footer `… (+N more lines — use --verbose for the full body)`. Missing dates render as `—`; missing versions render as `(unversioned)`. The version column is padded to the longest entry in the current response (no fixed width).

**`--verbose`.** Uncaps the body preview — every entry's full markdown body renders, indented and dimmed, with no truncation footer. Terminal-only — does not change `--json` output.

**`--no-body`.** Drops body fields from entries. Affects both terminal output (no body preview, no footer) and `--json` (entry objects lose the `body` field). Mirrors MCP's `include_bodies: false`. Default `--json` keeps full markdown bodies; use `--no-body` when you only need the version / date / URL timeline (drops 10 KB+ per entry on large release notes — measured 5.13× size reduction on `npm:typescript --limit 20`).

**JSON envelope.** `{registry?, name?, repoUrl?, source, mode, entries: {count, items}, filter?}`. `source` is always present (the null-source case is promoted to `NOT_FOUND` at the service boundary and never reaches this shape). `entries.count` is computed client-side from `items.length`. `filter` emits only when the caller explicitly supplied one of `--from`, `--to`, `--limit`, `--git-ref`; backend defaults don't round-trip as caller intent.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept even when null so agents can map `items.map(e => e.version)` without guarding; other nullable fields are stripped. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope — revisit via agent feedback.

**Errors.** `NOT_FOUND` covers both the backend's "package not found" case and the distinct "package exists but no changelog source resolved" case (typed `PackageIntelligenceChangelogSourceNotFoundError`; message names the sources that were tried). `VERSION_NOT_FOUND` enriches with structured `package` / `requested` / `available` detail lines from the shared `promoteGenericVersionNotFound` helper — which was extended in this PR to recognise `--from` and `--to` as promotable version inputs.

**Capability gate.** Same as the rest of the `pkg` family.

**Troubleshooting.** Same debug areas as the rest of the `pkg` family.

### `githits code files`

```
githits code files npm:express
githits code files npm:express lib                      # scope by prefix
githits code files npm:express lib --verbose            # + language / type / size
githits code files --repo-url https://github.com/expressjs/express --git-ref main lib
githits code files npm:express --json
```

Lists files in an indexed dependency. `[spec] [path-prefix]` positionals mirror `code read` / `code grep` so the three commands chain without friction. `[path-prefix]` is a literal directory prefix; glob / extension filtering is not supported by the backend today (tracked as an upstream ask).

**Plain output (default).** One bare path per line on stdout — pipe-friendly. No header, no annotations. `code files npm:express lib | xargs -I{} …` works cleanly.

**`--verbose`.** Adds a contextual header (`<identity> · <count>`), the resolution line (`indexed at <ref> · commit <sha>`), and per-row language / file-type / byte-size annotations.

**`stdout` vs `stderr` routing (plain mode).** Truncation warnings (`More files available — pass --limit higher …`) and empty-result hints go to **stderr**, not stdout, so they stay visible to humans without polluting pipes. In `--verbose` the same text renders inline.

**Addressing ambiguity guard.** In `--repo-url` mode, a positional that matches a known registry prefix (`npm:`, `pypi:`, `hex:`, `crates:`, `nuget:`, `maven:`, `zig:`, `vcpkg:`, `packagist:`) is rejected with a "looks like a package spec" error — catches `code files npm:express --repo-url …` typos that would otherwise silently interpret the spec as a path prefix.

**Exit codes.** `0` on success (including empty results — absence of files is not an error). `1` on error (authentication, indexing, invalid arguments, backend failures).

### `githits code read`

```
githits code read npm:express lib/express.js
githits code read npm:express lib/express.js --lines 1-40
githits code read npm:express lib/express.js --verbose  # + header + gutter
githits code read --repo-url https://github.com/expressjs/express --git-ref main lib/express.js
githits code read npm:express lib/express.js --json
```

Reads a file from an indexed dependency. `<path>` is package-relative in spec mode, repo-relative in `--repo-url` mode.

**Plain output (default).** Raw file bytes, verbatim (preserves the backend's trailing newline). Piping `code read … | grep …` or `code read … > file` round-trips cleanly.

**`--verbose`.** Adds the `<path> · <language> · lines <N-M> of <total>` header and a right-aligned line-number gutter. No stderr routing — `read` has no truncation path.

**Line ranges.** `--lines 10-40` (concise form), `--lines 10-` (open end), `--lines -40` (open start), or append the range directly to the path as `lib/express.js:10-40`. `--start <n>` / `--end <n>` are the verbose equivalents. Combining forms is rejected. Unified top-level `search` prints file-backed hits in the same `path:range` form so users can copy directly into `code read`.

**Binary files.** Plain mode writes `Binary file — cannot display as text.` to stdout (consistent with `grep`'s binary-file convention). `--verbose` adds the header above the sentinel. `--json` exposes the classification via `isBinary: true` with `content` omitted — agents branch on the flag, not a null check.

**Exit codes.** `0` on success. `1` on error — `FILE_NOT_FOUND` (path doesn't resolve) carries a "Use `code files` to list available paths" hint in terminal output.

### `githits code grep`

```
githits code grep npm:express middleware
githits code grep npm:express middleware src/ -C 2
githits code grep npm:express "router\\.(use|get)" --regex --glob 'lib/**/*.js'
githits code grep --repo-url https://github.com/expressjs/express --git-ref main export lib/
githits code grep npm:express middleware --path lib/express.js --json
```

Deterministic text grep over indexed dependency or repository source. Defaults to ASCII case-insensitive literal matching across the whole target; non-ASCII letters match case-sensitively. Pass `[path-prefix]`, `--path`, `--glob`, or `--ext` to narrow scope. `--regex` switches to RE2 regex mode. Whole-target regexes must include at least one literal substring the index can use for pre-filtering. Max pattern 200 UTF-8 bytes. For discovery and ranking, use top-level `githits search` instead. Repeat `--symbol-field` to hydrate enclosing symbol metadata; hints appear under each `--verbose` match, full payload in `--json`.

**Plain output (default).** One `file:line:text` record per match on stdout, pipe-friendly and deterministic. `-C/--context`, `-A/--after-context`, and `-B/--before-context` add surrounding lines. Distinct match groups are separated by `--`.

**`--verbose`.** Adds a summary header and grouped file sections with a `>` marker on match lines.

**`stdout` vs `stderr` routing (plain mode).** The pagination hint for `nextCursor` goes to **stderr** so stdout stays machine-friendly.

**Exit codes (grep-compatible).**

- `0` — at least one match.
- `1` — zero matches. Fires in both plain and `--json` modes so scripting (`if code grep X file; then …`) behaves consistently across surfaces.
- `2` — error (missing file, indexing, invalid arguments, backend failure). Distinguished from "no match" so scripts can branch correctly.

This is still the standard `grep(1)` contract even though the output includes file paths by default.

**Pattern note.** The `GREP_REPO_PATTERN_NOTE` string is shared verbatim across the CLI help text, the MCP tool description, and the MCP `pattern` argument's `describe` so the three surfaces never disagree about literal-vs-regex semantics.

## Architecture

```
CLI command (src/commands/search.ts)
  └─ searchAction(query, options, deps)
       ├─ requireAuth(deps)
       └─ deps.codeNavigationService.search(params)
            └─ CodeNavigationServiceImpl makes package/source API call
```

Each command follows this pattern:

1. **Focused dependency interface** — Only the deps the action needs (e.g., `SearchDependencies`), not the full `Dependencies` container
2. **Testable action function** — Pure logic that accepts deps via parameter injection
3. **Registration function** — `registerXxxCommand(program)` handles Commander setup with lazy `createContainer()` inside the action callback

### Shared Code with MCP Tools

| Shared Module | Used By |
|---|---|
| `GitHitsService` (via container) | `example`, `languages`, `feedback`, and always-on MCP tools |
| `CodeNavigationService` (via container) | top-level unified `search` / `search-status`, capability-gated MCP indexed-search tools, and `githits code search` |
| `filterLanguages()` from `src/shared/language-filter.ts` | `search_language` MCP tool + `languages` CLI command |
| `requireAuth()` from `src/shared/require-auth.ts` | all CLI commands and auth-required MCP tool handlers |

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

- **Default** — Human-readable terminal output (markdown for `example`, formatted result blocks for unified `search`, colored list for `languages`, plain text for `feedback`)
- **`--json`** — Machine-readable JSON for piping to `jq`, other tools, or agent consumption

## Global Flags

- **`--no-color`** — Disables colored output by setting `NO_COLOR=1` env var via a root-level `preAction` hook. All downstream `shouldUseColors()` calls pick it up automatically.

## Runtime Diagnostics

- **`GITHITS_TELEMETRY=1`** — Emits an end-of-run timing summary to stderr without polluting normal stdout. Current spans cover gated command registration, startup auth lookup, container creation, token loading/refresh, and the outbound API/package-intelligence request.

## Key Reference Files

| File | Purpose |
|---|---|
| `src/commands/example.ts` | Example-search command implementation |
| `src/commands/search.ts` | Unified search and search-status command implementation |
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
