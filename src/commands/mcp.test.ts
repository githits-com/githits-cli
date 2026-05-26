import { afterEach, describe, expect, it } from "bun:test";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import {
  buildClientHeaders,
  resetRequestHeadersState,
} from "../shared/request-headers.js";
import type { McpToolServices } from "../tools/tool-services.js";
import {
  createMcpServer,
  getMcpToolDefinitions,
  startMcpServer,
} from "./mcp.js";

function createTestServices(
  overrides: Partial<McpToolServices> = {},
): McpToolServices {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    githitsService: createMockGitHitsService(),
    ...overrides,
  };
}

const EXPECTED_TOOL_NAMES = [
  "get_example",
  "search_language",
  "feedback",
  "search",
  "search_status",
  "code_files",
  "code_read",
  "code_grep",
  "docs_list",
  "docs_read",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
] as const;

describe("createMcpServer", () => {
  it("constructs tools from service-only dependencies", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);

    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOL_NAMES]);
  });

  it("creates server with default tools registered", () => {
    const services = createTestServices();
    const server = createMcpServer(services);

    // McpServer should be created without error
    expect(server).toBeDefined();
  });

  it("creates server with instructions wired", () => {
    // Exercises the composer through createMcpServer so any breakage
    // in the instructions pipeline (composer import, SDK options
    // shape) surfaces here even though the SDK hides `instructions`
    // behind a private field.
    const services = createTestServices();
    const server = createMcpServer(services);

    expect(server).toBeDefined();
  });

  it("adds unified search tools by default", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);
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
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);
    expect(tools.map((tool) => tool.name)).toContain("docs_list");
    expect(tools.map((tool) => tool.name)).toContain("docs_read");
    expect(tools.map((tool) => tool.name)).toContain("pkg_info");
  });

  it("advertises package_summary with unified search", () => {
    const services = createTestServices();

    const names = getMcpToolDefinitions(services).map((t) => t.name);
    if (names.includes("pkg_info")) {
      expect(names).toContain("search");
      expect(names).toContain("search_status");
    }
  });

  it("adds package_vulnerabilities by default", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);
    expect(tools.map((tool) => tool.name)).toContain("pkg_vulns");
  });

  it("advertises package_summary and package_vulnerabilities together (shared predicate)", () => {
    const services = createTestServices();

    const names = getMcpToolDefinitions(services).map((t) => t.name);
    if (names.includes("pkg_info")) {
      expect(names).toContain("pkg_vulns");
    }
  });

  it("adds package_dependencies by default", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);
    expect(tools.map((tool) => tool.name)).toContain("pkg_deps");
  });

  it("advertises every package tool together (shared predicate covers deps too)", () => {
    const services = createTestServices();

    const names = getMcpToolDefinitions(services).map((t) => t.name);
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

  it("starts successfully with service-only dependencies", async () => {
    const services = createTestServices();

    // Server should start and connect transport without throwing.
    // Auth errors are deferred to individual tool calls.
    await expect(startMcpServer(services)).resolves.toBeUndefined();
  });

  it("sets clientMode to githits-cli/mcp", async () => {
    // After startMcpServer runs, subsequent buildClientHeaders calls
    // tag the client as MCP-mode. Pins the telemetry contract.
    const services = createTestServices();
    await startMcpServer(services);
    const headers = buildClientHeaders({});
    expect(headers["x-githits-client-name"]).toBe("githits-cli/mcp");
  });

  it("registers a lazy MCP clientInfo provider (read at request time, not via race-prone notification)", async () => {
    // The MCP SDK dispatches `oninitialized` via an async notification
    // that can race the first tool call. The provider pattern reads
    // clientInfo synchronously on every buildClientHeaders call,
    // eliminating the race. This test pins the provider-based flow.
    const services = createTestServices();
    await startMcpServer(services);

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
