import { ExitPromptError } from "@inquirer/core";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { ExecService } from "../../services/exec-service.js";
import { ExecServiceImpl } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import { FileSystemServiceImpl } from "../../services/filesystem-service.js";
import type {
  CheckboxChoice,
  ConfirmChoice,
  PromptService,
  SelectChoice,
} from "../../services/prompt-service.js";
import { PromptServiceImpl } from "../../services/prompt-service.js";
import {
  colorize,
  colorizeBrand,
  error as errorFmt,
  shouldUseColors,
  success,
  warning,
} from "../../shared/colors.js";
import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOutput,
} from "../login.js";
import { loginFlow } from "../login.js";
import {
  type AgentDefinition,
  agentDefinitions,
  type ConfigFileSetup,
  isGeminiExtensionInstalledFromFilesystem,
  type ScanProgress,
  type ScanResult,
  type SetupConfig,
  scanAgents,
} from "./agent-definitions.js";
import {
  executeCliSetup,
  executeCliUninstall,
  executeCompositeSetup,
  executeCompositeUninstall,
  executeConfigFileSetup,
  executeConfigFileUninstall,
  formatUninstallPreview,
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
}

/** Options for the init uninstall command */
export interface InitUninstallOptions {
  /** Skip all prompts, uninstall from all configured agents */
  yes?: boolean;
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
}

/** Tracks per-agent setup outcome for the summary */
interface AgentOutcome {
  id: string;
  name: string;
  status: "success" | "already_configured" | "failed" | "skipped";
  message?: string;
}

/** Tracks per-agent uninstall outcome for the summary */
interface AgentUninstallOutcome {
  id: string;
  name: string;
  status: "removed" | "not_configured" | "failed" | "skipped";
  message?: string;
  warnings?: string[];
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

type InitIntent = "mcp" | "skills" | "later";

type InitAuthStartChoice = "sign_in" | "skip" | "cancel";

type InitAuthRecoveryChoice = "retry" | "continue_without_auth" | "cancel";

type InitAuthStatus =
  | "authenticated"
  | "skipped"
  | "unavailable"
  | "failed_continue"
  | "cancelled";

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

function printReadyNextSteps(): void {
  console.log("  GitHits is connected to your AI coding tool.");
  console.log();
  console.log("  Start a coding task as usual. When your agent needs real");
  console.log(
    "  open-source examples, dependency source code, docs, or package",
  );
  console.log("  metadata, it can use GitHits.");
  console.log();
  console.log("  Try the CLI directly:");
  console.log(
    '    npx githits@latest example "How do I use useEffect cleanup?"',
  );
  console.log();
  console.log("  Or ask your agent:");
  console.log(
    "    Use GitHits Code Examples to find a real open-source implementation of HTTP retries with exponential backoff in Python.",
  );
  console.log();
  console.log("  Docs: https://docs.githits.com");
}

function printAuthRequiredNextSteps(): void {
  console.log("  GitHits MCP is configured, but sign-in is still needed.");
  console.log();
  console.log("  Sign in when you're ready:");
  console.log("    npx githits@latest login");
}

function printAuthNotCheckedNextSteps(): void {
  console.log("  GitHits MCP is configured. Sign-in was not checked.");
  console.log();
  console.log("  If your agent asks you to sign in, run:");
  console.log("    npx githits@latest login");
}

const GITHITS_ASCII_LOGO = String.raw`
   ____ _ _   _   _ _ _       
  / ___(_) |_| | | (_) |_ ___ 
 | |  _| | __| |_| | | __/ __|
 | |_| | | |_|  _  | | |_\__ \
  \____|_|\__|_| |_|_|\__|___/
`;

const INIT_INTENT_CHOICES: SelectChoice<InitIntent>[] = [
  {
    name: "Install GitHits MCP server",
    value: "mcp",
    description: "Recommended. Lets your agent call GitHits tools directly.",
  },
  {
    name: "I'd rather use Agent Skills",
    value: "skills",
    description:
      "Use instruction-driven Skills instead of the local MCP server.",
  },
  {
    name: "Later",
    value: "later",
    description: "Exit without changing anything.",
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
    description: "Open your browser and connect this CLI to GitHits.",
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
  console.log(colorizeBrand(GITHITS_ASCII_LOGO, "primary", useColors));
  console.log(
    "  GitHits adds source-backed open-source context to your AI coding tool.",
  );
  console.log(
    "  When local files and model memory are not enough, your agent can use",
  );
  console.log(
    "  GitHits for real open-source examples, dependency source code, docs,",
  );
  console.log("  and package metadata.");
  console.log();
  console.log(
    "  Most users should install the local MCP server. It lets your agent call",
  );
  console.log(
    "  GitHits tools directly, stores tokens in your OS keychain, and does not",
  );
  console.log("  write secrets into your coding tool config.");
  console.log();
  console.log("  Choose how you want to connect GitHits:");
  console.log(
    "    MCP server   Recommended. Configure your AI coding tool automatically.",
  );
  console.log(
    "    Agent Skills Use Skills instead if you prefer that workflow over MCP.",
  );
  console.log();
  console.log("  More info: https://docs.githits.com/quickstart");
  console.log();
  console.log("  What will happen:");
  console.log(
    "    1. Detect tools        Find supported AI coding tools on this machine.",
  );
  console.log(
    "    2. Choose tools        Pick which detected tools should get GitHits MCP.",
  );
  console.log(
    "    3. Sign in             Connect this CLI to GitHits, unless already signed in.",
  );
  console.log(
    "    4. Install and verify  Add the local MCP server entry and confirm it works.",
  );
  console.log(
    "    5. Ready               Restart or open your coding tool and start coding.",
  );
  console.log();
}

function printSkillsInstructions(): void {
  console.log("\n  Install GitHits Agent Skills:");
  console.log();
  console.log("    npx skills add githits-com/githits-cli");
  console.log();
  console.log(
    "  During installation, choose which coding tools should receive the Skills.",
  );
  console.log(
    "  Do not use GitHits Skills and GitHits MCP in the same coding tool at the",
  );
  console.log("  same time; they expose overlapping capabilities.");
  console.log();
  console.log("  GitHits still needs sign-in before tools can access results:");
  console.log();
  console.log("    npx githits@latest login");
  console.log();
}

function startSafeInitScan(
  fileSystemService: FileSystemService,
  execService: ExecService,
  onProgress?: (progress: ScanProgress) => void,
): Promise<SafeScanResult> {
  return scanAgents(agentDefinitions, fileSystemService, execService, {
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

function printScanSummary(scan: ScanResult, useColors: boolean): void {
  const detected = scan.needsSetup.length + scan.alreadyConfigured.length;
  for (const agent of scan.alreadyConfigured) {
    printTask("success", agent.name, "already configured", useColors);
  }
  for (const agent of scan.needsSetup) {
    printTask("warning", agent.name, "needs setup", useColors);
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
    console.log(
      `    Found ${detected} supported tool${detected !== 1 ? "s" : ""}.`,
    );
  }
}

function printAuthExplanation(): void {
  console.log(
    "    GitHits tools require sign-in before they can return results.",
  );
  console.log();
  console.log(
    "    We will open your browser to GitHits. After you approve access,",
  );
  console.log(
    "    the browser redirects back to this terminal through localhost.",
  );
  console.log("    Tokens are stored in your OS keychain.");
  console.log();
  console.log("    No secrets are written into your tool's MCP config.");
  console.log(
    "    For CI or headless machines, use GITHITS_API_TOKEN instead.",
  );
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

      printAuthExplanation();
      if (!options.yes) {
        let authChoice: InitAuthStartChoice;
        try {
          authChoice = await promptService.select(
            "  Continue with browser sign-in?",
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

      loginResult = await loginFlow({}, loginDeps, createInitLoginOutput());
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
    printAuthRecoveryHint();

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
    printAuthRequiredNextSteps();
  } else {
    printAuthNotCheckedNextSteps();
  }
}

async function verifyAgentConfigured(
  agent: (typeof agentDefinitions)[number],
  fileSystemService: FileSystemService,
  execService: ExecService,
): Promise<{ ok: boolean; message?: string }> {
  const postCheck = await scanAgents([agent], fileSystemService, execService);
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
  printInitIntro(useColors);

  const progress = createScanProgressReporter(useColors);
  let renderScanProgress = false;
  let lastScanProgress: ScanProgress | undefined;
  const scanPromise = startSafeInitScan(
    fileSystemService,
    execService,
    (scanProgress) => {
      lastScanProgress = scanProgress;
      if (renderScanProgress) {
        progress.onProgress(scanProgress);
      }
    },
  );

  if (!options.yes) {
    let intent: InitIntent;
    try {
      intent = await promptService.select(
        "  How would you like to use GitHits?",
        INIT_INTENT_CHOICES,
        "mcp",
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled. No changes made.\n");
        return;
      }
      throw err;
    }

    if (intent === "skills") {
      printSkillsInstructions();
      return;
    }
    if (intent === "later") {
      console.log(
        "\n  No changes made. Run `githits init` whenever you're ready.\n",
      );
      return;
    }
  }

  printSection(1, "Detect tools", useColors);
  console.log("    Scanning supported AI coding tools...");
  renderScanProgress = true;
  if (lastScanProgress) {
    progress.onProgress(lastScanProgress);
  }
  let scan: ScanResult;
  try {
    scan = await unwrapSafeScan(scanPromise);
  } finally {
    progress.finish();
  }
  printScanSummary(scan, useColors);

  if (scan.needsSetup.length === 0 && scan.alreadyConfigured.length === 0) {
    printTask(
      "warning",
      "No supported AI coding tools detected",
      "install a supported tool and run `githits init` again",
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
        "  Select AI coding tools to configure with GitHits MCP:",
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

  const outcomes: AgentOutcome[] = [];

  if (toSetup.length === 0 && scan.needsSetup.length > 0) {
    printTask("skipped", "Setup skipped", "no tools selected", useColors);
    console.log();
    return;
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
  if (toSetup.length === 0) {
    printTask(
      "success",
      "Nothing to install",
      "all detected tools are already configured",
      useColors,
    );
    printPostSetupNextSteps(authStatus, useColors);
    console.log();
    return;
  }

  const installTasks = createInstallTaskReporter(useColors);
  for (const agent of toSetup) {
    const config = getResolvedSetupConfig(agent, fileSystemService);
    const finishTask = installTasks.start(agent.name);

    let result: SetupResult;
    try {
      result =
        config.method === "cli"
          ? await executeCliSetup(config, execService)
          : config.method === "config-file"
            ? await executeConfigFileSetup(config, fileSystemService)
            : await executeCompositeSetup(
                config,
                fileSystemService,
                execService,
              );

      if (
        result.status === "success" ||
        result.status === "already_configured"
      ) {
        const verification = await verifyAgentConfigured(
          agent,
          fileSystemService,
          execService,
        );
        if (!verification.ok) {
          result = {
            status: "failed",
            message:
              agent.id === "gemini-cli"
                ? "Gemini installation did not complete. Retry, or run: gemini extensions install --consent https://github.com/githits-com/githits-cli"
                : (verification.message ??
                  `${agent.name} verification failed after setup.`),
          };
        }
      }
    } finally {
      finishTask();
    }

    outcomes.push({
      id: agent.id,
      name: agent.name,
      status: result.status,
      message: result.status === "failed" ? result.message : undefined,
    });

    if (result.status === "success") {
      printTask("success", agent.name, "configured and verified", useColors);
    } else if (result.status === "already_configured") {
      printTask("warning", agent.name, "already configured", useColors);
    } else {
      printTask("failed", agent.name, result.message, useColors);
    }
  }

  console.log();

  const configured = outcomes.filter((o) => o.status === "success").length;
  const alreadyDone =
    outcomes.filter((o) => o.status === "already_configured").length +
    scan.alreadyConfigured.length;
  const failed = outcomes.filter((o) => o.status === "failed").length;

  if (failed > 0) {
    console.log("  Setup completed with errors.");
  } else if (configured > 0 || alreadyDone > 0) {
    printPostSetupNextSteps(authStatus, useColors);
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
  }
  if (scan.alreadyConfigured.length > 0) {
    console.log(
      `  ${scan.alreadyConfigured.length} tool${scan.alreadyConfigured.length !== 1 ? "s" : ""} already configured.`,
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
  const { fileSystemService, promptService, execService } = deps;

  console.log(
    `\n  ${colorizeBrand("GitHits", "primary", useColors, { bold: true })} — Remove MCP server from your coding agents\n`,
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

  if (scan.configured.length === 0 && scan.failed.length === 0) {
    console.log(
      "  No GitHits MCP configurations found. Nothing to uninstall.\n",
    );
    return;
  }

  const outcomes: AgentUninstallOutcome[] = [...scan.failed];
  let alwaysMode = options.yes ?? false;

  for (const agent of scan.configured) {
    console.log(
      `  Uninstalling from ${colorize(agent.name, "bold", useColors)}...\n`,
    );

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
      outcomes.push({
        id: agent.id,
        name: agent.name,
        status: "failed",
        message: `${agent.name} does not have a verified uninstall command.`,
      });
      console.log(
        `    ${errorFmt(`${agent.name} does not have a verified uninstall command.`, useColors)}\n`,
      );
      continue;
    }

    const preview = formatUninstallPreview(uninstallConfig);
    for (const line of preview.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log();

    if (!alwaysMode) {
      let choice: ConfirmChoice;
      try {
        choice = await promptService.confirm3("Proceed?");
      } catch (err) {
        if (err instanceof ExitPromptError) {
          console.log("\n  Uninstall cancelled.\n");
          return;
        }
        throw err;
      }

      if (choice === "no") {
        outcomes.push({ id: agent.id, name: agent.name, status: "skipped" });
        console.log();
        continue;
      }
      if (choice === "always") {
        alwaysMode = true;
      }
    }

    let result =
      uninstallConfig.method === "cli"
        ? await executeCliUninstall(uninstallConfig, execService)
        : uninstallConfig.method === "config-file"
          ? await executeConfigFileUninstall(uninstallConfig, fileSystemService)
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
        };
      }
    }

    outcomes.push({
      id: agent.id,
      name: agent.name,
      status: result.status,
      message: result.status === "failed" ? result.message : undefined,
      warnings: result.warnings,
    });

    if (result.status === "removed") {
      console.log(`    ${success(`${agent.name} removed`, useColors)}\n`);
      for (const warn of result.warnings ?? []) {
        console.log(`    ${warning(`Warning: ${warn}`, useColors)}`);
      }
    } else if (result.status === "not_configured") {
      console.log(
        `    ${warning(`${agent.name} was not configured`, useColors)}\n`,
      );
    } else {
      console.log(`    ${errorFmt(result.message, useColors)}\n`);
      for (const warn of result.warnings ?? []) {
        console.log(`    ${warning(`Warning: ${warn}`, useColors)}`);
      }
    }
  }

  const removed = outcomes.filter((o) => o.status === "removed").length;
  const notConfigured =
    outcomes.filter((o) => o.status === "not_configured").length +
    scan.notConfigured.length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  if (failed > 0) {
    console.log("  Uninstall completed with errors.");
  } else if (removed > 0) {
    console.log("  Done! GitHits MCP configuration was removed.");
  } else if (skipped > 0) {
    console.log("  Uninstall skipped.");
  } else if (notConfigured > 0) {
    console.log(
      "  No GitHits MCP configurations were active. Nothing to remove.",
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
  if (skipped > 0) {
    console.log(`  ${skipped} agent${skipped !== 1 ? "s" : ""} skipped.`);
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
  }

  console.log();
}

function printAuthRecoveryHint(): void {
  console.log(
    "    You can still configure MCP, but GitHits tools will require auth.",
  );
  console.log("    Recovery steps:");
  console.log("      githits auth status");
  console.log("      githits login --force");
  console.log("    For CI or locked-down machines, set GITHITS_API_TOKEN.");
  console.log(
    "    If your system keychain is unavailable, set GITHITS_AUTH_STORAGE=file after accepting plaintext storage.\n",
  );
}

const INIT_DESCRIPTION = `Set up GitHits for your AI coding tools.

Walks through GitHits setup options, lets you install the local GitHits MCP
server or use Agent Skills, scans for available tools (Claude Code, Cursor, Windsurf,
VS Code, Cline, Claude Desktop, Codex CLI, Pi, Gemini CLI, Google Antigravity),
checks which are already configured, signs you in, and configures selected
tools with GitHits MCP.

Supports CLI-based setup (Claude Code, Codex, Gemini CLI), Pi package setup,
and config
file editing (Cursor, Windsurf, VS Code, Cline, Claude Desktop,
Google Antigravity) with atomic writes.`;

const INIT_UNINSTALL_DESCRIPTION = `Remove GitHits MCP server configuration from your coding agents.

Scans for available agents that currently have GitHits configured, then removes
only the GitHits MCP/plugin configuration with your confirmation. Authentication
tokens are not removed; use \`githits logout\` to remove stored credentials.`;

/**
 * Register the init command on the given program.
 * Creates lightweight dependencies for tool setup, plus auth deps for login.
 */
export function registerInitCommand(program: Command) {
  const initCommand = program
    .command("init")
    .summary("Set up MCP server for your AI coding tools")
    .description(INIT_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, configure all detected tools")
    .option("--skip-login", "Skip authentication step")
    .action(async (options: InitOptions) => {
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      await initAction(options, {
        fileSystemService,
        promptService,
        execService,
        createLoginDeps: () => createContainer(),
      });
    });

  initCommand
    .command("uninstall")
    .summary("Remove MCP server from your coding agents")
    .description(INIT_UNINSTALL_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, uninstall from all configured agents")
    .action(async (options: InitUninstallOptions) => {
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      await initUninstallAction(options, {
        fileSystemService,
        promptService,
        execService,
      });
    });
}
