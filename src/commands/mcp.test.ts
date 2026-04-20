import { describe, expect, it } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockCodeNavigationService,
  createMockFileSystemService,
  createMockGitHitsService,
} from "../services/test-helpers.js";
import {
  createMcpServer,
  getMcpToolDefinitions,
  startMcpServer,
} from "./mcp.js";

function createTestDeps(overrides: Partial<Dependencies> = {}): Dependencies {
  return {
    authStorage: createMockAuthStorage(),
    authService: createMockAuthService(),
    browserService: createMockBrowserService(),
    fileSystemService: createMockFileSystemService(),
    mcpUrl: "https://mcp.githits.com",
    apiUrl: "https://api.githits.com",
    apiToken: "test-token",
    hasValidToken: true,
    envApiToken: undefined,
    codeNavigationCapability: "disabled",
    codeNavigationCliOverrideEnabled: false,
    codeNavigationUrl: undefined,
    codeNavigationService: undefined,
    githitsService: createMockGitHitsService(),
    ...overrides,
  };
}

describe("createMcpServer", () => {
  it("creates server with default tools registered", () => {
    const deps = createTestDeps();
    const server = createMcpServer(deps);

    // McpServer should be created without error
    expect(server).toBeDefined();
  });

  it("adds search_symbols when capability is enabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://nav.example.com",
      codeNavigationService: createMockCodeNavigationService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toEqual([
      "search",
      "search_language",
      "feedback",
      "search_symbols",
    ]);
  });

  it("adds search_symbols for opaque env tokens", () => {
    const deps = createTestDeps({
      envApiToken: "ghi-opaque-token",
      codeNavigationCapability: "unknown",
      codeNavigationUrl: "https://nav.example.com",
      codeNavigationService: createMockCodeNavigationService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.some((tool) => tool.name === "search_symbols")).toBe(true);
  });
});

describe("startMcpServer", () => {
  it("starts successfully without a valid token", async () => {
    const deps = createTestDeps({ hasValidToken: false });

    // Server should start and connect transport without throwing.
    // Auth errors are deferred to individual tool calls.
    await expect(startMcpServer(deps)).resolves.toBeUndefined();
  });
});
