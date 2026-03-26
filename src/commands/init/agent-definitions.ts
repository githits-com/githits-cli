import { getMcpUrl } from "../../services/config.js";
import type { FileSystemService } from "../../services/index.js";

/**
 * Setup configuration for agents that use a CLI command.
 */
export interface CliSetup {
  method: "cli";
  /** Command to execute (e.g., "claude") */
  command: string;
  /** Command arguments */
  args: string[];
}

/**
 * Setup configuration for agents that need config file editing.
 */
export interface ConfigFileSetup {
  method: "config-file";
  /** Absolute path to the config file */
  configPath: string;
  /** Key in the config where MCP servers live (e.g., "mcpServers") */
  serversKey: string;
  /** Server name to add */
  serverName: string;
  /** Server config value to add */
  serverConfig: Record<string, unknown>;
}

export type SetupConfig = CliSetup | ConfigFileSetup;

/**
 * Represents a coding agent that can be configured with GitHits MCP server.
 * Each definition knows how to detect whether the agent is installed
 * and how to configure it.
 */
export interface AgentDefinition {
  /** Display name shown to the user (e.g., "Claude Code") */
  name: string;
  /** Unique identifier (e.g., "claude-code") */
  id: string;
  /** Directories to check for detection. Uses FileSystemService for testability. */
  detectPaths: (fs: FileSystemService) => string[];
  /** How this agent is configured */
  setupMethod: "cli" | "config-file";
  /** Returns the setup config for this agent. Uses FileSystemService for path resolution. */
  getSetupConfig: (fs: FileSystemService) => SetupConfig;
}

/** Returns the mcp-remote stdio config used by agents without native HTTP+OAuth */
function mcpRemoteConfig(mcpUrl: string): Record<string, unknown> {
  return {
    command: "npx",
    args: ["-y", "mcp-remote", mcpUrl],
  };
}

/**
 * Returns platform-specific application data directory path.
 * macOS: ~/Library/Application Support/<app>
 * Windows: %APPDATA%/<app>
 * Linux: ~/.config/<app>
 */
function getAppDataPath(fs: FileSystemService, appName: string): string {
  const home = fs.getHomeDir();
  switch (process.platform) {
    case "win32":
      return fs.joinPath(
        process.env.APPDATA ?? fs.joinPath(home, "AppData", "Roaming"),
        appName,
      );
    case "darwin":
      return fs.joinPath(home, "Library", "Application Support", appName);
    default:
      return fs.joinPath(home, ".config", appName);
  }
}

/** Claude Code: detected by ~/.claude/ directory, configured via `claude` CLI */
const claudeCode: AgentDefinition = {
  name: "Claude Code",
  id: "claude-code",
  setupMethod: "cli",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".claude")],
  getSetupConfig: () => ({
    method: "cli",
    command: "claude",
    args: [
      "mcp",
      "add",
      "--transport",
      "http",
      "GitHits",
      "--scope",
      "user",
      getMcpUrl(),
    ],
  }),
};

/** Cursor: detected by ~/.cursor/ directory, configured via mcp.json */
const cursor: AgentDefinition = {
  name: "Cursor",
  id: "cursor",
  setupMethod: "config-file",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".cursor")],
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(fs.getHomeDir(), ".cursor", "mcp.json"),
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: mcpRemoteConfig(getMcpUrl()),
  }),
};

/**
 * Windsurf: detected by ~/.codeium/windsurf/ directory.
 * Config path is ~/.codeium/windsurf/mcp_config.json on all platforms
 * (per official Windsurf docs: https://docs.windsurf.com/windsurf/cascade/mcp).
 */
const windsurf: AgentDefinition = {
  name: "Windsurf",
  id: "windsurf",
  setupMethod: "config-file",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".codeium", "windsurf")],
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(
      fs.getHomeDir(),
      ".codeium",
      "windsurf",
      "mcp_config.json",
    ),
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: mcpRemoteConfig(getMcpUrl()),
  }),
};

/** Claude Desktop: detected by platform-specific Claude directory */
const claudeDesktop: AgentDefinition = {
  name: "Claude Desktop",
  id: "claude-desktop",
  setupMethod: "config-file",
  detectPaths: (fs) => {
    const appData = getAppDataPath(fs, "Claude");
    return [appData];
  },
  getSetupConfig: (fs) => {
    const appData = getAppDataPath(fs, "Claude");
    return {
      method: "config-file",
      configPath: fs.joinPath(appData, "claude_desktop_config.json"),
      serversKey: "mcpServers",
      serverName: "GitHits",
      serverConfig: mcpRemoteConfig(getMcpUrl()),
    };
  },
};

/** Codex CLI: detected by ~/.codex/ directory, configured via `codex` CLI */
const codexCli: AgentDefinition = {
  name: "Codex CLI",
  id: "codex-cli",
  setupMethod: "cli",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".codex")],
  getSetupConfig: () => ({
    method: "cli",
    command: "codex",
    args: ["mcp", "add", "GitHits", "--url", getMcpUrl()],
  }),
};

/**
 * All supported agent definitions, ordered by popularity/likelihood.
 * New agents should be added here.
 */
export const agentDefinitions: AgentDefinition[] = [
  claudeCode,
  cursor,
  windsurf,
  claudeDesktop,
  codexCli,
];

/**
 * Detect which agents are installed by checking if their detection paths exist.
 * Returns the IDs of agents whose directories were found.
 */
export async function detectAgents(
  definitions: AgentDefinition[],
  fs: FileSystemService,
): Promise<string[]> {
  const detected: string[] = [];
  for (const agent of definitions) {
    const paths = agent.detectPaths(fs);
    for (const path of paths) {
      if (await fs.isDirectory(path)) {
        detected.push(agent.id);
        break;
      }
    }
  }
  return detected;
}

/**
 * Build checkbox choices for the agent selection prompt.
 * Detected agents are pre-checked.
 */
export function buildCheckboxChoices(
  definitions: AgentDefinition[],
  detectedIds: string[],
): { name: string; value: string; checked: boolean }[] {
  return definitions.map((agent) => ({
    name: detectedIds.includes(agent.id)
      ? `${agent.name}  (detected)`
      : agent.name,
    value: agent.id,
    checked: detectedIds.includes(agent.id),
  }));
}
