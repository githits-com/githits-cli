import { describe, expect, it, mock } from "bun:test";
import { AuthenticationError } from "@githits/core-internal";
import {
  createMcpServer,
  getMcpToolDescriptors,
  type McpToolExecutionHook,
  type McpToolServices,
  registerMcpTools,
} from "@githits/mcp";
import { getMcpToolDefinitions, type ToolResult } from "@githits/mcp/internal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";
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

interface TestRegisteredTool {
  handler: (
    args: unknown,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<ToolResult>;
}

function registeredTool(server: McpServer, name: string): TestRegisteredTool {
  return (
    server as unknown as {
      _registeredTools: Record<string, TestRegisteredTool>;
    }
  )._registeredTools[name]!;
}

describe("createMcpServer", () => {
  it("constructs tools from service-only dependencies", () => {
    const services = createTestServices();

    const tools = getMcpToolDefinitions(services);

    expect(tools.map((tool) => tool.name)).toEqual([...EXPECTED_TOOL_NAMES]);
  });

  it("creates server with default tools registered", () => {
    const services = createTestServices();
    const server = createMcpServer({
      services,
      metadata: TEST_MCP_SERVER_METADATA,
    });

    // McpServer should be created without error
    expect(server).toBeDefined();
  });

  it("creates server with instructions wired", () => {
    // Exercises the composer through createMcpServer so any breakage
    // in the instructions pipeline (composer import, SDK options
    // shape) surfaces here even though the SDK hides `instructions`
    // behind a private field.
    const services = createTestServices();
    const server = createMcpServer({
      services,
      metadata: TEST_MCP_SERVER_METADATA,
    });

    expect(server).toBeDefined();
  });

  it("exposes descriptors without concrete services", () => {
    expect(getMcpToolDescriptors().map((tool) => tool.name)).toEqual([
      ...EXPECTED_TOOL_NAMES,
    ]);
  });

  it("resolves function providers per tool call and passes extra", async () => {
    const server = new McpServer(TEST_MCP_SERVER_METADATA);
    const search = mock(() => Promise.resolve("provider result"));
    const provider = mock(() =>
      createTestServices({
        githitsService: createMockGitHitsService({ search }),
      }),
    );
    registerMcpTools(server, { services: provider });

    const extra = { requestId: 1 } as unknown as RequestHandlerExtra<
      ServerRequest,
      ServerNotification
    >;
    const result = await registeredTool(server, "get_example").handler(
      { query: "hello" },
      extra,
    );

    expect(result.content[0]?.text).toBe("provider result");
    expect(provider).toHaveBeenCalledWith({ extra });
  });

  it("runs a configured tool execution hook once around a simple public tool handler", async () => {
    const server = new McpServer(TEST_MCP_SERVER_METADATA);
    const events: string[] = [];
    const search = mock(() => Promise.resolve("hooked result"));
    const traceTool: McpToolExecutionHook = mock(
      async (toolName, runHandler) => {
        events.push(`start:${toolName}`);
        const result = await runHandler();
        events.push(`end:${toolName}`);
        return result;
      },
    );

    registerMcpTools(server, {
      services: createTestServices({
        githitsService: createMockGitHitsService({ search }),
      }),
      traceTool,
    });

    const result = await registeredTool(server, "get_example").handler(
      { query: "hello" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.content[0]?.text).toBe("hooked result");
    expect(traceTool).toHaveBeenCalledTimes(1);
    expect(traceTool).toHaveBeenCalledWith("get_example", expect.any(Function));
    expect(events).toEqual(["start:get_example", "end:get_example"]);
  });

  it("runs one tool execution hook around pkg_upgrade_review despite composed downstream probes", async () => {
    const services = createTestServices();
    const traceTool: McpToolExecutionHook = mock(
      async (toolName, runHandler) => {
        expect(toolName).toBe("pkg_upgrade_review");
        return runHandler();
      },
    );
    const server = createMcpServer({
      services,
      metadata: TEST_MCP_SERVER_METADATA,
      traceTool,
    });

    const result = await registeredTool(server, "pkg_upgrade_review").handler(
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.1",
        target_version: "4.18.2",
        format: "json",
      },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.isError).toBeUndefined();
    expect(traceTool).toHaveBeenCalledTimes(1);
    expect(
      services.packageIntelligenceService.packageSummary,
    ).toHaveBeenCalledTimes(1);
    expect(
      services.packageIntelligenceService.packageVulnerabilities,
    ).toHaveBeenCalledTimes(2);
    expect(
      services.packageIntelligenceService.packageUpgradeDependencyProbe,
    ).toHaveBeenCalledTimes(2);
  });

  it("function providers receive undefined extra deterministically", async () => {
    const server = new McpServer(TEST_MCP_SERVER_METADATA);
    const provider = mock(() => createTestServices());
    registerMcpTools(server, { services: provider });

    await registeredTool(server, "search_language").handler(
      { query: "python", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(provider).toHaveBeenCalledWith({ extra: undefined });
  });

  it("returns structured errors when function providers throw", async () => {
    const server = new McpServer(TEST_MCP_SERVER_METADATA);
    registerMcpTools(server, {
      services: () => {
        throw new Error("provider failed");
      },
    });

    const result = await registeredTool(server, "search_language").handler(
      { query: "python", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Failed to resolve MCP services: provider failed",
      code: "UNKNOWN",
      retryable: false,
    });
  });

  it("returns auth envelopes when function providers reject auth", async () => {
    const server = new McpServer(TEST_MCP_SERVER_METADATA);
    registerMcpTools(server, {
      services: () => Promise.reject(new AuthenticationError()),
    });

    const result = await registeredTool(server, "search_language").handler(
      { query: "python", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        action:
          "Run `githits login`, or set GITHITS_API_TOKEN, then retry this tool call.",
        authSource: "local",
      },
    });
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
