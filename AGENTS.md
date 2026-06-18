# githits Agent Instructions

CLI companion for GitHits backend - provides MCP server and command-line tools for code example search.

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
- For MCP/agent-facing tools, avoid coupled optional flags and default-true booleans. Design schemas for real agent calls, including empty strings, empty arrays, and explicit `false` values.

See `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` for detailed planning checklist and design principles.

## Testing

Philosophy: "If it is not tested, it is likely broken"

**Critical Rules:**

- Use `bun test` for running tests
- Use `bun run smoke:mcp` and `bun run smoke:cli` when changing MCP tools, CLI commands, shared formatters, auth/error envelopes, or MCP/CLI parity behavior. These are live smoke suites, not the normal unit suite; they must pass unauthenticated by validating auth handling, and provide deeper coverage when authenticated.
- Use `bun run agent:e2e` when changing MCP instructions, tool descriptions, or agent-facing tool behavior. This is a human/agent-driven qualitative eval, not a deterministic CI gate. Pick targeted workloads from `eval/agentic/README.md`; run both Claude and Codex for broad instruction changes when practical. Inspect `tool-calls.json` and `final.json` for actual tool use, `toolIssues`, `instructionIssues`, and usefulness, not just harness pass/fail.
- Maintain smoke coverage when adding or changing user-facing tools/commands. Prefer structural UX assertions over brittle snapshots, and keep MCP `format: "json"` and CLI `--json` behavior aligned.
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

- Root `src/**` is still the published `githits` CLI implementation until the CLI package move completes. It owns Commander commands, local auth storage, browser login, init/setup flows, local stdio MCP startup, and plugin/assistant packaging assets.
- `packages/core-internal` is private source. It owns transport-neutral service clients, service interfaces, shared request/header/telemetry primitives, neutral service errors, PKCE helpers, and `TokenProvider`. Never publish or leak `@githits/core-internal` into public artifacts.
- `packages/mcp` is the public `@githits/mcp` package. Its public API is `packages/mcp/src/index.ts`: transport-neutral MCP server creation, tool registration, descriptors, instructions, request-scoped service provider types, and MCP service types.
- `@githits/mcp/internal` is a workspace-only alias for root CLI transition helpers. External packages and the future remote MCP server repo must never import it. If remote server work needs something internal, promote the smallest stable API through `@githits/mcp` instead.
- Public package artifacts for both root `githits` and `@githits/mcp` must not contain `@githits/core-internal`, `workspace:*`, `@githits/mcp/internal`, or private source aliases in JS, declarations, or manifests.

## Release Boundaries

- `githits` and `@githits/mcp` have separate release flows. They may be bumped together when both surfaces changed, but CLI-only changes should not bump `@githits/mcp`.
- Root `githits` release versions must stay aligned with plugin/assistant manifests: `.plugin/plugin.json`, `.claude-plugin/plugin.json`, `plugins/claude/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, and `gemini-extension.json`.
- `@githits/mcp` release versions live in `packages/mcp/package.json` and should change only for MCP package API, tool behavior, MCP instructions, schemas, MCP auth/error behavior, or remote-server-facing public type changes.
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
