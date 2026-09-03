import { describe, expect, it, mock } from "bun:test";
import type {
  AgenticAskService,
  ResolveTargetService,
} from "@githits/core-internal";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
  defaultCodeDiffResult,
} from "../services/test-helpers.js";
import { QUICK_START_PREREQUISITE } from "../tools/quick-start.js";
import { buildLocalMcpQuickStart, buildMcpQuickStart } from "./instructions.js";
import {
  createLocalMcpServer,
  type LocalExperimentalMcpPolicy,
  type LocalMcpToolServices,
} from "./local-server.js";

const EXPECTED_STABLE_NAMES = [
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

const EXPECTED_EXPERIMENTAL_NAMES = [
  ...EXPECTED_STABLE_NAMES,
  "ask",
  "resolve_target",
  "code_diff",
] as const;

interface TestRegisteredTool {
  description?: string;
  inputSchema?: unknown;
  annotations?: unknown;
  handler: (
    args: unknown,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
}

function createServices(
  overrides: Partial<LocalMcpToolServices> = {},
): LocalMcpToolServices {
  const resolveTargetService: ResolveTargetService = {
    resolveTarget: mock(() => Promise.reject(new Error("unused"))),
  };
  return {
    githitsService: createMockGitHitsService(),
    codeNavigationService: createMockCodeNavigationService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    agenticAskService: {
      ask: mock(() =>
        Promise.reject(new Error("unused")),
      ) as unknown as AgenticAskService["ask"],
    },
    resolveTargetService,
    ...overrides,
  };
}

function registeredToolNames(server: ReturnType<typeof createLocalMcpServer>) {
  return Object.keys(
    (
      server as unknown as {
        _registeredTools: Record<string, unknown>;
      }
    )._registeredTools,
  );
}

function registeredTools(
  server: ReturnType<typeof createLocalMcpServer>,
): Record<string, TestRegisteredTool> {
  return (
    server as unknown as {
      _registeredTools: Record<string, TestRegisteredTool>;
    }
  )._registeredTools;
}

function serverInstructions(
  server: ReturnType<typeof createLocalMcpServer>,
): string | undefined {
  return (
    server.server as unknown as {
      _instructions?: string;
    }
  )._instructions;
}

describe("createLocalMcpServer", () => {
  const disabledPolicies: LocalExperimentalMcpPolicy[] = [
    { tools: false, reportToolIssues: undefined },
    { tools: false, reportToolIssues: "experimental" },
    { tools: false, reportToolIssues: "all" },
  ];

  it("keeps disabled and dormant policies on the exact stable inventories", async () => {
    for (const policy of disabledPolicies) {
      const server = createLocalMcpServer({
        metadata: { name: "local-githits", version: "0.0.0" },
        services: createServices(),
        policy,
      });

      expect(registeredToolNames(server)).toEqual([...EXPECTED_STABLE_NAMES]);
      expect(serverInstructions(server)).toBeUndefined();
      for (const name of EXPECTED_STABLE_NAMES) {
        if (name === "quick_start" || name === "feedback") continue;
        expect(registeredTools(server)[name]?.description).toEndWith(
          QUICK_START_PREREQUISITE,
        );
      }
      const result = await registeredTools(server).quick_start!.handler(
        {},
        undefined as unknown as RequestHandlerExtra<
          ServerRequest,
          ServerNotification
        >,
      );
      expect(result.content[0]?.text).toBe(buildMcpQuickStart());
    }
  });

  it("adds all experimental tools to the quick-start guide", async () => {
    const server = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: true, reportToolIssues: undefined },
    });

    expect(registeredToolNames(server)).toEqual([
      ...EXPECTED_EXPERIMENTAL_NAMES,
    ]);
    expect(registeredToolNames(server)).toHaveLength(19);
    expect(serverInstructions(server)).toBeUndefined();
    for (const name of ["ask", "resolve_target", "code_diff"] as const) {
      expect(registeredTools(server)[name]?.description).toEndWith(
        QUICK_START_PREREQUISITE,
      );
    }
    const result = await registeredTools(server).quick_start!.handler(
      {},
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(result.content[0]?.text).toBe(
      buildLocalMcpQuickStart({
        enabledExperimentalTools: ["ask", "resolve_target", "code_diff"],
      }),
    );
    for (const name of EXPECTED_EXPERIMENTAL_NAMES.filter(
      (name) => name !== "quick_start",
    )) {
      expect(result.content[0]?.text).toContain(`\`${name}\``);
    }
  });

  it("omits server instructions without changing stable tool registrations", () => {
    const options = {
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: false, reportToolIssues: undefined } as const,
    };
    const defaultServer = createLocalMcpServer(options);
    const descriptorServer = createLocalMcpServer(options);

    expect(serverInstructions(defaultServer)).toBeUndefined();
    expect(serverInstructions(descriptorServer)).toBeUndefined();
    expect(registeredToolNames(descriptorServer)).toEqual([
      ...EXPECTED_STABLE_NAMES,
    ]);

    const defaultTools = registeredTools(defaultServer);
    const descriptorTools = registeredTools(descriptorServer);
    for (const name of EXPECTED_STABLE_NAMES) {
      expect(descriptorTools[name]?.description).toBe(
        defaultTools[name]?.description,
      );
      expect(
        JSON.stringify(
          (descriptorTools[name]?.inputSchema as { def?: unknown } | undefined)
            ?.def,
        ),
      ).toBe(
        JSON.stringify(
          (defaultTools[name]?.inputSchema as { def?: unknown } | undefined)
            ?.def,
        ),
      );
      expect(descriptorTools[name]?.annotations).toEqual(
        defaultTools[name]?.annotations,
      );
      expect(typeof descriptorTools[name]?.handler).toBe("function");
    }
  });

  it("resolves the extended service from the request-scoped local provider", async () => {
    const ask = mock(() =>
      Promise.resolve({
        source_format: "mcp" as const,
        tool_call_id: "018f47a6-7b32-7a1e-8f45-6a2d39c81720",
        thread_id: "018f47a6-7b32-7b1e-8f45-6a2d39c81720",
        answer_markdown: "Grounded answer.",
        sources: [],
      }),
    );
    const resolveTarget = mock(() =>
      Promise.resolve({
        best: {
          kind: "PACKAGE",
          canonicalKey: "npm:express",
          confidence: "EXACT",
        },
        protectedMatches: [],
        targets: [],
        targetsTruncated: false,
        ambiguous: false,
        ambiguousReason: "NOT_AMBIGUOUS",
      }),
    );
    const services = createServices({
      agenticAskService: {
        ask: ask as unknown as AgenticAskService["ask"],
      },
      resolveTargetService: { resolveTarget },
    });
    const provider = mock(() => services);
    const server = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: provider,
      policy: { tools: true, reportToolIssues: undefined },
    });
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, TestRegisteredTool>;
      }
    )._registeredTools.resolve_target!;

    const askResult = await registeredTools(server).ask!.handler(
      { target: "npm:express", question: "How?", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(askResult.isError).toBeUndefined();
    expect(ask).toHaveBeenCalledWith(
      {
        target: "npm:express",
        question: "How?",
        sourceFormat: "mcp",
      },
      undefined,
    );

    const result = await registered.handler(
      { name: "express", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );

    expect(result.isError).toBeUndefined();
    expect(provider).toHaveBeenCalledWith({ extra: undefined });
    expect(resolveTarget).toHaveBeenCalledWith({
      name: "express",
      limit: 8,
      includeDetailedFields: true,
      includeNameSimilarity: true,
    });

    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const diffServices = createServices({
      codeNavigationService: createMockCodeNavigationService({ codeDiff }),
    });
    const diffProvider = mock(() => diffServices);
    const diffServer = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: diffProvider,
      policy: { tools: true, reportToolIssues: undefined },
    });
    const diffTool = (
      diffServer as unknown as {
        _registeredTools: Record<string, TestRegisteredTool>;
      }
    )._registeredTools.code_diff!;
    const diffResult = await diffTool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        from: "4.18.1",
        to: "4.18.2",
        format: "json",
      },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(diffResult.isError).toBeUndefined();
    expect(diffProvider).toHaveBeenCalledWith({ extra: undefined });
    expect(codeDiff).toHaveBeenCalledWith({
      target: { registry: "NPM", packageName: "express" },
      from: "4.18.1",
      to: "4.18.2",
      mode: "inventory",
    });
  });
});
