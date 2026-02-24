import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";
import { version } from "../../package.json";
import { createContainer, type Dependencies } from "../container.js";
import { dim, highlight, shouldUseColors } from "../shared/colors.js";
import { AuthRequiredError, requireAuth } from "../shared/require-auth.js";
import {
  createFeedbackTool,
  createSearchLanguageTool,
  createSearchTool,
  type ToolDefinition,
} from "../tools/index.js";

/**
 * Creates the MCP server with injected dependencies.
 */
export function createMcpServer(deps: Dependencies): McpServer {
  const server = new McpServer({
    name: "githits",
    version,
  });

  const { githitsService } = deps;
  // biome-ignore lint/suspicious/noExplicitAny: Generic tool definitions
  const tools: ToolDefinition<any, any>[] = [
    createSearchTool(githitsService),
    createSearchLanguageTool(githitsService),
    createFeedbackTool(githitsService),
  ];

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: tool.schema },
      tool.handler,
    );
  }

  return server;
}

/**
 * Start the MCP server. Exported for testability.
 */
export async function startMcpServer(deps: Dependencies): Promise<void> {
  requireAuth(deps, "to start MCP server");

  const server = createMcpServer(deps);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

/**
 * Show setup instructions when running in TTY mode.
 */
function showMcpSetupInstructions(): void {
  const useColors = shouldUseColors();

  console.log("MCP Server Setup");
  console.log("────────────────\n");

  console.log("Add GitHits to your AI assistant's MCP configuration.\n");

  console.log(
    `${highlight("Claude Code", useColors)} ${dim("(recommended)", useColors)}`,
  );
  console.log("  claude mcp add githits -- githits mcp start\n");

  console.log(highlight("Cursor / VS Code", useColors));
  console.log("  Add to your MCP settings JSON:");
  console.log(
    dim(
      '  { "mcpServers": { "githits": { "command": "githits", "args": ["mcp", "start"] } } }',
      useColors,
    ),
  );
  console.log("");

  console.log("Learn more at https://githits.com");
}

/**
 * Register the mcp command on the given program.
 * Uses lazy container creation so `--help` doesn't trigger auth.
 */
export function registerMcpCommand(program: Command) {
  const mcpCommand = program
    .command("mcp")
    .summary("Show setup instructions or start MCP server")
    .description(
      `Start the Model Context Protocol (MCP) server using STDIO transport.

When run interactively (TTY), shows setup instructions.
When run via stdio (non-TTY), starts the MCP server.

Available tools: search, search_language, feedback`,
    )
    .action(async () => {
      if (process.stdout.isTTY && process.stdin.isTTY) {
        showMcpSetupInstructions();
        return;
      }
      try {
        const deps = await createContainer();
        await startMcpServer(deps);
      } catch (error) {
        if (error instanceof AuthRequiredError) process.exit(1);
        throw error;
      }
    });

  mcpCommand
    .command("start")
    .summary("Start MCP server (stdio mode)")
    .description(
      `Start the MCP server using STDIO transport.

This command explicitly starts the server and is intended for use
in MCP configuration files. Use 'githits mcp' for interactive setup.`,
    )
    .action(async () => {
      try {
        const deps = await createContainer();
        await startMcpServer(deps);
      } catch (error) {
        if (error instanceof AuthRequiredError) process.exit(1);
        throw error;
      }
    });
}
