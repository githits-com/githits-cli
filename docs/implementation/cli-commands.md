# CLI Commands

## Purpose

The CLI exposes three commands (`search`, `languages`, `feedback`) that mirror the MCP tools for direct human and agent use. These commands share business logic with the MCP tools through the same `GitHitsService` and shared utilities, but format output for terminal consumption instead of MCP tool results.

## Commands

| Command | Required Args | Options | Description |
|---|---|---|---|
| `search <query>` | `-l, --lang <language>` | `--license <mode>`, `--explain`, `--json` | Search for code examples |
| `languages [query]` | — | `--json` | List or filter supported languages |
| `feedback <solution_id>` | `--accept` or `--reject` | `-m, --message <text>`, `--json` | Submit feedback on a search result |

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
| `GitHitsService` (via container) | MCP tools + all CLI commands |
| `filterLanguages()` from `src/shared/language-filter.ts` | `search_language` MCP tool + `languages` CLI command |
| `requireAuth()` from `src/shared/require-auth.ts` | MCP server startup + all CLI commands |

## Adding a New CLI Command

1. **Create command file** — `src/commands/new-command.ts` with `XxxDependencies` interface, `xxxAction()`, and `registerXxxCommand()`
2. **Create test file** — `src/commands/new-command.test.ts` testing action directly via deps injection
3. **Export from barrel** — Add to `src/commands/index.ts`
4. **Register in CLI** — Import and call `registerXxxCommand(program)` in `src/cli.ts`
5. **Update help text** — If the command is a primary workflow, add it to the `addHelpText("after", ...)` block

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

## Related Documentation

- `docs/implementation/tools.md` — MCP tools that share business logic with these commands
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — DI and testing patterns
