# githits Agent Instructions

GitHits companion for the backend - provides MCP server and command-line tools for code example search.

We strive to produce high quality code that can easily be maintained. Focus is on long term development speed, not on quick wins.

This document contains the most important instructions that need to be kept always in context.

## General

- Use very concise output and neutral tone
- If unclear about anything or stuck, please stop and ask for clarification
- Always verify assumptions
- Don't jump into coding, plan and assess the impact first
- Read more detailed documentation when needed
- Remember your MCP tools and use them when needed

## Architecture

Philosophy: "Create architecture that is performant and easy to test"

- Focus on building structures that are performant and scalable
- Build architecture that is easy to test
- Isolate functionality into sensible small modules
- Follow single responsibility principle
- Prefer public helper modules to lots of private methods
- Use dependency injection for external services (REST client, etc.)
- Do not eagerly validate network/proxy/environment configuration while constructing command dependencies when the command has local-only or no-network paths. Defer validation until the first network operation and add regression tests for malformed env values on local paths.
- For MCP/agent-facing tools, avoid coupled optional flags and default-true booleans. Design schemas for real agent calls, including empty strings, empty arrays, and explicit `false` values.
- For MCP tool discovery, treat the tool name plus the first 80 description characters as a standalone selection surface. A verified Claude Desktop connector session exposed only that context during unguided tool selection; connector descriptions and MCP server instructions did not reach it. Lead with the natural user question and the tool's distinct job, treat 80 characters as a ceiling rather than a target, and keep registry counts/lists, argument mechanics, and follow-up routing after that boundary. Do not rely on neighboring tools for context. Add first-80 contract tests and run descriptor-only agent evals for description changes.
- For GraphQL/API-backed tools, treat minimal data fetching as part of the tool contract. Before adding or changing selected fields, compare the query against every consumer (text, verbose, JSON, MCP, CLI, and internal callers), use conditional fields or separate queries for mode-specific data, and add tests that assert the wire variables/selections for compact and detailed modes.

See `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` for detailed planning checklist and design principles.

## Testing

Philosophy: "If it is not tested, it is likely broken"

**Critical Rules:**

- Use `bun test` for running tests
- Use `bun run smoke:mcp` and `bun run smoke:cli` when changing MCP tools, CLI commands, shared formatters, auth/error envelopes, or MCP/CLI parity behavior. These are live-capable local suites, not the normal unit suite; they must pass unauthenticated by validating auth handling, and provide deeper coverage when authenticated. After building, also run `bun run smoke:cli:built` and `bun run smoke:mcp:built` when changing smoke launch behavior or CI product validation; these secret-free modes execute `dist/cli.js` under Node.
- Use `bun run agent:e2e` when changing MCP instructions, tool descriptions, or agent-facing tool behavior. This is a human/agent-driven qualitative eval, not a deterministic CI gate. Pick targeted workloads from `eval/agentic/README.md`; run both Claude and Codex for broad instruction changes when practical. Inspect `tool-calls.json` and `final.json` for actual tool use, `toolIssues`, `instructionIssues`, and usefulness, not just harness pass/fail.
- Maintain smoke coverage when adding or changing user-facing tools/commands. Prefer structural UX assertions over brittle snapshots, and keep MCP `format: "json"` and CLI `--json` behavior aligned.
- When changing GraphQL/API selections, add regression tests for over-fetch controls (for example `@include` variables, body omission, field lists, or query builders) and live-smoke the affected CLI/MCP surfaces when authenticated access is available.
- Keep tests async and isolated
- Mock services at the interface level using factory functions
- Use mock factories from `test-helpers.ts` (e.g., `createMockGitHitsService()`, `createMockAuthService()`)
- Test behavior, not implementation - focus on inputs and outputs
- Test only one layer at a time - mock dependencies
- When tests simulate another platform, simulate that platform's path semantics too. Use `path.win32` for Windows paths and avoid mixed literals like `C:\\Users\\me/app`; mixed separators can make tests pass while real Windows logic is broken.

**Test Structure:**

```typescript
import { describe, expect, it, mock } from "bun:test";
import { createMockGitHitsService } from "./test-helpers.js";

describe("myTool", () => {
  it("does something", async () => {
    const mockService = createMockGitHitsService({
      /* overrides */
    });
    // test...
  });
});
```

See `docs/guidelines/TESTING.md` for comprehensive patterns.

## Development Workflow (Docs-driven)

- Proposals -> Plans -> Implementation -> Completion
- Keep docs updated as features evolve:
  - Implementation notes: `docs/implementation/`
  - Guidelines: `docs/guidelines/`
- Use test driven development whenever possible
- Document what and why with JSDoc comments

## Plugin Asset Workflow

- Root `skills/` and `AGENTS.md` are the only authored shared agent guidance. `CLAUDE.md` and `GEMINI.md` must remain symlinks to `AGENTS.md`.
- Use the repository-internal `githits-plugin-maintenance` skill when changing skills, agent guidance, plugin/marketplace/extension manifests, MCP transport metadata, root release metadata, generator behavior, or agent-facing setup/auth behavior. It must remain under `.agents/skills/` and must not be published with the public root `skills/` tree.
- Do not edit generated plugin assets directly. Change their canonical inputs, run `bun run plugins:generate`, inspect the diff, and run `bun run plugins:check`.
- `server.json` owns the canonical plugin keyword list used by generated manifests; keep `package.json` aligned with it.
- All plugin and extension packages use hosted remote MCP. Direct `githits init` configuration retains local stdio except for Cursor, which is remote-only. Claude and Gemini direct setup remove legacy plugin or extension state before installing the user-scoped stdio server.

## TypeScript Essentials

### Quick Start

- Use `bun run dev` for development
- Use `bun test` for testing
- Use `bun run build` before committing

### Code Style

- Always add TypeScript types for function parameters and returns
- Prefer interfaces to type aliases for object shapes
- Use `const` assertions for literal types
- Prefer explicit types over inference for public APIs
- Use Zod for runtime validation

### Patterns

- **Dependency Injection**: Use factory functions that accept dependencies
- **Service Layer**: Abstract external calls behind service interfaces
- **Error Handling**: Use `withErrorHandling()` wrapper for consistent errors
- **Tool Pattern**: Follow `ToolDefinition` interface for MCP tools

## Workspace Boundaries

- Root `src/**` is still the published `githits` CLI implementation until the CLI package move completes. It owns Commander commands, local auth storage, browser login, init/setup flows, local stdio MCP startup, plugin/assistant packaging assets, and the diagnostics implementation/lifecycle (environment, process, and output destinations).
- `packages/core-internal` is private source. It owns transport-neutral service clients, service interfaces, shared request/header primitives, the host-supplied `ServiceDiagnostics` contract, neutral service errors, PKCE helpers, and `TokenProvider`. It must not discover diagnostics environment settings or own diagnostics process/output destinations. Never publish or leak `@githits/core-internal` into public artifacts.
- `packages/mcp` is the public `@githits/mcp` package. Its public tool/server API is `packages/mcp/src/index.ts`: transport-neutral MCP server creation, tool registration, descriptors, instructions, request-scoped service provider types, and MCP service types. Its public runtime/client API is `packages/mcp/src/client.ts`, exported as `@githits/mcp/client`, for remote MCP servers that need concrete service implementations, token/header/config helpers, and optional injected `ServiceDiagnostics`.
- `@githits/mcp/smoke-test` is a public validation helper entrypoint for remote MCP servers. It exports smoke assertions and `runMcpSmoke()` without depending on local CLI startup.
- `@githits/mcp/internal` is a workspace-only alias for root CLI transition helpers. External packages and the future remote MCP server repo must never import it. If remote server work needs something internal, promote the smallest stable API through `@githits/mcp` instead.
- Public package artifacts for both root `githits` and `@githits/mcp` must not contain `@githits/core-internal`, `workspace:*`, `@githits/mcp/internal`, or private source aliases in JS, declarations, or manifests. The public-package validator also rejects static `fs`, `node:fs`, `fs/promises`, and `node:fs/promises` imports in core source and packed MCP artifacts, and rejects direct core `process.stderr`/`process.stdout` access. These checks cover statically resolved string-literal module edges; they do not claim browser compatibility.

## Release Boundaries

- Every notable user-, agent-, operator-, or public-API-visible change must add
  one independent `changes/<unique-name>.<category>.md` fragment with an
  explicit pending SemVer impact for every public artifact. Do not edit
  `CHANGELOG.md` outside release preparation. Follow
  `docs/implementation/release-process.md` and `changes/README.md`.
- Treat dated, versioned changelog sections as immutable historical records. Change them only to correct blatant, demonstrable factual errors, and keep any correction minimal.
- `githits` and `@githits/mcp` have separate release flows. They may be bumped together when both surfaces changed, but CLI-only changes should not bump `@githits/mcp`.
- Root `githits` release versions must stay aligned with generated plugin/assistant manifests: `.plugin/plugin.json`, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `.cursor-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `gemini-extension.json`. The versionless Antigravity `plugin.json` and `mcp_config.json` must also be regenerated and checked.
- `@githits/mcp` release versions live in `packages/mcp/package.json` and should change only for MCP package API, tool behavior, MCP instructions, schemas, MCP auth/error behavior, or remote-server-facing public type changes.
- For coordinated CLI and MCP releases, keep the MCP minor aligned with the CLI minor for discoverability. The first MCP release for a CLI minor starts at `X.Y.0`; later MCP-package-visible changes in that CLI minor bump the MCP patch.
- A request to audit, prepare, create, cut, or release a version authorizes release preparation through opening the release PR only; it does not authorize merging, enabling auto-merge, tagging, or publishing. Merging requires separate, explicit human approval given after the release PR exists and identifying that PR. Earlier release requests do not count. Stop after opening the PR, report its URL and check status, and wait for that approval.
- Successful `Main` runs on `main` trigger both root and MCP release workflows. The MCP workflow publishes only when the package version is not already published; manual dispatch is for recovery or dry runs.
- Release preparation consumes all fragments into separate versioned sections
  for each released artifact and deletes the consumed files.
- Validate package behavior from outside root path aliases. Repo-local imports can hide package export-map or declaration problems.

### Common Pitfalls

- Not mocking services in tests
- Missing error handling in async operations
- Not updating `index.ts` exports when adding new modules

## Commit & PR Guidelines

### Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <description>

[optional body with context]
```

**Types:**

- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation only
- `refactor:` - Code change that neither fixes a bug nor adds a feature
- `test:` - Adding or updating tests
- `chore:` - Maintenance tasks (deps, build, etc.)

**Examples:**

```
feat: add search MCP tool

Implements code example search via GitHits backend REST API
with license filtering support.
```

```
fix: handle expired tokens in auth status
```

### Pull Requests

- Use descriptive PR titles (they appear in release notes)
- Add labels for categorization:
  - `feature` / `enhancement` - New features
  - `bug` / `fix` - Bug fixes
  - `documentation` - Docs changes
  - `maintenance` / `chore` - Maintenance
  - `skip-changelog` - Exclude from release notes

### Other Rules

- No single liners - include body with context
- Follow guidelines from `docs/guidelines/REVIEW_GUIDELINES.md`
- Do not amend commits or rebase unless asked specifically

## Project Structure

```
src/
  cli.ts              # root CLI entry point for published githits package
  container.ts        # root CLI dependency injection
  auth/               # OAuth PKCE utilities
  commands/           # CLI commands and local stdio MCP command
  services/           # CLI/local auth storage and service composition
  tools/              # root CLI/MCP parity tests only
packages/
  core-internal/      # private transport-neutral service/core source
  mcp/                # public @githits/mcp package source
  cli/                # private placeholder until CLI package move
docs/
  guidelines/         # Development guidelines
  implementation/     # Implementation documentation
```
