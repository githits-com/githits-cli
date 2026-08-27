import type { AgentInfo } from "@githits/core-internal";
import {
  createLocalMcpServer,
  dim,
  highlight,
  type LocalExperimentalMcpPolicy,
  type LocalMcpToolServices,
  shouldUseColors,
  type ToolTermsRemediation,
} from "@githits/mcp/internal";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { type Command, Option } from "commander";
import { version } from "../../package.json";
import { createContainer } from "../container.js";
import { loadExperimentalSettings } from "../services/experimental-config.js";
import { FileSystemServiceImpl } from "../services/filesystem-service.js";

const LOCAL_MCP_SERVER_METADATA = { name: "githits", version };

type LocalMcpServer = ReturnType<typeof createLocalMcpServer>;

const DISABLED_LOCAL_MCP_POLICY: LocalExperimentalMcpPolicy = {
  tools: false,
  reportToolIssues: undefined,
};

const OVERRIDE_LOCAL_MCP_POLICY: LocalExperimentalMcpPolicy = {
  tools: true,
  reportToolIssues: undefined,
};

const LOCAL_TERMS_REMEDIATION: ToolTermsRemediation = {
  message:
    "Terms acceptance required. Run `githits settings terms accept`, then retry.",
  action: "githits settings terms accept",
};

export interface StartMcpServerOptions {
  onServerCreated?: (server: LocalMcpServer) => void;
  experimentalPolicy?: LocalExperimentalMcpPolicy;
  termsRemediation?: ToolTermsRemediation;
}

export interface CreateMcpCommandStartupOptions {
  experimentalTools?: boolean;
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
  services: LocalMcpToolServices,
  options: StartMcpServerOptions = {},
): Promise<void> {
  const server = createLocalMcpServer({
    services,
    metadata: LOCAL_MCP_SERVER_METADATA,
    policy: options.experimentalPolicy ?? DISABLED_LOCAL_MCP_POLICY,
    termsRemediation: options.termsRemediation ?? LOCAL_TERMS_REMEDIATION,
  });
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

export interface McpCommandStartup {
  services: LocalMcpToolServices;
  experimentalPolicy: LocalExperimentalMcpPolicy;
  onServerCreated: (server: LocalMcpServer) => void;
}

export async function createMcpCommandStartup(
  options: CreateMcpCommandStartupOptions = {},
): Promise<McpCommandStartup> {
  const experimentalPolicy = options.experimentalTools
    ? OVERRIDE_LOCAL_MCP_POLICY
    : await loadExperimentalSettings(new FileSystemServiceImpl()).then(
        (settings): LocalExperimentalMcpPolicy => ({
          tools: settings.tools,
          reportToolIssues: settings.reportToolIssues,
        }),
      );
  let server: LocalMcpServer | undefined;
  const services = await createContainer({
    resolveStoredToken: false,
    clientName: "githits-cli/mcp",
    agentProvider: () => readMcpClientVersion(server),
  });
  return {
    services,
    experimentalPolicy,
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
    "For agents that support skills, prefer `githits init` so the githits-mcp skill and a short instruction pointer are installed too. Use `--no-guidance` only for plain MCP setup.\n",
  );

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
export interface McpCommandRegistrationDependencies {
  createStartup?: typeof createMcpCommandStartup;
  startServer?: typeof startMcpServer;
}

export function registerMcpCommand(
  program: Command,
  dependencies: McpCommandRegistrationDependencies = {},
) {
  const createStartup = dependencies.createStartup ?? createMcpCommandStartup;
  const startServer = dependencies.startServer ?? startMcpServer;
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
      const startup = await createStartup();
      await startServer(startup.services, {
        experimentalPolicy: startup.experimentalPolicy,
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
    .addOption(new Option("--experimental-tools").hideHelp())
    .action(async (options: CreateMcpCommandStartupOptions) => {
      const startup = await createStartup(
        options.experimentalTools ? { experimentalTools: true } : undefined,
      );
      await startServer(startup.services, {
        experimentalPolicy: startup.experimentalPolicy,
        onServerCreated: startup.onServerCreated,
      });
    });
}
