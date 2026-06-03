import { describe, expect, it, mock } from "bun:test";
import { createMcpServer, getMcpToolDefinitions } from "../mcp/server.js";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
import type { McpToolServices } from "../tools/tool-services.js";
import { startMcpServer } from "./mcp.js";

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

const TEST_MCP_SERVER_METADATA = { name: "githits-test", version: "0.0.0" };

describe("createMcpServer", () => {
  it("constructs tools from service-only dependencies", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);

    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOL_NAMES]);
  });

  it("creates server with default tools registered", () => {
    const services = createTestServices();
    const server = createMcpServer(services, TEST_MCP_SERVER_METADATA);

    // McpServer should be created without error
    expect(server).toBeDefined();
  });

  it("creates server with instructions wired", () => {
    // Exercises the composer through createMcpServer so any breakage
    // in the instructions pipeline (composer import, SDK options
    // shape) surfaces here even though the SDK hides `instructions`
    // behind a private field.
    const services = createTestServices();
    const server = createMcpServer(services, TEST_MCP_SERVER_METADATA);

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
  it("starts successfully with service-only dependencies", async () => {
    const services = createTestServices();

    // Server should start and connect transport without throwing.
    // Auth errors are deferred to individual tool calls.
    await expect(startMcpServer(services)).resolves.toBeUndefined();
  });

  it("exposes the created server to callers for clientInfo telemetry wiring", async () => {
    const services = createTestServices();
    const onServerCreated = mock((_server: unknown) => undefined);

    await startMcpServer(services, { onServerCreated });

    expect(onServerCreated).toHaveBeenCalledTimes(1);
    expect(onServerCreated.mock.calls[0]?.[0]).toBeDefined();
  });
});
