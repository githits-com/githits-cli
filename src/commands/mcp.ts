import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";
import { version } from "../../package.json";
import { createContainer } from "../container.js";
import { createMcpServer } from "../mcp/server.js";
import { dim, highlight, shouldUseColors } from "../shared/colors.js";
import {
  setClientMode,
  setMcpClientVersionProvider,
} from "../shared/request-headers.js";
import type { McpToolServices } from "../tools/tool-services.js";

const LOCAL_MCP_SERVER_METADATA = { name: "githits", version };

/**
 * Start the MCP server. Exported for testability.
 *
 * Telemetry wiring:
 * - `setClientMode("mcp")` tags every subsequent API request with
 *   `x-githits-client-name: githits-cli/mcp` so backend telemetry
 *   can distinguish MCP-driven traffic from direct-CLI traffic.
 * - `setMcpClientVersionProvider` registers a lazy reader that
 *   pulls the connecting client's `clientInfo` (cursor,
 *   claude-code, etc.) on every request. The MCP SDK sets
 *   `_clientVersion` synchronously inside `_oninitialize` before
 *   the initialize response is sent back, so every tool call that
 *   arrives after the handshake sees a populated value —
 *   eliminating the race the older `oninitialized` callback
 *   pattern had where the first tool call could slip through
 *   before the notification dispatched.
 */
export async function startMcpServer(services: McpToolServices): Promise<void> {
  setClientMode("mcp");

  const server = createMcpServer(services, LOCAL_MCP_SERVER_METADATA);
  const transport = new StdioServerTransport();

  setMcpClientVersionProvider(() => {
    try {
      const clientVersion = server.server.getClientVersion();
      if (
        !clientVersion?.name ||
        typeof clientVersion.name !== "string" ||
        clientVersion.name.trim().length === 0
      ) {
        return undefined;
      }
      const name = clientVersion.name.trim();
      const rawVersion = clientVersion.version;
      const versionOut =
        typeof rawVersion === "string" && rawVersion.trim().length > 0
          ? rawVersion.trim()
          : undefined;
      return { name, version: versionOut };
    } catch {
      // Agent header is optional — never block the request.
      return undefined;
    }
  });

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
    .summary("Show MCP setup instructions or start the local MCP server")
    .description(
      `Start the Model Context Protocol (MCP) server using STDIO transport.

When run interactively (TTY), shows setup instructions.
When run via stdio (non-TTY), starts the MCP server.

Authenticated tool calls require a valid GitHits token.`,
    )
    .action(async () => {
      if (process.stdout.isTTY && process.stdin.isTTY) {
        showMcpSetupInstructions();
        return;
      }
      const deps = await createContainer({ resolveStoredToken: false });
      await startMcpServer(deps);
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
      const deps = await createContainer({ resolveStoredToken: false });
      await startMcpServer(deps);
    });
}
