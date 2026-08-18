import type {
  CodeDiffService,
  ResolveTargetService,
} from "@githits/core-internal";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createResolveTargetTool } from "../tools/resolve-target.js";
import type { McpToolServices } from "../tools/tool-services.js";
import { buildMcpInstructions } from "./instructions.js";
import {
  createDescriptorServices,
  createMcpServerWithFactories,
  eraseMcpTool,
  type McpAuthAction,
  type McpRequestContext,
  type McpServerMetadata,
  type McpToolExecutionHook,
  type McpToolFactory,
  STABLE_MCP_TOOL_FACTORIES,
} from "./server.js";

export type LocalExperimentalReportToolIssues = "experimental" | "all";

export interface LocalExperimentalMcpPolicy {
  tools: boolean;
  reportToolIssues: LocalExperimentalReportToolIssues | undefined;
}

export interface LocalMcpToolServices extends McpToolServices {
  codeNavigationService: McpToolServices["codeNavigationService"] &
    CodeDiffService;
  resolveTargetService: ResolveTargetService;
}

export type LocalMcpToolServicesProvider<TExtra = unknown> =
  | LocalMcpToolServices
  | ((
      context: McpRequestContext<TExtra>,
    ) => LocalMcpToolServices | Promise<LocalMcpToolServices>);

export interface CreateLocalMcpServerOptions<TExtra = unknown> {
  metadata: McpServerMetadata;
  services: LocalMcpToolServicesProvider<TExtra>;
  policy: LocalExperimentalMcpPolicy;
  authAction?: McpAuthAction;
  traceTool?: McpToolExecutionHook;
}

/**
 * Compose the local MCP server while keeping local-only service requirements
 * and experimental policy outside the public package surface.
 *
 * Experimental instructions remain deferred to the combined instruction
 * slice; enabling the policy only adds the local adapter inventory here.
 */
export function createLocalMcpServer<TExtra = unknown>(
  options: CreateLocalMcpServerOptions<TExtra>,
): McpServer {
  const toolFactories: readonly McpToolFactory<LocalMcpToolServices>[] = options
    .policy.tools
    ? [...STABLE_MCP_TOOL_FACTORIES, LOCAL_RESOLVE_TARGET_FACTORY]
    : STABLE_MCP_TOOL_FACTORIES;
  return createMcpServerWithFactories({
    metadata: options.metadata,
    services: options.services,
    toolFactories,
    descriptorServices: createLocalDescriptorServices(),
    authAction: options.authAction,
    traceTool: options.traceTool,
    instructions: buildMcpInstructions(),
  });
}

const LOCAL_RESOLVE_TARGET_FACTORY: McpToolFactory<LocalMcpToolServices> = (
  services,
) => eraseMcpTool(createResolveTargetTool(services.resolveTargetService));

function createLocalDescriptorServices(): LocalMcpToolServices {
  const fail = () => {
    throw new Error("Descriptor services must not execute tool handlers.");
  };
  const stable = createDescriptorServices();
  return {
    ...stable,
    codeNavigationService: {
      ...stable.codeNavigationService,
      codeDiff: fail,
    },
    resolveTargetService: {
      resolveTarget: fail,
    },
  };
}
