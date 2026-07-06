import { fileURLToPath } from "node:url";
import {
  colorize,
  colorizeBrand,
  colorizeTerminal,
  error as errorFmt,
  shouldUseColors,
  success,
  type TerminalColor,
  warning,
} from "@githits/mcp/internal";
import { ExitPromptError } from "@inquirer/core";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { ExecService } from "../../services/exec-service.js";
import { ExecServiceImpl } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import { FileSystemServiceImpl } from "../../services/filesystem-service.js";
import type {
  CheckboxChoice,
  PromptService,
  SelectChoice,
} from "../../services/prompt-service.js";
import { PromptServiceImpl } from "../../services/prompt-service.js";
import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOutput,
} from "../login.js";
import { loginFlow } from "../login.js";
import {
  type AgentDefinition,
  agentDefinitions,
  type CompositeSetup,
  type ConfigFileSetup,
  GITHITS_MCP_INVOCATION,
  getAgentSetupConfig,
  type InitSetupScope,
  isGeminiExtensionInstalledFromFilesystem,
  type ManagedBlockSetup,
  type ScanProgress,
  type ScanResult,
  type SetupConfig,
  type SetupStep,
  type SkillSetup,
  scanAgents,
} from "./agent-definitions.js";
import {
  GITHITS_GUIDANCE_BLOCK,
  GITHITS_GUIDANCE_MARKER,
  GITHITS_MCP_SKILL_NAME,
  GITHITS_MCP_SKILL_RELATIVE_PATH,
} from "./guidance-assets.js";
import {
  CHANGE_VERB_WIDTH,
  type ChangeRow,
  changeRowColumnWidths,
  describeConfigAsUnchanged,
  formatCliCommand,
  formatConfigPath,
  renderChangeRows,
  type SetupChange,
  type UninstallChange,
} from "./setup-format.js";
import {
  executeCliSetup,
  executeCliUninstall,
  executeCompositeSetup,
  executeCompositeUninstall,
  executeConfigFileSetup,
  executeConfigFileUninstall,
  executeManagedBlockSetup,
  executeManagedBlockUninstall,
  executeSkillSetup,
  executeSkillUninstall,
  getCliCheckStatus,
  getConfigUninstallCheckStatus,
  type SetupResult,
} from "./setup-handlers.js";

/** Options for the init command */
export interface InitOptions {
  /** Skip all prompts, configure all detected agents */
  yes?: boolean;
  /** Skip the login step */
  skipLogin?: boolean;
  /** Print the login URL instead of opening a browser */
  browser?: boolean;
  /** Scan supported agents without installing anything */
  detectAgents?: boolean;
  /** Comma-separated agent IDs to install non-interactively */
  installAgents?: string;
  /** Emit machine-readable output for staged non-interactive modes */
  json?: boolean;
  /** Configure project-level MCP for the current directory */
  project?: boolean;
  /** Install supporting GitHits skill and instruction guidance */
  guidance?: boolean;
}

/** Options for the init uninstall command */
export interface InitUninstallOptions {
  /** Skip all prompts, uninstall from all configured agents */
  yes?: boolean;
  /** Remove project-level MCP from the current directory */
  project?: boolean;
  /** Keep GitHits skill and managed instruction guidance */
  keepGuidance?: boolean;
}

interface InitLoginDependencies extends LoginDependencies {
  hasValidToken?: boolean;
}

/** Dependencies for the init command */
export interface InitDependencies {
  fileSystemService: FileSystemService;
  promptService: PromptService;
  execService: ExecService;
  /** Factory to create auth deps for the login step. Omit to skip login. */
  createLoginDeps?: () => Promise<InitLoginDependencies>;
  /** Whether this invocation can safely prompt on stdin/stdout. */
  isInteractive?: boolean;
}

/** Tracks per-agent setup outcome for the summary */
interface AgentOutcome {
  id: string;
  name: string;
  status: "success" | "already_configured" | "failed" | "skipped";
  message?: string;
  /** Paths written / commands run, for display and `--json` auditing. */
  changes?: SetupChange[];
}

interface GuidanceOutcome {
  status: "success" | "already_configured" | "failed" | "skipped";
  message?: string;
  changes?: SetupChange[];
}

type StagedAgentStatus =
  | "needs_setup"
  | "already_configured"
  | "unsupported_project_config"
  | "not_detected";

interface StagedAgentEntry {
  id: string;
  name: string;
  status: StagedAgentStatus;
  reason?: string;
}

/** Tracks per-agent uninstall outcome for the summary */
interface AgentUninstallOutcome {
  id: string;
  name: string;
  status: "removed" | "not_configured" | "failed";
  message?: string;
  warnings?: string[];
  /** Paths/commands removed or found already absent, for display. */
  changes?: UninstallChange[];
}

interface GuidanceUninstallOutcome {
  status: "removed" | "not_configured" | "failed" | "skipped";
  message?: string;
  warnings?: string[];
  changes?: UninstallChange[];
}

type UninstallInspectionResult =
  | "configured"
  | "not_configured"
  | { status: "failed"; message: string };

interface CompositeInspectionAccumulator {
  configured: boolean;
  notConfigured: boolean;
  failure?: { status: "failed"; message: string };
}

interface UninstallScanResult {
  configured: (typeof agentDefinitions)[number][];
  notConfigured: (typeof agentDefinitions)[number][];
  notDetected: (typeof agentDefinitions)[number][];
  failed: AgentUninstallOutcome[];
}

interface ProjectUninstallPlan {
  configRemovals: ConfigFileSetup[];
}

interface ProjectUninstallFailure {
  path: string;
  reason: string;
}

interface ProjectUninstallSummary {
  removed: string[];
  legacyRemoved: string[];
  skipped: string[];
  failed: ProjectUninstallFailure[];
}

const PROJECT_CONFIG_ROW_LABEL = "GitHits project config";
const LEGACY_PROJECT_MARKER_ROW_LABEL = "Legacy project setup marker";
const PROJECT_UNINSTALL_LABEL_WIDTH = Math.max(
  PROJECT_CONFIG_ROW_LABEL.length,
  LEGACY_PROJECT_MARKER_ROW_LABEL.length,
);

type InitIntent = "mcp-guided" | "mcp" | "skills" | "later";

type InitScopeChoice = InitSetupScope;

type InitAuthStartChoice = "sign_in" | "skip" | "cancel";

type InitAuthRecoveryChoice = "retry" | "continue_without_auth" | "cancel";

type InitAuthStatus =
  | "authenticated"
  | "skipped"
  | "unavailable"
  | "failed_continue"
  | "cancelled";

type StagedInstallAuthStatus = "authenticated" | "required" | "not_checked";

type SafeScanResult =
  | { ok: true; scan: ScanResult }
  | { ok: false; error: Error };

interface ScanProgressReporter {
  onProgress(progress: ScanProgress): void;
  finish(): void;
}

interface InstallTaskReporter {
  start(label: string): () => void;
}

const GITHITS_MCP_SKILL_PACKAGE_PATH =
  GITHITS_MCP_SKILL_RELATIVE_PATH.join("/");
const GITHITS_MCP_SKILL_SOURCE_PATH = fileURLToPath(
  new URL(`../../../${GITHITS_MCP_SKILL_PACKAGE_PATH}`, import.meta.url),
);
const GITHITS_MCP_SKILL_SOURCE_PATH_CANDIDATES = [
  fileURLToPath(
    new URL(`../${GITHITS_MCP_SKILL_PACKAGE_PATH}`, import.meta.url),
  ),
  fileURLToPath(
    new URL(`../../${GITHITS_MCP_SKILL_PACKAGE_PATH}`, import.meta.url),
  ),
];

function createInitLoginOutput(): LoginOutput {
  return {
    write: (message) => {
      const lines = message.replace(/\n$/, "").split("\n");
      for (const line of lines) {
        console.log(line.length > 0 ? `    ${line}` : "");
      }
    },
  };
}

function getResolvedSetupConfig(
  agent: AgentDefinition,
  fileSystemService: FileSystemService,
): SetupConfig {
  return (
    agent.resolvedSetupConfig ??
    agent.getSetupConfig(fileSystemService, agent.resolvedSetupContext)
  );
}

function getCliCheckDetail(config: SetupConfig): string | undefined {
  if (config.method === "cli" && config.checkCommand) {
    return `checked via ${formatCliCommand(config.checkCommand)}`;
  }
  if (config.method === "composite") {
    const checkStep = config.steps.find(
      (step) => step.method === "cli" && step.checkCommand,
    );
    return checkStep?.method === "cli" && checkStep.checkCommand
      ? `checked via ${formatCliCommand(checkStep.checkCommand)}`
      : undefined;
  }
  return undefined;
}

function getLegacyProjectSetupStatePath(
  fileSystemService: FileSystemService,
): string {
  return fileSystemService.joinPath(
    fileSystemService.getCwd(),
    ".githits",
    "init",
    "project-setup.json",
  );
}

function getPiConfigFileUninstall(
  agent: AgentDefinition,
  fileSystemService: FileSystemService,
): ConfigFileSetup | null {
  if (agent.id !== "pi") {
    return null;
  }
  const uninstallConfig = agent.getUninstallConfig?.(fileSystemService);
  if (uninstallConfig?.method !== "composite") {
    return null;
  }
  const configStep = uninstallConfig.steps
    .map(({ step }) => step)
    .find((step): step is ConfigFileSetup => step.method === "config-file");
  return configStep ?? null;
}

/** Style a CLI command so it stands out from surrounding text. */
function formatCommand(command: string, useColors: boolean): string {
  return colorizeBrand(command, "secondary", useColors, { bold: true });
}

const AGENT_SAFE_CLI = "npx -y githits@latest";
const AGENT_LOGIN_COMMAND = `${AGENT_SAFE_CLI} login`;
const AGENT_LOGIN_NO_BROWSER_COMMAND = `${AGENT_SAFE_CLI} login --no-browser`;
const AGENTIC_INIT_YES_WARNING =
  "Do not run `githits init -y` or `githits init --yes` unless the user explicitly asks to configure every detected tool.";

function getAgentDetectCommand(scope: InitSetupScope): string {
  return `${AGENT_SAFE_CLI} init ${scope === "project" ? "--project " : ""}--detect-agents`;
}

function getAgentInstallCommand(scope: InitSetupScope): string {
  return `${AGENT_SAFE_CLI} init ${scope === "project" ? "--project " : ""}--install-agents`;
}

function getAgenticVerifyCommand(scope: InitSetupScope): string {
  return `${getAgentDetectCommand(scope)} --json`;
}

function getAgenticVerifyInstruction(scope: InitSetupScope): string {
  return `After a successful --install-agents run, verify with ${getAgenticVerifyCommand(scope)} instead of running init again.`;
}

function getAgenticJsonVerifyInstruction(scope: InitSetupScope): string {
  return `Do not run init again after a successful --install-agents run; verify with ${getAgenticVerifyCommand(scope)} instead.`;
}

function formatInstallCommand(ids: string[], scope: InitSetupScope): string {
  return `${getAgentInstallCommand(scope)} ${ids.join(",")}`;
}

function printReadyNextSteps(): void {
  console.log("  GitHits is now connected to your coding agents.");
  console.log();
  console.log(
    "  Here are some examples of the new abilities that your agent just got:",
  );
  console.log();
  console.log("  • Find usage examples");
  console.log(
    "      -> “Find an example of using Azure Speech SDK TranscribeDefinition”",
  );
  console.log();
  console.log(
    "  • Search, grep, list files, and read exact lines in any repo or package to gather information",
  );
  console.log(
    "      -> “How does Next.js implement route prefetching internally?”",
  );
  console.log();
  console.log(
    "  • Inspect dependency versions, changelogs, and upgrade changes",
  );
  console.log("      -> “What changed between pydantic-ai 1.95 and 1.99?”");
  console.log();
  console.log(
    "  Open a new coding agent session and try out one of the above.",
  );
  console.log();
  console.log(
    '  In your normal workflow, your agent will call GitHits automatically depending on the task, but you can prompt it to use GitHits explicitly by adding "use GitHits".',
  );
  console.log();
  console.log(
    "  See docs for more use cases and trigger guides: https://docs.githits.com",
  );
}

function printAuthRequiredNextSteps(useColors: boolean): void {
  console.log("  GitHits MCP is configured, but sign-in is still needed.");
  console.log();
  console.log("  Sign in when you're ready:");
  console.log(`    ${formatCommand("npx githits@latest login", useColors)}`);
}

function printAuthNotCheckedNextSteps(useColors: boolean): void {
  console.log("  GitHits MCP is configured. Sign-in was not checked.");
  console.log();
  console.log("  If your agent asks you to sign in, run:");
  console.log(`    ${formatCommand("npx githits@latest login", useColors)}`);
}

function printProjectAuthRequiredNextSteps(useColors: boolean): void {
  console.log(
    "  GitHits MCP is configured for this project, but sign-in is still needed.",
  );
  console.log();
  console.log(
    "  Open an MCP-compatible coding agent in this project so it loads the project config.",
  );
  console.log();
  console.log("  Sign in when you're ready:");
  console.log(`    ${formatCommand("npx githits@latest login", useColors)}`);
}

function printProjectAuthNotCheckedNextSteps(useColors: boolean): void {
  console.log(
    "  GitHits MCP is configured for this project. Sign-in was not checked.",
  );
  console.log();
  console.log(
    "  Open an MCP-compatible coding agent in this project so it loads the project config.",
  );
  console.log();
  console.log("  If your agent asks you to sign in, run:");
  console.log(`    ${formatCommand("npx githits@latest login", useColors)}`);
}

function printAgenticLoginInstructions(useColors: boolean): void {
  console.log(
    "  Authentication is still required before agents can use GitHits.",
  );
  console.log();
  console.log("  Agent instruction:");
  console.log();
  console.log("  Ask the user:");
  console.log(
    `    "GitHits needs to open a browser sign-in page. The sign-in happens in your browser, not in this chat or terminal. I will not see or handle your credentials. Should I run \`${AGENT_LOGIN_COMMAND}\` now?"`,
  );
  console.log();
  console.log("  If the user approves, run:");
  console.log(`    ${formatCommand(AGENT_LOGIN_COMMAND, useColors)}`);
  console.log();
  console.log("  If the browser cannot open, run:");
  console.log(
    `    ${formatCommand(AGENT_LOGIN_NO_BROWSER_COMMAND, useColors)}`,
  );
}

function printAgenticAlreadyAuthenticated(): void {
  console.log("  GitHits MCP is installed and you are already signed in.");
  console.log();
  console.log("  Open a new coding agent session so it reloads MCP config.");
}

function printAgenticAuthNotChecked(useColors: boolean): void {
  console.log("  GitHits MCP is installed. Sign-in status was not checked.");
  console.log();
  console.log("  If the user is not already signed in, ask before running:");
  console.log(`    ${formatCommand(AGENT_LOGIN_COMMAND, useColors)}`);
}

function printNonInteractiveInitGuidance(useColors: boolean): void {
  console.log(
    "  This setup is interactive. Because this session is non-interactive, no changes were made.",
  );
  console.log();
  console.log(
    "  If you are an AI coding agent helping a user install GitHits:",
  );
  console.log();
  console.log("  1. Ask the user whether GitHits should be installed for:");
  console.log("     - this user account on this machine, or");
  console.log("     - only this project/repo via project-local MCP files.");
  console.log();
  console.log("  2. For user-level install, run:");
  console.log(
    `     ${formatCommand(getAgentDetectCommand("user"), useColors)}`,
  );
  console.log();
  console.log("     For project-level install, run:");
  console.log(
    `     ${formatCommand(getAgentDetectCommand("project"), useColors)}`,
  );
  console.log();
  console.log("  3. Show the detected tools to the user.");
  console.log();
  console.log("  4. Ask which tools should receive the GitHits MCP server.");
  console.log();
  console.log(
    "     For project-level install, explain that config files are written into this repo and may be committed.",
  );
  console.log();
  console.log("  5. Only after approval, run the matching install command:");
  console.log(
    `     ${formatCommand(`${getAgentInstallCommand("user")} <ids>`, useColors)}`,
  );
  console.log(
    `     ${formatCommand(`${getAgentInstallCommand("project")} <ids>`, useColors)}`,
  );
  console.log();
  console.log(
    "     Supporting GitHits skill and instruction guidance is installed by default; add --no-guidance only if the user asks for plain MCP.",
  );
  console.log();
  console.log(`  ${AGENTIC_INIT_YES_WARNING}`);
  console.log(`  ${getAgenticVerifyInstruction("user")}`);
  console.log(`  ${getAgenticVerifyInstruction("project")}`);
}

function printNonInteractiveYesRejected(useColors: boolean): void {
  console.error(
    "Non-interactive `githits init --yes` is not supported because it can configure tools without explicit per-tool approval.",
  );
  console.error();
  console.error("Use the agent-safe staged flow instead:");
  console.error(`  ${formatCommand(getAgentDetectCommand("user"), useColors)}`);
  console.error(
    `  ${formatCommand(`${getAgentInstallCommand("user")} <ids>`, useColors)}`,
  );
  console.error(
    `  ${formatCommand(getAgentDetectCommand("project"), useColors)}`,
  );
  console.error(
    `  ${formatCommand(`${getAgentInstallCommand("project")} <ids>`, useColors)}`,
  );
  process.exitCode = 1;
}

const GITHITS_ASCII_LOGO = String.raw`
   ____ _ _   _   _ _ _       
  / ___(_) |_| | | (_) |_ ___ 
 | |  _| | __| |_| | | __/ __|
 | |_| | | |_|  _  | | |_\__ \
  \____|_|\__|_| |_|_|\__|___/
`;

/** Per-column color stops for the logo's warm gradient. */
const LOGO_GRADIENT: ReadonlyArray<{ until: number; color: TerminalColor }> = [
  {
    until: 13,
    color: {
      hex: "#FF4FAE",
      rgb: [255, 79, 174],
      ansi256: 205,
      ansi16: "magenta",
    },
  },
  {
    until: 19,
    color: {
      hex: "#FF5D8E",
      rgb: [255, 93, 142],
      ansi256: 204,
      ansi16: "magenta",
    },
  },
  {
    until: 21,
    color: {
      hex: "#FF6B6F",
      rgb: [255, 107, 111],
      ansi256: 203,
      ansi16: "red",
    },
  },
  {
    until: 25,
    color: { hex: "#FF794F", rgb: [255, 121, 79], ansi256: 209, ansi16: "red" },
  },
  {
    until: 30,
    color: {
      hex: "#FF872F",
      rgb: [255, 135, 47],
      ansi256: 208,
      ansi16: "yellow",
    },
  },
];

/** Apply the column-based gradient to each row of the ASCII logo. */
function colorizeLogo(logo: string, useColors: boolean): string {
  if (!useColors) {
    return logo;
  }
  return logo
    .split("\n")
    .map((line) => {
      if (line.length === 0) {
        return line;
      }
      let cursor = 0;
      let colored = "";
      for (const { until, color } of LOGO_GRADIENT) {
        if (cursor >= line.length) {
          break;
        }
        colored += colorizeTerminal(
          line.slice(cursor, until),
          color,
          useColors,
        );
        cursor = until;
      }
      return cursor < line.length ? colored + line.slice(cursor) : colored;
    })
    .join("\n");
}

const INIT_INTENT_CHOICES: SelectChoice<InitIntent>[] = [
  {
    name: "Install GitHits MCP + supporting instructions (Recommended)",
    value: "mcp-guided",
    description:
      "Install the local GitHits MCP server, one GitHits MCP skill, and a small managed instruction block.",
  },
  {
    name: "Install plain GitHits MCP",
    value: "mcp",
    description:
      "Install only the local GitHits MCP server for your coding agents.",
  },
  {
    name: "Use Agent Skills instead",
    value: "skills",
    description: "Use Skills instead of the local MCP server.",
  },
  {
    name: "Exit",
    value: "later",
    description: "Leave setup without making changes.",
  },
];

const INIT_SCOPE_CHOICES: SelectChoice<InitScopeChoice>[] = [
  {
    name: "User-level config",
    value: "user",
    description: "Configure GitHits for your detected tools on this machine.",
  },
  {
    name: "Project-level config",
    value: "project",
    description:
      "Configure project-local MCP files for tools that support workspace config.",
  },
];

const INIT_UNINSTALL_SCOPE_CHOICES: SelectChoice<InitSetupScope>[] = [
  {
    name: "User-level config",
    value: "user",
    description: "Remove GitHits from detected tools on this machine.",
  },
  {
    name: "Project-level config",
    value: "project",
    description: "Remove GitHits from supported project-local MCP files.",
  },
];

const AUTH_RECOVERY_CHOICES: SelectChoice<InitAuthRecoveryChoice>[] = [
  { name: "Retry sign in", value: "retry" },
  {
    name: "Configure MCP without signing in",
    value: "continue_without_auth",
    description: "Your agent will ask you to sign in before using GitHits.",
  },
  { name: "Cancel setup", value: "cancel" },
];

const AUTH_START_CHOICES: SelectChoice<InitAuthStartChoice>[] = [
  {
    name: "Sign in now",
    value: "sign_in",
    description: "Connect this CLI to GitHits.",
  },
  {
    name: "Skip for now",
    value: "skip",
    description: "Finish MCP setup and sign in later with `githits login`.",
  },
  { name: "Cancel setup", value: "cancel" },
];

function printSection(index: number, title: string, useColors: boolean): void {
  console.log();
  console.log(
    `  ${colorizeBrand(`${index}. ${title}`, "primary", useColors, { bold: true })}`,
  );
  console.log(`  ${colorize("-".repeat(title.length + 3), "dim", useColors)}`);
}

function printTask(
  status: "success" | "warning" | "skipped" | "failed",
  label: string,
  detail: string | undefined,
  useColors: boolean,
): void {
  const suffix = detail ? `  ${colorize(detail, "dim", useColors)}` : "";
  if (status === "success") {
    console.log(`    ${success(label, useColors)}${suffix}`);
  } else if (status === "failed") {
    console.log(`    ${errorFmt(label, useColors)}${suffix}`);
  } else if (status === "warning") {
    console.log(`    ${warning(label, useColors)}${suffix}`);
  } else {
    console.log(`    ${colorize("○", "dim", useColors)} ${label}${suffix}`);
  }
}

function printInitIntro(useColors: boolean): void {
  console.log(colorizeLogo(GITHITS_ASCII_LOGO, useColors));
  console.log("  Your agent can only read your local codebase.");
  console.log();
  console.log(
    "  GitHits lets it navigate the open-source code your app depends on.",
  );
  console.log();
  console.log(
    `  ${colorizeBrand("With GitHits, your agent can:", "primary", useColors)}`,
  );
  console.log(
    "  • Find implementation examples from open-source code, issues, discussions, and pull requests",
  );
  console.log(
    "  • Search, grep, list files, and read exact lines in any repo or package",
  );
  console.log(
    "  • Inspect dependency internals, versions, changelogs, and upgrade changes",
  );
  console.log("  • Access package documentation");
  console.log();
  console.log(
    "  No cloning or local indexing required. GitHits handles everything automatically.",
  );
  console.log();
  console.log(
    "  Works with Cursor, Claude Code, Codex, OpenCode, Pi, VS Code, Windsurf, and more.",
  );
  console.log();
  console.log("  More info: https://docs.githits.com");
  console.log();
}

function printSkillsInstructions(useColors: boolean): void {
  console.log("\n  Install GitHits Agent Skills:");
  console.log();
  console.log(
    `    ${formatCommand("npx skills add githits-com/githits-cli", useColors)}`,
  );
  console.log();
  console.log("  During setup, choose where you want to enable GitHits.");
  console.log();
  console.log(
    "  IMPORTANT: Use either Agent Skills or the local MCP server in the same",
  );
  console.log("  coding tool, not both.");
  console.log();
  console.log("  Then sign in so your agent can use GitHits:");
  console.log();
  console.log(`    ${formatCommand("npx githits@latest login", useColors)}`);
  console.log();
}

const SHARED_AGENTS_SKILL_PATH = [
  ".agents",
  "skills",
  GITHITS_MCP_SKILL_NAME,
  "SKILL.md",
] as const;

const GITHITS_VSCODE_INSTRUCTIONS_HEADER = `---
name: GitHits
description: Prefer GitHits MCP and the installed githits-mcp skill for OSS and package context.
applyTo: "**"
---`;

const GUIDANCE_SKILL_TARGETS: Record<
  string,
  {
    user?: readonly (readonly string[])[];
    project?: readonly (readonly string[])[];
  }
> = {
  "claude-code": {
    user: [[".claude", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [[".claude", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
  cursor: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  windsurf: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  vscode: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  cline: {
    user: [[".cline", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [[".cline", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
  "codex-cli": {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  pi: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  "gemini-cli": {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  "google-antigravity": {
    user: [[".gemini", "config", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  opencode: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  "hermes-agent": {
    user: [[".hermes", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
  zed: {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  junie: {
    user: [[".junie", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [[".junie", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
  "qwen-code": {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  kiro: {
    user: [[".kiro", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [[".kiro", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
  "kilo-code": {
    user: [SHARED_AGENTS_SKILL_PATH],
    project: [SHARED_AGENTS_SKILL_PATH],
  },
  "factory-droid": {
    user: [[".factory", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
    project: [[".factory", "skills", GITHITS_MCP_SKILL_NAME, "SKILL.md"]],
  },
};

function getGuidanceSkillSetups(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): SkillSetup[] {
  const basePath =
    scope === "project"
      ? fileSystemService.getCwd()
      : fileSystemService.getHomeDir();
  const seen = new Set<string>();
  const setups: SkillSetup[] = [];

  for (const agent of agents) {
    const relativeTargets = GUIDANCE_SKILL_TARGETS[agent.id]?.[scope] ?? [];
    for (const relativeTarget of relativeTargets) {
      const targetPath = fileSystemService.joinPath(
        basePath,
        ...relativeTarget,
      );
      if (seen.has(targetPath)) continue;
      seen.add(targetPath);
      setups.push({
        method: "skill",
        skillName: GITHITS_MCP_SKILL_NAME,
        sourcePath: GITHITS_MCP_SKILL_SOURCE_PATH,
        sourcePathCandidates: GITHITS_MCP_SKILL_SOURCE_PATH_CANDIDATES,
        targetPath,
      });
    }
  }

  return setups;
}

function getInstructionTargetPath(
  agentId: string,
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): string | null {
  return (
    getInstructionTargetSetup(agentId, fileSystemService, scope)?.targetPath ??
    null
  );
}

function getInstructionTargetSetup(
  agentId: string,
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): ManagedBlockSetup | null {
  const cwd = fileSystemService.getCwd();
  const home = fileSystemService.getHomeDir();
  if (scope === "project") {
    if (agentId === "claude-code") {
      return getGuidanceManagedBlock(
        fileSystemService.joinPath(cwd, "CLAUDE.md"),
      );
    }
    if (agentId === "gemini-cli" || agentId === "google-antigravity") {
      return getGuidanceManagedBlock(
        fileSystemService.joinPath(cwd, "GEMINI.md"),
      );
    }
    if (
      agentId === "cursor" ||
      agentId === "windsurf" ||
      agentId === "vscode" ||
      agentId === "codex-cli" ||
      agentId === "opencode" ||
      agentId === "zed" ||
      agentId === "kiro"
    ) {
      return getGuidanceManagedBlock(
        fileSystemService.joinPath(cwd, "AGENTS.md"),
      );
    }
    return null;
  }

  if (agentId === "claude-code") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".claude", "CLAUDE.md"),
    );
  }
  if (agentId === "windsurf") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(
        home,
        ".codeium",
        "windsurf",
        "memories",
        "global_rules.md",
      ),
    );
  }
  if (agentId === "vscode") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(
        home,
        ".copilot",
        "instructions",
        "githits.instructions.md",
      ),
      GITHITS_VSCODE_INSTRUCTIONS_HEADER,
    );
  }
  if (agentId === "gemini-cli" || agentId === "google-antigravity") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".gemini", "GEMINI.md"),
    );
  }
  if (agentId === "codex-cli") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".codex", "AGENTS.md"),
    );
  }
  if (agentId === "opencode") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".config", "opencode", "AGENTS.md"),
    );
  }
  if (agentId === "zed") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".config", "zed", "AGENTS.md"),
    );
  }
  if (agentId === "kiro") {
    return getGuidanceManagedBlock(
      fileSystemService.joinPath(home, ".kiro", "steering", "AGENTS.md"),
    );
  }
  return null;
}

function getGuidanceManagedBlock(
  targetPath: string,
  fileHeader?: string,
): ManagedBlockSetup {
  return {
    method: "managed-block",
    targetPath,
    ...(fileHeader ? { fileHeader } : {}),
    marker: GITHITS_GUIDANCE_MARKER,
    blockContent: GITHITS_GUIDANCE_BLOCK,
  };
}

function getGuidanceInstructionSetups(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): ManagedBlockSetup[] {
  const seen = new Set<string>();
  const setups: ManagedBlockSetup[] = [];
  for (const agent of agents) {
    const setup = getInstructionTargetSetup(agent.id, fileSystemService, scope);
    if (!setup || seen.has(setup.targetPath)) continue;
    seen.add(setup.targetPath);
    setups.push(setup);
  }
  return setups;
}

function buildGuidanceSetupConfig(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): CompositeSetup | null {
  if (agents.length === 0) return null;
  const steps: SetupStep[] = [
    ...getGuidanceSkillSetups(agents, fileSystemService, scope),
    ...getGuidanceInstructionSetups(agents, fileSystemService, scope),
  ];
  if (steps.length === 0) return null;
  return { method: "composite", steps };
}

function getGuidanceUninstallSteps(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): Array<SkillSetup | ManagedBlockSetup> {
  if (agents.length === 0) return [];
  const setup = buildGuidanceSetupConfig(agents, fileSystemService, scope);
  return setup?.method === "composite"
    ? setup.steps.filter(
        (step): step is SkillSetup | ManagedBlockSetup =>
          step.method === "skill" || step.method === "managed-block",
      )
    : [];
}

function shouldInstallGuidanceForStaged(options: InitOptions): boolean {
  return options.guidance !== false;
}

function shouldInstallGuidanceForYes(options: InitOptions): boolean {
  return options.guidance !== false;
}

function isGuidedIntent(intent: InitIntent): boolean {
  return intent === "mcp-guided";
}

function startSafeInitScan(
  fileSystemService: FileSystemService,
  execService: ExecService,
  scope: InitSetupScope = "user",
  onProgress?: (progress: ScanProgress) => void,
): Promise<SafeScanResult> {
  return scanAgents(agentDefinitions, fileSystemService, execService, {
    scope,
    onProgress,
  })
    .then((scan) => ({ ok: true as const, scan }))
    .catch((error: unknown) => ({
      ok: false as const,
      error: error instanceof Error ? error : new Error(String(error)),
    }));
}

function createScanProgressReporter(useColors: boolean): ScanProgressReporter {
  if (!process.stdout.isTTY) {
    return { onProgress: () => {}, finish: () => {} };
  }

  let wrote = false;
  return {
    onProgress: (progress) => {
      const width = 20;
      const filled = Math.round((progress.completed / progress.total) * width);
      const bar = `${colorizeBrand("#".repeat(filled), "primary", useColors)}${"-".repeat(width - filled)}`;
      const line = `  Scanning tools [${bar}] ${progress.completed}/${progress.total} ${progress.agent.name}`;
      process.stdout.write(`\r\x1b[2K${line}`);
      wrote = true;
    },
    finish: () => {
      if (wrote) {
        process.stdout.write("\r\x1b[2K");
      }
    },
  };
}

function createInstallTaskReporter(useColors: boolean): InstallTaskReporter {
  if (!process.stdout.isTTY) {
    return {
      start: (label) => {
        printTask("skipped", label, "installing...", useColors);
        return () => {};
      },
    };
  }

  const frames = ["-", "\\", "|", "/"];
  return {
    start: (label) => {
      let frame = 0;
      const render = () => {
        const spinner = colorizeBrand(
          frames[frame % frames.length] ?? "-",
          "primary",
          useColors,
        );
        frame += 1;
        process.stdout.write(`\r\x1b[2K    ${spinner} ${label}  installing...`);
      };
      render();
      const interval = setInterval(render, 80);
      return () => {
        clearInterval(interval);
        process.stdout.write("\r\x1b[2K");
      };
    },
  };
}

async function unwrapSafeScan(
  scanPromise: Promise<SafeScanResult>,
): Promise<ScanResult> {
  const result = await scanPromise;
  if (!result.ok) {
    throw result.error;
  }
  return result.scan;
}

function formatAgentNames(agents: AgentDefinition[]): string {
  if (agents.length === 0) return "none";
  if (agents.length === 1) return agents[0]?.name ?? "unknown";
  if (agents.length === 2) {
    return `${agents[0]?.name ?? "unknown"} and ${agents[1]?.name ?? "unknown"}`;
  }
  const names = agents.map((agent) => agent.name);
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function buildInitAgentChoices(
  scan: ScanResult,
): CheckboxChoice<AgentDefinition>[] {
  return [
    ...scan.needsSetup.map((agent) => ({
      name: `${agent.name} (detected)`,
      value: agent,
      checked: true,
    })),
    ...scan.alreadyConfigured.map((agent) => ({
      name: `${agent.name} (already configured)`,
      value: agent,
      disabled: "already configured",
    })),
  ];
}

function getInstallSummaryAgents(
  scan: ScanResult,
  selectedForSetup: AgentDefinition[],
): AgentDefinition[] {
  const selectedIds = new Set(selectedForSetup.map((agent) => agent.id));
  const included = new Map<string, AgentDefinition>();

  for (const agent of scan.alreadyConfigured) {
    included.set(agent.id, agent);
  }
  for (const agent of scan.needsSetup) {
    if (selectedIds.has(agent.id)) {
      included.set(agent.id, agent);
    }
  }

  const agentOrder = new Map(
    agentDefinitions.map((agent, index) => [agent.id, index]),
  );
  return [...included.values()].sort(
    (a, b) =>
      (agentOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (agentOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

function printScanSummary(
  scan: ScanResult,
  useColors: boolean,
  scope: InitSetupScope = "user",
): void {
  const detected =
    scan.needsSetup.length +
    scan.alreadyConfigured.length +
    scan.unsupported.length;
  const projectSupported =
    scan.needsSetup.length + scan.alreadyConfigured.length;
  for (const agent of scan.alreadyConfigured) {
    printTask("success", agent.name, "already configured", useColors);
  }
  for (const agent of scan.needsSetup) {
    printTask("warning", agent.name, "needs setup", useColors);
  }
  for (const { agent, reason } of scan.unsupported) {
    printTask(
      "skipped",
      agent.name,
      scope === "project" ? "no project-level config" : reason,
      useColors,
    );
  }
  if (scan.notDetected.length > 0) {
    printTask(
      "skipped",
      `${scan.notDetected.length} supported tool${scan.notDetected.length !== 1 ? "s" : ""} not found`,
      formatAgentNames(scan.notDetected),
      useColors,
    );
  }
  if (detected > 0) {
    console.log();
    if (scope === "project") {
      console.log(
        `    Found ${detected} tool${detected !== 1 ? "s" : ""}. ${projectSupported} support${projectSupported === 1 ? "s" : ""} project-level config.`,
      );
    } else {
      console.log(
        `    Found ${detected} supported tool${detected !== 1 ? "s" : ""}.`,
      );
    }
  }
}

function printProjectScopeExplanation(useColors: boolean): void {
  console.log();
  console.log(
    `  ${warning("Project-level config is available for some tools.", useColors)}`,
  );
  console.log(
    "  Tools without project-level config are shown below but won't be selected.",
  );
}

function buildStagedAgentEntries(scan: ScanResult): StagedAgentEntry[] {
  const statuses = new Map<
    string,
    { status: StagedAgentStatus; reason?: string }
  >();
  for (const agent of scan.needsSetup) {
    statuses.set(agent.id, { status: "needs_setup" });
  }
  for (const agent of scan.alreadyConfigured) {
    statuses.set(agent.id, { status: "already_configured" });
  }
  for (const agent of scan.notDetected) {
    statuses.set(agent.id, { status: "not_detected" });
  }
  for (const { agent, reason } of scan.unsupported) {
    statuses.set(agent.id, {
      status: "unsupported_project_config",
      reason,
    });
  }

  return agentDefinitions.map((agent) => {
    const entry = statuses.get(agent.id);
    return {
      id: agent.id,
      name: agent.name,
      status: entry?.status ?? "not_detected",
      ...(entry?.reason ? { reason: entry.reason } : {}),
    };
  });
}

function printAgenticDetectSummary(
  scan: ScanResult,
  useColors: boolean,
  scope: InitSetupScope,
): void {
  const entries = buildStagedAgentEntries(scan);
  const detected = entries.filter((entry) => entry.status !== "not_detected");
  const installable = entries.filter((entry) => entry.status === "needs_setup");
  const unsupported = entries.filter(
    (entry) => entry.status === "unsupported_project_config",
  );
  const configured = entries.filter(
    (entry) => entry.status === "already_configured",
  );
  const notDetected = entries.filter(
    (entry) => entry.status === "not_detected",
  );

  console.log(
    `Detected tools (${scope === "project" ? "project-level" : "user-level"} install):`,
  );
  console.log();
  if (scope === "project") {
    console.log(
      "  Project-level install writes MCP config files into this repo. These files may be committed.",
    );
    console.log(
      "  Tools without verified project config are shown as unsupported and cannot be installed with --project.",
    );
    console.log();
  }
  if (detected.length === 0) {
    console.log("  None detected.");
  } else {
    console.log("  ID                 Tool                  Status");
    for (const entry of detected) {
      console.log(
        `  ${entry.id.padEnd(18)} ${entry.name.padEnd(21)} ${entry.status.replaceAll("_", " ")}`,
      );
      if (entry.status === "unsupported_project_config" && entry.reason) {
        console.log(`  ${"".padEnd(18)} ${"".padEnd(21)} ${entry.reason}`);
      }
    }
  }

  console.log();
  console.log("Not detected:");
  console.log(
    `  ${notDetected.length > 0 ? notDetected.map((entry) => entry.id).join(", ") : "none"}`,
  );
  console.log();

  if (detected.length === 0) {
    console.log("No supported AI coding tools detected.");
    console.log();
    console.log("Next step for agents:");
    console.log(
      "  Tell the user to install a supported coding tool, then run detection again.",
    );
    return;
  }

  if (installable.length === 0) {
    if (scope === "project" && unsupported.length > 0) {
      console.log(
        "No detected tools can be installed with project-level config.",
      );
      console.log();
      console.log("Next step for agents:");
      if (configured.length > 0) {
        console.log(
          "  Tell the user GitHits is already configured for the detected project-configurable tools.",
        );
      }
      console.log(
        "  Tell the user the other detected tools do not have verified project-level MCP support.",
      );
      console.log(
        `  Offer user-level install with ${getAgentDetectCommand("user")} if they want GitHits for those tools.`,
      );
      console.log(`  ${AGENTIC_INIT_YES_WARNING}`);
      console.log(
        `  Do not run init again as a verification step; use ${getAgenticVerifyCommand(scope)} if verification is needed.`,
      );
      return;
    }
    console.log("No detected tools need setup.");
    console.log();
    console.log("Next step for agents:");
    console.log(
      "  Tell the user that GitHits is already configured for detected tools.",
    );
    console.log(`  ${AGENTIC_INIT_YES_WARNING}`);
    console.log(
      `  Do not run init again as a verification step; use ${getAgenticVerifyCommand(scope)} if verification is needed.`,
    );
    return;
  }

  const installableIds = installable.map((entry) => entry.id);
  console.log("Next step for agents:");
  console.log();
  console.log("  Ask the user:");
  console.log(
    `    "GitHits can be installed for ${installable.map((entry) => entry.name).join(", ")}. Which should I configure?"`,
  );
  console.log();
  console.log("  If the user approves all detected tools needing setup, run:");
  console.log(
    `    ${formatCommand(formatInstallCommand(installableIds, scope), useColors)}`,
  );
  if (scope === "project") {
    console.log();
    console.log(
      "  Before running it, tell the user this writes project-local MCP files into the current repo and only configures tools with verified project support.",
    );
  }
  console.log();
  console.log(`  ${AGENTIC_INIT_YES_WARNING}`);
  console.log(`  ${getAgenticVerifyInstruction(scope)}`);
}

function printAgenticDetectJson(scan: ScanResult, scope: InitSetupScope): void {
  const entries = buildStagedAgentEntries(scan);
  const installableIds = entries
    .filter((entry) => entry.status === "needs_setup")
    .map((entry) => entry.id);
  const detected = entries.filter((entry) => entry.status !== "not_detected");
  const configured = entries.filter(
    (entry) => entry.status === "already_configured",
  );
  const unsupported = entries.filter(
    (entry) => entry.status === "unsupported_project_config",
  );
  const instructions = buildAgenticDetectJsonInstructions({
    scope,
    detectedCount: detected.length,
    installableCount: installableIds.length,
    configuredCount: configured.length,
    unsupportedCount: unsupported.length,
  });
  console.log(
    JSON.stringify(
      {
        mode: "detect-agents",
        scope,
        agents: entries,
        installableIds,
        suggestedCommand:
          installableIds.length > 0
            ? formatInstallCommand(installableIds, scope)
            : null,
        instructions,
      },
      null,
      2,
    ),
  );
}

function buildAgenticDetectJsonInstructions(input: {
  scope: InitSetupScope;
  detectedCount: number;
  installableCount: number;
  configuredCount: number;
  unsupportedCount: number;
}): string[] {
  const {
    scope,
    detectedCount,
    installableCount,
    configuredCount,
    unsupportedCount,
  } = input;
  if (detectedCount === 0) {
    return [
      "No supported AI coding tools were detected.",
      "Tell the user to install a supported coding tool, then run detection again.",
    ];
  }
  if (installableCount === 0) {
    if (scope === "project" && unsupportedCount > 0) {
      return [
        "Show detected tools to the user.",
        ...(configuredCount > 0
          ? [
              "Explain that GitHits is already configured for detected project-configurable tools.",
            ]
          : [
              "Explain that no detected tools have verified project-level MCP support.",
            ]),
        "Explain that tools with unsupported_project_config status cannot be installed with --project.",
        "Do not ask the user to choose project install IDs.",
        `Offer user-level detection with ${getAgentDetectCommand("user")} if they want GitHits for unsupported project tools.`,
        AGENTIC_INIT_YES_WARNING,
        getAgenticJsonVerifyInstruction(scope),
      ];
    }
    return [
      "Show detected tools to the user.",
      "Tell the user that GitHits is already configured for detected tools.",
      "Do not ask the user to choose install IDs.",
      AGENTIC_INIT_YES_WARNING,
      getAgenticJsonVerifyInstruction(scope),
    ];
  }
  return [
    "Show detected tools to the user.",
    ...(scope === "project"
      ? [
          "Explain that project-level install writes MCP config files into the current repo and those files may be committed.",
          "Do not offer agent IDs with unsupported_project_config status for project install.",
        ]
      : []),
    "Ask which tools should receive the GitHits MCP server.",
    "Only run --install-agents with user-approved IDs.",
    AGENTIC_INIT_YES_WARNING,
    getAgenticJsonVerifyInstruction(scope),
  ];
}

function getStagedModeCount(options: InitOptions): number {
  return [
    options.detectAgents === true,
    options.installAgents !== undefined,
  ].filter(Boolean).length;
}

function failInitArgument(message: string, json: boolean | undefined): void {
  if (json) {
    console.error(JSON.stringify({ error: message, code: "INVALID_ARGUMENT" }));
  } else {
    console.error(message);
  }
  process.exitCode = 1;
}

function validateInitModeOptions(options: InitOptions): boolean {
  const stagedModeCount = getStagedModeCount(options);
  if (stagedModeCount > 1) {
    failInitArgument(
      "Use only one staged init mode: --detect-agents or --install-agents.",
      options.json,
    );
    return false;
  }
  if (options.yes && stagedModeCount > 0) {
    failInitArgument(
      "--yes cannot be combined with --detect-agents or --install-agents.",
      options.json,
    );
    return false;
  }
  if (options.json && stagedModeCount === 0) {
    failInitArgument(
      "--json is only supported with --detect-agents or --install-agents.",
      options.json,
    );
    return false;
  }
  return true;
}

function parseAgentIdList(value: string | undefined): string[] {
  if (!value) return [];
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  return [...new Set(ids)];
}

function findAgentsByIds(scan: ScanResult, ids: string[]): AgentDefinition[] {
  const detected = [...scan.needsSetup, ...scan.alreadyConfigured];
  return ids
    .map((id) => detected.find((agent) => agent.id === id))
    .filter((agent): agent is AgentDefinition => Boolean(agent));
}

function validateInstallAgentIds(
  scan: ScanResult,
  ids: string[],
): { ok: true } | { ok: false; message: string; detectedIds: string[] } {
  const supportedIds = new Set(agentDefinitions.map((agent) => agent.id));
  const installableAgents = [...scan.needsSetup, ...scan.alreadyConfigured];
  const detectedIds = installableAgents.map((agent) => agent.id);
  const detectedIdSet = new Set(detectedIds);
  const unsupported = new Map(
    scan.unsupported.map(({ agent, reason }) => [agent.id, reason]),
  );
  if (ids.length === 0) {
    return {
      ok: false,
      message:
        detectedIds.length > 0
          ? `Provide at least one agent ID. Detected IDs: ${detectedIds.join(", ")}.`
          : "Provide at least one agent ID. No supported agents are currently detected.",
      detectedIds,
    };
  }

  const unknown = ids.filter((id) => !supportedIds.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      message: `Unsupported agent ID${unknown.length !== 1 ? "s" : ""}: ${unknown.join(", ")}.`,
      detectedIds,
    };
  }

  const unsupportedIds = ids.filter((id) => unsupported.has(id));
  if (unsupportedIds.length > 0) {
    const details = unsupportedIds
      .map((id) => `${id}: ${unsupported.get(id)}`)
      .join("; ");
    return {
      ok: false,
      message: `Agent ID${unsupportedIds.length !== 1 ? "s" : ""} cannot use project-level install: ${details}.`,
      detectedIds,
    };
  }

  const undetected = ids.filter((id) => !detectedIdSet.has(id));
  if (undetected.length > 0) {
    return {
      ok: false,
      message: `Agent ID${undetected.length !== 1 ? "s" : ""} not detected: ${undetected.join(", ")}. Detected IDs: ${detectedIds.length > 0 ? detectedIds.join(", ") : "none"}.`,
      detectedIds,
    };
  }

  return { ok: true };
}

function printInstallValidationFailure(
  failure: { message: string; detectedIds: string[] },
  json: boolean | undefined,
): void {
  if (json) {
    console.error(
      JSON.stringify({
        error: failure.message,
        code: "INVALID_ARGUMENT",
        detectedIds: failure.detectedIds,
      }),
    );
  } else {
    console.error(failure.message);
  }
  process.exitCode = 1;
}

function failUnknownInitAction(action: string): void {
  failInitArgument(
    `Unknown init action: ${action}. Use "githits init uninstall" to remove GitHits MCP config.`,
    false,
  );
}

interface ProjectSetupScope {
  projectPath: string;
}

async function resolveProjectSetupScope(
  options: { json?: boolean },
  fileSystemService: FileSystemService,
): Promise<ProjectSetupScope | null> {
  const projectPath = fileSystemService.getCwd();
  if (!(await fileSystemService.isDirectory(projectPath))) {
    failInitArgument(
      `Current directory does not exist or is not a directory: ${projectPath}`,
      options.json,
    );
    return null;
  }
  return { projectPath };
}

function hasUsableInstallOutcome(outcomes: AgentOutcome[]): boolean {
  return outcomes.some(
    (outcome) =>
      outcome.status === "success" || outcome.status === "already_configured",
  );
}

async function getStagedInstallAuthStatus(
  createLoginDeps: InitDependencies["createLoginDeps"],
): Promise<StagedInstallAuthStatus> {
  if (!createLoginDeps) return "not_checked";
  try {
    const loginDeps = await createLoginDeps();
    if (typeof loginDeps.hasValidToken === "boolean") {
      return loginDeps.hasValidToken ? "authenticated" : "required";
    }
    const tokens = await loginDeps.authStorage.loadTokens(loginDeps.mcpUrl);
    const expired = tokens?.expiresAt
      ? new Date(tokens.expiresAt) < new Date()
      : false;
    return tokens && !expired ? "authenticated" : "required";
  } catch {
    return "not_checked";
  }
}

function buildAgenticInstallAuthPayload(
  authStatus: StagedInstallAuthStatus,
): Record<string, unknown> {
  if (authStatus === "authenticated") {
    return { required: false, status: "authenticated" };
  }
  if (authStatus === "required") {
    return {
      required: true,
      status: "required",
      command: AGENT_LOGIN_COMMAND,
      noBrowserCommand: AGENT_LOGIN_NO_BROWSER_COMMAND,
    };
  }
  return {
    required: null,
    status: "not_checked",
    command: AGENT_LOGIN_COMMAND,
    noBrowserCommand: AGENT_LOGIN_NO_BROWSER_COMMAND,
  };
}

function buildAgenticInstallInstructions(
  authStatus: StagedInstallAuthStatus,
  scope: InitSetupScope,
  guidanceInstalled: boolean,
): string[] {
  const guidanceInstruction = guidanceInstalled
    ? "GitHits supporting instructions were installed; open a new agent session so skill and instruction changes are loaded."
    : "Supporting instructions were not installed; rerun staged install without --no-guidance if the user asks for them.";
  if (authStatus === "authenticated") {
    return [
      scope === "project"
        ? "Open a new coding agent session in this project so it reloads project MCP config."
        : "Open a new coding agent session so it reloads MCP config.",
      guidanceInstruction,
      getAgenticJsonVerifyInstruction(scope),
    ];
  }
  if (authStatus === "required") {
    return [
      `Ask the user before running ${AGENT_LOGIN_COMMAND}.`,
      "Browser sign-in happens outside chat and terminal input.",
      "Do not ask the user to paste passwords, tokens, cookies, or OAuth codes into chat.",
      guidanceInstruction,
      getAgenticJsonVerifyInstruction(scope),
    ];
  }
  return [
    "Sign-in status was not checked.",
    `If the user is not already signed in, ask before running ${AGENT_LOGIN_COMMAND}.`,
    guidanceInstruction,
    getAgenticJsonVerifyInstruction(scope),
  ];
}

function printAgenticInstallJson(
  outcomes: AgentOutcome[],
  guidance: GuidanceOutcome | null,
  authStatus: StagedInstallAuthStatus,
  scope: InitSetupScope,
): void {
  const canAuthenticate = hasUsableInstallOutcome(outcomes);
  const guidanceInstalled =
    guidance?.status === "success" || guidance?.status === "already_configured";
  console.log(
    JSON.stringify(
      {
        mode: "install-agents",
        scope,
        outcomes,
        guidance,
        auth: canAuthenticate
          ? buildAgenticInstallAuthPayload(authStatus)
          : {
              required: false,
              status: "not_applicable",
              reason: "Fix installation errors before starting sign-in.",
            },
        instructions: canAuthenticate
          ? buildAgenticInstallInstructions(
              authStatus,
              scope,
              guidanceInstalled,
            )
          : ["Fix installation errors before asking the user to sign in."],
      },
      null,
      2,
    ),
  );
}

async function runDetectAgentsMode(
  options: InitOptions,
  fileSystemService: FileSystemService,
  execService: ExecService,
  useColors: boolean,
): Promise<void> {
  const scope: InitSetupScope = options.project ? "project" : "user";
  const scan = await scanAgents(
    agentDefinitions,
    fileSystemService,
    execService,
    { scope },
  );
  if (options.json) {
    printAgenticDetectJson(scan, scope);
    return;
  }

  printAgenticDetectSummary(scan, useColors, scope);
}

async function runInstallAgentsMode(
  options: InitOptions,
  fileSystemService: FileSystemService,
  execService: ExecService,
  createLoginDeps: InitDependencies["createLoginDeps"],
  useColors: boolean,
): Promise<void> {
  const scope: InitSetupScope = options.project ? "project" : "user";
  const requestedIds = parseAgentIdList(options.installAgents);
  const scan = await scanAgents(
    agentDefinitions,
    fileSystemService,
    execService,
    { scope },
  );
  const validation = validateInstallAgentIds(scan, requestedIds);
  if (!validation.ok) {
    printInstallValidationFailure(validation, options.json);
    return;
  }

  const agents = findAgentsByIds(scan, requestedIds);
  if (!options.json) {
    console.log("Installing GitHits MCP:");
    console.log();
  }

  const outcomes = await installSelectedAgents(
    agents,
    scan,
    fileSystemService,
    execService,
    useColors,
    false,
    scope,
  );
  const guidance = shouldInstallGuidanceForStaged(options)
    ? await installGuidance(agents, fileSystemService, execService, scope)
    : null;
  if (!options.json) {
    printInstallOutcomeSections(
      outcomes,
      agents,
      guidance,
      fileSystemService,
      useColors,
      scope,
    );
  }

  const failed = outcomes.filter((outcome) => outcome.status === "failed");
  if (guidance?.status === "failed") {
    failed.push({
      id: "githits-guidance",
      name: "GitHits guidance",
      status: "failed",
      message: guidance.message,
      changes: guidance.changes,
    });
  }
  const canAuthenticate = hasUsableInstallOutcome(outcomes);
  const authStatus = canAuthenticate
    ? await getStagedInstallAuthStatus(createLoginDeps)
    : "not_checked";
  if (failed.length > 0) {
    process.exitCode = 1;
  }

  if (options.json) {
    printAgenticInstallJson(outcomes, guidance, authStatus, scope);
    return;
  }

  const installedAny = outcomes.some((outcome) => outcome.status === "success");
  console.log();
  if (failed.length === 0) {
    console.log(
      installedAny
        ? "GitHits MCP installation complete."
        : "GitHits MCP was already configured.",
    );
    console.log();
    printMcpServerSummary(useColors, installedAny);
  } else {
    console.log("GitHits MCP installation completed with errors.");
    for (const outcome of failed) {
      console.log(`  ${outcome.name}: ${outcome.message ?? "Unknown error"}`);
    }
  }
  console.log();
  if (canAuthenticate) {
    if (authStatus === "authenticated") {
      if (scope === "project") {
        console.log(
          "  GitHits MCP is installed for this project and you are already signed in.",
        );
        console.log();
        console.log(
          "  Open a new coding agent session in this project so it reloads project MCP config.",
        );
      } else {
        printAgenticAlreadyAuthenticated();
      }
    } else if (authStatus === "required") {
      printAgenticLoginInstructions(useColors);
    } else {
      printAgenticAuthNotChecked(useColors);
    }
    console.log(`  ${getAgenticVerifyInstruction(scope)}`);
  } else {
    console.log("Fix installation errors before starting sign-in.");
  }
  console.log();
}

function printAuthExplanation(options: InitOptions): void {
  console.log(
    "    GitHits authentication is required before your agent can use GitHits tools.",
  );
  console.log();
  if (options.browser === false) {
    console.log("    We'll print a sign-in URL to open in your browser.");
  } else {
    console.log(
      "    We'll open your browser to connect your account and print the sign-in URL in case the browser does not open.",
    );
  }
  console.log("    Credentials are stored securely in your OS keychain.");
  console.log();
  console.log("    No API keys or secrets are written into your MCP config.");
  console.log();
}

async function runInitAuthentication(
  options: InitOptions,
  promptService: PromptService,
  createLoginDeps: InitDependencies["createLoginDeps"],
  useColors: boolean,
): Promise<InitAuthStatus> {
  if (options.skipLogin) {
    console.log("  Skipping authentication (--skip-login).\n");
    return "skipped";
  }
  if (!createLoginDeps) {
    printTask(
      "warning",
      "Sign-in unavailable",
      "sign in later with `githits login`",
      useColors,
    );
    return "unavailable";
  }

  while (true) {
    let loginResult: LoginFlowResult;
    try {
      const loginDeps = await createLoginDeps();
      if (loginDeps.hasValidToken) {
        printTask("success", "Already signed in", undefined, useColors);
        return "authenticated";
      }

      printAuthExplanation(options);
      if (!options.yes) {
        let authChoice: InitAuthStartChoice;
        try {
          authChoice = await promptService.select(
            options.browser === false
              ? "  Continue with sign-in and print the URL?"
              : "  Continue with browser sign-in?",
            AUTH_START_CHOICES,
            "sign_in",
          );
        } catch (err) {
          if (err instanceof ExitPromptError) {
            console.log("\n  Setup cancelled.\n");
            return "cancelled";
          }
          throw err;
        }

        if (authChoice === "skip") {
          printTask(
            "warning",
            "Sign-in skipped",
            "your agent will ask you to sign in later",
            useColors,
          );
          return "skipped";
        }
        if (authChoice === "cancel") {
          console.log(
            "\n  Setup cancelled. Run `githits login` to authenticate.\n",
          );
          return "cancelled";
        }
      }

      const loginOptions = options.browser === false ? { browser: false } : {};
      loginResult = await loginFlow(
        loginOptions,
        loginDeps,
        createInitLoginOutput(),
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      loginResult = { status: "failed", message: msg };
    }

    if (loginResult.status === "already_authenticated") {
      printTask("success", "Already signed in", undefined, useColors);
      return "authenticated";
    }
    if (loginResult.status === "success") {
      printTask("success", "Signed in successfully", undefined, useColors);
      return "authenticated";
    }

    console.log(
      `    ${warning(`Login failed: ${loginResult.message}`, useColors)}\n`,
    );
    printAuthRecoveryHint(useColors);

    if (options.yes) {
      console.log("    Continuing without authentication...\n");
      return "failed_continue";
    }

    let choice: InitAuthRecoveryChoice;
    try {
      choice = await promptService.select(
        "  Authentication failed. What would you like to do?",
        AUTH_RECOVERY_CHOICES,
        "retry",
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled.\n");
        return "cancelled";
      }
      throw err;
    }

    if (choice === "retry") {
      console.log();
      continue;
    }
    if (choice === "cancel") {
      console.log(
        "\n  Setup cancelled. Run `githits login` to authenticate.\n",
      );
      return "cancelled";
    }

    console.log("    Continuing without authentication...\n");
    return "failed_continue";
  }
}

function shouldPrintReady(authStatus: InitAuthStatus): boolean {
  return authStatus === "authenticated";
}

function printPostSetupNextSteps(
  authStatus: InitAuthStatus,
  useColors: boolean,
): void {
  printSection(
    5,
    shouldPrintReady(authStatus) ? "Ready" : "Next Steps",
    useColors,
  );
  if (shouldPrintReady(authStatus)) {
    printReadyNextSteps();
  } else if (authStatus === "failed_continue") {
    printAuthRequiredNextSteps(useColors);
  } else {
    printAuthNotCheckedNextSteps(useColors);
  }
}

function printProjectNextSteps(authStatus: InitAuthStatus, useColors: boolean) {
  printSection(
    5,
    shouldPrintReady(authStatus) ? "Ready" : "Next Steps",
    useColors,
  );
  if (shouldPrintReady(authStatus)) {
    printReadyNextSteps();
  } else if (authStatus === "failed_continue") {
    printProjectAuthRequiredNextSteps(useColors);
  } else {
    printProjectAuthNotCheckedNextSteps(useColors);
  }
}

function printScopedNextSteps(
  scope: InitSetupScope,
  authStatus: InitAuthStatus,
  useColors: boolean,
): void {
  if (scope === "project") {
    printProjectNextSteps(authStatus, useColors);
    return;
  }
  printPostSetupNextSteps(authStatus, useColors);
}

function getConfigFileSetups(setup: SetupConfig): ConfigFileSetup[] {
  if (setup.method === "config-file") {
    return [setup];
  }
  if (setup.method === "composite") {
    return setup.steps.filter(
      (step): step is ConfigFileSetup => step.method === "config-file",
    );
  }
  return [];
}

function getTomlSetups(setup: SetupConfig): ConfigFileSetup[] {
  return getConfigFileSetups(setup).filter((step) => step.format === "toml");
}

async function hasExistingConfigContent(
  config: ConfigFileSetup,
  fileSystemService: FileSystemService,
): Promise<boolean> {
  try {
    return (
      (await fileSystemService.readFile(config.configPath)).trim().length > 0
    );
  } catch {
    return false;
  }
}

async function printTomlRewriteWarnings(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  useColors: boolean,
): Promise<void> {
  const seen = new Set<string>();
  for (const agent of agents) {
    const setup = getResolvedSetupConfig(agent, fileSystemService);
    for (const config of getTomlSetups(setup)) {
      if (seen.has(config.configPath)) continue;
      if (!(await hasExistingConfigContent(config, fileSystemService)))
        continue;
      seen.add(config.configPath);
      printTask(
        "warning",
        config.configPath,
        "existing TOML comments/formatting will not be preserved",
        useColors,
      );
    }
  }
}

async function getProjectUninstallPlan(
  fileSystemService: FileSystemService,
): Promise<ProjectUninstallPlan> {
  const seenConfig = new Set<string>();
  const plan: ProjectUninstallPlan = {
    configRemovals: [],
  };
  for (const agent of agentDefinitions) {
    const setup = getAgentSetupConfig(agent, fileSystemService, "project");
    if (!setup) continue;
    for (const configSetup of getConfigFileSetups(setup)) {
      const key = `${configSetup.configPath}\0${configSetup.serversKey}\0${configSetup.serverName.toLowerCase()}`;
      if (seenConfig.has(key)) continue;
      seenConfig.add(key);
      plan.configRemovals.push(configSetup);
    }
  }
  return plan;
}

async function cleanupLegacyProjectSetupState(
  fileSystemService: FileSystemService,
): Promise<{ removed: string[]; failed: ProjectUninstallFailure[] }> {
  const statePath = getLegacyProjectSetupStatePath(fileSystemService);
  try {
    if (!(await fileSystemService.exists(statePath))) {
      return { removed: [], failed: [] };
    }
    await fileSystemService.deleteFile(statePath);
    return { removed: [statePath], failed: [] };
  } catch (err) {
    return {
      removed: [],
      failed: [
        {
          path: statePath,
          reason: `Could not remove legacy project setup marker: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
    };
  }
}

function printProjectUninstallSummary(summary: ProjectUninstallSummary): void {
  const totalRemoved = summary.removed.length + summary.legacyRemoved.length;
  console.log();
  if (summary.failed.length === 0) {
    if (summary.removed.length > 0) {
      console.log(
        "  Done! GitHits MCP configuration was removed from this project.",
      );
    } else if (summary.legacyRemoved.length > 0) {
      console.log(
        "  Done! Removed legacy GitHits project setup marker. No project MCP config entries were found.",
      );
    } else {
      console.log("  No project GitHits MCP configuration found.");
    }
  } else {
    console.log("  Project uninstall completed with errors.");
  }
  console.log(
    `  Removed ${totalRemoved} item${totalRemoved !== 1 ? "s" : ""}. Skipped ${summary.skipped.length} config path${summary.skipped.length !== 1 ? "s" : ""} without GitHits.`,
  );
  if (summary.failed.length > 0) {
    console.log(
      `  Failed to remove ${summary.failed.length} item${summary.failed.length !== 1 ? "s" : ""}:`,
    );
    for (const failure of summary.failed) {
      console.log(`    - ${failure.path}: ${failure.reason}`);
    }
  }
  console.log();
}

function printProjectUninstallRow(
  label: string,
  tone: ChangeRow["tone"],
  verb: string,
  path: string,
  fileSystemService: FileSystemService,
  useColors: boolean,
  message?: string,
): void {
  const detail = message
    ? `${formatConfigPath(path, fileSystemService)}: ${message}`
    : formatConfigPath(path, fileSystemService);
  const lines = renderChangeRows([{ tone, label, verb, detail }], {
    useColors,
    labelWidth: PROJECT_UNINSTALL_LABEL_WIDTH,
    verbWidth: CHANGE_VERB_WIDTH,
  });
  for (const line of lines) {
    console.log(line);
  }
}

async function runProjectMcpUninstall(
  options: InitUninstallOptions,
  deps: InitDependencies,
  useColors: boolean,
): Promise<void> {
  const { fileSystemService, promptService } = deps;
  const isInteractive = deps.isInteractive ?? true;
  const scope = await resolveProjectSetupScope({}, fileSystemService);
  if (!scope) return;
  const projectPlan = await getProjectUninstallPlan(fileSystemService);

  console.log(
    `\n  ${colorize("Remove GitHits from this project's MCP config.", "bold", useColors)}`,
  );
  console.log(
    `  ${colorize("Removes GitHits entries from supported project-local MCP files.", "dim", useColors)}\n`,
  );
  console.log(`    Project: ${scope.projectPath}`);
  for (const setup of projectPlan.configRemovals) {
    console.log(`    Config: ${setup.configPath}`);
  }
  console.log();

  const checks = await Promise.all(
    projectPlan.configRemovals.map(async (setup) => ({
      setup,
      check: await getConfigUninstallCheckStatus(setup, fileSystemService),
    })),
  );
  const configured = checks.filter(
    (entry) => entry.check.status === "configured",
  );
  const failedChecks = checks.filter(
    (
      entry,
    ): entry is typeof entry & {
      check: { status: "failed"; message: string };
    } => entry.check.status === "failed",
  );
  for (const { setup, check } of failedChecks) {
    printProjectUninstallRow(
      PROJECT_CONFIG_ROW_LABEL,
      "error",
      "failed",
      setup.configPath,
      fileSystemService,
      useColors,
      check.message,
    );
  }
  const skipped = checks
    .filter((entry) => entry.check.status === "not_configured")
    .map((entry) => entry.setup.configPath);
  const legacyStatePath = getLegacyProjectSetupStatePath(fileSystemService);
  const legacyProbeFailures: ProjectUninstallFailure[] = [];
  let hasLegacyState = false;
  try {
    hasLegacyState = await fileSystemService.exists(legacyStatePath);
  } catch (err) {
    legacyProbeFailures.push({
      path: legacyStatePath,
      reason: `Could not inspect legacy project setup marker: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
  const hasWork = configured.length > 0 || hasLegacyState;

  if (
    !hasWork &&
    failedChecks.length === 0 &&
    legacyProbeFailures.length === 0 &&
    options.keepGuidance
  ) {
    printProjectUninstallSummary({
      removed: [],
      legacyRemoved: [],
      skipped,
      failed: [],
    });
    return;
  }
  if (!hasWork) {
    const summary: ProjectUninstallSummary = {
      removed: [],
      legacyRemoved: [],
      skipped,
      failed: failedChecks
        .map(({ setup, check }) => ({
          path: setup.configPath,
          reason: check.message,
        }))
        .concat(legacyProbeFailures),
    };
    process.exitCode = 1;
    printProjectUninstallSummary(summary);
    return;
  }

  if (!isInteractive && !options.yes) {
    console.log(
      "  Project uninstall needs confirmation. Because this session is non-interactive, no changes were made.",
    );
    console.log();
    console.log("  To remove GitHits from this project's MCP files, run:");
    console.log(
      `    ${formatCommand("githits init uninstall --project --yes", useColors)}`,
    );
    console.log();
    return;
  }

  if (!options.yes) {
    let accepted: boolean;
    try {
      accepted = await promptService.confirm(
        "Remove GitHits MCP config from this project?",
        false,
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Uninstall cancelled. No changes made.\n");
        return;
      }
      throw err;
    }
    if (!accepted) {
      printTask(
        "skipped",
        "Project uninstall skipped",
        "no changes made",
        useColors,
      );
      console.log();
      return;
    }
  }

  const summary: ProjectUninstallSummary = {
    removed: [],
    legacyRemoved: [],
    skipped,
    failed: failedChecks
      .map(({ setup, check }) => ({
        path: setup.configPath,
        reason: check.message,
      }))
      .concat(legacyProbeFailures),
  };

  for (const { setup } of configured) {
    const result = await executeConfigFileUninstall(setup, fileSystemService);
    if (result.status === "removed") {
      summary.removed.push(setup.configPath);
      printProjectUninstallRow(
        PROJECT_CONFIG_ROW_LABEL,
        "ok",
        "updated",
        setup.configPath,
        fileSystemService,
        useColors,
      );
    } else if (result.status === "not_configured") {
      summary.skipped.push(setup.configPath);
      printProjectUninstallRow(
        PROJECT_CONFIG_ROW_LABEL,
        "ok",
        "unchanged",
        setup.configPath,
        fileSystemService,
        useColors,
      );
    } else {
      summary.failed.push({
        path: setup.configPath,
        reason: result.message,
      });
      printProjectUninstallRow(
        PROJECT_CONFIG_ROW_LABEL,
        "error",
        "failed",
        setup.configPath,
        fileSystemService,
        useColors,
        result.message,
      );
    }
  }

  if (legacyProbeFailures.length === 0) {
    const legacyCleanup =
      await cleanupLegacyProjectSetupState(fileSystemService);
    for (const path of legacyCleanup.removed) {
      summary.legacyRemoved.push(path);
      printProjectUninstallRow(
        LEGACY_PROJECT_MARKER_ROW_LABEL,
        "ok",
        "updated",
        path,
        fileSystemService,
        useColors,
      );
    }
    for (const failure of legacyCleanup.failed) {
      summary.failed.push(failure);
      printProjectUninstallRow(
        LEGACY_PROJECT_MARKER_ROW_LABEL,
        "error",
        "failed",
        failure.path,
        fileSystemService,
        useColors,
        failure.reason,
      );
    }
  }

  const guidanceOutcome = options.keepGuidance
    ? null
    : await uninstallGuidance(agentDefinitions, fileSystemService, "project");
  if (guidanceOutcome) {
    printGuidanceUninstallOutcome(
      guidanceOutcome,
      fileSystemService,
      useColors,
    );
    if (guidanceOutcome.status === "failed") {
      summary.failed.push({
        path: "GitHits guidance",
        reason: guidanceOutcome.message ?? "Guidance cleanup failed",
      });
    }
  }

  if (summary.failed.length > 0) {
    process.exitCode = 1;
  }
  printProjectUninstallSummary(summary);
}

function printNonInteractiveUninstallGuidance(useColors: boolean): void {
  console.log(
    "  Uninstall is interactive. Because this session is non-interactive, no changes were made.",
  );
  console.log();
  console.log("  To remove user-level GitHits MCP config, run:");
  console.log(
    `    ${formatCommand("githits init uninstall --yes", useColors)}`,
  );
  console.log();
  console.log("  To remove project-level GitHits MCP config, run:");
  console.log(
    `    ${formatCommand("githits init uninstall --project --yes", useColors)}`,
  );
  console.log();
}

/** Build the deselect-to-keep checkbox for the uninstall flow. */
function buildUninstallAgentChoices(
  scan: UninstallScanResult,
): CheckboxChoice<AgentDefinition>[] {
  return [
    ...scan.configured.map((agent) => ({
      name: `${agent.name} (configured)`,
      value: agent,
      checked: true,
    })),
    ...scan.notConfigured.map((agent) => ({
      name: `${agent.name} (not configured)`,
      value: agent,
      disabled: "not configured" as const,
    })),
  ];
}

/**
 * Map an uninstall change to a display row for the given agent. Both "removed"
 * and "unchanged" use the ok tone (green ✓): for uninstall the desired end
 * state is "GitHits absent", which holds in both cases. This matches install,
 * where "unchanged" is likewise a ✓ rather than a warning.
 */
function uninstallChangeToRow(
  name: string,
  change: UninstallChange,
  fileSystemService: FileSystemService,
): ChangeRow {
  switch (change.kind) {
    case "config-file":
    case "skill":
    case "managed-block":
      return {
        tone: "ok",
        label: name,
        verb: change.change,
        detail: formatConfigPath(change.path, fileSystemService),
      };
    case "command":
      return {
        tone: "ok",
        label: name,
        verb: change.change,
        detail: change.command,
      };
  }
}

function visibleChangeRows<T extends SetupChange | UninstallChange>(
  name: string,
  changes: T[] | undefined,
  fileSystemService: FileSystemService,
  unchangedCommandDetail: string | undefined,
  toRow: (
    name: string,
    change: T,
    fileSystemService: FileSystemService,
  ) => ChangeRow,
): ChangeRow[] {
  const allChanges = changes ?? [];
  const visibleChanges = allChanges.filter(
    (change) => change.kind !== "command" || change.change === "ran",
  );
  const hiddenCommandChanges = allChanges.filter(
    (change) => change.kind === "command" && change.change === "unchanged",
  );
  const hasVisibleCommandChange = visibleChanges.some(
    (change) => change.kind === "command",
  );
  const rows: ChangeRow[] = [];

  if (
    hiddenCommandChanges.length > 0 &&
    !hasVisibleCommandChange &&
    unchangedCommandDetail
  ) {
    rows.push({
      tone: "ok",
      label: name,
      verb: "unchanged",
      detail: unchangedCommandDetail,
    });
  } else if (visibleChanges.length === 0 && hiddenCommandChanges.length > 0) {
    rows.push({ tone: "ok", label: name, verb: "unchanged", detail: "" });
  }

  let commandRows = 0;
  for (const change of visibleChanges) {
    if (change.kind === "command") {
      const commandChange = change as Extract<T, { kind: "command" }>;
      rows.push(
        commandRows === 0
          ? toRow(name, commandChange, fileSystemService)
          : { tone: "ok", label: "", verb: "", detail: commandChange.command },
      );
      commandRows += 1;
    } else {
      rows.push(toRow(name, change, fileSystemService));
    }
  }

  return rows;
}

/**
 * Build display rows for one agent's uninstall outcome. Config-file changes
 * show their paths; CLI command rows show only commands that actually ran, or
 * the read-only check command when every CLI command was already unnecessary.
 */
function uninstallOutcomeRows(
  outcome: AgentUninstallOutcome,
  fileSystemService: FileSystemService,
  unchangedCommandDetail?: string,
): ChangeRow[] {
  const rows = visibleChangeRows(
    outcome.name,
    outcome.changes,
    fileSystemService,
    unchangedCommandDetail,
    uninstallChangeToRow,
  );
  if (outcome.status === "failed") {
    rows.push({
      tone: "error",
      label: outcome.name,
      verb: "failed",
      detail: outcome.message ?? "uninstall failed",
    });
  } else if (rows.length === 0) {
    rows.push({
      tone: "ok",
      label: outcome.name,
      verb: outcome.status === "removed" ? "removed" : "unchanged",
      detail: "",
    });
  }
  return rows;
}

/** Render an uninstall outcome's rows and any warnings. */
function printUninstallOutcome(
  outcome: AgentUninstallOutcome,
  fileSystemService: FileSystemService,
  useColors: boolean,
  labelWidth: number,
  unchangedCommandDetail?: string,
): void {
  const lines = renderChangeRows(
    uninstallOutcomeRows(outcome, fileSystemService, unchangedCommandDetail),
    { useColors, labelWidth, verbWidth: CHANGE_VERB_WIDTH },
  );
  for (const line of lines) {
    console.log(line);
  }
  for (const warn of outcome.warnings ?? []) {
    console.log(`    ${warning(`Warning: ${warn}`, useColors)}`);
  }
}

/**
 * Remove GitHits from the selected agents, verifying each removal. Mirrors
 * installSelectedAgents: no per-agent prompt (the selection is the consent).
 */
async function uninstallSelectedAgents(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  execService: ExecService,
  useColors: boolean,
  labelWidth: number,
): Promise<AgentUninstallOutcome[]> {
  const outcomes: AgentUninstallOutcome[] = [];

  for (const agent of agents) {
    const setupConfig = getResolvedSetupConfig(agent, fileSystemService);
    const uninstallConfig =
      agent.resolvedUninstallConfig ??
      (setupConfig.method === "config-file"
        ? setupConfig
        : agent.getUninstallConfig?.(
            fileSystemService,
            agent.resolvedSetupContext,
          ));

    if (!uninstallConfig) {
      const outcome: AgentUninstallOutcome = {
        id: agent.id,
        name: agent.name,
        status: "failed",
        message: `${agent.name} does not have a verified uninstall command.`,
      };
      outcomes.push(outcome);
      printUninstallOutcome(outcome, fileSystemService, useColors, labelWidth);
      continue;
    }

    let result =
      uninstallConfig.method === "cli"
        ? await executeCliUninstall(uninstallConfig, execService)
        : uninstallConfig.method === "config-file"
          ? await executeConfigFileUninstall(uninstallConfig, fileSystemService)
          : uninstallConfig.method === "skill"
            ? await executeSkillUninstall(uninstallConfig, fileSystemService)
            : uninstallConfig.method === "managed-block"
              ? await executeManagedBlockUninstall(
                  uninstallConfig,
                  fileSystemService,
                )
              : await executeCompositeUninstall(
                  uninstallConfig,
                  fileSystemService,
                  execService,
                );

    if (result.status === "removed" && !agent.skipUninstallVerification) {
      const verification = await verifyAgentUnconfigured(
        agent,
        fileSystemService,
        execService,
      );
      if (!verification.ok) {
        result = {
          status: "failed",
          message:
            verification.message ??
            `${agent.name} verification failed after uninstall.`,
          warnings: result.warnings,
          changes: result.changes,
        };
      }
    }

    const outcome: AgentUninstallOutcome = {
      id: agent.id,
      name: agent.name,
      status: result.status,
      message: result.status === "failed" ? result.message : undefined,
      warnings: result.warnings,
      changes: result.changes,
    };
    outcomes.push(outcome);
    printUninstallOutcome(
      outcome,
      fileSystemService,
      useColors,
      labelWidth,
      getCliCheckDetail(setupConfig),
    );
  }

  return outcomes;
}

async function runUserMcpUninstall(
  options: InitUninstallOptions,
  deps: InitDependencies,
  useColors: boolean,
): Promise<void> {
  const { fileSystemService, promptService, execService } = deps;

  console.log(
    `\n  ${colorize("Disconnect GitHits from your coding agents.", "bold", useColors)}`,
  );
  console.log(
    `  ${colorize("Removes the local GitHits MCP configuration.", "dim", useColors)}\n`,
  );

  console.log("  Scanning for configured agents...\n");
  const scan = await scanAgentsForUninstall(fileSystemService, execService);

  for (const agent of scan.configured) {
    console.log(
      `    ${colorize(`● ${agent.name} — configured`, "cyan", useColors)}`,
    );
  }
  for (const agent of scan.notConfigured) {
    console.log(`    ${warning(`${agent.name} — not configured`, useColors)}`);
  }
  for (const outcome of scan.failed) {
    console.log(
      `    ${errorFmt(`${outcome.name} — cannot inspect config`, useColors)}`,
    );
  }
  for (const agent of scan.notDetected) {
    console.log(
      `    ${colorize(`${agent.name} — not detected`, "dim", useColors)}`,
    );
  }
  console.log();

  if (
    scan.configured.length === 0 &&
    scan.failed.length === 0 &&
    options.keepGuidance
  ) {
    console.log(
      "  No GitHits MCP configurations found. Nothing to uninstall.\n",
    );
    return;
  }

  // Select which configured tools to remove from. The selection is the
  // consent — no per-agent confirmation. All configured tools are pre-checked;
  // deselect the ones to keep. --yes removes from all. (initUninstallAction
  // already routes non-interactive-without-yes to guidance, so reaching the
  // checkbox below always means an interactive session.)
  let toRemove: AgentDefinition[];
  if (options.yes || scan.configured.length === 0) {
    toRemove = scan.configured;
    if (scan.configured.length > 0) {
      printTask(
        "success",
        "Selected all configured tools",
        options.yes ? "--yes" : undefined,
        useColors,
      );
    }
  } else {
    try {
      toRemove = await promptService.checkbox(
        "  Select which tools to remove GitHits from:",
        buildUninstallAgentChoices(scan),
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Uninstall cancelled. No changes made.\n");
        return;
      }
      throw err;
    }
  }

  if (
    toRemove.length === 0 &&
    scan.failed.length === 0 &&
    (options.keepGuidance || scan.configured.length > 0)
  ) {
    printTask("skipped", "Uninstall skipped", "no tools selected", useColors);
    console.log();
    return;
  }

  const labelWidth = toRemove.reduce(
    (width, agent) => Math.max(width, agent.name.length),
    0,
  );
  if (toRemove.length > 0) {
    console.log();
  }
  // scan.failed (could not inspect config) are already shown in the detection
  // list above and the failure summary below; they carry into outcomes only
  // for the counts.
  const outcomes: AgentUninstallOutcome[] = [
    ...scan.failed,
    ...(await uninstallSelectedAgents(
      toRemove,
      fileSystemService,
      execService,
      useColors,
      labelWidth,
    )),
  ];
  const guidanceOutcome = options.keepGuidance
    ? null
    : await uninstallGuidance(agentDefinitions, fileSystemService, "user");
  if (guidanceOutcome) {
    printGuidanceUninstallOutcome(
      guidanceOutcome,
      fileSystemService,
      useColors,
    );
  }
  console.log();

  const removed =
    outcomes.filter((o) => o.status === "removed").length +
    (guidanceOutcome?.status === "removed" ? 1 : 0);
  const notConfigured =
    outcomes.filter((o) => o.status === "not_configured").length +
    scan.notConfigured.length +
    (guidanceOutcome?.status === "not_configured" ? 1 : 0);
  const failed =
    outcomes.filter((o) => o.status === "failed").length +
    (guidanceOutcome?.status === "failed" ? 1 : 0);

  if (failed > 0) {
    console.log("  Uninstall completed with errors.");
  } else if (removed > 0) {
    console.log("  Done! GitHits MCP configuration was removed.");
  } else if (notConfigured > 0) {
    console.log(
      "  No GitHits MCP configurations were active. Nothing to uninstall.",
    );
  }

  if (removed > 0) {
    console.log(`  ${removed} agent${removed !== 1 ? "s" : ""} removed.`);
  }
  if (notConfigured > 0) {
    console.log(
      `  ${notConfigured} agent${notConfigured !== 1 ? "s" : ""} not configured.`,
    );
  }
  if (failed > 0) {
    console.log(
      `  ${failed} agent${failed !== 1 ? "s" : ""} failed to uninstall.`,
    );
    for (const outcome of outcomes.filter((o) => o.status === "failed")) {
      console.log(
        `    - ${outcome.name}: ${outcome.message ?? "Unknown error"}`,
      );
      for (const warn of outcome.warnings ?? []) {
        console.log(`      Warning: ${warn}`);
      }
    }
    if (guidanceOutcome?.status === "failed") {
      console.log(
        `    - GitHits guidance: ${guidanceOutcome.message ?? "Unknown error"}`,
      );
    }
  }

  console.log();
}

async function verifyAgentConfigured(
  agent: (typeof agentDefinitions)[number],
  fileSystemService: FileSystemService,
  execService: ExecService,
  scope: InitSetupScope,
): Promise<{ ok: boolean; message?: string }> {
  const postCheck = await scanAgents([agent], fileSystemService, execService, {
    scope,
  });
  if (postCheck.alreadyConfigured.some((a) => a.id === agent.id)) {
    return { ok: true };
  }
  if (postCheck.needsSetup.some((a) => a.id === agent.id)) {
    return {
      ok: false,
      message: `${agent.name} verification failed: not configured after setup.`,
    };
  }
  return {
    ok: false,
    message: `${agent.name} verification failed: agent not detected after setup.`,
  };
}

async function executeAgentSetupWithVerification(
  agent: AgentDefinition,
  fileSystemService: FileSystemService,
  execService: ExecService,
  scope: InitSetupScope,
): Promise<SetupResult> {
  const config = getResolvedSetupConfig(agent, fileSystemService);
  let result =
    config.method === "cli"
      ? await executeCliSetup(config, execService)
      : config.method === "config-file"
        ? await executeConfigFileSetup(config, fileSystemService)
        : config.method === "skill"
          ? await executeSkillSetup(config, fileSystemService)
          : config.method === "managed-block"
            ? await executeManagedBlockSetup(config, fileSystemService)
            : await executeCompositeSetup(
                config,
                fileSystemService,
                execService,
              );

  if (result.status === "success" || result.status === "already_configured") {
    const verification = await verifyAgentConfigured(
      agent,
      fileSystemService,
      execService,
      scope,
    );
    if (!verification.ok) {
      result = {
        status: "failed",
        message:
          agent.id === "gemini-cli"
            ? "Gemini installation did not complete. Retry, or run: gemini extensions install --consent https://github.com/githits-com/githits-cli"
            : (verification.message ??
              `${agent.name} verification failed after setup.`),
        // Preserve what was written so the user can still locate/fix it.
        changes: result.changes,
      };
    }
  }

  return result;
}

/** Map a single setup change to a display row for the given agent. */
function changeToRow(
  name: string,
  change: SetupChange,
  fileSystemService: FileSystemService,
): ChangeRow {
  switch (change.kind) {
    case "config-file":
    case "skill":
    case "managed-block":
      return {
        tone: "ok",
        label: name,
        verb: change.change,
        detail: formatConfigPath(change.path, fileSystemService),
      };
    case "command":
      return {
        tone: "ok",
        label: name,
        verb: change.change,
        detail: change.command,
      };
  }
}

function guidanceTargetKey(kind: SetupChange["kind"], path: string): string {
  return `${kind}:${path}`;
}

function addGuidanceTargetLabel(
  labels: Map<string, AgentDefinition[]>,
  kind: "skill" | "managed-block",
  path: string,
  agent: AgentDefinition,
): void {
  const key = guidanceTargetKey(kind, path);
  const existing = labels.get(key);
  if (existing) {
    existing.push(agent);
  } else {
    labels.set(key, [agent]);
  }
}

function formatGuidanceLabel(
  kind: "skill" | "managed-block",
  agents: AgentDefinition[],
): string {
  if (kind === "skill") {
    return agents.length > 1
      ? "Shared Agent Skill"
      : `${agents[0]?.name ?? "GitHits"} skill`;
  }
  return agents.length > 1
    ? "Shared agent guidance"
    : `${agents[0]?.name ?? "GitHits"} guidance`;
}

function buildGuidanceTargetLabels(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): Map<string, string> {
  const basePath =
    scope === "project"
      ? fileSystemService.getCwd()
      : fileSystemService.getHomeDir();
  const labelsByTarget = new Map<string, AgentDefinition[]>();

  for (const agent of agents) {
    const relativeSkillTargets =
      GUIDANCE_SKILL_TARGETS[agent.id]?.[scope] ?? [];
    for (const relativeTarget of relativeSkillTargets) {
      addGuidanceTargetLabel(
        labelsByTarget,
        "skill",
        fileSystemService.joinPath(basePath, ...relativeTarget),
        agent,
      );
    }

    const instructionTarget = getInstructionTargetPath(
      agent.id,
      fileSystemService,
      scope,
    );
    if (instructionTarget) {
      addGuidanceTargetLabel(
        labelsByTarget,
        "managed-block",
        instructionTarget,
        agent,
      );
    }
  }

  return new Map(
    [...labelsByTarget.entries()].map(([key, targetAgents]) => [
      key,
      formatGuidanceLabel(
        key.startsWith("skill:") ? "skill" : "managed-block",
        targetAgents,
      ),
    ]),
  );
}

/**
 * Build display rows for one agent's install outcome. Config-file changes show
 * their paths; CLI command rows show only commands that actually ran, or the
 * read-only check command when every CLI command was already unnecessary. A
 * failed outcome keeps visible changes plus a trailing error row.
 */
function agentOutcomeRows(
  outcome: AgentOutcome,
  fileSystemService: FileSystemService,
  unchangedCommandDetail?: string,
): ChangeRow[] {
  const rows = visibleChangeRows(
    outcome.name,
    outcome.changes,
    fileSystemService,
    unchangedCommandDetail,
    changeToRow,
  );
  if (outcome.status === "failed") {
    rows.push({
      tone: "error",
      label: outcome.name,
      verb: "failed",
      detail: outcome.message ?? "verification failed",
    });
  } else if (rows.length === 0) {
    rows.push({
      tone: "ok",
      label: outcome.name,
      verb: "configured",
      detail: "",
    });
  }
  return rows;
}

/**
 * Confirm the MCP server and its launch command. The wording reflects whether
 * anything was actually installed this run versus already being configured, so
 * we never claim to have installed when nothing changed. The command is shown
 * as a muted inline value (the agent runs it, not the user), so it does not
 * read as something to copy-paste. Callers provide the leading separator; a
 * trailing blank line separates it from what follows.
 */
function printMcpServerSummary(useColors: boolean, installed: boolean): void {
  const verb = installed
    ? 'Configured MCP server "githits"'
    : 'MCP server "githits" already configured';
  const command = colorize(
    `\`${GITHITS_MCP_INVOCATION.join(" ")}\``,
    "dim",
    useColors,
  );
  console.log(
    `  ${success(`${verb} with local command ${command}`, useColors)}`,
  );
  console.log();
}

async function installSelectedAgents(
  agents: AgentDefinition[],
  scan: ScanResult,
  fileSystemService: FileSystemService,
  execService: ExecService,
  useColors: boolean,
  printResults: boolean,
  scope: InitSetupScope = "user",
): Promise<AgentOutcome[]> {
  const alreadyConfiguredIds = new Set(
    scan.alreadyConfigured.map((agent) => agent.id),
  );
  const outcomes: AgentOutcome[] = [];
  const installTasks = createInstallTaskReporter(useColors);

  // Column widths are fixed up front (agent names are known; verbs are a closed
  // set) so rows align even though they print one agent at a time.
  const labelWidth = agents.reduce(
    (width, agent) => Math.max(width, agent.name.length),
    0,
  );
  const printRows = (
    outcome: AgentOutcome,
    unchangedCommandDetail?: string,
  ): void => {
    if (!printResults) return;
    const lines = renderChangeRows(
      agentOutcomeRows(outcome, fileSystemService, unchangedCommandDetail),
      {
        useColors,
        labelWidth,
        verbWidth: CHANGE_VERB_WIDTH,
      },
    );
    for (const line of lines) {
      console.log(line);
    }
  };

  for (const agent of agents) {
    if (alreadyConfiguredIds.has(agent.id)) {
      const config = getResolvedSetupConfig(agent, fileSystemService);
      const outcome: AgentOutcome = {
        id: agent.id,
        name: agent.name,
        status: "already_configured",
        changes: describeConfigAsUnchanged(config),
      };
      outcomes.push(outcome);
      printRows(outcome, getCliCheckDetail(config));
      continue;
    }

    const config = getResolvedSetupConfig(agent, fileSystemService);
    const finishTask = printResults ? installTasks.start(agent.name) : () => {};
    let result: SetupResult;
    try {
      result = await executeAgentSetupWithVerification(
        agent,
        fileSystemService,
        execService,
        scope,
      );
    } finally {
      finishTask();
    }

    const outcome: AgentOutcome = {
      id: agent.id,
      name: agent.name,
      status: result.status,
      message: result.status === "failed" ? result.message : undefined,
      changes: result.changes,
    };
    outcomes.push(outcome);
    printRows(outcome, getCliCheckDetail(config));
  }

  return outcomes;
}

function guidanceRowsForKind(
  outcome: GuidanceOutcome,
  fileSystemService: FileSystemService,
  kind: "skill" | "managed-block",
  targetLabels: Map<string, string>,
): ChangeRow[] {
  return visibleChangeRows(
    "GitHits guidance",
    outcome.changes?.filter((change) => change.kind === kind),
    fileSystemService,
    undefined,
    (name, change, fs) =>
      changeToRow(
        "path" in change
          ? (targetLabels.get(guidanceTargetKey(change.kind, change.path)) ??
              name)
          : name,
        change,
        fs,
      ),
  );
}

function guidanceStatusRows(
  outcome: GuidanceOutcome,
  hasGuidanceRows: boolean,
): ChangeRow[] {
  if (outcome.status === "failed") {
    return [
      {
        tone: "error",
        label: "GitHits guidance",
        verb: "failed",
        detail: outcome.message ?? "guidance setup failed",
      },
    ];
  }
  if (outcome.status === "skipped") {
    return [
      {
        tone: "warn",
        label: "GitHits guidance",
        verb: "skipped",
        detail: outcome.message ?? "",
      },
    ];
  }
  if (!hasGuidanceRows) {
    return [
      {
        tone: "ok",
        label: "GitHits guidance",
        verb: outcome.status === "success" ? "updated" : "unchanged",
        detail: "",
      },
    ];
  }
  return [];
}

function printChangeRowsSection(
  title: string,
  rows: ChangeRow[],
  useColors: boolean,
): void {
  if (rows.length === 0) return;
  const widths = changeRowColumnWidths(rows);
  console.log(`  ${colorize(title, "bold", useColors)}`);
  const lines = renderChangeRows(rows, {
    useColors,
    labelWidth: widths.labelWidth,
    verbWidth: CHANGE_VERB_WIDTH,
  });
  for (const line of lines) {
    console.log(line);
  }
  console.log();
}

function printInstallOutcomeSections(
  outcomes: AgentOutcome[],
  agents: AgentDefinition[],
  guidance: GuidanceOutcome | null,
  fileSystemService: FileSystemService,
  useColors: boolean,
  scope: InitSetupScope,
): void {
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const mcpRows = outcomes.flatMap((outcome) => {
    const agent = agentsById.get(outcome.id);
    const config = agent
      ? getResolvedSetupConfig(agent, fileSystemService)
      : undefined;
    return agentOutcomeRows(
      outcome,
      fileSystemService,
      config ? getCliCheckDetail(config) : undefined,
    );
  });
  const guidanceTargetLabels = guidance
    ? buildGuidanceTargetLabels(agents, fileSystemService, scope)
    : new Map<string, string>();
  const skillRows = guidance
    ? guidanceRowsForKind(
        guidance,
        fileSystemService,
        "skill",
        guidanceTargetLabels,
      )
    : [];
  const instructionRows = guidance
    ? guidanceRowsForKind(
        guidance,
        fileSystemService,
        "managed-block",
        guidanceTargetLabels,
      )
    : [];
  const guidanceRows = guidance
    ? guidanceStatusRows(
        guidance,
        skillRows.length > 0 || instructionRows.length > 0,
      )
    : [];

  printChangeRowsSection("MCP", mcpRows, useColors);
  printChangeRowsSection("Skills", skillRows, useColors);
  printChangeRowsSection("Agent guidance files", instructionRows, useColors);
  printChangeRowsSection("Guidance", guidanceRows, useColors);
}

function printGuidanceUninstallOutcome(
  outcome: GuidanceUninstallOutcome,
  fileSystemService: FileSystemService,
  useColors: boolean,
): void {
  if (outcome.status === "skipped") return;
  const mapped: AgentUninstallOutcome = {
    id: "githits-guidance",
    name: "GitHits guidance",
    status:
      outcome.status === "removed"
        ? "removed"
        : outcome.status === "failed"
          ? "failed"
          : "not_configured",
    message: outcome.message,
    warnings: outcome.warnings,
    changes: outcome.changes,
  };
  printUninstallOutcome(
    mapped,
    fileSystemService,
    useColors,
    "GitHits guidance".length,
  );
}

async function installGuidance(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  execService: ExecService,
  scope: InitSetupScope,
): Promise<GuidanceOutcome> {
  const config = buildGuidanceSetupConfig(agents, fileSystemService, scope);
  if (!config) {
    return {
      status: "skipped",
      message: "no selected tools need guidance",
    };
  }
  const result = await executeCompositeSetup(
    config,
    fileSystemService,
    execService,
  );
  return {
    status: result.status,
    message: result.status === "failed" ? result.message : undefined,
    changes: result.changes,
  };
}

async function uninstallGuidance(
  agents: AgentDefinition[],
  fileSystemService: FileSystemService,
  scope: InitSetupScope,
): Promise<GuidanceUninstallOutcome> {
  const steps = getGuidanceUninstallSteps(agents, fileSystemService, scope);
  if (steps.length === 0) {
    return {
      status: "skipped",
      message: "no guidance targets",
    };
  }

  let anyRemoved = false;
  let anyNotConfigured = false;
  const changes: UninstallChange[] = [];
  for (const step of steps) {
    const result =
      step.method === "skill"
        ? await executeSkillUninstall(step, fileSystemService)
        : await executeManagedBlockUninstall(step, fileSystemService);
    if (result.changes) {
      changes.push(...result.changes);
    }
    if (result.status === "failed") {
      return {
        status: "failed",
        message: result.message,
        warnings: result.warnings,
        changes,
      };
    }
    if (result.status === "removed") {
      anyRemoved = true;
    } else {
      anyNotConfigured = true;
    }
  }

  if (anyRemoved) {
    return {
      status: "removed",
      message: "Guidance removed successfully",
      changes,
    };
  }
  return {
    status: anyNotConfigured ? "not_configured" : "skipped",
    message: "GitHits guidance not configured",
    changes,
  };
}

async function verifyAgentUnconfigured(
  agent: (typeof agentDefinitions)[number],
  fileSystemService: FileSystemService,
  execService: ExecService,
): Promise<{ ok: boolean; message?: string }> {
  const postCheck = await scanAgents([agent], fileSystemService, execService);
  if (postCheck.needsSetup.some((a) => a.id === agent.id)) {
    return { ok: true };
  }
  if (postCheck.notDetected.some((a) => a.id === agent.id)) {
    return {
      ok: false,
      message: `${agent.name} verification failed: agent was not detected after uninstall, so removal could not be confirmed.`,
    };
  }
  return {
    ok: false,
    message: `${agent.name} verification failed: still configured after uninstall.`,
  };
}

async function inspectSetupForUninstall(
  agent: (typeof agentDefinitions)[number],
  config: ReturnType<(typeof agentDefinitions)[number]["getSetupConfig"]>,
  fileSystemService: FileSystemService,
  execService: ExecService,
): Promise<UninstallInspectionResult> {
  if (config.method === "config-file") {
    const check = await getConfigUninstallCheckStatus(
      config,
      fileSystemService,
    );
    if (check.status === "configured") return "configured";
    if (check.status === "not_configured") return "not_configured";
    return { status: "failed", message: check.message };
  }

  if (config.method === "cli") {
    if (!config.checkCommand) {
      return {
        status: "failed",
        message: `${agent.name} does not have a verified uninstall check command.`,
      };
    }
    const checkStatus = await getCliCheckStatus(
      config.checkCommand,
      execService,
    );
    if (checkStatus === "configured") return "configured";
    if (checkStatus === "not_configured") return "not_configured";
    if (
      agent.id === "gemini-cli" &&
      (await isGeminiExtensionInstalledFromFilesystem(fileSystemService))
    ) {
      return "configured";
    }
    return {
      status: "failed",
      message: `Cannot inspect ${agent.name}: ${config.checkCommand.command} ${config.checkCommand.args.join(" ")} failed.`,
    };
  }

  if (config.method === "skill" || config.method === "managed-block") {
    return "not_configured";
  }

  const accumulated: CompositeInspectionAccumulator = {
    configured: false,
    notConfigured: false,
  };
  for (const step of config.steps) {
    const check = await inspectSetupForUninstall(
      agent,
      step,
      fileSystemService,
      execService,
    );
    if (check === "configured") {
      accumulated.configured = true;
    } else if (check === "not_configured") {
      accumulated.notConfigured = true;
    } else {
      accumulated.failure = check;
    }
  }
  if (accumulated.failure) return accumulated.failure;
  if (accumulated.configured) return "configured";
  return "not_configured";
}

async function scanAgentsForUninstall(
  fileSystemService: FileSystemService,
  execService: ExecService,
): Promise<UninstallScanResult> {
  const setupScan = await scanAgents(
    agentDefinitions,
    fileSystemService,
    execService,
  );
  const result: UninstallScanResult = {
    configured: [],
    notConfigured: [],
    notDetected: setupScan.notDetected,
    failed: [],
  };

  for (const agent of [
    ...setupScan.alreadyConfigured,
    ...setupScan.needsSetup,
  ]) {
    const config = getResolvedSetupConfig(agent, fileSystemService);
    const check = await inspectSetupForUninstall(
      agent,
      config,
      fileSystemService,
      execService,
    );
    if (check === "configured") {
      result.configured.push(agent);
    } else if (check === "not_configured") {
      result.notConfigured.push(agent);
    } else {
      result.failed.push({
        id: agent.id,
        name: agent.name,
        status: "failed",
        message: check.message,
      });
    }
  }

  for (const agent of setupScan.notDetected) {
    const piConfigUninstall = getPiConfigFileUninstall(
      agent,
      fileSystemService,
    );
    if (!piConfigUninstall) {
      continue;
    }
    const check = await getConfigUninstallCheckStatus(
      piConfigUninstall,
      fileSystemService,
    );
    if (check.status === "configured") {
      result.configured.push({
        ...agent,
        resolvedUninstallConfig: piConfigUninstall,
        skipUninstallVerification: true,
      });
      result.notDetected = result.notDetected.filter((a) => a.id !== agent.id);
    } else if (check.status === "failed") {
      result.failed.push({
        id: agent.id,
        name: agent.name,
        status: "failed",
        message: check.message,
      });
    }
  }

  return result;
}

/**
 * Core init logic, separated from CLI registration for testability.
 * Scans for available agents, prompts for selection, configures each sequentially.
 */
export async function initAction(
  options: InitOptions,
  deps: InitDependencies,
): Promise<void> {
  const useColors = shouldUseColors();
  const { fileSystemService, promptService, execService, createLoginDeps } =
    deps;
  const isInteractive = deps.isInteractive ?? true;

  if (!validateInitModeOptions(options)) {
    return;
  }

  if (options.detectAgents) {
    await runDetectAgentsMode(
      options,
      fileSystemService,
      execService,
      useColors,
    );
    return;
  }

  if (options.installAgents !== undefined) {
    await runInstallAgentsMode(
      options,
      fileSystemService,
      execService,
      createLoginDeps,
      useColors,
    );
    return;
  }

  printInitIntro(useColors);

  if (!isInteractive) {
    if (options.yes) {
      printNonInteractiveYesRejected(useColors);
      return;
    }
    printNonInteractiveInitGuidance(useColors);
    console.log();
    return;
  }

  let setupScope: InitSetupScope = options.project ? "project" : "user";
  let installSupportingGuidance = shouldInstallGuidanceForYes(options);

  if (!options.yes) {
    let intent: InitIntent;
    try {
      intent = await promptService.select(
        "  What do you want to do?",
        INIT_INTENT_CHOICES,
        options.guidance === false ? "mcp" : "mcp-guided",
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled. No changes made.\n");
        return;
      }
      throw err;
    }

    if (intent === "skills") {
      printSkillsInstructions(useColors);
      return;
    }
    if (intent === "later") {
      console.log(
        "\n  No changes made. Run `npx githits@latest init` whenever you're ready.\n",
      );
      return;
    }
    installSupportingGuidance = isGuidedIntent(intent);

    if (!options.project) {
      try {
        setupScope = await promptService.select(
          "  Where should GitHits be configured?",
          INIT_SCOPE_CHOICES,
          "user",
        );
      } catch (err) {
        if (err instanceof ExitPromptError) {
          console.log("\n  Setup cancelled. No changes made.\n");
          return;
        }
        throw err;
      }
    }
  }

  if (setupScope === "project") {
    const scope = await resolveProjectSetupScope({}, fileSystemService);
    if (!scope) return;
    printProjectScopeExplanation(useColors);
  }

  printSection(1, "Detect tools", useColors);
  console.log("    Scanning for compatible AI coding tools...");
  const progress = createScanProgressReporter(useColors);
  const scanPromise = startSafeInitScan(
    fileSystemService,
    execService,
    setupScope,
    (scanProgress) => progress.onProgress(scanProgress),
  );
  let scan: ScanResult;
  try {
    scan = await unwrapSafeScan(scanPromise);
  } finally {
    progress.finish();
  }
  printScanSummary(scan, useColors, setupScope);

  if (scan.needsSetup.length === 0 && scan.alreadyConfigured.length === 0) {
    printTask(
      "warning",
      setupScope === "project"
        ? "No project-configurable tools detected"
        : "No supported AI coding tools detected",
      setupScope === "project"
        ? "choose user-level config or install a project-configurable tool"
        : "install a supported tool and run `githits init` again",
      useColors,
    );
    console.log();
    return;
  }

  let toSetup = scan.needsSetup;
  printSection(2, "Choose tools", useColors);
  if (!options.yes && scan.needsSetup.length > 0) {
    try {
      toSetup = await promptService.checkbox(
        "  Select which tools should use GitHits:",
        buildInitAgentChoices(scan),
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled. No changes made.\n");
        return;
      }
      throw err;
    }
  } else if (scan.needsSetup.length === 0) {
    printTask(
      "success",
      "No tool changes needed",
      "all detected tools already have GitHits MCP",
      useColors,
    );
  } else {
    printTask("success", "Selected all detected tools", "--yes", useColors);
  }

  if (toSetup.length === 0 && scan.needsSetup.length > 0) {
    printTask("skipped", "Setup skipped", "no tools selected", useColors);
    console.log();
    if (scan.alreadyConfigured.length === 0) {
      return;
    }
  }

  if (installSupportingGuidance && setupScope === "project" && !options.yes) {
    try {
      installSupportingGuidance = await promptService.confirm(
        "Add project-level GitHits skill and instruction files?",
        true,
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled. No changes made.\n");
        return;
      }
      throw err;
    }
  }

  if (toSetup.length > 0) {
    await printTomlRewriteWarnings(toSetup, fileSystemService, useColors);
  }

  printSection(3, "Sign in", useColors);
  const authStatus = await runInitAuthentication(
    options,
    promptService,
    createLoginDeps,
    useColors,
  );
  if (authStatus === "cancelled") {
    return;
  }

  printSection(4, "Install and verify", useColors);
  const summaryAgents = getInstallSummaryAgents(scan, toSetup);
  const outcomes = await installSelectedAgents(
    summaryAgents,
    scan,
    fileSystemService,
    execService,
    useColors,
    false,
    setupScope,
  );
  const guidanceOutcome = installSupportingGuidance
    ? await installGuidance(
        summaryAgents,
        fileSystemService,
        execService,
        setupScope,
      )
    : null;
  printInstallOutcomeSections(
    outcomes,
    summaryAgents,
    guidanceOutcome,
    fileSystemService,
    useColors,
    setupScope,
  );

  const configured = outcomes.filter((o) => o.status === "success").length;
  const alreadyDone = outcomes.filter(
    (o) => o.status === "already_configured",
  ).length;
  const failed =
    outcomes.filter((o) => o.status === "failed").length +
    (guidanceOutcome?.status === "failed" ? 1 : 0);

  if (failed > 0) {
    console.log("  Setup completed with errors.");
  } else if (configured > 0 || alreadyDone > 0) {
    printMcpServerSummary(useColors, configured > 0);
    printScopedNextSteps(setupScope, authStatus, useColors);
  }

  if (failed > 0) {
    console.log(
      `  ${failed} tool${failed !== 1 ? "s" : ""} failed to configure.`,
    );
    for (const outcome of outcomes.filter((o) => o.status === "failed")) {
      console.log(
        `    - ${outcome.name}: ${outcome.message ?? "Unknown error"}`,
      );
    }
    if (guidanceOutcome?.status === "failed") {
      console.log(
        `    - GitHits guidance: ${guidanceOutcome.message ?? "Unknown error"}`,
      );
    }
  }
  if (alreadyDone > 0) {
    console.log(
      `  ${alreadyDone} tool${alreadyDone !== 1 ? "s" : ""} already configured.`,
    );
  }

  console.log();
}

/**
 * Core init uninstall logic, separated from CLI registration for testability.
 * Scans for configured agents and removes GitHits MCP setup with confirmation.
 */
export async function initUninstallAction(
  options: InitUninstallOptions,
  deps: InitDependencies,
): Promise<void> {
  const useColors = shouldUseColors();
  const { promptService } = deps;
  const isInteractive = deps.isInteractive ?? true;

  if (options.project) {
    await runProjectMcpUninstall(options, deps, useColors);
    return;
  }

  if (!isInteractive && !options.yes) {
    printNonInteractiveUninstallGuidance(useColors);
    return;
  }

  if (!options.yes) {
    let scope: InitSetupScope;
    try {
      scope = await promptService.select(
        "  What should GitHits be removed from?",
        INIT_UNINSTALL_SCOPE_CHOICES,
        "user",
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Uninstall cancelled. No changes made.\n");
        return;
      }
      throw err;
    }

    if (scope === "project") {
      await runProjectMcpUninstall(options, deps, useColors);
      return;
    }
  }

  await runUserMcpUninstall(options, deps, useColors);
}

function printAuthRecoveryHint(useColors: boolean): void {
  console.log(
    "    You can still configure MCP, but GitHits tools will require auth.",
  );
  console.log("    Recovery steps:");
  console.log(`      ${formatCommand("githits auth status", useColors)}`);
  console.log(`      ${formatCommand("githits login --force", useColors)}`);
  console.log("    For CI or locked-down machines, set GITHITS_API_TOKEN.");
  console.log(
    "    If your system keychain is unavailable, set GITHITS_AUTH_STORAGE=file after accepting plaintext storage.\n",
  );
}

const INIT_DESCRIPTION = `Connect GitHits to your coding agents.

Installs the local GitHits MCP server — the recommended way to connect — or
sets up Agent Skills instead. Guided MCP setup also installs a small GitHits
skill and managed instruction block so agents use GitHits for OSS stack context.
Detects supported coding tools on this machine, signs you in, and configures
the tools you select.`;

const INIT_UNINSTALL_DESCRIPTION = `Remove GitHits MCP server configuration from your coding agents.

In interactive mode, asks whether to remove user-level coding-agent config or
project-level MCP config. Removes only GitHits MCP/plugin entries with your
confirmation. By default it also removes GitHits-owned guidance files; pass
\`--keep-guidance\` to leave them in place. Authentication tokens are not
removed; use \`githits logout\` to remove stored credentials.`;

/**
 * Register the init command on the given program.
 * Creates lightweight dependencies for tool setup, plus auth deps for login.
 */
export function registerInitCommand(program: Command) {
  const initCommand = program
    .command("init")
    .argument("[action]", "Compatibility action; use uninstall with --project")
    .summary("Connect GitHits to your coding agents")
    .description(INIT_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, configure all detected tools")
    .option("--skip-login", "Skip authentication step")
    .option("--no-browser", "Print sign-in URL instead of opening browser")
    .option("--project", "Configure project-level MCP in the current directory")
    .option("--guidance", "Install supporting GitHits skill and instructions")
    .option("--no-guidance", "Install plain MCP without supporting guidance")
    .option("--detect-agents", "Scan supported agents without installing")
    .option(
      "--install-agents <ids>",
      "Install MCP server for comma-separated agent IDs from --detect-agents",
    )
    .option("--json", "Emit JSON for --detect-agents or --install-agents")
    .action(async (action: string | undefined, options: InitOptions) => {
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      const deps = {
        fileSystemService,
        promptService,
        execService,
        createLoginDeps: () => createContainer(),
        isInteractive:
          process.stdin.isTTY === true && process.stdout.isTTY === true,
      };
      if (action !== undefined) {
        failUnknownInitAction(action);
        return;
      }
      await initAction(options, {
        ...deps,
      });
    });

  initCommand
    .command("uninstall")
    .summary("Remove MCP server from coding agents or project config")
    .description(INIT_UNINSTALL_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, uninstall user-level config", false)
    .option(
      "--project",
      "Remove project-level MCP from the current directory",
      false,
    )
    .option(
      "--keep-guidance",
      "Keep GitHits skill and managed instruction guidance",
      false,
    )
    .action(async (options: InitUninstallOptions, command: Command) => {
      const parentOptions = command.parent?.opts<InitOptions>() ?? {};
      const resolvedOptions: InitUninstallOptions = {
        ...options,
        yes: options.yes || parentOptions.yes,
        project: options.project || parentOptions.project,
        keepGuidance: options.keepGuidance,
      };
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      await initUninstallAction(resolvedOptions, {
        fileSystemService,
        promptService,
        execService,
        isInteractive:
          process.stdin.isTTY === true && process.stdout.isTTY === true,
      });
    });
}
