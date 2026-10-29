import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type {
  ServerNotification,
  ServerRequest,
} from "@modelcontextprotocol/sdk/types.js";
import {
  beginAnimatedProgress,
  type McpProgressAnimationOptions,
} from "../progress/progress-animator.js";
import type { McpProgressHook } from "../progress/relay-receiver.js";
import {
  type CompleteToolAnnotations,
  createCodeDiffTool,
  createGetExampleTool,
  createGrepTool,
  createListTool,
  createPackageChangelogTool,
  createPackageDependenciesTool,
  createPackageSummaryTool,
  createPackageUpgradeReviewTool,
  createPackageVulnerabilitiesTool,
  createQuickStartTool,
  createReadTool,
  createResearchTool,
  createResolveTargetTool,
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
  ToolProgress,
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
  /** Optional progress source; used only when the client sends a progress token. */
  progress?: McpProgressHook;
  /**
   * Animates progress messages locally with the GitHits narrowing mark.
   * Defaults to on (500 ms frames) when `progress` is set; `false` disables.
   */
  progressAnimation?: McpProgressAnimationOptions | boolean;
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
  (services) => eraseMcpTool(createSearchTool(services.codeNavigationService)),
  (services) =>
    eraseMcpTool(createSearchStatusTool(services.codeNavigationService)),
  (services) => eraseMcpTool(createListTool(services.listService)),
  (services) => eraseMcpTool(createReadTool(services)),
  (services) => eraseMcpTool(createGrepTool(services.grepService)),
  (services) =>
    eraseMcpTool(createResolveTargetTool(services.resolveTargetService)),
  (services) =>
    eraseMcpTool(createCodeDiffTool(services.codeNavigationService)),
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
  (services) => eraseMcpTool(createResearchTool(services.agenticAskService)),
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
  if (tool.name === "quick_start") return tool;

  return {
    ...tool,
    description: `${tool.description.trimEnd()}\n\n${QUICK_START_PREREQUISITE}`,
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
    progress?: McpProgressHook;
    progressAnimation?: McpProgressAnimationOptions | boolean;
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
    progress?: McpProgressHook;
    progressAnimation?: McpProgressAnimationOptions | boolean;
    descriptorServices: TServices;
  },
): void {
  const animation = resolveAnimation(
    options.progressAnimation,
    options.progress,
  );
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
        const progress = bindProgress(options.progress, animation, extra);
        const context: ToolExecutionContext = {
          authAction: options.authAction,
          termsRemediation: options.termsRemediation,
          signal: extra?.signal,
          ...(progress ? { progress } : {}),
        };
        const runHandler = async () => {
          const services = await withErrorHandling(
            "resolve MCP services",
            () =>
              resolveMcpToolServices(options.services, {
                extra: extra as TExtra | undefined,
              }),
            context,
            args.format === "json" ? "json" : "text",
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
  progress?: McpProgressHook;
  progressAnimation?: McpProgressAnimationOptions | boolean;
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
    progress: options.progress,
    progressAnimation: options.progressAnimation,
    descriptorServices: options.descriptorServices,
  });

  return server;
}

type ProgressRequestExtra = Pick<
  RequestHandlerExtra<ServerRequest, ServerNotification>,
  "_meta" | "sendNotification"
>;

/** Animation is opt-out with a progress hook and opt-in without one. */
function resolveAnimation(
  option: McpProgressAnimationOptions | boolean | undefined,
  hook: McpProgressHook | undefined,
): McpProgressAnimationOptions | false {
  if (option === false) return false;
  if (option === true) return {};
  if (option) return option;
  return hook ? {} : false;
}

/**
 * Binds progress to one MCP request. Progress is offered only when the client
 * supplied a token; `0` is a valid token. Live updates come from the hook and
 * animation frames are generated locally; all notifications are best effort
 * and stop when the tool call ends.
 */
function bindProgress(
  hook: McpProgressHook | undefined,
  animation: McpProgressAnimationOptions | false,
  extra: ProgressRequestExtra | undefined,
): ToolProgress | undefined {
  const progressToken = extra?._meta?.progressToken;
  if (
    (!hook && !animation) ||
    progressToken === undefined ||
    !extra?.sendNotification
  ) {
    return undefined;
  }
  const { sendNotification } = extra;
  const emit = (progress: number, message: string) => {
    void sendNotification({
      method: "notifications/progress",
      params: { progressToken, progress, message },
    }).catch(() => {});
  };
  return {
    begin: (initialMessage = "Working…") =>
      beginAnimatedProgress(hook, emit, initialMessage, animation),
  };
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
    },
    codeNavigationService: {
      search: fail,
      searchStatus: fail,
      listFiles: fail,
      readFile: fail,
      grepRepo: fail,
      codeDiff: fail,
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
    listService: {
      list: fail,
    },
    readService: {
      read: fail,
    },
    grepService: {
      grep: fail,
    },
    resolveTargetService: {
      resolveTarget: fail,
    },
    agenticAskService: {
      ask: fail,
    },
  };
}

function isToolResult(
  value: McpToolServices | ToolResult,
): value is ToolResult {
  return "content" in value;
}
