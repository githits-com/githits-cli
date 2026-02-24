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

See `docs/guidelines/ARCHITECTURAL_GUIDELINES.md` for detailed planning checklist and design principles.

## Testing

Philosophy: "If it is not tested, it is likely broken"

**Critical Rules:**

- Use `bun test` for running tests
- Keep tests async and isolated
- Mock services at the interface level using factory functions
- Use mock factories from `test-helpers.ts` (e.g., `createMockGitHitsService()`, `createMockAuthService()`)
- Test behavior, not implementation - focus on inputs and outputs
- Test only one layer at a time - mock dependencies

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
  cli.ts              # CLI entry point
  container.ts        # Dependency injection
  auth/               # OAuth PKCE utilities
  commands/           # CLI commands
  services/           # Service interfaces and implementations
  tools/              # MCP tool implementations
docs/
  guidelines/         # Development guidelines
  implementation/     # Implementation documentation
```
