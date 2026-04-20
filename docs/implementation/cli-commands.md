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

**Always latest.** `pkg info` returns the latest published version regardless of input. Passing `<spec>@<version>` is rejected with `INVALID_ARGUMENT` and a clear message — the tool never silently swaps to latest. Use `pkg vulns` (future) or `pkg deps` (future) for version-pinned queries.

**`--verbose` + `--json`.** `--verbose` has no effect under `--json` — the JSON envelope always carries every field the verbose terminal view exposes (and more). The flag only affects human-readable output.

**Output envelope.** Success payload is hand-crafted for agent token efficiency: `{registry, name, version, description?, license?, homepage?, repository?, publishedAt?, downloads?, github?, install?, usage?, vulnerabilities?, recentChanges?}`. Omitted fields reflect backend nulls, not dropped data. Error envelope: `{error, code, retryable, details?}` — same shape as `search_symbols`, same classifier family. Under `--json` the error envelope is written to **stderr** so stdout stays clean for `jq`.

**Capability gate.** Same as `code`: `code_navigation` capability on the token, `GITHITS_CODE_NAVIGATION=1` override, `GITHITS_API_TOKEN` env token, or expired stored auth.

**Troubleshooting.** `GITHITS_DEBUG=pkg-intel` emits PII-safe classified-error diagnostics (area, event, code, error class, detail keys). `GITHITS_DEBUG=pkg-graphql` emits transport-failure diagnostics from inside the POST helper. Use `GITHITS_DEBUG=*` to enable both.

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
