import { ExitPromptError } from "@inquirer/core";
import type { Command } from "commander";
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
import {
  agentDefinitions,
  buildCheckboxChoices,
  detectAgents,
} from "./agent-definitions.js";
import {
  executeCliSetup,
  executeConfigFileSetup,
  formatSetupPreview,
} from "./setup-handlers.js";

/** Options for the init command */
export interface InitOptions {
  /** Skip all prompts, configure all detected agents */
  yes?: boolean;
}

/** Dependencies for the init command (not from createContainer) */
export interface InitDependencies {
  fileSystemService: FileSystemService;
  promptService: PromptService;
  execService: ExecService;
}

/** Tracks per-agent setup outcome for the summary */
interface AgentOutcome {
  name: string;
  status: "success" | "already_configured" | "failed" | "skipped";
}

/**
 * Core init logic, separated from CLI registration for testability.
 * Scans for installed agents, prompts for selection, configures each sequentially.
 */
export async function initAction(
  options: InitOptions,
  deps: InitDependencies,
): Promise<void> {
  const useColors = shouldUseColors();
  const { fileSystemService, promptService, execService } = deps;

  // Header
  console.log(
    `\n  ${colorize("GitHits", "bold", useColors)} — Set up MCP server for your coding agents\n`,
  );

  // Detect installed agents
  console.log("  Scanning for installed agents...\n");
  const detectedIds = await detectAgents(agentDefinitions, fileSystemService);

  // Determine which agents to configure
  let selectedIds: string[];

  if (options.yes) {
    // Non-interactive: use all detected agents
    if (detectedIds.length === 0) {
      console.log(
        "  No coding agents detected. Install an agent and try again.\n",
      );
      return;
    }
    const names = agentDefinitions
      .filter((a) => detectedIds.includes(a.id))
      .map((a) => a.name)
      .join(", ");
    console.log(`  Detected: ${colorize(names, "cyan", useColors)}\n`);
    selectedIds = detectedIds;
  } else {
    // Interactive: show checkbox
    const choices = buildCheckboxChoices(agentDefinitions, detectedIds);
    try {
      selectedIds = await promptService.checkbox(
        "Select agents to configure",
        choices,
      );
    } catch (err) {
      if (err instanceof ExitPromptError) {
        console.log("\n  Setup cancelled.\n");
        return;
      }
      throw err;
    }
  }

  if (selectedIds.length === 0) {
    console.log("  No agents selected.\n");
    return;
  }

  // Sequential setup with confirmation
  const outcomes: AgentOutcome[] = [];
  let alwaysMode = options.yes ?? false;

  for (const agentId of selectedIds) {
    const agent = agentDefinitions.find((a) => a.id === agentId);
    if (!agent) continue;

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
        outcomes.push({ name: agent.name, status: "skipped" });
        console.log();
        continue;
      }
      if (choice === "always") {
        alwaysMode = true;
      }
    }

    // Execute setup
    const result =
      config.method === "cli"
        ? await executeCliSetup(config, execService)
        : await executeConfigFileSetup(config, fileSystemService);

    // Record and display outcome
    outcomes.push({ name: agent.name, status: result.status });

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
  const alreadyDone = outcomes.filter(
    (o) => o.status === "already_configured",
  ).length;
  const failed = outcomes.filter((o) => o.status === "failed").length;
  const skipped = outcomes.filter((o) => o.status === "skipped").length;

  if (configured > 0 || alreadyDone > 0) {
    console.log("  Done! GitHits is ready.");
  } else if (failed > 0) {
    console.log("  Setup completed with errors.");
  } else if (skipped > 0) {
    console.log("  Setup skipped.");
  }

  if (failed > 0) {
    console.log(
      `  ${failed} agent${failed !== 1 ? "s" : ""} failed to configure.`,
    );
  }
  if (skipped > 0) {
    console.log(`  ${skipped} agent${skipped !== 1 ? "s" : ""} skipped.`);
  }

  console.log("  Run `githits login` if you haven't authenticated yet.\n");
}

const INIT_DESCRIPTION = `Set up GitHits MCP server for your coding agents.

Scans for installed agents (Claude Code, Cursor, Windsurf, Claude Desktop,
Codex CLI), lets you select which to configure, and sets up each one
with your confirmation.

Supports both CLI-based setup (Claude Code, Codex) and config file
editing (Cursor, Windsurf, Claude Desktop) with atomic writes.`;

/**
 * Register the init command on the given program.
 * Creates its own lightweight dependencies (no auth needed).
 */
export function registerInitCommand(program: Command) {
  program
    .command("init")
    .summary("Set up MCP server for your coding agents")
    .description(INIT_DESCRIPTION)
    .option("-y, --yes", "Skip prompts, configure all detected agents")
    .action(async (options: InitOptions) => {
      const fileSystemService = new FileSystemServiceImpl();
      const promptService = new PromptServiceImpl();
      const execService = new ExecServiceImpl();
      await initAction(options, {
        fileSystemService,
        promptService,
        execService,
      });
    });
}
