import type { ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/index.js";
import {
  type CliCheckCommand,
  getCliCheckStatus,
  isSetupAlreadyConfigured,
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

/** A setup made from multiple existing setup primitives. */
export interface CompositeSetup {
  method: "composite";
  /** Ordered setup steps. Later steps only run when earlier steps succeed. */
  steps: SetupStep[];
}

export type SetupStep = CliSetup | ConfigFileSetup;
export type SetupConfig = SetupStep | CompositeSetup;

const GITHITS_SERVER_NAME = "GitHits";
const GITHITS_MCP_COMMAND = "npx";
const GITHITS_MCP_ARGS = ["-y", "githits@latest", "mcp", "start"] as const;
const GITHITS_MCP_INVOCATION = [
  GITHITS_MCP_COMMAND,
  ...GITHITS_MCP_ARGS,
] as const;

/** How an agent is considered present on the machine. */
type DetectionMethod = "binary" | "path" | "hybrid";

interface ResolvedAgentCommand {
  command: string;
}

export interface AgentSetupContext {
  command?: string;
}

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
  /** Directories to check for path/hybrid detection. */
  detectPaths?: (fs: FileSystemService) => string[];
  /** Executable detection for binary/hybrid agents. */
  detectBinary?: (exec: ExecService) => Promise<boolean>;
  /** Resolve a runnable command when PATH lookup alone is insufficient. */
  detectCommand?: (
    exec: ExecService,
    fs: FileSystemService,
  ) => Promise<ResolvedAgentCommand | null>;
  /** How this agent is configured */
  setupMethod: "cli" | "config-file" | "composite";
  /** Returns the setup config for this agent. Uses FileSystemService for path resolution. */
  getSetupConfig: (
    fs: FileSystemService,
    context?: AgentSetupContext,
  ) => SetupConfig;
  /** Setup config resolved during scan, including any detected command path. */
  resolvedSetupConfig?: SetupConfig;
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
 * Returns platform-specific user data directory root.
 * macOS: ~/Library/Application Support
 * Windows: %APPDATA% (or ~/AppData/Roaming fallback)
 * Linux: $XDG_DATA_HOME (or ~/.local/share fallback)
 */
function getUserDataRoot(fs: FileSystemService): string {
  const home = fs.getHomeDir();
  switch (process.platform) {
    case "win32":
      return process.env.APPDATA ?? fs.joinPath(home, "AppData", "Roaming");
    case "darwin":
      return fs.joinPath(home, "Library", "Application Support");
    default:
      return process.env.XDG_DATA_HOME ?? fs.joinPath(home, ".local", "share");
  }
}

function getOpenCodeConfigDir(fs: FileSystemService): string {
  if (process.platform === "win32") {
    return fs.joinPath(getUserDataRoot(fs), "opencode");
  }
  return fs.joinPath(fs.getHomeDir(), ".config", "opencode");
}

function expandHomePath(fs: FileSystemService, path: string): string {
  if (path === "~") {
    return fs.getHomeDir();
  }
  if (path.startsWith("~/")) {
    return fs.joinPath(fs.getHomeDir(), path.slice(2));
  }
  return path;
}

function getPiAgentDir(fs: FileSystemService): string {
  const configuredDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (configuredDir) {
    return expandHomePath(fs, configuredDir);
  }
  return fs.joinPath(fs.getHomeDir(), ".pi", "agent");
}

function getPiMcpConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getPiAgentDir(fs), "mcp.json");
}

function getOpenCodeDesktopDetectPaths(fs: FileSystemService): string[] {
  const userDataRoot = getUserDataRoot(fs);
  return [
    fs.joinPath(userDataRoot, "ai.opencode.desktop"),
    fs.joinPath(userDataRoot, "ai.opencode.desktop.beta"),
    fs.joinPath(userDataRoot, "ai.opencode.desktop.dev"),
    getOpenCodeConfigDir(fs),
  ];
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

async function resolveExecutableFromPath(
  exec: ExecService,
  executable: string,
): Promise<boolean> {
  return isExecutableAvailable(exec, executable);
}

const PI_GLOBAL_BIN_PROBES = [
  { command: "npm", args: ["prefix", "-g"], output: "prefix" },
  { command: "pnpm", args: ["bin", "-g"], output: "binDir" },
  { command: "bun", args: ["pm", "bin", "-g"], output: "binDir" },
] as const;

type PiGlobalBinProbe = (typeof PI_GLOBAL_BIN_PROBES)[number];

const PI_ADAPTER_CONFIGURED_PATTERN =
  /(?:^|\s|:)(?:npm:)?pi-mcp-adapter(?:[\s@:]|$)/i;

function getPiExecutableNames(): string[] {
  return process.platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
}

async function runGlobalBinProbe(
  exec: ExecService,
  probe: PiGlobalBinProbe,
): Promise<string | null> {
  try {
    const result = await exec.exec(probe.command, [...probe.args]);
    if (result.exitCode !== 0) {
      return null;
    }
    const probePath = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!probePath) {
      return null;
    }
    if (probe.output === "prefix" && process.platform !== "win32") {
      return fsJoinPathLike(probePath, "bin");
    }
    return probePath;
  } catch {
    return null;
  }
}

function fsJoinPathLike(base: string, child: string): string {
  return base.endsWith("/") ? `${base}${child}` : `${base}/${child}`;
}

async function detectPiExecutable(
  exec: ExecService,
  fs: FileSystemService,
): Promise<ResolvedAgentCommand | null> {
  if (await resolveExecutableFromPath(exec, "pi")) {
    return { command: "pi" };
  }

  for (const probe of PI_GLOBAL_BIN_PROBES) {
    const binDir = await runGlobalBinProbe(exec, probe);
    if (!binDir) {
      continue;
    }
    for (const executableName of getPiExecutableNames()) {
      const candidate = fs.joinPath(binDir, executableName);
      if (await fs.exists(candidate)) {
        return { command: candidate };
      }
    }
  }

  return null;
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

/** Cursor: detected by ~/.cursor/ directory, configured via npm MCP command */
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
    serverName: GITHITS_SERVER_NAME,
    serverConfig: {
      command: GITHITS_MCP_COMMAND,
      args: [...GITHITS_MCP_ARGS],
    },
  }),
};

/**
 * Windsurf: detected by ~/.codeium/windsurf/ directory.
 * Uses npm MCP command.
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
    serverName: GITHITS_SERVER_NAME,
    serverConfig: {
      command: GITHITS_MCP_COMMAND,
      args: [...GITHITS_MCP_ARGS],
    },
  }),
};

/** Claude Desktop: detected by platform-specific Claude directory, uses npm MCP command */
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
      serverName: GITHITS_SERVER_NAME,
      serverConfig: {
        command: GITHITS_MCP_COMMAND,
        args: [...GITHITS_MCP_ARGS],
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
        args: ["mcp", "add", "githits", "--", ...GITHITS_MCP_INVOCATION],
      },
    ],
    checkCommand: {
      command: "codex",
      args: ["mcp", "list"],
      configuredPattern: /githits/i,
    },
  }),
};

/** Pi: detected by pi executable, configured through adapter package + Pi-owned MCP config */
const pi: AgentDefinition = {
  name: "Pi",
  id: "pi",
  detectionMethod: "binary",
  setupMethod: "composite",
  detectCommand: detectPiExecutable,
  getSetupConfig: (fs, context) => {
    const piCommand = context?.command ?? "pi";
    return {
      method: "composite",
      steps: [
        {
          method: "cli",
          commands: [
            {
              command: piCommand,
              args: ["install", "npm:pi-mcp-adapter"],
            },
          ],
          checkCommand: {
            command: piCommand,
            args: ["list"],
            configuredPattern: PI_ADAPTER_CONFIGURED_PATTERN,
          },
        },
        {
          method: "config-file",
          configPath: getPiMcpConfigPath(fs),
          serversKey: "mcpServers",
          serverName: GITHITS_SERVER_NAME,
          serverConfig: {
            command: GITHITS_MCP_COMMAND,
            args: [...GITHITS_MCP_ARGS],
            lifecycle: "eager",
          },
        },
      ],
    };
  },
};

/** VS Code / Copilot: detected by platform-specific Code directory, uses npm MCP command */
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
      serverName: GITHITS_SERVER_NAME,
      serverConfig: {
        command: GITHITS_MCP_COMMAND,
        args: [...GITHITS_MCP_ARGS],
      },
    };
  },
};

/** Cline: detected by ~/.cline/ directory, uses npm MCP command */
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
    serverName: GITHITS_SERVER_NAME,
    serverConfig: {
      command: GITHITS_MCP_COMMAND,
      args: [...GITHITS_MCP_ARGS],
    },
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
          "--consent",
          "https://github.com/githits-com/githits-cli",
        ],
      },
    ],
    checkCommand: {
      command: "gemini",
      args: ["extensions", "config", "githits"],
      // `gemini extensions list` can return empty output in non-interactive
      // environments. `extensions config githits` is a deterministic probe:
      // stderr includes "not installed" when missing.
      notConfiguredPattern: /not installed/i,
      requireExitCodeZero: true,
    },
  }),
};

async function isGeminiExtensionInstalledFromFilesystem(
  fs: FileSystemService,
): Promise<boolean> {
  const extensionManifestPath = fs.joinPath(
    fs.getHomeDir(),
    ".gemini",
    "extensions",
    "githits",
    "gemini-extension.json",
  );
  return fs.exists(extensionManifestPath);
}

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
    serverName: GITHITS_SERVER_NAME,
    serverConfig: {
      command: GITHITS_MCP_COMMAND,
      args: [...GITHITS_MCP_ARGS],
    },
  }),
};

/** OpenCode: detected by CLI binary or desktop/config directories, configured via config file */
const openCode: AgentDefinition = {
  name: "OpenCode",
  id: "opencode",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectPaths: (fs) => getOpenCodeDesktopDetectPaths(fs),
  detectBinary: async (exec) => isExecutableAvailable(exec, "opencode"),
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(getOpenCodeConfigDir(fs), "opencode.json"),
    serversKey: "mcp",
    serverName: GITHITS_SERVER_NAME,
    serverConfig: {
      type: "local",
      command: [...GITHITS_MCP_INVOCATION],
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
  pi,
  geminiCli,
  googleAntigravity,
  openCode,
];

/**
 * Detect agents that expose directory probes (path + hybrid) by checking if
 * their detection directories exist. Binary checks are intentionally skipped
 * here and only performed by scanAgents().
 * @deprecated Use scanAgents() instead, which also checks configuration status.
 */
export async function detectAgents(
  definitions: AgentDefinition[],
  fs: FileSystemService,
): Promise<string[]> {
  const detected: string[] = [];
  for (const agent of definitions) {
    if (
      (agent.detectionMethod !== "path" &&
        agent.detectionMethod !== "hybrid") ||
      !agent.detectPaths
    ) {
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
    let setupContext: AgentSetupContext | undefined;

    if (agent.detectCommand) {
      try {
        const resolvedCommand = await agent.detectCommand(execService, fs);
        if (resolvedCommand) {
          detected = true;
          setupContext = { command: resolvedCommand.command };
        }
      } catch {
        detected = false;
      }
    } else if (agent.detectionMethod === "binary" && agent.detectBinary) {
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
    } else if (agent.detectionMethod === "hybrid") {
      let binaryDetected = false;
      let pathDetected = false;

      if (agent.detectBinary) {
        try {
          binaryDetected = await agent.detectBinary(execService);
        } catch {
          binaryDetected = false;
        }
      }

      if (!binaryDetected && agent.detectPaths) {
        const paths = agent.detectPaths(fs);
        for (const path of paths) {
          if (await fs.isDirectory(path)) {
            pathDetected = true;
            break;
          }
        }
      }

      detected = binaryDetected || pathDetected;
    }

    if (!detected) {
      result.notDetected.push(agent);
      continue;
    }

    // Detected — check configuration status
    const config = agent.getSetupConfig(fs, setupContext);
    const scannedAgent: AgentDefinition = {
      ...agent,
      resolvedSetupConfig: config,
    };
    if (agent.id === "gemini-cli" && config.method === "cli") {
      if (config.checkCommand) {
        const checkStatus = await getCliCheckStatus(
          config.checkCommand,
          execService,
        );
        let configured = checkStatus === "configured";
        // Only use filesystem fallback when the CLI probe itself failed.
        // If Gemini explicitly reports "not installed", do not override it.
        if (!configured && checkStatus === "probe_failed") {
          configured = await isGeminiExtensionInstalledFromFilesystem(fs);
        }
        if (configured) {
          result.alreadyConfigured.push(scannedAgent);
        } else {
          result.needsSetup.push(scannedAgent);
        }
      } else {
        result.needsSetup.push(scannedAgent);
      }
    } else if (await isSetupAlreadyConfigured(config, fs, execService)) {
      result.alreadyConfigured.push(scannedAgent);
    } else {
      result.needsSetup.push(scannedAgent);
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
