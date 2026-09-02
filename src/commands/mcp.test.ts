import { describe, expect, it, mock } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type AgenticAskService,
  AuthenticationError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import {
  createMcpServer,
  getMcpToolDescriptors,
  type McpToolExecutionHook,
  registerMcpTools,
} from "@githits/mcp";
import {
  getMcpToolDefinitions,
  type LocalMcpToolServices,
  type ToolResult,
} from "@githits/mcp/internal";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { Command } from "commander";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
  createMockResolveTargetService,
} from "../services/test-helpers.js";
import {
  flushTelemetry,
  resetTelemetryCollectorForTests,
} from "../shared/telemetry.js";
import {
  type CreateMcpCommandStartupOptions,
  createMcpCommandStartup,
  type McpCommandRegistrationDependencies,
  registerMcpCommand,
  startMcpServer,
} from "./mcp.js";

async function withConfigHome<T>(
  configHome: string,
  fn: () => Promise<T>,
): Promise<T> {
  const configHomeEnvKey =
    process.platform === "win32" ? "APPDATA" : "XDG_CONFIG_HOME";
  const alternateConfigHomeEnvKey =
    configHomeEnvKey === "APPDATA" ? "XDG_CONFIG_HOME" : "APPDATA";
  const previous = process.env[configHomeEnvKey];
  const previousAlternate = process.env[alternateConfigHomeEnvKey];
  process.env[configHomeEnvKey] = configHome;
  delete process.env[alternateConfigHomeEnvKey];
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[configHomeEnvKey];
    else process.env[configHomeEnvKey] = previous;
    if (previousAlternate === undefined)
      delete process.env[alternateConfigHomeEnvKey];
    else process.env[alternateConfigHomeEnvKey] = previousAlternate;
  }
}

function createTestServices(
  overrides: Partial<LocalMcpToolServices> = {},
): LocalMcpToolServices {
  return {
    agenticAskService: {
      ask: mock(() =>
        Promise.reject(new Error("unused")),
      ) as unknown as AgenticAskService["ask"],
    },
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    githitsService: createMockGitHitsService(),
    resolveTargetService: createMockResolveTargetService(),
    ...overrides,
  };
}

const EXPECTED_TOOL_NAMES = [
  "quick_start",
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

  it("omits default server instructions", () => {
    const services = createTestServices();
    const server = createMcpServer({
      services,
      metadata: TEST_MCP_SERVER_METADATA,
    });

    expect(
      (server.server as unknown as { _instructions?: string })._instructions,
    ).toBeUndefined();
  });

  it("preserves explicit caller-owned server instructions", () => {
    const server = createMcpServer({
      services: createTestServices(),
      metadata: TEST_MCP_SERVER_METADATA,
      instructions: "caller guidance",
    });

    expect(
      (server.server as unknown as { _instructions?: string })._instructions,
    ).toBe("caller guidance");
  });

  it("configures quick_start without publishing server instructions", async () => {
    const server = createMcpServer({
      services: createTestServices(),
      metadata: TEST_MCP_SERVER_METADATA,
      quickStartOptions: { includeExternalContentPosture: false },
    });

    const result = await registeredTool(server, "quick_start").handler(
      {},
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(result.content[0]?.text).not.toContain("External-content posture");
    expect(
      (server.server as unknown as { _instructions?: string })._instructions,
    ).toBeUndefined();
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

  it("runs one tool execution hook around pkg_upgrade_review aggregate call", async () => {
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
      services.packageIntelligenceService.packageUpgradeReview,
    ).toHaveBeenCalledTimes(1);
    expect(
      services.packageIntelligenceService.packageSummary,
    ).not.toHaveBeenCalled();
    expect(
      services.packageIntelligenceService.packageVulnerabilities,
    ).not.toHaveBeenCalled();
    expect(
      services.packageIntelligenceService.packageUpgradeDependencyProbe,
    ).not.toHaveBeenCalled();
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

  it("supplies the byte-compatible local terms remediation", async () => {
    const search = mock(() =>
      Promise.reject(new TermsAcceptanceRequiredError()),
    );
    let server: McpServer | undefined;
    await startMcpServer(
      createTestServices({
        githitsService: createMockGitHitsService({ search }),
      }),
      { onServerCreated: (created) => (server = created) },
    );

    const result = await registeredTool(server!, "get_example").handler(
      { query: "python" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error:
        "Terms acceptance required. Run `githits settings terms accept`, then retry.",
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        action: "githits settings terms accept",
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl: "https://app.githits.com/settings/privacy",
      },
    });
  });
});

describe("createMcpCommandStartup", () => {
  it("maps strict host settings into the neutral local policy", async () => {
    const xdgConfigHome = await mkdtemp(join(tmpdir(), "githits-mcp-policy-"));
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.toml"),
      '[experimental]\ntools = true\nreport_tool_issues = "all"\n',
    );
    const previousToken = process.env.GITHITS_API_TOKEN;

    try {
      process.env.GITHITS_API_TOKEN = "test-mcp-startup-token";
      await withConfigHome(xdgConfigHome, async () => {
        const startup = await createMcpCommandStartup();
        expect(startup.experimentalPolicy).toEqual({
          tools: true,
          reportToolIssues: "all",
        });
        expect(startup.services.resolveTargetService).toBeDefined();
        expect(startup.services.codeNavigationService.codeDiff).toBeDefined();
        expect(startup.services.agenticAskService).toBeDefined();
      });
    } finally {
      if (previousToken === undefined) delete process.env.GITHITS_API_TOKEN;
      else process.env.GITHITS_API_TOKEN = previousToken;
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("consumes malformed config strictly only when local startup is created", async () => {
    const xdgConfigHome = await mkdtemp(join(tmpdir(), "githits-mcp-start-"));
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.toml"), "[experimental\n");

    try {
      await withConfigHome(xdgConfigHome, async () => {
        await expect(createMcpCommandStartup()).rejects.toThrow(
          `Cannot parse GitHits config at ${join(configDir, "config.toml")}`,
        );
      });
    } finally {
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("keeps malformed shared TOML as an auth startup error under the override", async () => {
    const xdgConfigHome = await mkdtemp(
      join(tmpdir(), "githits-mcp-override-"),
    );
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    const originalConfig = "[experimental\n";
    await writeFile(configPath, originalConfig);
    const previousToken = process.env.GITHITS_API_TOKEN;
    const previousStorage = process.env.GITHITS_AUTH_STORAGE;

    try {
      delete process.env.GITHITS_API_TOKEN;
      delete process.env.GITHITS_AUTH_STORAGE;
      await withConfigHome(xdgConfigHome, async () => {
        await expect(
          createMcpCommandStartup({ experimentalTools: true }),
        ).rejects.toThrow(`Cannot parse GitHits config at ${configPath}`);
        expect(await Bun.file(configPath).text()).toBe(originalConfig);
      });
    } finally {
      if (previousToken === undefined) delete process.env.GITHITS_API_TOKEN;
      else process.env.GITHITS_API_TOKEN = previousToken;
      if (previousStorage === undefined)
        delete process.env.GITHITS_AUTH_STORAGE;
      else process.env.GITHITS_AUTH_STORAGE = previousStorage;
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("bypasses only experimental validation while preserving file auth mode", async () => {
    const xdgConfigHome = await mkdtemp(
      join(tmpdir(), "githits-mcp-override-auth-"),
    );
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    const configPath = join(configDir, "config.toml");
    await writeFile(
      configPath,
      '[experimental]\ntools = "invalid"\n[auth]\nstorage = "file"\n',
    );
    const previousToken = process.env.GITHITS_API_TOKEN;
    const previousStorage = process.env.GITHITS_AUTH_STORAGE;

    try {
      delete process.env.GITHITS_API_TOKEN;
      delete process.env.GITHITS_AUTH_STORAGE;
      const telemetry: string[] = [];
      resetTelemetryCollectorForTests({
        env: { GITHITS_TELEMETRY: "1" },
        now: () => 0,
        write: (text) => telemetry.push(text),
      });
      await withConfigHome(xdgConfigHome, async () => {
        await expect(createMcpCommandStartup()).rejects.toThrow(
          `Invalid GitHits config at ${configPath}`,
        );
        const startup = await createMcpCommandStartup({
          experimentalTools: true,
        });
        expect(startup.experimentalPolicy).toEqual({
          tools: true,
          reportToolIssues: undefined,
        });
        expect(process.env.GITHITS_AUTH_STORAGE).toBeUndefined();
      });
      flushTelemetry(0);
      expect(telemetry.join(" ")).toContain("mode=file");

      process.env.GITHITS_AUTH_STORAGE = "invalid";
      await withConfigHome(xdgConfigHome, async () => {
        await expect(
          createMcpCommandStartup({ experimentalTools: true }),
        ).rejects.toThrow("Invalid GITHITS_AUTH_STORAGE");
      });
      expect(process.env.GITHITS_AUTH_STORAGE).toBe("invalid");
    } finally {
      if (previousToken === undefined) delete process.env.GITHITS_API_TOKEN;
      else process.env.GITHITS_API_TOKEN = previousToken;
      if (previousStorage === undefined)
        delete process.env.GITHITS_AUTH_STORAGE;
      else process.env.GITHITS_AUTH_STORAGE = previousStorage;
      resetTelemetryCollectorForTests({ env: {} });
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("does not inherit a disabled host policy or its reporting mode", async () => {
    const xdgConfigHome = await mkdtemp(
      join(tmpdir(), "githits-mcp-override-policy-"),
    );
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    await writeFile(
      join(configDir, "config.toml"),
      '[experimental]\ntools = false\nreport_tool_issues = "all"\n',
    );
    const previousToken = process.env.GITHITS_API_TOKEN;
    const previousStorage = process.env.GITHITS_AUTH_STORAGE;

    try {
      delete process.env.GITHITS_API_TOKEN;
      delete process.env.GITHITS_AUTH_STORAGE;
      await withConfigHome(xdgConfigHome, async () => {
        const startup = await createMcpCommandStartup({
          experimentalTools: true,
        });
        expect(startup.experimentalPolicy).toEqual({
          tools: true,
          reportToolIssues: undefined,
        });
      });
    } finally {
      if (previousToken === undefined) delete process.env.GITHITS_API_TOKEN;
      else process.env.GITHITS_API_TOKEN = previousToken;
      if (previousStorage === undefined)
        delete process.env.GITHITS_AUTH_STORAGE;
      else process.env.GITHITS_AUTH_STORAGE = previousStorage;
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });

  it("maps the hidden experimental override through mcp start", async () => {
    const startupOptions: Array<CreateMcpCommandStartupOptions | undefined> =
      [];
    const dependencies: McpCommandRegistrationDependencies = {
      createStartup: async (options) => {
        startupOptions.push(options);
        return {
          services: createTestServices(),
          experimentalPolicy: {
            tools: options?.experimentalTools === true,
            reportToolIssues: undefined,
          },
          onServerCreated: () => {},
        };
      },
      startServer: async () => {},
    };

    const explicit = new Command();
    let explicitHelp = "";
    explicit.configureOutput({
      writeOut: (value) => {
        explicitHelp += value;
      },
      writeErr: (value) => {
        explicitHelp += value;
      },
    });
    explicit.exitOverride();
    registerMcpCommand(explicit, dependencies);
    await explicit.parseAsync([
      "node",
      "test",
      "mcp",
      "start",
      "--experimental-tools",
    ]);
    expect(startupOptions).toEqual([{ experimentalTools: true }]);
    expect(explicitHelp).not.toContain("experimental-tools");

    const normal = new Command();
    let normalHelp = "";
    normal.configureOutput({
      writeOut: (value) => {
        normalHelp += value;
      },
      writeErr: (value) => {
        normalHelp += value;
      },
    });
    normal.exitOverride();
    registerMcpCommand(normal, dependencies);
    await normal.parseAsync(["node", "test", "mcp", "start"]);
    expect(startupOptions).toEqual([{ experimentalTools: true }, undefined]);
    expect(normalHelp).not.toContain("experimental-tools");
  });

  it("does not advertise the session override in mcp or root help", async () => {
    for (const args of [
      ["mcp", "--help"],
      ["mcp", "start", "--help"],
      ["--help"],
    ]) {
      const program = new Command();
      let output = "";
      program.configureOutput({
        writeOut: (value) => {
          output += value;
        },
        writeErr: (value) => {
          output += value;
        },
      });
      program.exitOverride();
      registerMcpCommand(program);
      await expect(
        program.parseAsync(["node", "test", ...args]),
      ).rejects.toMatchObject({ code: "commander.helpDisplayed" });
      expect(output).not.toContain("experimental-tools");
      expect(output).not.toContain("instruction-mode");
    }
  });

  it("keeps mcp help from creating local startup dependencies", async () => {
    const xdgConfigHome = await mkdtemp(join(tmpdir(), "githits-mcp-help-"));
    const configDir = join(xdgConfigHome, "githits");
    await mkdir(configDir, { recursive: true });
    await writeFile(join(configDir, "config.toml"), "[experimental\n");

    try {
      await withConfigHome(xdgConfigHome, async () => {
        const program = new Command();
        program.configureOutput({
          writeOut: () => {},
          writeErr: () => {},
        });
        program.exitOverride();
        registerMcpCommand(program);

        await expect(
          program.parseAsync(["node", "test", "mcp", "--help"]),
        ).rejects.toMatchObject({ code: "commander.helpDisplayed" });
      });
    } finally {
      await rm(xdgConfigHome, { recursive: true, force: true });
    }
  });
});
