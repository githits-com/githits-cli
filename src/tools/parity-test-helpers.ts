import type { ResolveTargetService } from "@githits/core-internal";
import {
  createResolveTargetTool,
  getMcpToolDefinitions,
  type McpToolServices,
  type ResolveTargetMcpArgs,
  type ToolDefinition,
} from "@githits/mcp/internal";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockGrepService,
  createMockListService,
  createMockPackageIntelligenceService,
  createMockReadService,
  createMockResolveTargetService,
} from "../services/test-helpers.js";

export type ExperimentalParityToolName = "resolve_target";

interface ExperimentalParityServices extends McpToolServices {
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
    listService: createMockListService(),
    readService: createMockReadService(),
    grepService: createMockGrepService(),
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
  TArgs extends ResolveTargetMcpArgs = ResolveTargetMcpArgs,
>(
  _name: ExperimentalParityToolName,
  overrides: Partial<ExperimentalParityServices> = {},
): ToolDefinition<TArgs> {
  const services: ExperimentalParityServices = {
    codeNavigationService: createMockCodeNavigationService(),
    githitsService: createMockGitHitsService(),
    packageIntelligenceService: createMockPackageIntelligenceService(),
    listService: createMockListService(),
    readService: createMockReadService(),
    grepService: createMockGrepService(),
    resolveTargetService: createMockResolveTargetService(),
    ...overrides,
  };
  const tool = createResolveTargetTool(services.resolveTargetService);
  return tool as unknown as ToolDefinition<TArgs>;
}
