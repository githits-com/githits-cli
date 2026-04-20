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
| `package_summary` | `registry`, `package_name` | Package overview: latest version, license, description, repository, downloads, GitHub metadata, install command, and known vulnerabilities. Always returns the latest published version. |
| `package_vulnerabilities` | `registry`, `package_name`, `version?`, `min_severity?`, `include_withdrawn?` | Known vulnerabilities for a package on npm, PyPI, Hex, or Crates. Count summary, per-advisory OSV ID + severity + affected/fix ranges, and upgrade paths. Malware is surfaced in a disjoint bucket. |

`search_symbols`, `package_summary`, and `package_vulnerabilities` are only registered when the startup token advertises `code_navigation` capability. The backend endpoint can be overridden via `GITHITS_CODE_NAV_URL` for local development. Capability gating keeps the tools hidden from public/default flows while the feature is still rolling out.

`search_symbols` shares request-construction, error classification, and JSON-payload shape with the CLI `githits code search` command via shared helpers under `src/shared/`. The parity rules are codified in [`mcp-cli-parity.md`](./mcp-cli-parity.md); the parity test (`src/tools/search-symbols-parity.test.ts`) asserts that both surfaces emit identical JSON for equivalent inputs.

**Response shape.** `search_symbols` always requests `mode: DETAILED` and always selects the `code`, `resolution`, `kind`, and `category` fields. Responses include each match's full source code, precise symbol kind (from the unified symbol taxonomy), broad symbol category, and line range. The tool does not expose `mode` or `verbose` inputs — the service layer makes the choice once so both surfaces get the richest response without callers juggling the knobs. The legacy `chunkType` field is no longer selected or surfaced client-side; `kind` is the single source of truth for taxonomy. The text payload is always valid JSON (whether the result is success or error), so MCP clients can parse `content[0].text` without branching on `isError`.

**Filter parameters.** `category` is the preferred surface for filtering (`callable`, `type`, `module`, `data`, `documentation`); `kind` is for the "I want this specific construct" case (27-value taxonomy). Both filters may be combined; both route through the shared `buildSearchSymbolsParams` helper.

### `package_summary` response shape

**Hand-crafted JSON envelope.** `package_summary` returns a lean JSON payload designed for agent token efficiency. Every GraphQL field dropped is deliberate — backend metadata (`schemaVersion`, `downloadsRefreshedAt`, `versionCount`, duplicate GitHub identifiers) does not reach the envelope. Null scalars are omitted; blocks (`github`, `vulnerabilities`, `downloads`, `recentChanges`) are omitted entirely when they carry no actionable data. `vulnerabilities` is omitted when `total === 0` or missing; when present, severity values include a CVSS-banded `severityLabel` (`critical` ≥9, `high` ≥7, `medium` ≥4, else `low`) for agent convenience.

**Validation.** The MCP schema is permissive (`registry: z.string()`, `package_name: z.string()`) — validation happens in-handler via `buildPackageSummaryParams`, producing the same structured `{error, code, retryable}` envelope as CLI. Matches the `search_symbols` pattern of never surfacing raw Zod errors to agents.

**Always latest.** The query exposes no `version` input because the upstream `packageSummary` resolver always returns the latest published version. The CLI `githits pkg info` rejects `<spec>@<version>` with `INVALID_ARGUMENT` rather than silently swapping — a silent-swap would break security-testing workflows that pin to an older vulnerable release.

`package_summary` shares its envelope builder, terminal formatter, and error classifier with the CLI `githits pkg info` command via `src/shared/package-summary-request.ts`, `src/shared/package-summary-response.ts`, and `src/shared/package-intelligence-error-map.ts`. The parity test (`src/tools/package-summary-parity.test.ts`) asserts `toEqual` between CLI `--json` and MCP `content[0].text` for service-sourced fixtures, and `toMatchObject` for the `INVALID_ARGUMENT` fixture where surface-specific error text is acceptable.

### `package_vulnerabilities` response shape

**Filter-aware summary.** `min_severity` and `include_withdrawn` are passed straight to the GraphQL query. The backend's `vulnerabilityCount` reflects the filtered set — there is no client-side filtering and no `summary.filtered` dual-block. Callers wanting the unfiltered view omit the flag.

**Partitioning buckets.** Advisories with `isMalicious: true` count **only** under `summary.bySeverity.malware`; severity bands (`critical`/`high`/`medium`/`low`) count non-malicious advisories with a positive CVSS score; non-malicious advisories with no score count under `summary.bySeverity.unrated`. Every returned advisory lands in exactly one bucket — the client-side guarantee is `MALWARE + crit + high + medium + low + unrated = advisories.length`. The sum also equals `summary.total` whenever the backend keeps `vulnerabilityCount` and `vulnerabilities[]` consistent (the expected case on all shipped registries). The malware bucket sorts to the top of the advisory list regardless of score. The `unrated` bucket ensures the terminal breakdown line reconciles with the header total on Rust / PyPI packages where a non-trivial fraction of advisories ship without a CVSS score.

**Version validation.** `package_vulnerabilities` accepts canonical package versions only. Tag-style refs with a leading `v` (for example `v4.18.0`) are rejected client-side with `INVALID_ARGUMENT` before the backend call. This avoids the current production backend's unhelpful generic error for that input shape. This is intentionally narrow: proper ecosystem-aware version parsing and typed invalid-version errors belong in the backend, not in ad hoc CLI normalization rules.

**Typed `VERSION_NOT_FOUND`.** Mirrors the code-nav precedent: a dedicated `PackageIntelligenceVersionNotFoundError` carries structured `{ packageName, requestedVersion, availableVersions? }` fields sourced from GraphQL `extensions`. Classifier routes it to `VERSION_NOT_FOUND` with a structured `details` block. When the backend returns a generic backend error whose message matches `/no matching version/i` (current production behaviour — the typed `extensions.code` is not yet emitted on `packageVulnerabilities`), the service promotes the error to `VersionNotFoundError` using the caller's `packageName` + `version` so CLI / MCP surfaces still render an actionable envelope. `availableVersions` remains undefined in the fallback path until the backend ships them.

**Omission rules.** Null scalars omitted; empty arrays dropped; zero-count `bySeverity` keys dropped; the `bySeverity` block itself dropped when `total === 0`. `modifiedAt` included only when it differs from `publishedAt`. `isMalicious` included only when `true`.

**Registry coverage.** Only npm, PyPI, Hex, and Crates have vulnerability data. The CLI + MCP reject the other five registries client-side with a tool-specific message (`pkg vulns only supports npm, pypi, hex, and crates. Got: ${registry}.`) — rejection predicate lives in `src/shared/package-vulnerabilities-request.ts` rather than the shared registry module, since it is a tool-specific capability matrix.

`package_vulnerabilities` shares its envelope builder with the CLI `githits pkg vulns` command via `src/shared/package-vulnerabilities-request.ts` and `src/shared/package-vulnerabilities-response.ts`. The terminal formatter is CLI-only (MCP always emits JSON). The parity test (`src/tools/package-vulnerabilities-parity.test.ts`) asserts `toEqual` across the service-sourced success and typed-error fixtures, and `toMatchObject` for builder-sourced `INVALID_ARGUMENT` fixtures such as unsupported registries and tag-style `v`-prefixed versions.

## Server instructions

The MCP server advertises a short, cross-tool orientation via the protocol's server-level `instructions` field. This is distinct from per-tool `description` text: instructions cover rationale, workflow glue, and decisions that span multiple tools, while per-tool descriptions remain the source of truth for arguments, output shape, and tool-specific constraints.

`src/commands/mcp-instructions.ts` owns two sections:

- **Core block** — always loaded. Introduces GitHits and the `search` / `search_language` / `feedback` workflow.
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
