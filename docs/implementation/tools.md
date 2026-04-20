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
| `search` | `query`, `language`, `license_mode?` | Search for code examples. Returns markdown-formatted results. |
| `search_language` | `query` | Find supported programming language names before searching. |
| `feedback` | `solution_id`, `accepted`, `feedback_text?` | Submit feedback on a search result to improve quality. |
| `search_symbols` | `target`, `query?`, `keywords?`, `match_mode?`, `category?`, `kind?`, `file_path?`, `limit?`, `file_intent?`, `wait_timeout_ms?` | Capability-gated code navigation search over indexed dependency source. |

`search_symbols` is only registered when the startup token advertises `code_navigation` capability. The code-navigation endpoint can be overridden via `GITHITS_CODE_NAV_URL` for local development. Capability gating keeps the tool hidden from public/default flows while the feature is still rolling out.

`search_symbols` shares request-construction, error classification, and JSON-payload shape with the CLI `githits code search` command via shared helpers under `src/shared/`. The parity rules are codified in [`mcp-cli-parity.md`](./mcp-cli-parity.md); the parity test (`src/tools/search-symbols-parity.test.ts`) asserts that both surfaces emit identical JSON for equivalent inputs.

**Response shape.** `search_symbols` always requests `mode: DETAILED` and always selects the `code`, `resolution`, `kind`, and `category` fields. Responses include each match's full source code, precise symbol kind (from the unified symbol taxonomy), broad symbol category, and line range. The tool does not expose `mode` or `verbose` inputs — the service layer makes the choice once so both surfaces get the richest response without callers juggling the knobs. The legacy `chunkType` field is no longer selected or surfaced client-side; `kind` is the single source of truth for taxonomy. The text payload is always valid JSON (whether the result is success or error), so MCP clients can parse `content[0].text` without branching on `isError`.

**Filter parameters.** `category` is the preferred surface for filtering (`callable`, `type`, `module`, `data`, `documentation`); `kind` is for the "I want this specific construct" case (27-value taxonomy). Both filters may be combined; both route through the shared `buildSearchSymbolsParams` helper.

## Entry Points

The `githits mcp` command has two modes:

- **`githits mcp`** (no subcommand) — Detects TTY. When run interactively, shows setup instructions for configuring AI assistants. When run via stdio (non-TTY), starts the MCP server.
- **`githits mcp start`** — Always starts the MCP server. Use this in MCP configuration files.

Both paths call `requireAuth()` before starting the server. See `src/commands/mcp.ts` for the TTY detection logic.

## Architecture

```
MCP SDK Server (src/commands/mcp.ts)
  └─ registers tools using deps.githitsService from container
       └─ each tool: createXxxTool(service)
            └─ ToolDefinition { name, description, schema, handler, annotations? }
                 └─ handler calls GitHitsService or CodeNavigationService methods
                      └─ service implementation makes REST or GraphQL calls
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
| `search` response | Backend builds markdown from structured `McpSearchResponse` | CLI receives pre-formatted markdown from REST `/search` endpoint |
| `feedback` response | Backend returns different messages for accepted/rejected | CLI hard-codes "Feedback submitted successfully" on success; the REST API response body is not used for the message |
| Error handling | Catches specific exception types, logs to PostHog | Uses `withErrorHandling()` wrapper for consistent `ToolResult` errors |

These differences exist because the CLI hits the REST API (which does its own formatting) rather than calling internal backend services directly.

## Testing Tools

Each tool has a co-located test file (e.g., `src/tools/search.test.ts`). Tests use `createMockGitHitsService()` from `src/services/test-helpers.ts` to mock the service layer.

Test categories for each tool:
- **Metadata** — tool name and description are correct
- **Service calls** — correct parameters passed to the service
- **Success path** — result formatted correctly
- **Error path** — errors wrapped in `ToolResult` with `isError: true`

See `docs/guidelines/TESTING.md` for the full testing pattern.

## Key Reference Files

| File | What it demonstrates |
|---|---|
| `src/tools/search.ts` | Canonical tool definition with full description |
| `src/tools/search-language.ts` | Tool with client-side filtering logic |
| `src/tools/feedback.ts` | Simplest tool (direct service delegation) |
| `src/tools/types.ts` | `ToolDefinition` interface, `textResult`/`errorResult` helpers |
| `src/tools/shared.ts` | `withErrorHandling()` wrapper |
| `src/services/test-helpers.ts` | `createMockGitHitsService()` and `createMockCodeNavigationService()` factories |
| `src/commands/mcp.ts` | Tool registration, MCP server setup, and TTY detection |
| `src/services/githits-service.ts` | REST API client (what tools and CLI commands call) |
| `src/services/code-navigation-service.ts` | GraphQL code navigation client for `search_symbols` |
| `src/shared/language-filter.ts` | Pure `filterLanguages()` function shared between MCP tool and CLI |

## Pending backend follow-ups

- **`totalMatches` / pagination.** `searchSymbols.totalMatches` currently tracks `results.length` on the wire — equal to `returnedCount`, not the total before `limit`. Once the backend distinguishes them (and adds an `offset` arg), the CLI header flips from *"N match(es) (more available)"* to *"Showing N of M"* and a `--offset` flag can land for pagination. Tracked with the backend team; no frontend changes needed in the meantime.

## Related Documentation

- Backend tool definitions: `githits-backend/githits/api/mcp/server.py`
- [`mcp-cli-parity.md`](./mcp-cli-parity.md) — rules for dual-surface tools (CLI ↔ MCP)
- [`cli-commands.md`](./cli-commands.md) — CLI commands that mirror these MCP tools
- `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` — service isolation and testing patterns
