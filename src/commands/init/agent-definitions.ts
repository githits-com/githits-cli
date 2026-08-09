import { DEFAULT_MCP_URL } from "@githits/core-internal";
import type { ExecService } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import { traceInit, traceProbeEnd, traceProbeStart } from "./init-trace.js";
import {
  type CliCheckCommand,
  isSetupAlreadyConfigured,
} from "./setup-handlers.js";

/** A single CLI command step (command + arguments). */
export interface CliCommand {
  /** Command to execute (e.g., "claude") */
  command: string;
  /** Command arguments */
  args: string[];
  /** Treat a recognized already-absent result as success during replacement. */
  allowAlreadyAbsent?: boolean;
}

export type NonEmptyCliCommands = [CliCommand, ...CliCommand[]];

/**
 * Setup configuration for agents that use CLI commands.
 * Supports multi-step installs (e.g., legacy cleanup followed by MCP add).
 */
export interface CliSetup {
  method: "cli";
  /** One or more commands to execute sequentially */
  commands: CliCommand[];
  /** Optional read-only command to check if already configured before setup. */
  checkCommand?: CliCheckCommand;
}

/**
 * Uninstall configuration for agents that remove GitHits via CLI commands.
 */
export interface CliUninstall {
  method: "cli";
  /** One or more commands to execute sequentially */
  commands: NonEmptyCliCommands;
}

/** Uninstall made from multiple existing uninstall primitives. */
export interface CompositeUninstall {
  method: "composite";
  /** Ordered uninstall steps. Required steps fail the uninstall; best-effort steps warn after earlier removals. */
  steps: CompositeUninstallStep[];
}

export interface CompositeUninstallStep {
  step: UninstallStep;
  failureMode: "required" | "best-effort";
}

export type ConfigFileFormat = "json" | "yaml" | "toml";

export type InitSetupScope = "user" | "project";

/**
 * Setup configuration for agents that need config file editing.
 */
export interface ConfigFileSetup {
  method: "config-file";
  /** Absolute path to the config file */
  configPath: string;
  /** Config file format. Omitted means JSON/JSONC for backward compatibility. */
  format?: ConfigFileFormat;
  /** Key in the config where MCP servers live (e.g., "mcpServers") */
  serversKey: string;
  /** Server name to add */
  serverName: string;
  /** Server config value to add */
  serverConfig: Record<string, unknown>;
}

/** Setup for copying a packaged Agent Skill into a user/project skill folder. */
export interface SkillSetup {
  method: "skill";
  /** Skill display/name identifier, e.g. githits-mcp. */
  skillName: string;
  /** Absolute path to the packaged SKILL.md source. */
  sourcePath: string;
  /** Alternate absolute paths for source and bundled runtimes. */
  sourcePathCandidates?: string[];
  /** Absolute target path for the installed SKILL.md file. */
  targetPath: string;
}

/** Setup for a small managed text block inside an agent instruction file. */
export interface ManagedBlockSetup {
  method: "managed-block";
  /** Absolute path to the instruction file. */
  targetPath: string;
  /** Optional file header kept before the GitHits-managed block. */
  fileHeader?: string;
  /** Marker used for both opening and closing lines. */
  marker: string;
  /** Body text written between marker lines. */
  blockContent: string;
}

/** A setup made from multiple existing setup primitives. */
export interface CompositeSetup {
  method: "composite";
  /** Ordered setup steps. Later steps only run when earlier steps succeed. */
  steps: SetupStep[];
}

export type SetupStep =
  | CliSetup
  | ConfigFileSetup
  | SkillSetup
  | ManagedBlockSetup;
export type SetupConfig = SetupStep | CompositeSetup;

export type UninstallStep =
  | CliUninstall
  | ConfigFileSetup
  | SkillSetup
  | ManagedBlockSetup;
export type UninstallConfig = UninstallStep | CompositeUninstall;

export const GITHITS_SERVER_NAME = "GitHits";
const GITHITS_MCP_COMMAND = "npx";
const GITHITS_MCP_ARGS = ["-y", "githits@latest", "mcp", "start"] as const;
/** The canonical GitHits MCP launch invocation, e.g. for setup summaries. */
export const GITHITS_MCP_INVOCATION = [
  GITHITS_MCP_COMMAND,
  ...GITHITS_MCP_ARGS,
] as const;
const CLAUDE_GITHITS_PLUGIN = "githits";
const CLAUDE_GITHITS_MARKETPLACE = "githits-plugins";
const BINARY_LOOKUP_TIMEOUT_MS = 2_000;
const GLOBAL_BIN_PROBE_TIMEOUT_MS = 3_000;

/** How an agent is considered present on the machine. */
type DetectionMethod = "binary" | "path" | "hybrid";

interface ResolvedAgentCommand {
  command: string;
}

export interface AgentSetupContext {
  command?: string;
}

export type ProjectSetupSupport =
  | {
      supported: true;
      getSetupConfig: (
        fs: FileSystemService,
        context?: AgentSetupContext,
      ) => SetupConfig;
    }
  | {
      supported: false;
      reason: string;
    };

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
  /** User-level setup support override for project-only agents. */
  userSetup?: ProjectSetupSupport;
  /** Project-local MCP setup support, when the agent auto-loads repository config. */
  projectSetup?: ProjectSetupSupport;
  /** Setup config resolved during scan, including any detected command path. */
  resolvedSetupConfig?: SetupConfig;
  /** Returns CLI uninstall config when the agent cannot be removed via config editing. */
  getUninstallConfig?: (
    fs: FileSystemService,
    context?: AgentSetupContext,
  ) => UninstallConfig;
  /** Setup context resolved during scan, including any detected command path. */
  resolvedSetupContext?: AgentSetupContext;
  /** Uninstall config resolved during uninstall scan for special cases. */
  resolvedUninstallConfig?: UninstallConfig;
  /** Skip generic scan-based verification when uninstall scan used config-only fallback cleanup. */
  skipUninstallVerification?: boolean;
}

/**
 * Returns platform-specific application data directory path.
 * macOS: ~/Library/Application Support/<app>
 * Windows: %APPDATA%/<app>
 * Linux: ~/.config/<app>
 */
function getAppDataPath(fs: FileSystemService, appName: string): string {
  const platform = fs.platform ?? process.platform;
  const home = fs.getHomeDir();
  switch (platform) {
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
  const platform = fs.platform ?? process.platform;
  const home = fs.getHomeDir();
  switch (platform) {
    case "win32":
      return process.env.APPDATA ?? fs.joinPath(home, "AppData", "Roaming");
    case "darwin":
      return fs.joinPath(home, "Library", "Application Support");
    default:
      return process.env.XDG_DATA_HOME ?? fs.joinPath(home, ".local", "share");
  }
}

function getOpenCodeConfigDir(fs: FileSystemService): string {
  const platform = fs.platform ?? process.platform;
  if (platform === "win32") {
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

function getHermesHomeDir(fs: FileSystemService): string {
  const configuredDir = process.env.HERMES_HOME?.trim();
  if (configuredDir) {
    return expandHomePath(fs, configuredDir);
  }
  return fs.joinPath(fs.getHomeDir(), ".hermes");
}

function getHermesConfigPath(fs: FileSystemService): string {
  return fs.joinPath(getHermesHomeDir(fs), "config.yaml");
}

export function getStandardMcpServerConfig(): Record<string, unknown> {
  return {
    command: GITHITS_MCP_COMMAND,
    args: [...GITHITS_MCP_ARGS],
  };
}

function getRemoteMcpServerConfig(): Record<string, unknown> {
  return { url: DEFAULT_MCP_URL };
}

function getVsCodeMcpServerConfig(): Record<string, unknown> {
  return {
    type: "stdio",
    ...getStandardMcpServerConfig(),
  };
}

function getLocalCommandArrayMcpServerConfig(): Record<string, unknown> {
  return {
    type: "local",
    command: [...GITHITS_MCP_INVOCATION],
    enabled: true,
  };
}

function getZedMcpServerConfig(): Record<string, unknown> {
  return {
    source: "custom",
    command: {
      path: GITHITS_MCP_COMMAND,
      args: [...GITHITS_MCP_ARGS],
    },
  };
}

function getProjectPath(fs: FileSystemService): string {
  return fs.getCwd();
}

function getProjectJsonConfig(
  fs: FileSystemService,
  relativePath: string[],
  serversKey: string,
  serverConfig: Record<string, unknown> = getStandardMcpServerConfig(),
): ConfigFileSetup {
  return {
    method: "config-file",
    configPath: fs.joinPath(getProjectPath(fs), ...relativePath),
    serversKey,
    serverName: GITHITS_SERVER_NAME,
    serverConfig,
  };
}

function getUnsupportedProjectSetup(reason: string): ProjectSetupSupport {
  return { supported: false, reason };
}

export function getAgentSetupConfig(
  agent: AgentDefinition,
  fs: FileSystemService,
  scope: InitSetupScope = "user",
  context?: AgentSetupContext,
): SetupConfig | null {
  if (scope === "user" && agent.userSetup) {
    if (agent.userSetup.supported) {
      return agent.userSetup.getSetupConfig(fs, context);
    }
    return null;
  }
  if (scope === "project") {
    if (agent.projectSetup?.supported) {
      return agent.projectSetup.getSetupConfig(fs, context);
    }
    return null;
  }
  return agent.getSetupConfig(fs, context);
}

export function getProjectSetupUnsupportedReason(
  agent: AgentDefinition,
): string | null {
  if (agent.projectSetup?.supported) {
    return null;
  }
  return agent.projectSetup?.reason ?? "project-level MCP config not verified";
}

function getUserJsonConfig(
  fs: FileSystemService,
  relativePath: string[],
  serversKey: string,
  serverConfig: Record<string, unknown> = getStandardMcpServerConfig(),
): ConfigFileSetup {
  return {
    method: "config-file",
    configPath: fs.joinPath(fs.getHomeDir(), ...relativePath),
    serversKey,
    serverName: GITHITS_SERVER_NAME,
    serverConfig,
  };
}

export function getSetupUnsupportedReason(
  agent: AgentDefinition,
  scope: InitSetupScope,
): string | null {
  if (scope === "user" && agent.userSetup) {
    return agent.userSetup.supported ? null : agent.userSetup.reason;
  }
  return getProjectSetupUnsupportedReason(agent);
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
    const platform = exec.platform ?? process.platform;
    const lookupCommand = platform === "win32" ? "where" : "which";
    const result = await exec.exec(lookupCommand, [executable], {
      timeoutMs: BINARY_LOOKUP_TIMEOUT_MS,
    });
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

function getPiExecutableNames(
  platform: NodeJS.Platform = process.platform,
): string[] {
  return platform === "win32" ? ["pi.cmd", "pi.exe", "pi"] : ["pi"];
}

async function runGlobalBinProbe(
  exec: ExecService,
  probe: PiGlobalBinProbe,
): Promise<string | null> {
  const platform = exec.platform ?? process.platform;
  try {
    const result = await exec.exec(probe.command, [...probe.args], {
      timeoutMs: GLOBAL_BIN_PROBE_TIMEOUT_MS,
    });
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
    if (probe.output === "prefix" && platform !== "win32") {
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
  const platform = exec.platform ?? fs.platform ?? process.platform;
  if (await resolveExecutableFromPath(exec, "pi")) {
    return { command: "pi" };
  }

  for (const probe of PI_GLOBAL_BIN_PROBES) {
    const binDir = await runGlobalBinProbe(exec, probe);
    if (!binDir) {
      continue;
    }
    for (const executableName of getPiExecutableNames(platform)) {
      const candidate = fs.joinPath(binDir, executableName);
      if (await fs.exists(candidate)) {
        return { command: candidate };
      }
    }
  }

  return null;
}

async function detectAmazonQCommand(
  exec: ExecService,
): Promise<ResolvedAgentCommand | null> {
  if (await resolveExecutableFromPath(exec, "q")) {
    return { command: "q" };
  }
  if (await resolveExecutableFromPath(exec, "qchat")) {
    return { command: "qchat" };
  }
  return null;
}

/** Claude Code: detected by claude executable, configured via npm/stdio. */
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
        args: ["plugin", "uninstall", CLAUDE_GITHITS_PLUGIN],
        allowAlreadyAbsent: true,
      },
      {
        command: "claude",
        args: ["plugin", "marketplace", "remove", CLAUDE_GITHITS_MARKETPLACE],
        allowAlreadyAbsent: true,
      },
      {
        command: "claude",
        args: ["mcp", "remove", "githits", "--scope", "user"],
        allowAlreadyAbsent: true,
      },
      {
        command: "claude",
        args: [
          "mcp",
          "add",
          "--transport",
          "stdio",
          "--scope",
          "user",
          "githits",
          "--",
          ...GITHITS_MCP_INVOCATION,
        ],
      },
    ],
    checkCommand: {
      command: "claude",
      args: ["mcp", "list"],
      configuredPattern:
        /^\s*githits\b[^\r\n]*\bnpx\b[^\r\n]*\bgithits@latest\b/im,
    },
  }),
  getUninstallConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "claude",
        args: ["mcp", "remove", "githits", "--scope", "user"],
      },
      {
        command: "claude",
        args: ["plugin", "uninstall", CLAUDE_GITHITS_PLUGIN],
        allowAlreadyAbsent: true,
      },
      {
        command: "claude",
        args: ["plugin", "marketplace", "remove", CLAUDE_GITHITS_MARKETPLACE],
        allowAlreadyAbsent: true,
      },
    ],
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".mcp.json"], "mcpServers"),
  },
};

/** Cursor: detected by ~/.cursor/ directory, configured via remote MCP */
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
    serverConfig: getRemoteMcpServerConfig(),
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(
        fs,
        [".cursor", "mcp.json"],
        "mcpServers",
        getRemoteMcpServerConfig(),
      ),
  },
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
    serverConfig: getStandardMcpServerConfig(),
  }),
  projectSetup: getUnsupportedProjectSetup(
    "project-level MCP config not verified for Windsurf",
  ),
};

/** Claude Desktop: detected by platform-specific Claude directory, uses npm MCP command */
const claudeDesktop: AgentDefinition = {
  name: "Claude Desktop",
  id: "claude-desktop",
  detectionMethod: "path",
  setupMethod: "config-file",
  detectPaths: (fs) => {
    const platform = fs.platform ?? process.platform;
    const appData = getAppDataPath(fs, "Claude");
    if (platform === "win32") {
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
      serverConfig: getStandardMcpServerConfig(),
    };
  },
  projectSetup: getUnsupportedProjectSetup(
    "Claude Desktop uses user-level desktop config",
  ),
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
      configuredPattern: /^\s*githits\b/im,
    },
  }),
  getUninstallConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "codex",
        args: ["mcp", "remove", "githits"],
      },
    ],
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) => ({
      method: "config-file",
      format: "toml",
      configPath: fs.joinPath(getProjectPath(fs), ".codex", "config.toml"),
      serversKey: "mcp_servers",
      serverName: "githits",
      serverConfig: getStandardMcpServerConfig(),
    }),
  },
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
            ...getStandardMcpServerConfig(),
            lifecycle: "eager",
          },
        },
      ],
    };
  },
  getUninstallConfig: (fs, context) => {
    const piCommand = context?.command ?? "pi";
    return {
      method: "composite",
      steps: [
        {
          failureMode: "required",
          step: {
            method: "config-file",
            configPath: getPiMcpConfigPath(fs),
            serversKey: "mcpServers",
            serverName: GITHITS_SERVER_NAME,
            // Config-file uninstall ignores serverConfig; keep the shape shared.
            serverConfig: {},
          },
        },
        {
          failureMode: "required",
          step: {
            method: "cli",
            commands: [
              {
                command: piCommand,
                args: ["remove", "npm:pi-mcp-adapter"],
              },
            ],
          },
        },
      ],
    };
  },
  projectSetup: {
    supported: true,
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
          // Project .mcp.json is shared with Claude Code and Pi's adapter, so
          // keep it to the standard MCP shape instead of Pi's eager lifecycle.
          getProjectJsonConfig(fs, [".mcp.json"], "mcpServers"),
        ],
      };
    },
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
      serverConfig: getVsCodeMcpServerConfig(),
    };
  },
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(
        fs,
        [".vscode", "mcp.json"],
        "servers",
        getVsCodeMcpServerConfig(),
      ),
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
    serverConfig: getStandardMcpServerConfig(),
  }),
  projectSetup: getUnsupportedProjectSetup(
    "Cline MCP settings are documented as user-level config; project MCP auto-load not verified",
  ),
};

/** Gemini CLI: detected by gemini executable, configured via npm/stdio. */
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
        args: ["extensions", "uninstall", "githits"],
        allowAlreadyAbsent: true,
      },
      {
        command: "gemini",
        args: ["mcp", "remove", "--scope", "user", "githits"],
        allowAlreadyAbsent: true,
      },
      {
        command: "gemini",
        args: [
          "mcp",
          "add",
          "--transport",
          "stdio",
          "--scope",
          "user",
          "githits",
          GITHITS_MCP_INVOCATION[0],
          "--",
          ...GITHITS_MCP_INVOCATION.slice(1),
        ],
      },
    ],
    checkCommand: {
      command: "gemini",
      args: ["mcp", "list"],
      requireExitCodeZero: true,
      configuredPattern:
        /^\s*(?:[^\w\s]+\s+)?githits\b[^\r\n]*\bnpx\b[^\r\n]*\bgithits@latest\b/im,
    },
  }),
  getUninstallConfig: () => ({
    method: "cli",
    commands: [
      {
        command: "gemini",
        args: ["mcp", "remove", "--scope", "user", "githits"],
      },
      {
        command: "gemini",
        args: ["extensions", "uninstall", "githits"],
        allowAlreadyAbsent: true,
      },
    ],
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".gemini", "settings.json"], "mcpServers"),
  },
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
      "config",
      "mcp_config.json",
    ),
    serversKey: "mcpServers",
    serverName: GITHITS_SERVER_NAME,
    serverConfig: getStandardMcpServerConfig(),
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".agents", "mcp_config.json"], "mcpServers"),
  },
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
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, ["opencode.json"], "mcp", {
        type: "local",
        command: [...GITHITS_MCP_INVOCATION],
        enabled: true,
      }),
  },
};

/** Hermes Agent: detected by hermes-agent executable or ~/.hermes, configured via YAML MCP config */
const hermesAgent: AgentDefinition = {
  name: "Hermes Agent",
  id: "hermes-agent",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectPaths: (fs) => [getHermesHomeDir(fs)],
  // Probe hermes-agent specifically to avoid false positives from other
  // toolchains that ship a generic `hermes` binary (e.g., Facebook Hermes).
  detectBinary: async (exec) => isExecutableAvailable(exec, "hermes-agent"),
  getSetupConfig: (fs) => ({
    method: "config-file",
    format: "yaml",
    configPath: getHermesConfigPath(fs),
    serversKey: "mcp_servers",
    serverName: GITHITS_SERVER_NAME,
    serverConfig: getStandardMcpServerConfig(),
  }),
  projectSetup: getUnsupportedProjectSetup(
    "Hermes Agent project-level MCP config not verified",
  ),
};

/** Zed: detected by zed executable or config directory, configured via context_servers */
const zed: AgentDefinition = {
  name: "Zed",
  id: "zed",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "zed"),
  detectPaths: (fs) => [
    fs.joinPath(fs.getHomeDir(), ".config", "zed"),
    fs.joinPath(fs.getHomeDir(), ".zed"),
  ],
  getSetupConfig: (fs) => ({
    method: "config-file",
    configPath: fs.joinPath(fs.getHomeDir(), ".config", "zed", "settings.json"),
    serversKey: "context_servers",
    serverName: GITHITS_SERVER_NAME,
    serverConfig: getZedMcpServerConfig(),
  }),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(
        fs,
        [".zed", "settings.json"],
        "context_servers",
        getZedMcpServerConfig(),
      ),
  },
};

/** Junie: detected by CLI/config directory, configured via MCP JSON */
const junie: AgentDefinition = {
  name: "Junie",
  id: "junie",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "junie"),
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".junie")],
  getSetupConfig: (fs) =>
    getUserJsonConfig(fs, [".junie", "mcp", "mcp.json"], "mcpServers"),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".junie", "mcp", "mcp.json"], "mcpServers"),
  },
};

/** Qwen Code: detected by qwen executable or config directory */
const qwenCode: AgentDefinition = {
  name: "Qwen Code",
  id: "qwen-code",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "qwen"),
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".qwen")],
  getSetupConfig: (fs) =>
    getUserJsonConfig(fs, [".qwen", "settings.json"], "mcpServers"),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".qwen", "settings.json"], "mcpServers"),
  },
};

/** Kiro: detected by kiro executable or config directory */
const kiro: AgentDefinition = {
  name: "Kiro",
  id: "kiro",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "kiro"),
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".kiro")],
  getSetupConfig: (fs) =>
    getUserJsonConfig(fs, [".kiro", "settings", "mcp.json"], "mcpServers"),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".kiro", "settings", "mcp.json"], "mcpServers"),
  },
};

/** Kilo Code: detected by kilo executable or config directory */
const kiloCode: AgentDefinition = {
  name: "Kilo Code",
  id: "kilo-code",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "kilo"),
  detectPaths: (fs) => [
    fs.joinPath(fs.getHomeDir(), ".config", "kilo"),
    fs.joinPath(getUserDataRoot(fs), "kilo"),
  ],
  getSetupConfig: (fs) =>
    getUserJsonConfig(
      fs,
      [".config", "kilo", "kilo.jsonc"],
      "mcp",
      getLocalCommandArrayMcpServerConfig(),
    ),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(
        fs,
        [".kilo", "kilo.jsonc"],
        "mcp",
        getLocalCommandArrayMcpServerConfig(),
      ),
  },
};

/** Factory Droid: detected by droid executable or config directory */
const factoryDroid: AgentDefinition = {
  name: "Factory Droid",
  id: "factory-droid",
  detectionMethod: "hybrid",
  setupMethod: "config-file",
  detectBinary: async (exec) => isExecutableAvailable(exec, "droid"),
  detectPaths: (fs) => [fs.joinPath(fs.getHomeDir(), ".factory")],
  getSetupConfig: (fs) =>
    getUserJsonConfig(fs, [".factory", "mcp.json"], "mcpServers"),
  projectSetup: {
    supported: true,
    getSetupConfig: (fs) =>
      getProjectJsonConfig(fs, [".factory", "mcp.json"], "mcpServers"),
  },
};

/** Amazon Q CLI: detected by q/qchat executable, configured through the CLI */
const amazonQCli: AgentDefinition = {
  name: "Amazon Q CLI",
  id: "amazon-q-cli",
  detectionMethod: "binary",
  setupMethod: "cli",
  detectCommand: async (exec) => detectAmazonQCommand(exec),
  getSetupConfig: (_fs, context) => {
    const command = context?.command ?? "q";
    return {
      method: "cli",
      commands: [
        {
          command,
          args: [
            "mcp",
            "add",
            "--name",
            "githits",
            "--command",
            GITHITS_MCP_INVOCATION[0]!,
            "--args",
            JSON.stringify(GITHITS_MCP_INVOCATION.slice(1)),
          ],
        },
      ],
      checkCommand: {
        command,
        args: ["mcp", "list"],
        configuredPattern: /githits/i,
      },
    };
  },
  getUninstallConfig: (_fs, context) => ({
    method: "cli",
    commands: [
      {
        command: context?.command ?? "q",
        args: ["mcp", "remove", "githits"],
      },
    ],
  }),
  projectSetup: getUnsupportedProjectSetup(
    "Amazon Q CLI project-level MCP config not verified",
  ),
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
  hermesAgent,
  zed,
  junie,
  qwenCode,
  kiro,
  kiloCode,
  factoryDroid,
  amazonQCli,
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
  /** Detected but not supported for the selected setup scope. */
  unsupported: Array<{ agent: AgentDefinition; reason: string }>;
}

export interface ScanProgress {
  completed: number;
  total: number;
  agent: AgentDefinition;
}

export interface ScanAgentsOptions {
  onProgress?: (progress: ScanProgress) => void;
  scope?: InitSetupScope;
}

type AgentScanOutcome =
  | { status: "needs_setup"; agent: AgentDefinition }
  | { status: "already_configured"; agent: AgentDefinition }
  | { status: "not_detected"; agent: AgentDefinition }
  | { status: "unsupported"; agent: AgentDefinition; reason: string };

async function scanSingleAgent(
  agent: AgentDefinition,
  fs: FileSystemService,
  execService: ExecService,
  scope: InitSetupScope,
): Promise<AgentScanOutcome> {
  const scanStartedAt = Date.now();
  traceInit(`agent:start agent=${agent.id} scope=${scope}`);
  // Check if available using the agent's declared detection contract.
  let detected = false;
  let setupContext: AgentSetupContext | undefined;

  if (agent.detectCommand) {
    const startedAt = Date.now();
    try {
      traceProbeStart({ agentId: agent.id, phase: "detectCommand" });
      const resolvedCommand = await agent.detectCommand(execService, fs);
      traceProbeEnd({
        agentId: agent.id,
        phase: "detectCommand",
        startedAt,
        status: "end",
      });
      if (resolvedCommand) {
        detected = true;
        setupContext = { command: resolvedCommand.command };
      }
    } catch {
      traceProbeEnd({
        agentId: agent.id,
        phase: "detectCommand",
        startedAt,
        status: "error",
      });
      detected = false;
    }
  } else if (agent.detectionMethod === "binary" && agent.detectBinary) {
    const startedAt = Date.now();
    try {
      traceProbeStart({ agentId: agent.id, phase: "binary" });
      detected = await agent.detectBinary(execService);
      traceProbeEnd({
        agentId: agent.id,
        phase: "binary",
        startedAt,
        status: "end",
      });
    } catch {
      traceProbeEnd({
        agentId: agent.id,
        phase: "binary",
        startedAt,
        status: "error",
      });
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
      const startedAt = Date.now();
      try {
        traceProbeStart({ agentId: agent.id, phase: "binary" });
        binaryDetected = await agent.detectBinary(execService);
        traceProbeEnd({
          agentId: agent.id,
          phase: "binary",
          startedAt,
          status: "end",
        });
      } catch {
        traceProbeEnd({
          agentId: agent.id,
          phase: "binary",
          startedAt,
          status: "error",
        });
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
    traceInit(
      `agent:end agent=${agent.id} status=not_detected elapsedMs=${Date.now() - scanStartedAt}`,
    );
    return { status: "not_detected", agent };
  }

  const config = getAgentSetupConfig(agent, fs, scope, setupContext);
  if (!config) {
    return {
      status: "unsupported",
      agent,
      reason:
        getSetupUnsupportedReason(agent, scope) ??
        `${scope}-level MCP config not verified`,
    };
  }
  const scannedAgent: AgentDefinition = {
    ...agent,
    resolvedSetupConfig: config,
    resolvedSetupContext: setupContext,
  };
  const configured = await isSetupAlreadyConfigured(config, fs, execService, {
    agentId: agent.id,
    phase: "check",
  });
  if (configured) {
    traceInit(
      `agent:end agent=${agent.id} status=already_configured elapsedMs=${Date.now() - scanStartedAt}`,
    );
    return { status: "already_configured", agent: scannedAgent };
  }
  traceInit(
    `agent:end agent=${agent.id} status=needs_setup elapsedMs=${Date.now() - scanStartedAt}`,
  );
  return { status: "needs_setup", agent: scannedAgent };
}

/**
 * Scan all agents: detect availability and check configuration status.
 * Config-file agents get a pre-check via isAlreadyConfigured().
 * CLI agents with a checkCommand get a pre-check via isCliAlreadyConfigured().
 * CLI agents without a checkCommand are treated as needsSetup.
 * Agent probes run in parallel while output order remains definition order.
 */
export async function scanAgents(
  definitions: AgentDefinition[],
  fs: FileSystemService,
  execService: ExecService,
  options: ScanAgentsOptions = {},
): Promise<ScanResult> {
  const result: ScanResult = {
    needsSetup: [],
    alreadyConfigured: [],
    notDetected: [],
    unsupported: [],
  };
  let completed = 0;
  const startedAt = Date.now();
  traceInit(
    `scan:start scope=${options.scope ?? "user"} total=${definitions.length}`,
  );

  const outcomes = await Promise.all(
    definitions.map((agent) =>
      scanSingleAgent(agent, fs, execService, options.scope ?? "user").then(
        (outcome) => {
          completed += 1;
          options.onProgress?.({
            completed,
            total: definitions.length,
            agent: outcome.agent,
          });
          return outcome;
        },
      ),
    ),
  );

  for (const outcome of outcomes) {
    if (outcome.status === "already_configured") {
      result.alreadyConfigured.push(outcome.agent);
    } else if (outcome.status === "needs_setup") {
      result.needsSetup.push(outcome.agent);
    } else if (outcome.status === "unsupported") {
      result.unsupported.push({
        agent: outcome.agent,
        reason: outcome.reason,
      });
    } else {
      result.notDetected.push(outcome.agent);
    }
  }

  traceInit(`scan:end elapsedMs=${Date.now() - startedAt}`);
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
