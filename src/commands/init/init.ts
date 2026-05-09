import { ExitPromptError } from "@inquirer/core";
import type { Command } from "commander";
import { createAuthCommandDependencies } from "../../container.js";
import type { ExecService } from "../../services/exec-service.js";
import { ExecServiceImpl } from "../../services/exec-service.js";
import type { FileSystemService } from "../../services/filesystem-service.js";
import { FileSystemServiceImpl } from "../../services/filesystem-service.js";
import type {
  ConfirmChoice,
  PromptService,
} from "../../services/prompt-service.js";
import { PromptServiceImpl } from "../../services/prompt-service.js";
import {
  colorize,
  error as errorFmt,
  shouldUseColors,
  success,
  warning,
} from "../../shared/colors.js";
import type { LoginDependencies, LoginFlowResult } from "../login.js";
import { loginFlow } from "../login.js";
import {
  agentDefinitions,
  isGeminiExtensionInstalledFromFilesystem,
  scanAgents,
} from "./agent-definitions.js";
import {
  executeCliSetup,
  executeCliUninstall,
  executeConfigFileSetup,
  executeConfigFileUninstall,
  formatSetupPreview,
  formatUninstallPreview,
  getCliCheckStatus,
  getConfigUninstallCheckStatus,
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

/** Dependencies for the init command */
export interface InitDependencies {
  fileSystemService: FileSystemService;
  promptService: PromptService;
  execService: ExecService;
  /** Factory to create auth deps for the login step. Omit to skip login. */
  createLoginDeps?: () => Promise<LoginDependencies>;
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

interface UninstallScanResult {
  configured: (typeof agentDefinitions)[number][];
  notConfigured: (typeof agentDefinitions)[number][];
  notDetected: (typeof agentDefinitions)[number][];
  failed: AgentUninstallOutcome[];
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

async function scanCliAgentForUninstall(
  agent: (typeof agentDefinitions)[number],
  fileSystemService: FileSystemService,
  execService: ExecService,
): Promise<UninstallInspectionResult> {
  const config = agent.getSetupConfig(fileSystemService);
  if (config.method !== "cli" || !config.checkCommand) {
    return {
      status: "failed",
      message: `${agent.name} does not have a verified uninstall check command.`,
    };
  }

  const checkStatus = await getCliCheckStatus(config.checkCommand, execService);
  if (checkStatus === "configured") {
    return "configured";
  }
  if (checkStatus === "not_configured") {
    return "not_configured";
  }
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
    const config = agent.getSetupConfig(fileSystemService);
    if (config.method === "config-file") {
      const check = await getConfigUninstallCheckStatus(
        config,
        fileSystemService,
      );
      if (check.status === "configured") {
        result.configured.push(agent);
      } else if (check.status === "failed") {
        result.failed.push({
          id: agent.id,
          name: agent.name,
          status: "failed",
          message: check.message,
        });
      } else {
        result.notConfigured.push(agent);
      }
    } else {
      const check = await scanCliAgentForUninstall(
        agent,
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
  let continuedWithoutAuth = false;

  // Header
  console.log(
    `\n  ${colorize("GitHits", "bold", useColors)} — Set up MCP server for your coding agents\n`,
  );

  // Login step (before tool configuration)
  if (!options.skipLogin && createLoginDeps) {
    console.log("  Checking authentication...\n");
    let loginResult: LoginFlowResult;
    try {
      const loginDeps = await createLoginDeps();
      loginResult = await loginFlow({}, loginDeps);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      loginResult = { status: "failed", message: msg };
    }

    if (loginResult.status === "already_authenticated") {
      console.log(`    ${success("Already authenticated", useColors)}\n`);
    } else if (loginResult.status === "success") {
      console.log(`    ${success("Logged in successfully", useColors)}\n`);
    } else {
      console.log(
        `    ${warning(`Login failed: ${loginResult.message}`, useColors)}\n`,
      );
      printAuthRecoveryHint();
      if (!options.yes) {
        try {
          const choice = await promptService.confirm3(
            "Continue without authentication?",
          );
          if (choice === "no") {
            console.log(
              "\n  Setup cancelled. Run `githits login` to authenticate.\n",
            );
            return;
          }
        } catch (err) {
          if (err instanceof ExitPromptError) {
            console.log("\n  Setup cancelled.\n");
            return;
          }
          throw err;
        }
      }
      continuedWithoutAuth = true;
      console.log("    Continuing without authentication...\n");
    }
  }

  // Scan for available agents and check configuration status
  console.log("  Scanning for available agents...\n");
  const scan = await scanAgents(
    agentDefinitions,
    fileSystemService,
    execService,
  );

  // Display status list
  for (const agent of scan.alreadyConfigured) {
    console.log(
      `    ${success(`${agent.name} — already configured`, useColors)}`,
    );
  }
  for (const agent of scan.needsSetup) {
    console.log(
      `    ${colorize(`● ${agent.name} — needs setup`, "cyan", useColors)}`,
    );
  }
  for (const agent of scan.notDetected) {
    console.log(
      `    ${colorize(`${agent.name} — not detected`, "dim", useColors)}`,
    );
  }
  console.log();

  // All agents not detected
  if (scan.needsSetup.length === 0 && scan.alreadyConfigured.length === 0) {
    console.log(
      "  No coding agents detected. Install an agent and try again.\n",
    );
    return;
  }

  // All detected agents already configured
  if (scan.needsSetup.length === 0) {
    if (continuedWithoutAuth) {
      console.log(
        "  MCP is already configured, but authentication is still required.",
      );
      console.log("  Run `githits login` before using GitHits tools.\n");
      return;
    }
    console.log(
      "  All detected agents are already configured. Nothing to do.\n",
    );
    return;
  }

  // Sequential setup for unconfigured agents
  const toSetup = scan.needsSetup;
  const outcomes: AgentOutcome[] = [];
  let alwaysMode = options.yes ?? false;

  for (const agent of toSetup) {
    console.log(`  Setting up ${colorize(agent.name, "bold", useColors)}...\n`);

    const config = agent.getSetupConfig(fileSystemService);

    // Show preview
    const preview = formatSetupPreview(config);
    for (const line of preview.split("\n")) {
      console.log(`    ${line}`);
    }
    console.log();

    // Confirm (unless --yes or "always" mode)
    if (!alwaysMode) {
      let choice: ConfirmChoice;
      try {
        choice = await promptService.confirm3("Proceed?");
      } catch (err) {
        if (err instanceof ExitPromptError) {
          console.log("\n  Setup cancelled.\n");
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

    // Execute setup
    let result =
      config.method === "cli"
        ? await executeCliSetup(config, execService)
        : await executeConfigFileSetup(config, fileSystemService);

    if (result.status === "success" || result.status === "already_configured") {
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

    // Record and display outcome
    outcomes.push({
      id: agent.id,
      name: agent.name,
      status: result.status,
      message: result.status === "failed" ? result.message : undefined,
    });

    if (result.status === "success") {
      console.log(`    ${success(`${agent.name} configured`, useColors)}\n`);
    } else if (result.status === "already_configured") {
      console.log(
        `    ${warning(`${agent.name} already configured`, useColors)}\n`,
      );
    } else {
      console.log(`    ${errorFmt(result.message, useColors)}\n`);
    }
  }

  // Summary
  const configured = outcomes.filter((o) => o.status === "success").length;
  const alreadyDone =
    outcomes.filter((o) => o.status === "already_configured").length +
    scan.alreadyConfigured.length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  if (failed > 0) {
    console.log("  Setup completed with errors.");
  } else if (continuedWithoutAuth && (configured > 0 || alreadyDone > 0)) {
    console.log("  MCP is configured, but authentication is still required.");
    console.log("  Run `githits login` before using GitHits tools.");
  } else if (configured > 0 || alreadyDone > 0) {
    console.log("  Done! GitHits is ready.");
  } else if (skipped > 0) {
    console.log("  Setup skipped.");
  }

  if (failed > 0) {
    console.log(
      `  ${failed} agent${failed !== 1 ? "s" : ""} failed to configure.`,
    );
    for (const outcome of outcomes.filter((o) => o.status === "failed")) {
      console.log(
        `    - ${outcome.name}: ${outcome.message ?? "Unknown error"}`,
      );
    }
  }
  if (skipped > 0) {
    console.log(`  ${skipped} agent${skipped !== 1 ? "s" : ""} skipped.`);
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
    `\n  ${colorize("GitHits", "bold", useColors)} — Remove MCP server from your coding agents\n`,
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

    const setupConfig = agent.getSetupConfig(fileSystemService);
    const uninstallConfig =
      setupConfig.method === "config-file"
        ? setupConfig
        : agent.getUninstallConfig?.(fileSystemService);

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
        : await executeConfigFileUninstall(uninstallConfig, fileSystemService);

    if (result.status === "removed") {
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

const INIT_DESCRIPTION = `Set up GitHits MCP server for your coding agents.

Authenticates with your GitHits account, then scans for available agents
(Claude Code, Cursor, Windsurf, VS Code, Cline, Claude Desktop, Codex CLI,
Gemini CLI, Google Antigravity), checks which are already configured,
and sets up unconfigured ones with your confirmation.

Supports CLI-based setup (Claude Code, Codex, Gemini CLI) and config
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
    .summary("Set up MCP server for your coding agents")
    .description(INIT_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, configure all detected agents")
    .option("--skip-login", "Skip authentication step")
    .action(async (options: InitOptions) => {
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      await initAction(options, {
        fileSystemService,
        promptService,
        execService,
        createLoginDeps: () => createAuthCommandDependencies(),
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
