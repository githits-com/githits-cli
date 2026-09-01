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
  createQuickStartTool,
  createReadFileTool,
  createReadPackageDocTool,
  createSearchLanguageTool,
  createSearchStatusTool,
  createSearchTool,
  QUICK_START_PREREQUISITE,
  type ToolDefinition,
  type ToolResult,
  type ZodRawShape,
} from "../tools/index.js";
import { type McpAuthAction, withErrorHandling } from "../tools/shared.js";
import type { McpToolServices } from "../tools/tool-services.js";
import type {
  ToolExecutionContext,
  ToolTermsRemediation,
} from "../tools/types.js";
import { buildMcpQuickStart } from "./instructions.js";

export type {
  McpAuthAction,
  McpAuthActionContext,
  ToolExecutionContext,
  ToolTermsRemediation,
} from "../tools/shared.js";

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
  termsRemediation?: ToolTermsRemediation;
  /** Optional caller-owned MCP instructions. GitHits does not provide defaults. */
  instructions?: string;
  /** Controls the guide returned by `quick_start`. */
  quickStartOptions?: Parameters<typeof buildMcpQuickStart>[0];
  /** @deprecated Use `quickStartOptions`. */
  instructionOptions?: Parameters<typeof buildMcpQuickStart>[0];
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

const STABLE_MCP_OPERATION_FACTORIES: readonly McpToolFactory[] = [
  (services) => eraseMcpTool(createGetExampleTool(services.githitsService)),
  (services) => eraseMcpTool(createSearchLanguageTool(services.githitsService)),
  (services) => eraseMcpTool(createFeedbackTool(services.githitsService)),
  (services) => eraseMcpTool(createSearchTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(createSearchStatusTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(createListFilesTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(createReadFileTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(createGrepRepoTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(
      createListPackageDocsTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseMcpTool(createReadPackageDocTool(services.packageIntelligenceService)),
  (services) =>
    eraseMcpTool(createPackageSummaryTool(services.packageIntelligenceService)),
  (services) =>
    eraseMcpTool(
      createPackageVulnerabilitiesTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseMcpTool(
      createPackageDependenciesTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseMcpTool(
      createPackageChangelogTool(services.packageIntelligenceService),
    ),
  (services) =>
    eraseMcpTool(
      createPackageUpgradeReviewTool(services.packageIntelligenceService),
    ),
];

export function createStableMcpToolFactories(
  quickStartGuide: string = buildMcpQuickStart(),
): readonly McpToolFactory[] {
  return [
    () => eraseMcpTool(createQuickStartTool(quickStartGuide)),
    ...STABLE_MCP_OPERATION_FACTORIES,
  ];
}

export const STABLE_MCP_TOOL_FACTORIES: readonly McpToolFactory[] =
  createStableMcpToolFactories();

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
  return toolFactories.map((createTool) =>
    addMcpSessionPrerequisite(createTool(services)),
  );
}

/**
 * Add the bootstrap contract only while composing an MCP session.
 * Transport-neutral callable tools may be used without a `quick_start` tool.
 */
function addMcpSessionPrerequisite<TArgs, TSchema extends ZodRawShape>(
  tool: ToolDefinition<TArgs, TSchema>,
): ToolDefinition<TArgs, TSchema> {
  if (tool.name === "quick_start" || tool.name === "feedback") return tool;

  return {
    ...tool,
    description: `${tool.description}\n\n${QUICK_START_PREREQUISITE}`,
  };
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

export function eraseMcpTool<TArgs, TSchema extends ZodRawShape>(
  tool: ToolDefinition<TArgs, TSchema>,
): ToolDefinition<unknown> {
  return {
    ...tool,
    handler: (args, context) => tool.handler(args as TArgs, context),
  };
}

export function registerMcpTools<TExtra = unknown>(
  server: McpServer,
  options: {
    authAction?: McpAuthAction;
    termsRemediation?: ToolTermsRemediation;
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
    termsRemediation?: ToolTermsRemediation;
    services: McpToolServicesProviderFor<TServices, TExtra>;
    traceTool?: McpToolExecutionHook;
    descriptorServices: TServices;
  },
): void {
  for (const createTool of toolFactories) {
    const descriptor = addMcpSessionPrerequisite(
      createTool(options.descriptorServices),
    );
    server.registerTool(
      descriptor.name,
      {
        description: descriptor.description,
        inputSchema: descriptor.schema,
        annotations: descriptor.annotations,
      },
      async (args, extra) => {
        const context: ToolExecutionContext = {
          authAction: options.authAction,
          termsRemediation: options.termsRemediation,
          signal: extra?.signal,
        };
        const runHandler = async () => {
          const services = await withErrorHandling(
            "resolve MCP services",
            () =>
              resolveMcpToolServices(options.services, {
                extra: extra as TExtra | undefined,
              }),
            context,
          );
          if (isToolResult(services)) return services;
          return createTool(services).handler(args, context);
        };
        return options.traceTool
          ? await options.traceTool(descriptor.name, runHandler)
          : runHandler();
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
  const toolFactories = createStableMcpToolFactories(
    buildMcpQuickStart(options.quickStartOptions ?? options.instructionOptions),
  );
  return createMcpServerWithFactories({
    ...options,
    toolFactories,
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
  termsRemediation?: ToolTermsRemediation;
  instructions?: string;
  traceTool?: McpToolExecutionHook;
}

export function createMcpServerWithFactories<
  TServices extends McpToolServices,
  TExtra = unknown,
>(options: CreateMcpServerWithFactoriesOptions<TServices, TExtra>): McpServer {
  const server = new McpServer(
    options.metadata,
    options.instructions === undefined
      ? undefined
      : { instructions: options.instructions },
  );

  registerMcpToolsWithFactories(server, options.toolFactories, {
    authAction: options.authAction,
    termsRemediation: options.termsRemediation,
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
