import type {
  AgenticAskService,
  CodeDiffService,
  ResolveTargetService,
} from "@githits/core-internal";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createCodeDiffTool } from "../tools/code-diff.js";
import { createResolveTargetTool } from "../tools/resolve-target.js";
import type { McpToolServices } from "../tools/tool-services.js";
import type { ToolTermsRemediation } from "../tools/types.js";
import {
  buildLocalMcpQuickStart,
  type LocalExperimentalToolName,
} from "./instructions.js";
import { createLocalAgenticAskTool } from "./local-agentic-ask.js";
import {
  createDescriptorServices,
  createMcpServerWithFactories,
  createStableMcpToolFactories,
  eraseMcpTool,
  type McpAuthAction,
  type McpRequestContext,
  type McpServerMetadata,
  type McpToolExecutionHook,
  type McpToolFactory,
} from "./server.js";

export type LocalExperimentalReportToolIssues = "experimental" | "all";

export interface LocalExperimentalMcpPolicy {
  tools: boolean;
  reportToolIssues: LocalExperimentalReportToolIssues | undefined;
}

export interface LocalMcpToolServices extends McpToolServices {
  agenticAskService: AgenticAskService;
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
  termsRemediation?: ToolTermsRemediation;
  traceTool?: McpToolExecutionHook;
}

/** Compose the local MCP server while keeping local-only service requirements
 * and experimental policy outside the public package surface. */
export function createLocalMcpServer<TExtra = unknown>(
  options: CreateLocalMcpServerOptions<TExtra>,
): McpServer {
  const enabledExperimentalTools = options.policy.tools
    ? LOCAL_EXPERIMENTAL_TOOL_DEFINITIONS
    : [];
  const quickStartGuide = buildLocalMcpQuickStart({
    enabledExperimentalTools: enabledExperimentalTools.map(({ name }) => name),
    reportToolIssues: options.policy.tools
      ? options.policy.reportToolIssues
      : undefined,
  });
  const toolFactories: readonly McpToolFactory<LocalMcpToolServices>[] = [
    ...createStableMcpToolFactories(quickStartGuide),
    ...enabledExperimentalTools.map(({ factory }) => factory),
  ];
  return createMcpServerWithFactories({
    metadata: options.metadata,
    services: options.services,
    toolFactories,
    descriptorServices: createLocalDescriptorServices(),
    authAction: options.authAction,
    termsRemediation: options.termsRemediation,
    traceTool: options.traceTool,
  });
}

const LOCAL_RESOLVE_TARGET_FACTORY: McpToolFactory<LocalMcpToolServices> = (
  services,
) => eraseMcpTool(createResolveTargetTool(services.resolveTargetService));

const LOCAL_CODE_DIFF_FACTORY: McpToolFactory<LocalMcpToolServices> = (
  services,
) => eraseMcpTool(createCodeDiffTool(services.codeNavigationService));

const LOCAL_AGENTIC_ASK_FACTORY: McpToolFactory<LocalMcpToolServices> = (
  services,
) => eraseMcpTool(createLocalAgenticAskTool(services.agenticAskService));

interface LocalExperimentalToolDefinition {
  name: LocalExperimentalToolName;
  factory: McpToolFactory<LocalMcpToolServices>;
}

const LOCAL_EXPERIMENTAL_TOOL_DEFINITIONS: readonly LocalExperimentalToolDefinition[] =
  [
    { name: "ask", factory: LOCAL_AGENTIC_ASK_FACTORY },
    { name: "resolve_target", factory: LOCAL_RESOLVE_TARGET_FACTORY },
    { name: "code_diff", factory: LOCAL_CODE_DIFF_FACTORY },
  ];

function createLocalDescriptorServices(): LocalMcpToolServices {
  const fail = () => {
    throw new Error("Descriptor services must not execute tool handlers.");
  };
  const stable = createDescriptorServices();
  return {
    ...stable,
    agenticAskService: {
      ask: fail,
    },
    codeNavigationService: {
      ...stable.codeNavigationService,
      codeDiff: fail,
    },
    resolveTargetService: {
      resolveTarget: fail,
    },
  };
}
