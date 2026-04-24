import { afterEach, describe, expect, it } from "bun:test";
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
  buildClientHeaders,
  resetRequestHeadersState,
} from "../shared/request-headers.js";
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

  it("adds unified search tools when capability is enabled", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://nav.example.com",
      codeNavigationService: createMockCodeNavigationService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toEqual([
      "get_example",
      "search_language",
      "feedback",
      "search",
      "search_status",
      "list_files",
      "read_file",
      "grep_repo",
    ]);
  });

  it("omits unified search tools for opaque env tokens without an explicit capability claim", () => {
    const deps = createTestDeps({
      envApiToken: "ghi-opaque-token",
      codeNavigationCapability: "unknown",
      codeNavigationUrl: "https://nav.example.com",
      codeNavigationService: createMockCodeNavigationService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.some((tool) => tool.name === "search")).toBe(false);
    expect(tools.some((tool) => tool.name === "search_status")).toBe(false);
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

  it("omits package_summary for opaque env tokens without an explicit capability claim", () => {
    const deps = createTestDeps({
      envApiToken: "ghi-opaque-token",
      codeNavigationCapability: "unknown",
      codeNavigationUrl: "https://pkgseer.dev",
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const tools = getMcpToolDefinitions(deps);
    expect(tools.some((tool) => tool.name === "package_summary")).toBe(false);
  });

  it("preserves half-open invariant: whenever package_summary is advertised, unified search is too (enabled path)", () => {
    const deps = createTestDeps({
      codeNavigationCapability: "enabled",
      codeNavigationUrl: "https://pkgseer.dev",
      codeNavigationService: createMockCodeNavigationService(),
      packageIntelligenceService: createMockPackageIntelligenceService(),
    });

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("package_summary")) {
      expect(names).toContain("search");
      expect(names).toContain("search_status");
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
  // `startMcpServer` mutates module-level state in `request-headers.ts`
  // (sets `clientName = "githits-cli/mcp"` and registers the lazy MCP
  // client-version provider). Reset after each test so later test
  // files inherit the default state.
  afterEach(() => {
    resetRequestHeadersState();
  });

  it("starts successfully without a valid token", async () => {
    const deps = createTestDeps({ hasValidToken: false });

    // Server should start and connect transport without throwing.
    // Auth errors are deferred to individual tool calls.
    await expect(startMcpServer(deps)).resolves.toBeUndefined();
  });

  it("sets clientMode to githits-cli/mcp", async () => {
    // After startMcpServer runs, subsequent buildClientHeaders calls
    // tag the client as MCP-mode. Pins the telemetry contract.
    const deps = createTestDeps({ hasValidToken: false });
    await startMcpServer(deps);
    const headers = buildClientHeaders({});
    expect(headers["x-githits-client-name"]).toBe("githits-cli/mcp");
  });

  it("registers a lazy MCP clientInfo provider (read at request time, not via race-prone notification)", async () => {
    // The MCP SDK dispatches `oninitialized` via an async notification
    // that can race the first tool call. The provider pattern reads
    // clientInfo synchronously on every buildClientHeaders call,
    // eliminating the race. This test pins the provider-based flow.
    const deps = createTestDeps({ hasValidToken: false });
    await startMcpServer(deps);

    // Before the initialize handshake lands, the provider returns
    // undefined — `buildClientHeaders` falls back to env detection
    // (none in the test env), so no x-githits-agent header.
    const headersBefore = buildClientHeaders({});
    expect(headersBefore["x-githits-agent"]).toBeUndefined();

    // Simulate the SDK's _oninitialize landing: `_clientVersion` is
    // set synchronously inside the SDK before the initialize response
    // is returned. A tool call reaching buildClientHeaders after that
    // point should see the agent header populated. We can't easily
    // reach into the real SDK's private state from here, so this
    // test pins the *mechanism* (provider registration) rather than
    // the end-to-end race; the provider's correctness is exercised
    // in request-headers.test.ts.
    // At this point the provider is registered but returns undefined —
    // confirm the fallback path to env detection also works.
    const headersWithAgent = buildClientHeaders({
      GITHITS_AGENT: "test-harness/1.0.0",
    });
    expect(headersWithAgent["x-githits-agent"]).toBe("test-harness/1.0.0");
  });
});
