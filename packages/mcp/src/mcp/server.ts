import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  type CompleteToolAnnotations,
  createFeedbackTool,
  createGetExampleTool,
  createGrepRepoTool,
  createListFilesTool,
  createListPackageDocsTool,
  createPackageChangelogTool,
  createPackageDependenciesTool,
  createPackageSummaryTool,
  createPackageUpgradeReviewTool,
  createPackageVulnerabilitiesTool,
  createReadFileTool,
  createReadPackageDocTool,
  createSearchLanguageTool,
  createSearchStatusTool,
  createSearchTool,
  type ToolDefinition,
  type ToolResult,
  type ZodRawShape,
} from "../tools/index.js";
import {
  type McpAuthAction,
  withErrorHandling,
  withMcpErrorOptions,
} from "../tools/shared.js";
import type { McpToolServices } from "../tools/tool-services.js";
import { buildMcpInstructions } from "./instructions.js";

export type { McpAuthAction, McpAuthActionContext } from "../tools/shared.js";

export interface McpServerMetadata {
  name: string;
  version: string;
}

export interface McpRequestContext<TExtra = unknown> {
  extra: TExtra | undefined;
}

export type McpToolServicesProviderFor<
  TServices extends McpToolServices,
  TExtra = unknown,
> =
  | TServices
  | ((context: McpRequestContext<TExtra>) => TServices | Promise<TServices>);

export type McpToolServicesProvider<TExtra = unknown> =
  McpToolServicesProviderFor<McpToolServices, TExtra>;

/** Wraps one public MCP tool call without receiving arguments or auth data. */
export type McpToolExecutionHook = (
  toolName: string,
  runHandler: () => Promise<ToolResult>,
) => ToolResult | Promise<ToolResult>;

export interface CreateMcpServerOptions<TExtra = unknown> {
  metadata: McpServerMetadata;
  services: McpToolServicesProvider<TExtra>;
  authAction?: McpAuthAction;
  instructions?: string;
  instructionOptions?: Parameters<typeof buildMcpInstructions>[0];
  traceTool?: McpToolExecutionHook;
}

export interface McpToolDescriptor<TSchema extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: TSchema;
  annotations: CompleteToolAnnotations;
}

export type McpToolFactory<
  TServices extends McpToolServices = McpToolServices,
> = (services: TServices) => ToolDefinition<unknown>;

export const STABLE_MCP_TOOL_FACTORIES: readonly McpToolFactory[] = [
  (services) => eraseTool(createGetExampleTool(services.githitsService)),
  (services) => eraseTool(createSearchLanguageTool(services.githitsService)),
  (services) => eraseTool(createFeedbackTool(services.githitsService)),
  (services) => eraseTool(createSearchTool(services.codeNavigationService)),
  (services) =>
    eraseTool(createSearchStatusTool(services.codeNavigationService)),
  (services) => eraseTool(createListFilesTool(services.codeNavigationService)),
  (services) => eraseTool(createReadFileTool(services.codeNavigationService)),
  (services) => eraseTool(createGrepRepoTool(services.codeNavigationService)),
  (services) =>
    eraseTool(createListPackageDocsTool(services.packageIntelligenceService)),
  (services) =>
    eraseTool(createReadPackageDocTool(services.packageIntelligenceService)),
  (services) =>
    eraseTool(createPackageSummaryTool(services.packageIntelligenceService)),
  (services) =>
    eraseTool(
      createPackageVulnerabilitiesTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseTool(
      createPackageDependenciesTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseTool(createPackageChangelogTool(services.packageIntelligenceService)),
  (services) =>
    eraseTool(
      createPackageUpgradeReviewTool(services.packageIntelligenceService),
    ),
];

/**
 * Returns the MCP tools enabled for the current startup state.
 */
export function getMcpToolDefinitions(
  services: McpToolServices,
): ToolDefinition<unknown>[] {
  return getToolDefinitionsFromFactories(services, STABLE_MCP_TOOL_FACTORIES);
}

function getToolDefinitionsFromFactories<TServices extends McpToolServices>(
  services: TServices,
  toolFactories: readonly McpToolFactory<TServices>[],
): ToolDefinition<unknown>[] {
  return toolFactories.map((createTool) => createTool(services));
}

export function getMcpToolDescriptors(): McpToolDescriptor[] {
  return getMcpToolDefinitions(createDescriptorServices()).map(
    ({ name, description, schema, annotations }) => ({
      name,
      description,
      schema,
      annotations,
    }),
  );
}

function eraseTool<TArgs, TSchema extends ZodRawShape>(
  tool: ToolDefinition<TArgs, TSchema>,
): ToolDefinition<unknown> {
  return {
    ...tool,
    handler: (args, extra) => tool.handler(args as TArgs, extra),
  };
}

export function registerMcpTools<TExtra = unknown>(
  server: McpServer,
  options: {
    authAction?: McpAuthAction;
    services: McpToolServicesProvider<TExtra>;
    traceTool?: McpToolExecutionHook;
  },
): void {
  registerMcpToolsWithFactories(server, STABLE_MCP_TOOL_FACTORIES, {
    ...options,
    descriptorServices: createDescriptorServices(),
  });
}

export function registerMcpToolsWithFactories<
  TServices extends McpToolServices,
  TExtra = unknown,
>(
  server: McpServer,
  toolFactories: readonly McpToolFactory<TServices>[],
  options: {
    authAction?: McpAuthAction;
    services: McpToolServicesProviderFor<TServices, TExtra>;
    traceTool?: McpToolExecutionHook;
    descriptorServices: TServices;
  },
): void {
  for (const createTool of toolFactories) {
    const descriptor = createTool(options.descriptorServices);
    server.registerTool(
      descriptor.name,
      {
        description: descriptor.description,
        inputSchema: descriptor.schema,
        annotations: descriptor.annotations,
      },
      async (args, extra) => {
        const runHandler = async () => {
          const services = await withErrorHandling("resolve MCP services", () =>
            resolveMcpToolServices(options.services, {
              extra: extra as TExtra | undefined,
            }),
          );
          if (isToolResult(services)) return services;
          return createTool(services).handler(args, extra);
        };
        return withMcpErrorOptions(
          { authAction: options.authAction },
          async () =>
            options.traceTool
              ? await options.traceTool(descriptor.name, runHandler)
              : runHandler(),
        );
      },
    );
  }
}

/**
 * Creates the transport-neutral MCP server with injected services.
 */
export function createMcpServer<TExtra = unknown>(
  options: CreateMcpServerOptions<TExtra>,
): McpServer {
  return createMcpServerWithFactories({
    ...options,
    toolFactories: STABLE_MCP_TOOL_FACTORIES,
    descriptorServices: createDescriptorServices(),
  });
}

export interface CreateMcpServerWithFactoriesOptions<
  TServices extends McpToolServices,
  TExtra = unknown,
> {
  metadata: McpServerMetadata;
  services: McpToolServicesProviderFor<TServices, TExtra>;
  toolFactories: readonly McpToolFactory<TServices>[];
  descriptorServices: TServices;
  authAction?: McpAuthAction;
  instructions?: string;
  instructionOptions?: Parameters<typeof buildMcpInstructions>[0];
  traceTool?: McpToolExecutionHook;
}

export function createMcpServerWithFactories<
  TServices extends McpToolServices,
  TExtra = unknown,
>(options: CreateMcpServerWithFactoriesOptions<TServices, TExtra>): McpServer {
  const server = new McpServer(options.metadata, {
    instructions:
      options.instructions ?? buildMcpInstructions(options.instructionOptions),
  });

  registerMcpToolsWithFactories(server, options.toolFactories, {
    authAction: options.authAction,
    services: options.services,
    traceTool: options.traceTool,
    descriptorServices: options.descriptorServices,
  });

  return server;
}

async function resolveMcpToolServices<
  TServices extends McpToolServices,
  TExtra,
>(
  provider: McpToolServicesProviderFor<TServices, TExtra>,
  context: McpRequestContext<TExtra>,
): Promise<TServices> {
  if (typeof provider === "function") {
    return provider(context);
  }
  return provider;
}

export function createDescriptorServices(): McpToolServices {
  const fail = () => {
    throw new Error("Descriptor services must not execute tool handlers.");
  };
  return {
    githitsService: {
      search: fail,
      getLanguages: fail,
      searchLanguages: fail,
      submitFeedback: fail,
    },
    codeNavigationService: {
      search: fail,
      searchStatus: fail,
      listFiles: fail,
      readFile: fail,
      grepRepo: fail,
    },
    packageIntelligenceService: {
      packageSummary: fail,
      packageVulnerabilities: fail,
      packageDependencies: fail,
      packageUpgradeDependencyProbe: fail,
      packageUpgradeReview: fail,
      packageChangelog: fail,
      listPackageDocs: fail,
      readPackageDoc: fail,
    },
  };
}

function isToolResult(
  value: McpToolServices | ToolResult,
): value is ToolResult {
  return "content" in value;
}
