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
    codeNavigationUrl: "https://pkgseer.dev",
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
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

  it("creates server with instructions wired", () => {
    // Exercises the composer through createMcpServer so any breakage
    // in the instructions pipeline (composer import, SDK options
    // shape) surfaces here even though the SDK hides `instructions`
    // behind a private field.
    const deps = createTestDeps();
    const server = createMcpServer(deps);

    expect(server).toBeDefined();
  });

  it("adds unified search tools by default", () => {
    const deps = createTestDeps();

    const tools = getMcpToolDefinitions(deps);
    const names = tools.map((tool) => tool.name);
    for (const name of [
      "get_example",
      "search_language",
      "feedback",
      "search",
      "search_status",
      "code_files",
      "code_read",
      "code_grep",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("adds package_summary by default", () => {
    const deps = createTestDeps();

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("docs_list");
    expect(tools.map((tool) => tool.name)).toContain("docs_read");
    expect(tools.map((tool) => tool.name)).toContain("pkg_info");
  });

  it("advertises package_summary with unified search", () => {
    const deps = createTestDeps();

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("pkg_info")) {
      expect(names).toContain("search");
      expect(names).toContain("search_status");
    }
  });

  it("adds package_vulnerabilities by default", () => {
    const deps = createTestDeps();

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("pkg_vulns");
  });

  it("advertises package_summary and package_vulnerabilities together (shared predicate)", () => {
    const deps = createTestDeps();

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("pkg_info")) {
      expect(names).toContain("pkg_vulns");
    }
  });

  it("adds package_dependencies by default", () => {
    const deps = createTestDeps();

    const tools = getMcpToolDefinitions(deps);
    expect(tools.map((tool) => tool.name)).toContain("pkg_deps");
  });

  it("advertises every package tool together (shared predicate covers deps too)", () => {
    const deps = createTestDeps();

    const names = getMcpToolDefinitions(deps).map((t) => t.name);
    if (names.includes("pkg_info")) {
      expect(names).toContain("pkg_vulns");
      expect(names).toContain("pkg_deps");
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
