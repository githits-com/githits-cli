import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
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
  type ZodRawShape,
} from "../tools/index.js";
import type { McpToolServices } from "../tools/tool-services.js";
import { buildMcpInstructions } from "./instructions.js";

export interface McpServerMetadata {
  name: string;
  version: string;
}

/**
 * Returns the MCP tools enabled for the current startup state.
 */
export function getMcpToolDefinitions(
  services: McpToolServices,
): ToolDefinition<unknown>[] {
  const tools: ToolDefinition<unknown>[] = [
    eraseTool(createGetExampleTool(services.githitsService)),
    eraseTool(createSearchLanguageTool(services.githitsService)),
    eraseTool(createFeedbackTool(services.githitsService)),
  ];

  tools.push(eraseTool(createSearchTool(services.codeNavigationService)));
  tools.push(eraseTool(createSearchStatusTool(services.codeNavigationService)));
  tools.push(eraseTool(createListFilesTool(services.codeNavigationService)));
  tools.push(eraseTool(createReadFileTool(services.codeNavigationService)));
  tools.push(eraseTool(createGrepRepoTool(services.codeNavigationService)));
  tools.push(
    eraseTool(createListPackageDocsTool(services.packageIntelligenceService)),
  );
  tools.push(
    eraseTool(createReadPackageDocTool(services.packageIntelligenceService)),
  );
  tools.push(
    eraseTool(createPackageSummaryTool(services.packageIntelligenceService)),
  );
  tools.push(
    eraseTool(
      createPackageVulnerabilitiesTool(services.packageIntelligenceService),
    ),
  );
  tools.push(
    eraseTool(
      createPackageDependenciesTool(services.packageIntelligenceService),
    ),
  );
  tools.push(
    eraseTool(createPackageChangelogTool(services.packageIntelligenceService)),
  );
  tools.push(
    eraseTool(
      createPackageUpgradeReviewTool(services.packageIntelligenceService),
    ),
  );

  return tools;
}

function eraseTool<TArgs, TSchema extends ZodRawShape>(
  tool: ToolDefinition<TArgs, TSchema>,
): ToolDefinition<unknown> {
  return {
    ...tool,
    handler: (args, extra) => tool.handler(args as TArgs, extra),
  };
}

/**
 * Creates the transport-neutral MCP server with injected services.
 */
export function createMcpServer(
  services: McpToolServices,
  metadata: McpServerMetadata,
): McpServer {
  const server = new McpServer(metadata, {
    instructions: buildMcpInstructions(),
  });

  const tools = getMcpToolDefinitions(services);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.schema,
        annotations: tool.annotations,
      },
      tool.handler,
    );
  }

  return server;
}
