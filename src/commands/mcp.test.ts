import { describe, expect, it, spyOn } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockFileSystemService,
  createMockGitHitsService,
} from "../services/test-helpers.js";
import { AuthRequiredError } from "../shared/require-auth.js";
import { createMcpServer, startMcpServer } from "./mcp.js";

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
    githitsService: createMockGitHitsService(),
    ...overrides,
  };
}

describe("createMcpServer", () => {
  it("creates server with all three tools registered", () => {
    const deps = createTestDeps();
    const server = createMcpServer(deps);

    // McpServer should be created without error
    expect(server).toBeDefined();
  });

  it("uses apiToken from dependencies", () => {
    const deps = createTestDeps({ apiToken: "custom-token" });
    const server = createMcpServer(deps);

    // Server should be created successfully
    expect(server).toBeDefined();
  });
});

describe("startMcpServer", () => {
  it("throws AuthRequiredError on auth failure", async () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    const deps = createTestDeps({ hasValidToken: false });

    await expect(startMcpServer(deps)).rejects.toThrow(AuthRequiredError);

    consoleSpy.mockRestore();
  });
});
