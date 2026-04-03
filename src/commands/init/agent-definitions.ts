import { getMcpUrl } from "../../services/config.js";
import type { ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/index.js";
import {
  type CliCheckCommand,
  isAlreadyConfigured,
  isCliAlreadyConfigured,
} from "./setup-handlers.js";

/** A single CLI command step (command + arguments). */
export interface CliCommand {
  /** Command to execute (e.g., "claude") */
  command: string;
  /** Command arguments */
  args: string[];
}

/**
 * Setup configuration for agents that use CLI commands.
 * Supports multi-step installs (e.g., plugin marketplace add + plugin install).
 */
export interface CliSetup {
  method: "cli";
  /** One or more commands to execute sequentially */
  commands: CliCommand[];
  /** Optional read-only command to check if already configured before setup. */
  checkCommand?: CliCheckCommand;
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
  /** Optional binary detection — checked before detectPaths. */
  detectBinary?: (exec: ExecService) => Promise<boolean>;
  /** How this agent is configured */
  setupMethod: "cli" | "config-file";
  /** Returns the setup config for this agent. Uses FileSystemService for path resolution. */
  getSetupConfig: (fs: FileSystemService) => SetupConfig;
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

/** Claude Code: detected by ~/.claude/ directory, configured via plugin install */
const claudeCode: AgentDefinition = {
  name: "Claude Code",
  id: "claude-code",
  setupMethod: "cli",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".claude")],
  getSetupConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "claude",
        args: [
          "plugin",
          "marketplace",
          "add",
          "githits-com/githits-claude-code-plugin",
        ],
      },
      {
        command: "claude",
        args: ["plugin", "install", "githits@githits-plugins"],
      },
    ],
    checkCommand: {
      command: "claude",
      args: ["plugin", "list"],
      configuredPattern: /githits/i,
    },
  }),
};

/** Cursor: detected by ~/.cursor/ directory, configured via mcp.json with native OAuth */
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
    serverConfig: { url: getMcpUrl() },
  }),
};

/**
 * Windsurf: detected by ~/.codeium/windsurf/ directory.
 * Uses native serverUrl (no mcp-remote needed).
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
    serverConfig: { serverUrl: getMcpUrl() },
  }),
};

/** Claude Desktop: detected by platform-specific Claude directory, uses mcp-remote */
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
      serverConfig: {
        command: "npx",
        args: ["-y", "mcp-remote", getMcpUrl()],
      },
    };
  },
};

/** Codex CLI: detected by ~/.codex/ directory, configured via npm/stdio */
const codexCli: AgentDefinition = {
  name: "Codex CLI",
  id: "codex-cli",
  setupMethod: "cli",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".codex")],
  getSetupConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "codex",
        args: [
          "mcp",
          "add",
          "githits",
          "--",
          "npx",
          "-y",
          "githits@latest",
          "mcp",
          "start",
        ],
      },
    ],
    checkCommand: {
      command: "codex",
      args: ["mcp", "list"],
      configuredPattern: /githits/i,
    },
  }),
};

/** VS Code / Copilot: detected by platform-specific Code directory, uses native HTTP */
const vscode: AgentDefinition = {
  name: "VS Code / Copilot",
  id: "vscode",
  setupMethod: "config-file",
  detectPaths: (fs) => {
    const appData = getAppDataPath(fs, "Code");
    return [appData];
  },
  getSetupConfig: (fs) => {
    const appData = getAppDataPath(fs, "Code");
    return {
      method: "config-file",
      configPath: fs.joinPath(appData, "User", "mcp.json"),
      serversKey: "servers",
      serverName: "GitHits",
      serverConfig: { url: getMcpUrl(), type: "http" },
    };
  },
};

/** Cline: detected by ~/.cline/ directory, uses streamable HTTP */
const cline: AgentDefinition = {
  name: "Cline",
  id: "cline",
  setupMethod: "config-file",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".cline")],
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(
      fs.getHomeDir(),
      ".cline",
      "data",
      "settings",
      "cline_mcp_settings.json",
    ),
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: { url: getMcpUrl(), type: "streamableHttp" },
  }),
};

/** Gemini CLI: detected by ~/.gemini/ directory, configured via extensions install */
const geminiCli: AgentDefinition = {
  name: "Gemini CLI",
  id: "gemini-cli",
  setupMethod: "cli",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".gemini")],
  getSetupConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "gemini",
        args: [
          "extensions",
          "install",
          "https://github.com/githits-com/githits-gemini-cli",
        ],
      },
    ],
    checkCommand: {
      command: "gemini",
      args: ["extensions", "list"],
      configuredPattern: /githits/i,
    },
  }),
};

/** Google Antigravity: detected by ~/.gemini/antigravity/ directory */
const googleAntigravity: AgentDefinition = {
  name: "Google Antigravity",
  id: "google-antigravity",
  setupMethod: "config-file",
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".gemini", "antigravity")],
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(
      fs.getHomeDir(),
      ".gemini",
      "antigravity",
      "mcp_config.json",
    ),
    serversKey: "mcpServers",
    serverName: "GitHits",
    serverConfig: { serverUrl: getMcpUrl() },
  }),
};

/** OpenCode: detected by opencode binary on PATH */
const openCode: AgentDefinition = {
  name: "OpenCode",
  id: "opencode",
  setupMethod: "config-file",
  detectPaths: () => [],
  detectBinary: async (exec) => {
    try {
      const cmd = process.platform === "win32" ? "where" : "which";
      const result = await exec.exec(cmd, ["opencode"]);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  },
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(
      fs.getHomeDir(),
      ".config",
      "opencode",
      "opencode.json",
    ),
    serversKey: "mcp",
    serverName: "GitHits",
    serverConfig: {
      type: "local",
      command: ["npx", "-y", "githits@latest", "mcp", "start"],
      enabled: true,
    },
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
  vscode,
  cline,
  claudeDesktop,
  codexCli,
  geminiCli,
  googleAntigravity,
  openCode,
];

/**
 * Detect which agents are installed by checking if their detection paths exist.
 * Returns the IDs of agents whose directories were found.
 * @deprecated Use scanAgents() instead, which also checks configuration status.
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

/** Result of scanning all agents for install and configuration status */
export interface ScanResult {
  /** Detected and not yet configured */
  needsSetup: AgentDefinition[];
  /** Detected and already configured */
  alreadyConfigured: AgentDefinition[];
  /** Not installed */
  notDetected: AgentDefinition[];
}

/**
 * Scan all agents: detect installation and check configuration status.
 * Config-file agents get a pre-check via isAlreadyConfigured().
 * CLI agents with a checkCommand get a pre-check via isCliAlreadyConfigured().
 * CLI agents without a checkCommand are treated as needsSetup.
 */
export async function scanAgents(
  definitions: AgentDefinition[],
  fs: FileSystemService,
  execService: ExecService,
): Promise<ScanResult> {
  const result: ScanResult = {
    needsSetup: [],
    alreadyConfigured: [],
    notDetected: [],
  };

  for (const agent of definitions) {
    // Check if installed — try binary detection first, then directory detection
    let detected = false;

    if (agent.detectBinary) {
      try {
        detected = await agent.detectBinary(execService);
      } catch {
        // Fall through to directory detection
      }
    }

    if (!detected) {
      const paths = agent.detectPaths(fs);
      for (const path of paths) {
        if (await fs.isDirectory(path)) {
          detected = true;
          break;
        }
      }
    }

    if (!detected) {
      result.notDetected.push(agent);
      continue;
    }

    // Detected — check configuration status
    if (agent.setupMethod === "config-file") {
      const config = agent.getSetupConfig(fs);
      if (
        config.method === "config-file" &&
        (await isAlreadyConfigured(config, fs))
      ) {
        result.alreadyConfigured.push(agent);
      } else {
        result.needsSetup.push(agent);
      }
    } else {
      // CLI agent — try checkCommand if available
      const config = agent.getSetupConfig(fs);
      if (config.method === "cli" && config.checkCommand) {
        const configured = await isCliAlreadyConfigured(
          config.checkCommand,
          execService,
        );
        if (configured) {
          result.alreadyConfigured.push(agent);
        } else {
          result.needsSetup.push(agent);
        }
      } else {
        result.needsSetup.push(agent);
      }
    }
  }

  return result;
}

/**
 * Build checkbox choices for the agent selection prompt.
 * Detected agents are pre-checked.
 * @deprecated Use scanAgents() instead, which checks configuration status during detection.
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
