import {
  getMcpToolDefinitions,
  type McpToolServices,
  type ToolDefinition,
} from "@githits/mcp/internal";
import {
  createMockCodeNavigationService,
  createMockGitHitsService,
  createMockPackageIntelligenceService,
} from "../services/test-helpers.js";

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
