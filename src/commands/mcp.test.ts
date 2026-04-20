import { describe, expect, it } from "bun:test";
import type { Dependencies } from "../container.js";
import {
  createMockAuthService,
  createMockAuthStorage,
  createMockBrowserService,
  createMockCodeNavigationService,
  createMockFileSystemService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
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
    packageIntelligenceService: undefined,
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

  it("creates server with instructions wired in the gate-open state", () => {
    // Exercises the composer through createMcpServer so any breakage
    // in the instructions pipeline (composer import, SDK options
    // shape) surfaces here even though the SDK hides `instructions`
    // behind a private field.
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });
    const server = createMcpServer(deps);

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

  it("adds package_summary when capability is enabled and service wired", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("package_summary");
  });

  it("omits package_summary when capability is disabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "disabled",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).not.toContain("package_summary");
  });

  it("omits package_summary when service is missing even if capability enabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: undefined,
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).not.toContain("package_summary");
  });

  it("adds package_summary for opaque env tokens (capability unknown + env token)", () => {
    const deps = createTestDeps({
      envApiToken: "ghi-opaque-token",
      codeNavigationCapability: "unknown",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.some((tool) => tool.name === "package_summary")).toBe(true);
  });

  it("preserves half-open invariant: whenever package_summary is advertised, search_symbols is too (enabled path)", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("package_summary")) {
      expect(names).toContain("search_symbols");
    }
  });

  it("adds package_vulnerabilities when capability is enabled and service wired", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("package_vulnerabilities");
  });

  it("omits package_vulnerabilities when capability is disabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "disabled",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).not.toContain(
      "package_vulnerabilities",
    );
  });

  it("advertises package_summary and package_vulnerabilities together (shared predicate)", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("package_summary")) {
      expect(names).toContain("package_vulnerabilities");
    }
  });

  it("adds package_dependencies when capability is enabled and service wired", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("package_dependencies");
  });

  it("omits package_dependencies when capability is disabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "disabled",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).not.toContain(
      "package_dependencies",
    );
  });

  it("advertises every package tool together (shared predicate covers deps too)", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("package_summary")) {
      expect(names).toContain("package_vulnerabilities");
      expect(names).toContain("package_dependencies");
    }
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
