import type {
  CodeDiffService,
  ResolveTargetService,
} from "@githits/core-internal";
import {
  type CodeDiffMcpArgs,
  createCodeDiffTool,
  createResolveTargetTool,
  getMcpToolDefinitions,
  type McpToolServices,
  type ResolveTargetMcpArgs,
  type ToolDefinition,
} from "@githits/mcp/internal";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
  createMockResolveTargetService,
} from "../services/test-helpers.js";

export type ExperimentalParityToolName = "resolve_target" | "code_diff";

interface ExperimentalParityServices extends McpToolServices {
  codeNavigationService: McpToolServices["codeNavigationService"] &
    CodeDiffService;
  resolveTargetService: ResolveTargetService;
}

export function isProcessExitSentinel(error: unknown): boolean {
  return error instanceof Error && error.message === "process.exit";
}

export function createParityMcpTool<TArgs = unknown>(
  name: string,
  overrides: Partial<McpToolServices> = {},
): ToolDefinition<TArgs> {
  const services: McpToolServices = {
    codeNavigationService: createMockCodeNavigationService(),
    githitsService: createMockGitHitsService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    ...overrides,
  };
  const tool = getMcpToolDefinitions(services).find(
    (definition) => definition.name === name,
  );
  if (!tool) {
    throw new Error(`Missing MCP parity tool: ${name}`);
  }
  return tool as ToolDefinition<TArgs>;
}

export function createParityExperimentalMcpTool<
  TArgs extends ResolveTargetMcpArgs | CodeDiffMcpArgs =
    | ResolveTargetMcpArgs
    | CodeDiffMcpArgs,
>(
  name: ExperimentalParityToolName,
  overrides: Partial<ExperimentalParityServices> = {},
): ToolDefinition<TArgs> {
  const services: ExperimentalParityServices = {
    codeNavigationService: createMockCodeNavigationService(),
    githitsService: createMockGitHitsService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    resolveTargetService: createMockResolveTargetService(),
    ...overrides,
  };
  const tool =
    name === "resolve_target"
      ? createResolveTargetTool(services.resolveTargetService)
      : createCodeDiffTool(services.codeNavigationService);
  return tool as unknown as ToolDefinition<TArgs>;
}
