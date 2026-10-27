import { describe, expect, it, mock } from "bun:test";
import type {
  AgenticAskService,
  ListService,
  ResolveTargetService,
} from "@githits/core-internal";
import { AuthenticationError } from "@githits/core-internal";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
  createMockReadService,
  defaultCodeDiffResult,
} from "../services/test-helpers.js";
import { QUICK_START_PREREQUISITE } from "../tools/quick-start.js";
import { buildLocalMcpQuickStart, buildMcpQuickStart } from "./instructions.js";
import {
  createLocalMcpServer,
  type LocalExperimentalMcpPolicy,
  type LocalExperimentalToolDefinition,
  type LocalMcpToolServices,
} from "./local-server.js";

const EXPECTED_STABLE_NAMES = [
  "quick_start",
  "get_example",
  "search",
  "search_status",
  "list",
  "read",
  "grep",
  "resolve_target",
  "code_diff",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
  "research",
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
    listService: createMockListService(),
    readService: createMockReadService(),
    grepService: { grep: mock(() => Promise.reject(new Error("unused"))) },
    agenticAskService: {
      ask: mock(() =>
        Promise.reject(new Error("unused")),
      ) as unknown as AgenticAskService["ask"],
    },
    resolveTargetService,
    ...overrides,
  };
}

function createMockListService(): ListService {
  return {
    list: mock(() => Promise.reject(new Error("unused"))),
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
  it.each([
    { name: "omitted", format: undefined },
    { name: "text", format: "text" as const },
    { name: "json", format: "json" as const },
  ])(
    "formats request-scoped provider failures when format is $name",
    async (mode) => {
      const hostAuthAction =
        "Refresh the host authentication token, then retry this tool.";
      const provider = mock(() =>
        Promise.reject(
          new AuthenticationError("Provider token rejected.", "server"),
        ),
      );
      const server = createLocalMcpServer({
        metadata: { name: "local-githits", version: "0.0.0" },
        services: provider,
        authAction: hostAuthAction,
        policy: { tools: false },
      });
      const response = await registeredTools(server).pkg_info!.handler(
        {
          target: "npm:express",
          ...(mode.format === undefined ? {} : { format: mode.format }),
        },
        undefined as unknown as RequestHandlerExtra<
          ServerRequest,
          ServerNotification
        >,
      );
      const content = response.content[0]?.text ?? "";

      expect(provider).toHaveBeenCalledTimes(1);
      expect(response.isError).toBe(true);
      if (mode.format === "json") {
        expect(JSON.parse(content)).toEqual({
          error: "Provider token rejected.",
          code: "AUTH_REQUIRED",
          retryable: false,
          details: {
            authSource: "server",
            action: hostAuthAction,
          },
        });
        return;
      }

      expect(content).toContain("Provider token rejected.");
      expect(content).toContain(hostAuthAction);
      expect(content).not.toContain('"code":"AUTH_REQUIRED"');
    },
  );

  it.each([false, true])(
    "classifies every tool's state changes and evidence domain with experimental=%s",
    (tools) => {
      const server = createLocalMcpServer({
        metadata: { name: "local-githits", version: "0.0.0" },
        services: createServices(),
        policy: { tools },
      });
      expect(registeredToolNames(server)).not.toContain("feedback");
      for (const [name, tool] of Object.entries(registeredTools(server))) {
        expect(tool.annotations, name).toEqual({
          readOnlyHint: name !== "get_example" && name !== "research",
          idempotentHint: name !== "get_example" && name !== "research",
          destructiveHint: false,
          openWorldHint: name !== "quick_start",
        });
      }
    },
  );

  const disabledPolicies: LocalExperimentalMcpPolicy[] = [{ tools: false }];

  it("keeps disabled policy on the exact stable inventories", async () => {
    for (const policy of disabledPolicies) {
      const server = createLocalMcpServer({
        metadata: { name: "local-githits", version: "0.0.0" },
        services: createServices(),
        policy,
      });

      expect(registeredToolNames(server)).toEqual([...EXPECTED_STABLE_NAMES]);
      expect(registeredToolNames(server)).toHaveLength(15);
      expect(registeredToolNames(server)).toContain("list");
      expect(registeredToolNames(server)).not.toContain("code_files");
      expect(registeredToolNames(server)).not.toContain("docs_list");
      expect(registeredToolNames(server)).toContain("read");
      expect(registeredToolNames(server)).not.toContain("code_read");
      expect(registeredToolNames(server)).not.toContain("docs_read");
      expect(serverInstructions(server)).toBeUndefined();
      for (const name of EXPECTED_STABLE_NAMES) {
        if (name === "quick_start") continue;
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

  it("keeps the legacy opt-in on the stable inventory and guide", async () => {
    const server = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: true },
    });

    expect(registeredToolNames(server)).toEqual([...EXPECTED_STABLE_NAMES]);
    expect(serverInstructions(server)).toBeUndefined();
    const result = await registeredTools(server).quick_start!.handler(
      {},
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(result.content[0]?.text).toBe(buildMcpQuickStart());
  });

  it("composes injected experimental tools only when the policy enables them", async () => {
    const probe: LocalExperimentalToolDefinition = {
      name: "experimental_probe",
      guidance: "- `experimental_probe` — probe one experimental contract.",
      factory: () => ({
        name: "experimental_probe",
        description: "Probe one experimental contract.",
        schema: {},
        annotations: {
          readOnlyHint: true,
          idempotentHint: true,
          destructiveHint: false,
          openWorldHint: true,
        },
        handler: async () => ({
          content: [{ type: "text" as const, text: "probe" }],
        }),
      }),
    };
    const options = {
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      experimentalTools: [probe],
    };

    const disabled = createLocalMcpServer({
      ...options,
      policy: { tools: false },
    });
    expect(registeredToolNames(disabled)).toEqual([...EXPECTED_STABLE_NAMES]);

    const enabled = createLocalMcpServer({
      ...options,
      policy: { tools: true },
    });
    expect(registeredToolNames(enabled)).toEqual([
      ...EXPECTED_STABLE_NAMES,
      "experimental_probe",
    ]);
    expect(registeredTools(enabled).experimental_probe?.description).toEndWith(
      QUICK_START_PREREQUISITE,
    );
    const result = await registeredTools(enabled).quick_start!.handler(
      {},
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(result.content[0]?.text).toBe(
      buildLocalMcpQuickStart({ enabledExperimentalTools: [probe] }),
    );
    expect(result.content[0]?.text).toContain("## Local experimental tools");
  });

  it("renders complete stable and experimental selection sentences", () => {
    const server = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: true },
    });
    const expectedSentences = {
      research:
        "Research a public repository or package to answer a question with sources.",
      resolve_target:
        "Resolve OSS dependency names to canonical package, repository, or docs targets.",
      code_diff:
        "Compare source across exact package versions or public repository refs.",
    } as const;
    const firstSentences = Object.entries(expectedSentences).map(
      ([name, expected]) => {
        const description = registeredTools(server)[name]?.description;
        expect(description, name).toBeDefined();
        const match = description?.match(/^([^.]*\.)(?:\s|$)/);
        expect(match, name).not.toBeNull();
        const firstSentence = match?.[1] ?? "";
        expect(firstSentence, name).toBe(expected);
        expect(firstSentence, name).not.toContain("...");
        expect(firstSentence.length, name).toBeGreaterThan(0);
        expect(firstSentence.length, name).toBeLessThanOrEqual(79);
        expect(description?.slice(0, 80), name).toStartWith(firstSentence);
        return firstSentence;
      },
    );
    expect(new Set(firstSentences)).toHaveLength(3);
  });

  it("uses compact string targets for stable and experimental navigation tools", () => {
    const server = createLocalMcpServer({
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: true },
    });
    const tools = registeredTools(server);

    for (const name of ["list", "code_diff"] as const) {
      const schema = z.toJSONSchema(tools[name]?.inputSchema as z.ZodObject);
      const targetSchema = schema.properties?.target as
        | { properties?: unknown; type?: string }
        | undefined;
      expect(targetSchema, name).toMatchObject({ type: "string" });
      expect(targetSchema?.properties, name).toBeUndefined();
    }
    const grepSchema = z.toJSONSchema(tools.grep?.inputSchema as z.ZodObject);
    expect(grepSchema.properties?.targets).toMatchObject({ type: "array" });
  });

  it("omits server instructions without changing stable tool registrations", () => {
    const options = {
      metadata: { name: "local-githits", version: "0.0.0" },
      services: createServices(),
      policy: { tools: false } as const,
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
        tool_call_id: "018f47a6-7b32-7a1e-8f45-6a2d39c81720",
        thread_id: "018f47a6-7b32-7b1e-8f45-6a2d39c81720",
        display_markdown: "Grounded answer.",
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
      policy: { tools: true },
    });
    const registered = (
      server as unknown as {
        _registeredTools: Record<string, TestRegisteredTool>;
      }
    )._registeredTools.resolve_target!;

    const researchResult = await registeredTools(server).research!.handler(
      { question: "How does Express routing work?", format: "json" },
      undefined as unknown as RequestHandlerExtra<
        ServerRequest,
        ServerNotification
      >,
    );
    expect(researchResult.isError).toBeUndefined();
    expect(ask).toHaveBeenCalledWith(
      {
        question: "How does Express routing work?",
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
      policy: { tools: true },
    });
    const diffTool = (
      diffServer as unknown as {
        _registeredTools: Record<string, TestRegisteredTool>;
      }
    )._registeredTools.code_diff!;
    const diffResult = await diffTool.handler(
      {
        target: "npm:express",
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
