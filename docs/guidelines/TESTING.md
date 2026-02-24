# Testing Guide

This document provides comprehensive testing patterns for githits-cli.

## Quick Reference

- **Test Runner**: Bun test (`bun test`)
- **Mocking**: Bun's built-in `mock()` function
- **Tool Testing**: See tool test files alongside implementations (e.g., `src/tools/search.test.ts`)

## Testing Philosophy

- **Test behavior, not implementation**: Focus on inputs and outputs
- **Use dependency injection**: Mock services at the interface level
- **Enable isolation**: Each test should be independent
- **Keep tests fast**: Mock external calls, avoid network

## Test Structure

### Basic Pattern

```typescript
import { describe, expect, it, mock } from "bun:test";
import { createMyTool } from "./my-tool.js";
import { createMockGitHitsService } from "./test-helpers.js";

describe("createMyTool", () => {
  it("returns tool with correct metadata", () => {
    const tool = createMyTool(createMockGitHitsService());
    expect(tool.name).toBe("my_tool");
    expect(tool.description).toContain("expected text");
  });

  it("calls service with correct arguments", async () => {
    const search = mock(() => Promise.resolve("# Result"));
    const mockService = createMockGitHitsService({ search });
    const tool = createMyTool(mockService);

    await tool.handler({ query: "express middleware" }, {});

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({ query: "express middleware" })
    );
  });
});
```

### Mock Service Pattern

Create a central mock factory in `test-helpers.ts`:

```typescript
import { mock } from "bun:test";
import type { GitHitsService } from "../services/githits-service.js";

export function createMockGitHitsService(
  impl: Partial<GitHitsService> = {}
): GitHitsService {
  return {
    search: mock(() => Promise.resolve("# Example\n```js\nconsole.log('hi')\n```")),
    getLanguages: mock(() => Promise.resolve([
      { id: "1", name: "javascript", display_name: "JavaScript", aliases: ["js"] },
    ])),
    submitFeedback: mock(() => Promise.resolve({ success: true, message: "ok" })),
    ...impl, // Override specific methods
  };
}
```

### Test Categories

#### 1. Metadata Tests

Verify tool configuration is correct:

```typescript
it("returns tool with correct metadata", () => {
  const tool = createSearchTool(createMockGitHitsService());
  expect(tool.name).toBe("search");
  expect(tool.description).toContain("code examples");
});
```

#### 2. Service Call Tests

Verify services are called with correct arguments:

```typescript
it("calls service with search params", async () => {
  const search = mock(() => Promise.resolve("# Result"));
  const mockService = createMockGitHitsService({ search });
  const tool = createSearchTool(mockService);

  await tool.handler({ query: "express middleware", language: "javascript" }, {});

  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ query: "express middleware", language: "javascript" })
  );
});
```

#### 3. Success Path Tests

Verify correct output when service returns data:

```typescript
it("returns search results as text", async () => {
  const mockService = createMockGitHitsService({
    search: mock(() => Promise.resolve("# Express middleware example\n```js\napp.use(...)\n```")),
  });

  const tool = createSearchTool(mockService);
  const result = await tool.handler({ query: "express middleware", language: "javascript" }, {});

  expect(result.isError).toBeUndefined();
  expect(result.content[0]?.text).toContain("Express middleware");
});
```

#### 4. Error Path Tests

Verify error handling:

```typescript
it("returns error when service throws", async () => {
  const mockService = createMockGitHitsService({
    search: mock(() => Promise.reject(new Error("Network error"))),
  });

  const tool = createSearchTool(mockService);
  const result = await tool.handler({ query: "test", language: "javascript" }, {});

  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("Network error");
});
```

## Best Practices

### 1. Use Mock Factory

Always use `createMockGitHitsService()` instead of manually creating mocks:

```typescript
// Good: Use factory
const mockService = createMockGitHitsService({ search: myMock });

// Bad: Manual mock object
const mockService = { search: myMock };
```

### 2. Test One Thing Per Test

```typescript
// Good: Single assertion focus
it("passes language parameter to service", async () => {
  const search = mock(() => Promise.resolve("result"));
  // ...
  expect(search).toHaveBeenCalledWith(
    expect.objectContaining({ language: "javascript" })
  );
});

// Bad: Multiple unrelated assertions
it("works correctly", async () => {
  // tests name, description, service call, and output format
});
```

### 3. Use Descriptive Test Names

```typescript
// Good: Describes behavior
it("calls service with language from user input", ...);
it("returns error when API token is missing", ...);

// Bad: Vague names
it("works", ...);
it("handles error", ...);
```

### 4. Handle Optional Results Safely

```typescript
// Good: Safe access with fallback
expect(result.content[0]?.text).toContain("expected");

// Bad: Assumes array has elements
expect(result.content[0].text).toContain("expected");
```

## Running Tests

```bash
# Run all tests
bun test

# Run specific test file
bun test src/tools/search.test.ts

# Run tests matching pattern
bun test --grep "search"

# Run with watch mode
bun test --watch
```

## Test File Organization

```
src/
  tools/
    search.ts              # Implementation
    search.test.ts         # Tests
    test-helpers.ts        # Shared mock factories
  commands/
    login.ts               # Implementation
    login.test.ts          # Tests
  services/
    githits-service.ts     # Implementation
    githits-service.test.ts # Tests
    test-helpers.ts        # Service mock factories
```

Keep test files next to implementations for easy navigation.

## Coverage Goals

- All public functions should have tests
- Error paths should be tested
- Edge cases should be covered
- Pure functions should have thorough unit tests
