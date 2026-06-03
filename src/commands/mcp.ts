import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Command } from "commander";
import { version } from "../../package.json";
import { createContainer } from "../container.js";
import { createMcpServer } from "../mcp/server.js";
import { dim, highlight, shouldUseColors } from "../shared/colors.js";
import type { AgentInfo } from "../shared/request-headers.js";
import type { McpToolServices } from "../tools/tool-services.js";

const LOCAL_MCP_SERVER_METADATA = { name: "githits", version };

type LocalMcpServer = ReturnType<typeof createMcpServer>;

export interface StartMcpServerOptions {
  onServerCreated?: (server: LocalMcpServer) => void;
}

/**
 * Start the MCP server. Exported for testability.
 *
 * Telemetry wiring:
 * Telemetry headers are built by the services injected into this server.
 * The CLI command passes `githits-cli/mcp` plus a lazy reader for the
 * connecting client's `clientInfo` when it creates those services.
 */
export async function startMcpServer(
  services: McpToolServices,
  options: StartMcpServerOptions = {},
): Promise<void> {
  const server = createMcpServer(services, LOCAL_MCP_SERVER_METADATA);
  const transport = new StdioServerTransport();

  options.onServerCreated?.(server);

  await server.connect(transport);
}

function readMcpClientVersion(
  server: LocalMcpServer | undefined,
): AgentInfo | undefined {
  if (!server) return undefined;
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
}

async function createMcpCommandStartup(): Promise<{
  services: McpToolServices;
  onServerCreated: (server: LocalMcpServer) => void;
}> {
  let server: LocalMcpServer | undefined;
  const services = await createContainer({
    resolveStoredToken: false,
    clientName: "githits-cli/mcp",
    agentProvider: () => readMcpClientVersion(server),
  });
  return {
    services,
    onServerCreated: (created: LocalMcpServer) => {
      server = created;
    },
  };
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
      const startup = await createMcpCommandStartup();
      await startMcpServer(startup.services, {
        onServerCreated: startup.onServerCreated,
      });
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
      const startup = await createMcpCommandStartup();
      await startMcpServer(startup.services, {
        onServerCreated: startup.onServerCreated,
      });
    });
}
