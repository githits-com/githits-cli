# Architectural Guidelines

> **Intent**: Provide a lightweight checklist for design docs and task planning so new work arrives with deterministic tests, predictable performance, and clean boundaries.

## Core Principles

- **Deterministic testability**: Every feature must be testable with isolated unit tests and mocked dependencies
- **Pure-first design**: Model business rules as pure functions. Push IO and external calls to thin edges
- **Documented separation**: Keep CLI commands, services, and tools isolated. Commands orchestrate, tools compute
- **Dependency injection**: Accept dependencies via function parameters or container, enabling easy mocking

## Deterministic Testability

### 1. Service Isolation

- Define service interfaces for external dependencies (REST API, HTTP, file system)
- Production implementations wrap real clients
- Test implementations return deterministic data
- Use factory functions: `createMyTool(service)` not `createMyTool()`

### 2. Pure Helpers

- Extract transformation logic into pure functions
- Pass data in, return results. No hidden state
- Require TypeScript types and JSDoc comments
- Mention why the helper exists for downstream maintainers

```typescript
// Good: Pure function
export function formatSearchResult(result: SearchResponse): string {
  return result.examples.map(e => `## ${e.title}\n${e.code}`).join("\n");
}

// Bad: Hidden dependency
export function getApiUrl() {
  return process.env.API_URL; // Implicit state
}
```

### 3. Deterministic Inputs

- Accept explicit dependencies via function parameters
- Provide mock implementations in test files
- Use `createMockGitHitsService()` pattern for test setup

### 4. MCP Tools

- Keep tool handlers thin - delegate to services
- Use shared utilities for common patterns (error handling, input validation)
- Return `ToolResult` type for consistent responses

## Pure Function Helpers & Layering

### Conversion Modules

Any place we convert API responses or user input should live in pure functions:

```typescript
// src/tools/shared.ts
export function withErrorHandling<T>(operation: string, fn: () => Promise<T>): Promise<T | ToolResult> { ... }
```

### Type Definitions

- Define explicit types for all data structures
- Use Zod schemas for runtime validation of external input
- Export types alongside implementations

### Service Layer

External services (REST API) must be wrapped in a service interface:

```typescript
export interface GitHitsService {
  search(params: SearchParams): Promise<string>;
  getLanguages(): Promise<Language[]>;
  submitFeedback(params: FeedbackParams): Promise<FeedbackResponse>;
}
```

## Designing for Test Harnesses

### Layering

```
CLI Command → Tool Handler → Service → REST Client
     ↓            ↓            ↓
  Parses       Business     External
  args         logic        calls
```

- Commands parse and validate input
- Tools contain business logic
- Services abstract external calls
- Tests can mock at any layer

### Test Helpers

- Create `test-helpers.ts` with mock factories
- Mock services return deterministic data
- Override specific methods as needed

```typescript
export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {}
): GitHitsService {
  return {
    search: mock(() => Promise.resolve("# Example\n```js\nconsole.log('hi')\n```")),
    getLanguages: mock(() => Promise.resolve([...])),
    submitFeedback: mock(() => Promise.resolve({ success: true, message: "ok" })),
    ...impl,
  };
}
```

## Clean Separation of Concerns

- **Services own data access**: `GitHitsService` exposes stable APIs
- **Tools own business logic**: Transform inputs, call services, format outputs
- **Commands own orchestration**: Parse args, create dependencies, invoke tools
- **Shared utilities**: Common patterns extracted to `shared.ts`

## Planning Checklist

When drafting a plan or proposal, explicitly answer:

### 1. Testability

- Which parts are pure functions?
- What mocks are needed for services?
- Can the feature be tested in isolation?

### 2. Dependency Injection

- What services are required?
- How are they passed into the code path?
- Is the container updated if needed?

### 3. Error Handling

- What errors can occur?
- How are they surfaced to users?
- Are error messages helpful?

### 4. Documentation

- What docs need updating?
- Are JSDoc comments added?
- Is the implementation doc updated?

Checking these boxes before implementation keeps future maintainers from revisiting architectural gaps.
