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

/** How an agent is considered present on the machine. */
type DetectionMethod = "binary" | "path";

/**
 * Represents a coding agent that can be configured with GitHits MCP server.
 * Each definition knows how to detect whether the agent is available
 * and how to configure it.
 */
export interface AgentDefinition {
  /** Display name shown to the user (e.g., "Claude Code") */
  name: string;
  /** Unique identifier (e.g., "claude-code") */
  id: string;
  /** Detection contract for the agent. */
  detectionMethod: DetectionMethod;
  /** Directories to check for path-based detection. */
  detectPaths?: (fs: FileSystemService) => string[];
  /** Executable detection for binary-based agents. */
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

/**
 * Detect whether an executable is available on PATH.
 * This is the install signal for CLI-configured agents.
 */
async function isExecutableAvailable(
  exec: ExecService,
  executable: string,
): Promise<boolean> {
  try {
    const lookupCommand = process.platform === "win32" ? "where" : "which";
    const result = await exec.exec(lookupCommand, [executable]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

/** Claude Code: detected by claude executable, configured via plugin install */
const claudeCode: AgentDefinition = {
  name: "Claude Code",
  id: "claude-code",
  detectionMethod: "binary",
  setupMethod: "cli",
  detectBinary: async (exec) => isExecutableAvailable(exec, "claude"),
  getSetupConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "claude",
        args: ["plugin", "marketplace", "add", "githits-com/githits-cli"],
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
  detectionMethod: "path",
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
  detectionMethod: "path",
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
  detectionMethod: "path",
  setupMethod: "config-file",
  detectPaths: (fs) => {
    const appData = getAppDataPath(fs, "Claude");
    if (process.platform === "win32") {
      const home = fs.getHomeDir();
      const localAppData =
        process.env.LOCALAPPDATA ?? fs.joinPath(home, "AppData", "Local");
      return [
        appData,
        fs.joinPath(localAppData, "Claude"),
        fs.joinPath(localAppData, "Programs", "Claude"),
      ];
    }
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

/** Codex CLI: detected by codex executable, configured via npm/stdio */
const codexCli: AgentDefinition = {
  name: "Codex CLI",
  id: "codex-cli",
  detectionMethod: "binary",
  setupMethod: "cli",
  detectBinary: async (exec) => isExecutableAvailable(exec, "codex"),
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
  detectionMethod: "path",
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
  detectionMethod: "path",
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

/** Gemini CLI: detected by gemini executable, configured via extensions install */
const geminiCli: AgentDefinition = {
  name: "Gemini CLI",
  id: "gemini-cli",
  detectionMethod: "binary",
  setupMethod: "cli",
  detectBinary: async (exec) => isExecutableAvailable(exec, "gemini"),
  getSetupConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "gemini",
        args: [
          "extensions",
          "install",
          "https://github.com/githits-com/githits-cli",
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
  detectionMethod: "path",
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

/** OpenCode: detected by opencode executable, configured via config file */
const openCode: AgentDefinition = {
  name: "OpenCode",
  id: "opencode",
  detectionMethod: "binary",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "opencode"),
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath:
      process.platform === "win32"
        ? fs.joinPath(
            process.env.APPDATA ??
              fs.joinPath(fs.getHomeDir(), "AppData", "Roaming"),
            "opencode",
            "opencode.json",
          )
        : fs.joinPath(fs.getHomeDir(), ".config", "opencode", "opencode.json"),
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
 * @deprecated Use scanAgents() instead, which also checks configuration status.
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
 * Detect which path-based agents are present by checking if their detection
 * directories exist. Binary-based agents are intentionally ignored here.
 * @deprecated Use scanAgents() instead, which also checks configuration status.
 */
export async function detectAgents(
  definitions: AgentDefinition[],
  fs: FileSystemService,
): Promise<string[]> {
  const detected: string[] = [];
  for (const agent of definitions) {
    if (agent.detectionMethod !== "path" || !agent.detectPaths) {
      continue;
    }
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
 * Scan all agents: detect availability and check configuration status.
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
    // Check if available using the agent's declared detection contract
    let detected = false;

    if (agent.detectionMethod === "binary" && agent.detectBinary) {
      try {
        detected = await agent.detectBinary(execService);
      } catch {
        detected = false;
      }
    } else if (agent.detectionMethod === "path" && agent.detectPaths) {
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
