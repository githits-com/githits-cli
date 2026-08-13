import { describe, expect, it, mock } from "bun:test";
import {
  AuthenticationError,
  CodeNavigationFileNotFoundError,
} from "@githits/core-internal";
import {
  buildMcpInstructions,
  createMcpServer,
  getMcpToolDescriptors,
  type McpToolServices,
  type McpToolServicesProvider,
  registerMcpTools,
} from "@githits/mcp";
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

describe("public MCP package surface", () => {
  it("contains the APIs needed by a remote MCP server without internal imports", () => {
    const provider: McpToolServicesProvider<RemoteExtra> = () =>
      createServices();

    expect(buildMcpInstructions()).toContain("GitHits provides");
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
