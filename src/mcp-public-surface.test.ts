import { describe, expect, it, mock } from "bun:test";
import {
  AuthenticationError,
  CodeNavigationFileNotFoundError,
  TermsAcceptanceRequiredError,
} from "@githits/core-internal";
import * as publicMcp from "@githits/mcp";
import {
  buildMcpQuickStart,
  createMcpServer,
  getMcpToolDescriptors,
  type McpToolExecutionHook,
  type McpToolServices,
  type McpToolServicesProvider,
  registerMcpTools,
} from "@githits/mcp";
import { getMcpToolDefinitions } from "@githits/mcp/internal";
import { EXPECTED_MCP_TOOLS } from "@githits/mcp/smoke-test";
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
} from "./services/test-helpers.js";

interface RegisteredTool {
  handler: (
    args: unknown,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<{ content: Array<{ text?: string }>; isError?: boolean }>;
}

interface RemoteExtra {
  sessionId: string;
}

function createServices(
  overrides: Partial<McpToolServices> = {},
): McpToolServices {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    githitsService: createMockGitHitsService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    ...overrides,
  };
}

function registeredTool(server: McpServer, name: string): RegisteredTool {
  return (
    server as unknown as {
      _registeredTools: Record<string, RegisteredTool>;
    }
  )._registeredTools[name]!;
}

const EXPECTED_DESCRIPTOR_NAMES = [
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

const EXPECTED_SMOKE_NAMES = [
  "quick_start",
  "get_example",
  "search_language",
  "pkg_info",
  "pkg_deps",
  "pkg_vulns",
  "pkg_changelog",
  "pkg_upgrade_review",
  "docs_list",
  "docs_read",
  "code_files",
  "code_read",
  "code_grep",
  "search",
  "search_status",
  "feedback",
] as const;

describe("public MCP package surface", () => {
  it("keeps the public and smoke inventories stable and non-experimental", () => {
    const names = getMcpToolDescriptors().map((tool) => tool.name);
    const definitions = getMcpToolDefinitions(createServices()).map(
      (tool) => tool.name,
    );
    const server = createMcpServer({
      metadata: { name: "public-githits", version: "0.0.0" },
      services: createServices(),
    });
    const registeredNames = Object.keys(
      (
        server as unknown as {
          _registeredTools: Record<string, unknown>;
        }
      )._registeredTools,
    );

    expect(names).toEqual([...EXPECTED_DESCRIPTOR_NAMES]);
    expect(definitions).toEqual([...EXPECTED_DESCRIPTOR_NAMES]);
    expect(registeredNames).toEqual([...EXPECTED_DESCRIPTOR_NAMES]);
    expect(EXPECTED_MCP_TOOLS).toEqual([...EXPECTED_SMOKE_NAMES]);
    for (const inventory of [
      names,
      definitions,
      registeredNames,
      [...EXPECTED_MCP_TOOLS],
    ]) {
      expect(inventory).not.toContain("resolve_target");
      expect(inventory).not.toContain("code_diff");
    }
    expect("createLocalMcpServer" in publicMcp).toBe(false);
  });

  it("contains the APIs needed by a remote MCP server without internal imports", () => {
    const provider: McpToolServicesProvider<RemoteExtra> = () =>
      createServices();

    expect(buildMcpQuickStart()).toContain("GitHits provides");
    expect(getMcpToolDescriptors().map((tool) => tool.name)).toContain(
      "search",
    );
    expect(
      createMcpServer<RemoteExtra>({
        metadata: { name: "remote-githits", version: "0.0.0" },
        services: provider,
      }),
    ).toBeDefined();
  });

  it("supports request-scoped services and remote-specific auth guidance", async () => {
    const server = new McpServer({ name: "remote-githits", version: "0.0.0" });
    const search = mock(() =>
      Promise.reject(
        new AuthenticationError("Authentication required.", "server"),
      ),
    );
    const seenSessionIds: Array<string | undefined> = [];
    const provider = mock((context: { extra: RemoteExtra | undefined }) => {
      seenSessionIds.push(context.extra?.sessionId);
      return createServices({
        githitsService: createMockGitHitsService({ search }),
      });
    });

    registerMcpTools<RemoteExtra>(server, {
      authAction: ({ authSource }) =>
        `Open the hosted GitHits authorization flow for auth source ${String(authSource)}.`,
      services: provider,
    });

    const extra = { sessionId: "session-1" } as unknown as RequestHandlerExtra<
      ServerRequest,
      ServerNotification
    >;
    const result = await registeredTool(server, "get_example").handler(
      { query: "express hello world" },
      extra,
    );

    expect(provider).toHaveBeenCalledWith({ extra });
    expect(seenSessionIds).toEqual(["session-1"]);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: {
        action:
          "Open the hosted GitHits authorization flow for auth source server.",
        authSource: "server",
      },
    });
  });

  it("applies remote auth guidance to mapped code-navigation errors", async () => {
    const server = new McpServer({ name: "remote-githits", version: "0.0.0" });
    const search = mock(() =>
      Promise.reject(
        new AuthenticationError("Authentication required.", "server"),
      ),
    );

    registerMcpTools(server, {
      authAction: "Authenticate in the hosted GitHits MCP server, then retry.",
      services: createServices({
        codeNavigationService: createMockCodeNavigationService({ search }),
      }),
    });

    const result = await registeredTool(server, "search").handler(
      {
        query: "router",
        target: { registry: "npm", package_name: "express" },
        format: "json",
      },
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
        action: "Authenticate in the hosted GitHits MCP server, then retry.",
        authSource: "server",
      },
    });
  });

  it("uses URL-based terms remediation for hosted callers", async () => {
    const acceptanceUrl = "https://acceptance.example.test/settings/privacy";
    const server = createMcpServer({
      metadata: { name: "remote-githits", version: "0.0.0" },
      services: createServices({
        githitsService: createMockGitHitsService({
          search: mock(() =>
            Promise.reject(new TermsAcceptanceRequiredError({ acceptanceUrl })),
          ),
        }),
      }),
    });

    const result = await registeredTool(server, "get_example").handler(
      { query: "express hello world" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({
      error: `Terms acceptance required. Review and accept the current terms at ${acceptanceUrl}, then retry.`,
      code: "TERMS_ACCEPTANCE_REQUIRED",
      retryable: false,
      details: {
        termsUrl: "https://githits.com/legal/terms-of-service/",
        acceptanceUrl,
        action: acceptanceUrl,
      },
    });
  });

  it("keeps custom auth actions isolated across concurrent servers", async () => {
    const makeServer = (action: string) => {
      const server = new McpServer({
        name: "remote-githits",
        version: "0.0.0",
      });
      registerMcpTools(server, {
        authAction: action,
        services: createServices({
          githitsService: createMockGitHitsService({
            searchLanguages: mock(() =>
              Promise.reject(new AuthenticationError()),
            ),
          }),
        }),
      });
      return server;
    };

    const [resultA, resultB] = await Promise.all([
      registeredTool(makeServer("authenticate A"), "search_language").handler(
        { query: "python", format: "json" },
        undefined as unknown as RequestHandlerExtra<
          ServerRequest,
          ServerNotification
        >,
      ),
      registeredTool(makeServer("authenticate B"), "search_language").handler(
        { query: "python", format: "json" },
        undefined as unknown as RequestHandlerExtra<
          ServerRequest,
          ServerNotification
        >,
      ),
    ]);

    expect(JSON.parse(resultA.content[0]?.text ?? "{}").details.action).toBe(
      "authenticate A",
    );
    expect(JSON.parse(resultB.content[0]?.text ?? "{}").details.action).toBe(
      "authenticate B",
    );
  });

  it("propagates caller cancellation through traceTool", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const traceTool: McpToolExecutionHook = mock(async (_name, runHandler) =>
      runHandler(),
    );
    const server = createMcpServer({
      metadata: { name: "remote-githits", version: "0.0.0" },
      services: createServices({
        githitsService: createMockGitHitsService({
          search: mock(() => Promise.reject(reason)),
        }),
      }),
      traceTool,
    });

    await expect(
      registeredTool(server, "get_example").handler(
        { query: "express hello world" },
        { signal: controller.signal } as unknown as RequestHandlerExtra<
          ServerRequest,
          ServerNotification
        >,
      ),
    ).rejects.toBe(reason);
    expect(traceTool).toHaveBeenCalledTimes(1);
  });

  it("applies MCP-native file recovery through the remote server API", async () => {
    const grepRepo = mock(() =>
      Promise.reject(
        new CodeNavigationFileNotFoundError(
          "Path not found in the index: docs/missing.md.",
          "docs/missing.md",
        ),
      ),
    );
    const server = createMcpServer({
      metadata: { name: "remote-githits", version: "0.0.0" },
      services: createServices({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    });

    const result = await registeredTool(server, "code_grep").handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "pagination",
        path: "docs/missing.md",
      },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.isError).toBe(true);
    const payload = JSON.parse(result.content[0]?.text ?? "{}") as {
      details?: { action?: string };
    };
    expect(payload.details?.action).toContain("`code_files`");
    expect(payload.details?.action).toContain('path_prefix: "docs/"');
    expect(payload.details?.action).toContain("`code_grep`");
    expect(payload.details?.action).not.toContain("githits code");
  });
});
