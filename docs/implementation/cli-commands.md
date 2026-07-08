# CLI Commands

## Purpose

The CLI exposes setup/auth commands, `doctor`, `example`, `languages`, `feedback`, top-level indexed `search` / `search-status`, and the `code`, `docs`, and `pkg` command groups by default. MCP-parity commands share business logic with the MCP tools through the same service interfaces and shared utilities, but format output for terminal consumption instead of MCP tool results.

## Commands

| Command | Required Args | Options | Description |
|---|---|---|---|
| `init` | — | `-y, --yes`, `--skip-login`, `--no-browser`, `--project`, `--detect-agents`, `--install-agents <ids>`, `--json` | Authenticate and set up MCP server for coding agents; interactive setup asks whether to configure user-level or project-level MCP where supported; staged flags support agent-safe non-interactive onboarding |
| `init uninstall` | — | `-y, --yes`, `--project` | Remove GitHits MCP server configuration from coding agents or supported project-local MCP files |
| `example <query>` | `<query>` | `-l, --lang <language>`, `--license <mode>`, `--explain`, `--json` | Search for code examples |
| `search <query>` | `--in <target>` | `--source <source>`, `--kind <kind>`, `--category <category>`, `--path-prefix <prefix>`, `--intent <intent>`, `--public`, `--name <name>`, `--lang <language>`, `--allow-partial`, `--limit <n>`, `--offset <n>`, `--wait <seconds>`, `--json` | Unified indexed search across dependency/repository code, docs, and symbols. Defaults to 10 results. |
| `search-status <search-ref>` | `<search-ref>` | `--json` | Check progress, fetch partial hits, or fetch final results for a prior unified search |
| `languages [query]` | — | `--json` | List or filter supported languages |
| `feedback [solution_id]` | `--accept` or `--reject` | `-m, --message <text>`, `--tool <name>`, `--json` | Submit solution-tied or generic session feedback |
| `doctor` | — | `--json` | Print redacted diagnostics for GitHits runtime, environment, service URLs, config, and auth storage |
| `pkg info <spec>` | package spec | `--verbose`, `--json` | Show a package overview (latest version, downloads, license, vulnerabilities) |
| `pkg vulns <spec>` | package spec (optional `@version`) | `--severity`, `--scope`, `--include-withdrawn`, `--verbose`, `--json` | List known vulnerabilities for a package (npm/pypi/hex/crates/nuget/maven/packagist/rubygems/go/swift) |
| `pkg deps <spec>` | package spec (optional `@version`) | `--lifecycle`, `--depth`, `--verbose`, `--json` | Analyse dependencies: direct runtime deps, structured groups, optional capped transitive graph (npm/pypi/hex/crates/vcpkg/zig/rubygems/go/swift) |
| `pkg changelog [spec]` | package spec OR `--repo-url` | `--from`, `--to`, `--limit`, `--git-ref`, `--no-body`, `--verbose`, `--json` | Release notes / changelog entries for a package or GitHub repo (GitHub Releases, CHANGELOG.md, or HexDocs). Default shows each entry with a 10-line body preview; `--verbose` uncaps, `--no-body` drops. |
| `pkg upgrade-review [spec]` | single package spec with current version plus `--to`, OR repeatable `--package` ranges | `--to`, repeatable `--package`, `--no-transitive-security`, `--dependency-issues`, `--min-severity`, `--verbose`, `--json` | Compare current and target versions for upgrade evidence: vulnerabilities, changelog entries, deprecation metadata, peer changes, dependency changes, and transitive security evidence by default. Reports facts only. |
| `docs list <spec>` | package spec (optional `@version`) | `--limit`, `--after`, `--verbose`, `--json` | List hosted/crawled and repository-backed documentation pages for a package. Entries include page IDs for `docs read`; JSON includes exact repo-file follow-up metadata when available. |
| `docs read <page-id>` | page ID from `docs list` or search results | `--lines`, `--verbose`, `--json` | Read a documentation page by page ID. Default output is content-only; `--lines` fetches a bounded range for long pages. |
| `code files [spec] [path-prefix]` | package spec OR `--repo-url` with optional `--git-ref`; optional `[path-prefix]` | `--path`, repeatable `--glob`, repeatable `--ext`, repeatable `--file-type`, repeatable `--language`, repeatable `--file-intent`, repeatable `--exclude-intent`, `--exclude-docs`, `--exclude-tests`, `--hidden`, `--limit`, `--wait`, `--verbose`, `--json` | List files in an indexed dependency. Selectors (`[path-prefix]`, `--path`, `--glob`) are OR-ed; the other flags filter that scope down further. Plain output is one path per line; `--verbose` adds language / type / size annotations. Indexing errors include elapsed/expected duration when available plus retry via `--wait` or indexed refs/versions from the error detail. |
| `code read <spec?> <path>` | package spec OR `--repo-url` with optional `--git-ref`; plus `<path>` | `--lines`, `--start`, `--end`, `--wait`, `--verbose`, `--json` | Read a file's contents. Plain output is the raw file bytes (pipe-friendly); `--verbose` adds a header and a line-number gutter. `--lines 10-40` concise form; `--start`/`--end` equivalent. Binary files show a sentinel line. |
| `code grep [spec] <pattern> [path-prefix]` | package spec OR `--repo-url` with optional `--git-ref`; plus `<pattern>` and optional `[path-prefix]` | `--path`, repeatable `--glob`, repeatable `--ext`, `--regex`, `--case-sensitive`, `-C/-A/-B`, `--exclude-docs`, `--exclude-tests`, `--limit`, `--per-file-limit`, `--cursor`, `--symbol-field`, `--wait`, `--verbose`, `--json` | Deterministic text grep over indexed dependency or repository source. Defaults to whole-target, literal, ASCII case-insensitive matching; non-ASCII letters match case-sensitively. Narrow with `[path-prefix]`, `--path`, `--glob`, or `--ext`. Plain output is `file:line:text`; `--verbose` groups matches by file. |

### `githits init`

```
githits init                                      # Interactive: authenticate, scan, configure unconfigured agents
githits init --yes                                # Interactive shortcut: configure all detected unconfigured agents
githits init --skip-login                         # Skip authentication, configure tools only
githits init --no-browser                         # Print sign-in URL instead of opening a browser
npx -y githits@latest init --detect-agents        # Agent-safe discovery: scan and print detected agent IDs/statuses
npx -y githits@latest init --detect-agents --json # Machine-readable discovery output for agents
npx -y githits@latest init --install-agents cursor # Agent-safe install: configure only explicit detected IDs
npx -y githits@latest init --project --detect-agents # Agent-safe project discovery for current repo
npx -y githits@latest init --project --install-agents cursor # Agent-safe project install for explicit IDs
githits init uninstall                            # Interactive: choose user-level or project-level uninstall
githits init uninstall -y                         # Non-interactive: remove all detected user-level GitHits MCP configs
githits init uninstall --project                  # Explicit project-level uninstall
githits init uninstall --project --yes            # Non-interactive project-level uninstall
```

Authenticates with GitHits (via OAuth in the browser), then scans for available coding agents, checks which are already configured, and sets up unconfigured ones with your confirmation. Use `--no-browser` in SSH or display-less sessions to print the sign-in URL instead of opening a browser on the current machine. All agents are pre-checked before any setup begins, so the status display is fully resolved. CLI agents are considered available only when their executable is on `PATH`; related dot-directories alone do not count. Config-file agents remain filesystem-detected using their known app/config directories. If already authenticated, the login step is skipped automatically. If login fails, the user is prompted to continue with tool setup anyway. If all detected agents are already configured, exits early with a summary.

Interactive MCP setup asks where GitHits should be configured. User-level setup preserves the existing global/user config behavior for all supported tools. Project-level setup is partial because MCP project config conventions differ by tool; GitHits only offers project setup for tools with verified project-local MCP support: Claude Code (`.mcp.json`), Cursor (`.cursor/mcp.json`), VS Code / Copilot (`.vscode/mcp.json` with `type = "stdio"` server entries), Codex CLI (`.codex/config.toml`), Pi (`.mcp.json` with `pi-mcp-adapter` installed when needed), Gemini CLI (`.gemini/settings.json`), and OpenCode (`opencode.json`). Detected tools without verified project-local MCP support are shown as skipped with a reason. Project config contains no secrets, but it may be committed to source control like other project tooling configuration. Gemini may ignore project settings in untrusted workspaces.

When `init` is run without a TTY, it prints agent onboarding guidance and exits without scanning, writing config, prompting, or authenticating. Non-interactive `--yes` is rejected for safety because it can configure tools without explicit per-tool user approval. Agentic onboarding must use the staged flow instead: ask whether the user wants user-level install or project-level install for the current repo, run `npx -y githits@latest init --detect-agents` or `npx -y githits@latest init --project --detect-agents`, then run the matching `--install-agents <ids>` command only after the user approves the exact detected IDs. Project staged detection marks detected tools without verified project config as `unsupported_project_config` with a reason; agents must not offer those IDs for project install. Agent-facing guidance explicitly forbids `githits init -y` / `githits init --yes` unless the user asks to configure every detected tool, and tells agents to verify successful staged installs with the matching scoped detect command (`--detect-agents --json` or `--project --detect-agents --json`) instead of running init again. `--install-agents` rescans, rejects unknown, unsupported-project, or currently undetected IDs before writing, installs only the requested agents, verifies setup, and does not authenticate. After successful or already-configured outcomes it instructs agents to ask before running the separate `npx -y githits@latest login` command; if every install fails, it reports installation errors and suppresses auth guidance. `--json` is supported only for staged detect/install modes so agents do not need to scrape prose.

Global setup supports Claude Code, Cursor, Windsurf, VS Code / Copilot, Cline, Claude Desktop, Codex CLI, Pi, Gemini CLI, Google Antigravity, OpenCode, Hermes Agent, Zed, Junie, Qwen Code, Kiro, Kilo Code, Factory Droid, and Amazon Q CLI. It uses plugin install (Claude Code), CLI commands (Codex, Gemini CLI, Amazon Q CLI), Pi adapter setup plus Pi-owned MCP config writes (Pi), and atomic config file writes (Cursor, Windsurf, VS Code, Cline, Claude Desktop, Google Antigravity, OpenCode, Hermes Agent, Zed, Junie, Qwen Code, Kiro, Kilo Code, Factory Droid). CLI agents use read-only check commands (e.g., `claude plugin list`) to determine global configuration status before prompting.

The command uses `createContainer()` lazily for the login step. Tool detection and configuration use lightweight dependencies that don't require auth.

`githits init uninstall` reverses the tool configuration performed by init. In interactive mode it first asks whether to remove user-level config or project-level config. User-level uninstall scans the same supported agents, removes only GitHits MCP/plugin entries, and leaves authentication credentials untouched. Use `githits logout` separately to remove stored credentials. Config-file uninstall removes `GitHits`/case-variant server entries while preserving other MCP servers and user settings; global uninstall never deletes config files or directories. Project uninstall uses the verified project config paths above, removes only GitHits entries from project-local files, preserves unrelated servers/settings, and best-effort removes legacy `.githits/init/project-setup.json` markers from earlier versions. Project uninstall does not remove global tools or Pi's global `pi-mcp-adapter` package because they can be shared by other projects; legacy, pre-existing, and GitHits-installed global Pi adapters are left installed. User-level Pi uninstall removes the `GitHits` entry from Pi's MCP config and runs `pi remove npm:pi-mcp-adapter` when the Pi CLI is available; if Pi is no longer installed, stale Pi MCP config entries are still removable without attempting adapter cleanup. Project uninstall is best-effort across supported config paths: missing files and files without GitHits are skipped, malformed/read-only/write-failing files are reported in the final summary, and the command exits 1 only after all possible removals have been attempted. JSONC-style files are accepted on read and rewritten as canonical JSON only when changed, matching setup behavior. Codex project setup rewrites `.codex/config.toml` as TOML and does not preserve existing TOML comments or formatting.

For automation, `githits init uninstall --yes` is user-level only and never touches project files. Use `githits init uninstall --project --yes` for non-interactive project-level removal.

**File structure:** The init command uses a subdirectory (`src/commands/init/`) because it has distinct submodules (agent definitions, setup handlers, orchestrator). This is an accepted variation for commands with significant internal complexity.

### `githits example`

```
githits example "how to use express middleware"
githits example "how to use express middleware" --lang javascript
githits example "async file reading" -l python --license yolo
githits example "react hooks patterns" -l typescript --explain
githits example "react hooks patterns" -l typescript --json
```

Default output is markdown (the API response). `--lang` is optional; when omitted, the backend infers the language from the query. With `--explain`, an AI-generated explanation is included alongside the code example. With `--json`, output is `{ "result": "<markdown>", "solution_id": "<uuid>" }` (`solution_id` is omitted only if the markdown lacks a solution URL — pass it back to `feedback`). The MCP `get_example` tool always sends `include_explanation: false` since LLMs don't need the extra context.

### `githits search`

```
githits search "router middleware" --in npm:express
githits search '"body parser" OR multer' --in npm:express --source docs
githits search "compose" --in npm:lodash --source code --kind function
githits search "debounce" --in npm:lodash --source symbol
githits search "composeArgs" --in npm:lodash --name composeArgs --json
```

Unified search spans indexed dependency and repository code, docs, and explicit symbols. The positional query is the backend discovery syntax, not a raw pass-through to a per-source search engine. It supports implicit `AND`, uppercase `OR`, parentheses, unary `-`, quoted phrases, semantic qualifiers (`kind:`, `category:`, `path:`, `lang:`, `name:`, `intent:`), and routing qualifiers (`registry:`, `package:`, `version:`, `repo:`). Structured flags are compiled together with the query using `AND` semantics before the request reaches the backend.

**Decision guide.** Use `githits example` for canonical cross-project examples. Use `githits search` for indexed dependency/repository search. Use `githits search --source symbol` when you want symbol-shaped unified search.

**Targets.** `--in <target>` is repeatable and required. Package targets require explicit `registry:name[@version]` (for example `npm:express`, `pypi:requests@2.32.3`). Repo targets use `github:org/repo[#ref|@ref]`, `github.com/org/repo[#ref|@ref]`, or `https://github.com/org/repo[#ref|@ref]`; omitted refs request the backend default-branch intent. User-facing output canonicalizes repo targets as `github:org/repo#ref` so refs can contain `@` safely. Exact duplicate targets are deduplicated while preserving order. Mixing package and repo targets in the same request is supported.

**Sources and filters.** `--source docs|code|symbol` restricts results to one evidence type; omit it to let GitHits select the best sources. Use `--source symbol` when you want symbol-shaped search results. `--category` is the broad filter (`callable`, `type`, `module`, `data`, `documentation`); `--kind` is the precise taxonomy. `--path-prefix`, `--intent`, and `--public` narrow the result set further. For docs-only search, code/symbol-only filters (`category`, `kind`, `file_intent`, `public_only`) are ignored client-side because the backend docs source rejects them. `--name` and `--lang` compile into query qualifiers instead of becoming separate backend fields.

**Intent filter.** When `--intent` is omitted, unified search sends no file-intent filter. Pass `--intent production` or another specific intent only when you want to narrow the result set. Some sources can still ignore `fileIntent`; when they do, the JSON `sourceStatus` block and terminal notes report that explicitly.

**Complete-by-default results.** The CLI sends `allowPartialResults: false` unless `--allow-partial` is passed. If indexing does not complete within the wait window, the default behavior returns a `searchRef` and progress summary instead of partial hits. With `--allow-partial`, available hits are included while remaining sources continue indexing. `--limit` defaults to 10 results. `--wait` is in seconds (0-60, default 20).

The original unified-search plan envisaged hiding partial mode entirely in v1 to make results trustworthy by default. We kept the flag exposed because some agent and CLI flows benefit from "show me what you have so far"; the trust contract is preserved by keeping the *default* false. Users and agents must explicitly opt in, so a vanilla `search` call still cannot return incomplete results by surprise.

**Output.** Plain output preserves backend ranking order. It starts with a lightweight per-type count summary, then shows one result per block. The header line is optimized for scanning and copy-paste follow-up: `target path:range [type] - title`. For file-backed hits, that header can be turned directly into a `githits code read` call because `code read` accepts `path:start-end` suffixes. Summaries are rendered verbatim from the backend response. Labels are: `docs page` (hosted package docs), `repo doc` (documentation-like block from a repository file), `repo code` (code block from a repository file), and `repo symbol` (explicit symbol hit from the repository index). `--json` emits the shared success/error envelope used by the MCP `search` tool, including a full `query` echo for initial searches.

**Highlighting.** The CLI applies the backend's structured `highlights` spans on titles and summaries, plus structural emphasis on headers and badges. It does **not** attempt client-side substring highlighting for terms the backend did not flag, since the compiled query is not a faithful match spec.

**Trust signals.** The JSON `sourceStatus` block is included only when a source reports an actionable condition. Human-readable output surfaces the same actionable subset: ignored / incompatible filters, ignored / incompatible query features, terminal indexing states with backend notes, an `INDEXING` indicator when a source is still indexing on a partial-result payload, and promoted freshness warnings when a floating target was served from stale evidence while a fresher index is building. `CURRENT` target-resolution metadata is suppressed because it does not change how a user should interpret displayed results.

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

Without a query, lists all languages. With a query, filters to top 5 matches using the same logic as the `search_language` MCP tool (case-insensitive substring match on name, display_name, and aliases). Default output uses colored terminal formatting. JSON output is `[{ "name": "...", "display_name": "...", "aliases": [...] }, ...]`.

### `githits feedback`

```
githits feedback abc123 --accept
githits feedback abc123 --reject -m "Example was outdated"
githits feedback abc123 --accept --message "Solved my problem" --json
githits feedback --reject --tool search -m "missing kotlin support"
```

Passing `[solution_id]` anchors feedback to a prior `githits example` result. Omitting it creates generic feedback for the current CLI/MCP session via the `x-githits-session-id` header; `--tool` records the command or MCP tool that produced the result being rated. `--accept` and `--reject` are mutually exclusive (enforced by Commander's `.conflicts()` API). At least one must be provided (validated in the action function). JSON output is `{ "success": true, "message": "..." }`.

### `githits doctor`

```
githits doctor
githits doctor --json
```

Prints redacted diagnostics for comparing GitHits behavior across terminals or agents. The report includes CLI/runtime identity, selected environment variables, service URL sources, config file status, active and legacy auth storage locations, token/client/metadata presence and timestamps, and recommendations. Secret-bearing values such as tokens, client secrets, API tokens, and proxy credentials are never printed; presence is reported as `set` / `present` only. JSON output uses `schemaVersion: 1` for support tooling.

### Proxy Support

CLI-originated HTTP traffic uses `src/services/proxy-fetch.ts`. This includes OAuth discovery, client registration, token exchange/refresh, REST API calls, code/package service calls, local MCP tool calls started through `githits mcp start`, and npm update checks. The fetch factory supports `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` plus lowercase aliases; lowercase values win when both cases are set, matching undici's env proxy precedence.

Native Node env proxy support is used only when the user explicitly opted in and the running Node version is known to support that opt-in. `NODE_USE_ENV_PROXY=1` is treated as native on Node `22.21.0+` and `24.0.0+`; `--use-env-proxy` / `NODE_OPTIONS=--use-env-proxy` is treated as native on Node `22.21.0+` and `24.5.0+`. Older or unknown versions use the fallback so the Node `20.18.1` floor remains supported.

Fallback proxy support uses the installed `undici` runtime dependency and per-request `ProxyAgent` dispatchers rather than mutating global fetch or the global dispatcher. Proxy URL validation and runtime proxy failures are sanitized before surfacing to CLI/MCP callers: credentials, path, query, and fragments are never printed. `doctor` remains presence/status-only for proxy environment variables.

`bun run smoke:proxy-node` builds the proxy fetch module and runs a Node process against local target/proxy servers. It verifies that fallback mode really sends HTTP traffic through a local proxy, that `NO_PROXY` bypasses it, and that proxy URL redaction stays intact.

### `githits pkg info`

```
githits pkg info npm:express
githits pkg info pypi:requests --verbose
githits pkg info crates:serde --json
githits pkg info npm:@types/node
```

Shows a concise latest-version overview for dependency triage: license, description, repository popularity (stars/forks/issues and `[ARCHIVED]` when applicable), homepage, publication date, download count, and explicit vulnerability status. Default output is compact. `--verbose` adds GitHub language/topics/last-pushed, recent advisories, and a recent-changes list. `--json` emits the lean hand-crafted envelope — null scalars are omitted, and vulnerability data is emitted whenever the backend reports a numeric count, including zero.

**Package spec.** `<registry>:<name>`. Registries: `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `zig`, `vcpkg`, `packagist`, `rubygems`, `go`. Scoped npm names (`npm:@types/node`) are supported.

**Always latest.** `pkg info` returns the latest published version regardless of input. Passing `<spec>@<version>` is rejected with `INVALID_ARGUMENT` and a clear message — the tool never silently swaps to latest. Use `pkg vulns` or `pkg deps` for version-pinned queries.

**`--verbose` + `--json`.** `--verbose` has no effect under `--json` — the JSON envelope always carries every field the verbose terminal view exposes (and more). The flag only affects human-readable output.

**Output envelope.** Success payload is hand-crafted for agent token efficiency: `{registry, name, version, description?, license?, homepage?, repository?, publishedAt?, downloads?, github?, vulnerabilities?, recentChanges?}`. Omitted fields reflect backend nulls, not dropped data. Error envelope: `{error, code, retryable, details?}` — shared classifier family. Under `--json` the error envelope is written to **stderr** so stdout stays clean for `jq`.

**Troubleshooting.** `GITHITS_DEBUG=pkg-intel` emits PII-safe classified-error diagnostics (area, event, code, error class, detail keys). Use `GITHITS_DEBUG=*` to enable all non-sensitive package/source diagnostics.

### `githits pkg vulns`

```
githits pkg vulns npm:express
githits pkg vulns npm:express@4.17.0
githits pkg vulns pypi:requests --severity high
githits pkg vulns crates:serde --json
githits pkg vulns npm:minimatch --include-withdrawn --verbose
githits pkg vulns npm:express --scope non_affecting
```

Lists known CVE / OSV advisories for a package: severity, affected version ranges, fix versions, and upgrade targets. Default text is capped at 5 advisory rows for readability; use `--verbose` for all selected rows or `--json` for the complete structured envelope. Malicious-package advisories (supply-chain attacks flagged by OSV) surface in a separate `MALWARE` bucket that sorts above all CVE advisories.

**Package spec.** `<registry>:<name>[@<version>]`. Unlike `pkg info`, `pkg vulns` supports `@<version>` so callers can inspect older pinned releases. `npm`, `pypi`, `hex`, `crates`, `nuget`, `maven`, `packagist`, `rubygems`, `go`, and `swift` support vulnerability data; vcpkg and Zig are rejected client-side with `pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: ${registry}.` Swift accepts `v`-prefixed release tags because SwiftPM packages commonly publish them.

**Filtering and scope.** `--severity low|medium|high|critical` maps to a CVSS float threshold (`low=0.1, medium=4, high=7, critical=9`) and is applied by the service. The returned `summary.total` always means advisories affecting the inspected version. Advisory rows default to `--scope affected`; use `--scope non_affecting` for historical package advisories that do not affect the inspected version, or `--scope all` for affected + historical rows. Active filters and non-default scope are echoed in text and under top-level JSON `filter`. `--include-withdrawn` includes retracted advisories; withdrawn advisories bucket below active ones in the terminal list.

**Zero-vulns hot path.** The common case (clean package) renders as header + one-line summary body (`No active vulnerabilities affect this version.`) — no breakdown, no advisory list, no footer. Filtered zero-results say `No vulnerabilities matching the filter affect this version.` so callers do not confuse a thresholded query with a clean package.

**Version validation.** `pkg vulns` expects canonical package versions. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` and an actionable message telling the caller to drop the leading `v`, instead of forwarding the request and surfacing an opaque upstream failure.

**Malware marker.** Advisories with `isMalicious: true` render with a red/bold `MALWARE` column (optionally combined as `MALWARE | crit` when both flags exist). Count surfaces in the summary breakdown line as `N MALWARE | N crit | ...`. Buckets partition every returned advisory: `MALWARE + crit + high + medium + low + unrated = advisories.length`, which equals `summary.total` when the upstream count and list stay consistent. Non-malicious advisories without a CVSS score bucket under `unrated` so the breakdown reconciles with the header total (common for PyPI / Rust advisories where CVSS may be absent).

**Affected-range truncation (terminal-width aware).** The `affected` detail row under each advisory caps at 4 ranges on narrow terminals (≤119 cols), 6 on standard-wide (120–159 cols), and 8 on ultrawide (≥160 cols). The remainder collapses into a dim `... (+N more; use -v)` hint. Verbose mode (`-v`) shows every range. JSON output is never truncated — machine consumers get the full list.

**Unrated severity column.** Advisories with no CVSS score (common on RUSTSEC / PYSEC upstreams) render with a dim `unrated` label in the severity column rather than an empty gutter, matching the header-breakdown vocabulary. They sort below banded advisories within the active bucket.

**Placeholder summary stripping.** When the upstream advisory feed returns the literal string `No summary available` (an OSV convention), both the JSON envelope and the terminal row drop the field entirely — absence of `summary` is the signal, and the advisory row is shorter as a result.

**Upgrade-path ordering.** `upgradePaths` are de-duplicated and sorted ascending by semver-ish comparison (pre-release suffixes rank below the matching base release), so the footer presents the minimum-churn upgrade first: `Upgrade options: 3.11.0, 4.0.0-rc1, 4.5.0, 4.19.2, …` rather than the backend's advisory-iteration order.

**Output envelope.** `{registry, name, version, requestedVersion?, filter?, summary: {total, affected?, bySeverity?}, advisories?, upgradePaths?}`. `filter` echoes only explicit caller filters and non-default advisory scope. Each advisory: `{id?, aliases?, summary?, severity?, severityLabel?, affectedRanges?, affectsInspectedVersion?, matchedAffectedVersionRanges?, fixedIn?, publishedAt?, modifiedAt?, withdrawnAt?, isMalicious?}`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Exit codes.** 0 on success including zero-vulns; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

**Troubleshooting.** Same debug areas as `pkg info`.

### `githits pkg deps`

```
githits pkg deps npm:express
githits pkg deps npm:express --lifecycle all
githits pkg deps crates:tokio --lifecycle optional
githits pkg deps npm:express --lifecycle runtime,development
githits pkg deps npm:express --depth 2
githits pkg deps npm:express --json
```

Analyses dependencies for a package on npm, PyPI, Hex, Crates, vcpkg, Zig, RubyGems, Go, or Swift. Default terminal output is a flat list of direct runtime dependencies with a hint summarising hidden groups.

**Package spec.** `<registry>:<name>[@<version>]`. `@<version>` is accepted (same as `pkg vulns`); defaults to latest. Tag-style inputs such as `@v4.18.0` are rejected client-side with `INVALID_ARGUMENT` except for Swift, where `v`-prefixed release tags are accepted. Only `npm`, `pypi`, `hex`, `crates`, `vcpkg`, `zig`, `rubygems`, `go`, and `swift` are supported; other registries are rejected client-side with `pkg deps only supports npm, pypi, hex, crates, vcpkg, zig, rubygems, go, swift. Got: ${registry}.`

**Two views.** The default runtime view renders a labelled `Runtime dependencies:` list from `dependencies.direct` — the flat answer to "what does this pull in?". The structured groups view (`--lifecycle all` or a concrete non-runtime lifecycle) renders a labelled `Dependency groups:` block and preserves registry-specific condition metadata (PyPI extras, Crates features). Dev / peer / build / optional deps live only in the groups view — the wire's `direct[]` is always runtime-only. The groups view does not repeat the resolved runtime list above the group block; runtime group rows include resolved versions when available.

**Lifecycle filter.** `-l, --lifecycle <phases>` accepts a comma-separated list of canonical lowercase tokens (`runtime`, `development`, `build`, `peer`, `optional`). Uppercase and whitespace are tolerated. The filter only affects `dependencyGroups`; `direct[]` and `transitive[]` are returned regardless. Unknown tokens are rejected with `INVALID_ARGUMENT` and the canonical list.

**Groups view (`--lifecycle all` or a concrete non-runtime lifecycle).** Headings collapse to `name` when `conditionType === "always"` (e.g. `runtime`, `development`). Feature / TFM groups render `name (lifecycle, conditionType[: conditionValue])` — `conditionValue` is omitted when it equals `name` (the common case on Crates features and PyPI extras). Within each group, entries sort alphabetically. Duplicate `{name, constraint}` tuples inside a group collapse in the terminal for scannability; the JSON envelope preserves every duplicate the backend emitted.

**Transitive view (`--depth <n>`).** Replaces the runtime list with a labelled `Transitive packages:` block containing the unique transitive closure up to the requested depth (alphabetical, `name@version`, one per line). Summary row carries the aggregate counts + conflict / cycle counts and `(max depth N)`. `--depth <n>` is both the transitive-output request and the traversal cap (1-10); omitting it shows direct dependencies only.

**Verbose (`--verbose`).** In both plain and transitive modes, each dep expands to a multi-line block: the first line is `name@version`, followed by indented `- <constraint> required by <importer>@<importer-version>, ...` bullets. Importers that share a constraint are collapsed onto one bullet with a comma-separated list. In plain mode each direct dep has exactly one importer (the root package itself); in transitive mode a popular leaf may list many importers grouped by constraint. Conflicts expand into a `Conflicts (N):` table (`name: range1, range2, ...`, one row per package); circular dependencies expand into a `Circular dependencies (N):` list (`a -> b -> a` chain).

**JSON envelope.** Preprocessed: `runtime.items[].version` surfaces the resolved version alongside the constraint. Under `--depth`, `transitive.packages[]` carries `{name, version}` records by default; `--verbose` opts each entry into an `importers[]` array with importer name / version / constraint (roughly quadruples envelope size on heavy graphs, so it's off by default). `transitive.conflicts[]` and `transitive.circularDependencies[]` are typed (`{name, requiredVersions}` / `{cycle: string[]}`). The raw DAG itself is deliberately **not** in the envelope.

**Output envelope.** `{registry, name, version, requestedVersion?, runtime?, groups?, transitive?, filter?}`. Data-first: the `runtime` block emits whenever the backend returned `dependencies.direct` (including `{count: 0, items: []}` for zero-dep packages); the `groups` block emits whenever the backend returned `dependencyGroups` (including `{items: []}` when a lifecycle filter matched nothing, so agents distinguish "backend has no groups concept" from "filter excluded everything"). Each group carries its members under `items` (matches the top-level `runtime.items` naming so dependency lists share one key throughout the envelope). `filter.lifecycles` echoes the canonicalised, deduplicated, display-order-sorted list the backend received — not the raw CSV input.

**Exit codes.** 0 on success including zero-dep packages; 1 on any error. Under `--json`, the error envelope is written to **stderr**.

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

**Default terminal output.** Summary header (`name | registry | source | mode | entry count`) followed by each entry's `version  date  url` header plus the first 10 lines of its markdown body, indented and dimmed. Bodies longer than the cap show a footer `... (+N more lines - use --verbose for the full body)`. Missing dates render as `-`; missing versions render as `(unversioned)`. The version column is padded to the longest entry in the current response (no fixed width).

**`--verbose`.** Uncaps the body preview — every entry's full markdown body renders, indented and dimmed, with no truncation footer. Terminal-only — does not change `--json` output.

**`--no-body`.** Drops body fields from entries. Affects both terminal output (no body preview, no footer) and `--json` (entry objects lose the `body` field). Mirrors MCP's `omit_bodies: true`. Default `--json` keeps full markdown bodies; use `--no-body` when you only need the version / date / URL timeline (drops 10 KB+ per entry on large release notes — measured 5.13× size reduction on `npm:typescript --limit 20`).

**JSON envelope.** `{registry?, name?, repoUrl?, source, mode, entries: {count, items}, filter?}`. `source` is always present (the null-source case is promoted to `NOT_FOUND` at the service boundary and never reaches this shape). `entries.count` is computed client-side from `items.length`. `filter` emits only when the caller explicitly supplied one of `--from`, `--to`, `--limit`, `--git-ref`; backend defaults don't round-trip as caller intent.

**Per-entry shape.** `{version, normalizedVersion?, publishedAt?, htmlUrl?, body?}`. `version` is kept even when null so agents can map `items.map(e => e.version)` without guarding; other nullable fields are stripped. The backend's opaque per-entry `metadata` GenericJSON is deliberately dropped from the envelope — revisit via agent feedback.

**Errors.** `NOT_FOUND` covers both the backend's "package not found" case and the distinct "package exists but no changelog source resolved" case (typed `PackageIntelligenceChangelogSourceNotFoundError`; message names the sources that were tried). `VERSION_NOT_FOUND` enriches with structured `package` / `requested` / `available` detail lines from the shared `promoteGenericVersionNotFound` helper — which was extended in this PR to recognise `--from` and `--to` as promotable version inputs.

**Troubleshooting.** Same debug areas as the rest of the `pkg` family.

### `githits docs list`

```
githits docs list npm:express
githits docs list npm:express --limit 20
githits docs list npm:express --json
```

Lists hosted/crawled and repository-backed documentation pages for a package. Each row includes a stable page ID for `docs read`, a source badge, and the source location. JSON output also includes repo URL / git ref / file path for repository-backed docs so callers can follow up with `code read` when source context is needed.

**Pagination.** `--limit <n>` accepts 1-500. When `hasMore` is true, pass the returned `nextCursor` to `--after`.

**Output envelope.** `{registry, name, version?, pages, total?, hasMore, nextCursor?, stale?, filter?}`. Each page has `{pageId, title, sourceKind, sourceUrl?, linkName?, repoUrl?, gitRef?, filePath?, lastUpdatedAt?}`.

**Troubleshooting.** Same debug areas as the `pkg` family.

### `githits docs read`

```
githits docs read <page-id>
githits docs read <page-id> --lines 10-80
githits docs read <page-id> --verbose
githits docs read <page-id> --json
```

Reads a documentation page returned by `docs list` or search results. Default output is content-only for easy piping; `--verbose` adds a metadata header.

**Line ranges.** `--lines 10-40`, `--lines 10-`, and `--lines -40` are supported. Use ranges to inspect long pages incrementally.

**Output envelope.** `{pageId, title?, sourceKind?, sourceUrl?, repoUrl?, gitRef?, filePath?, totalLines?, startLine?, endLine?, content}`. Repo-backed docs include exact source metadata for `code read` follow-up.

**Troubleshooting.** Same debug areas as the `pkg` family.

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
| `CodeNavigationService` (via container) | top-level unified `search` / `search-status`, MCP indexed-search tools (`search`, `search_status`, `code_files`, `code_read`, `code_grep`), and the `githits code` command group |
| `filterLanguages()` from `packages/mcp/src/shared/language-filter.ts` | `search_language` MCP tool + `languages` CLI command |
| `requireAuth()` from `packages/mcp/src/shared/require-auth.ts` | all CLI commands and auth-required MCP tool handlers |

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

- **`GITHITS_TELEMETRY=1`** — Emits an end-of-run timing summary to stderr without polluting normal stdout. Current spans cover command registration, container creation, token loading/refresh, and the outbound API/package-intelligence request.

## Key Reference Files

| File | Purpose |
|---|---|
| `src/commands/example.ts` | Example-search command implementation |
| `src/commands/search.ts` | Unified search and search-status command implementation |
| `src/commands/languages.ts` | Languages command with colored output |
| `src/commands/feedback.ts` | Feedback command with accept/reject validation |
| `packages/mcp/src/shared/language-filter.ts` | Pure `filterLanguages()` shared with MCP tool |
| `packages/mcp/src/shared/require-auth.ts` | Auth guard shared with MCP server |
| `packages/mcp/src/shared/colors.ts` | ANSI color utilities and `shouldUseColors()` |
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
