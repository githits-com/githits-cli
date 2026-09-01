import { getAuthConfigPath } from "./app-config-paths.js";
import {
  ExperimentalConfigError,
  type ExperimentalSettings,
  loadExperimentalSettings,
} from "./experimental-config.js";
import type { FileSystemService } from "./filesystem-service.js";

/** The CLI command paths gated by the experimental tools setting. */
export const EXPERIMENTAL_CLI_COMMANDS = [
  "ask",
  "resolve",
  "code diff",
] as const;
export type ExperimentalCliCommand = (typeof EXPERIMENTAL_CLI_COMMANDS)[number];

export class ExperimentalToolsDisabledError extends Error {
  constructor(commandPath: ExperimentalCliCommand, configPath: string) {
    super(
      `Experimental CLI command "${commandPath}" is disabled. Enable it in ${configPath} by adding:\n[experimental]\ntools = true`,
    );
    this.name = "ExperimentalToolsDisabledError";
  }
}

/** Return whether a command path belongs to the experimental CLI suite. */
export function isExperimentalCliCommand(
  commandPath: string,
): commandPath is ExperimentalCliCommand {
  return EXPERIMENTAL_CLI_COMMANDS.includes(
    commandPath as ExperimentalCliCommand,
  );
}

/** Return whether a command should be registered for the resolved policy. */
export function shouldRegisterCliCommand(
  commandPath: string,
  experimentalTools: boolean,
): boolean {
  return !isExperimentalCliCommand(commandPath) || experimentalTools;
}

/**
 * Detect a direct experimental invocation, including Commander help forms.
 * Root-only options are ignored because they may precede the command path.
 */
export function getExperimentalCliCommand(
  args: readonly string[],
): ExperimentalCliCommand | undefined {
  const normalizedArgs = args.filter((arg) => arg !== "--no-color");
  const commandArgs =
    normalizedArgs[0] === "help" ? normalizedArgs.slice(1) : normalizedArgs;
  for (const commandPath of EXPERIMENTAL_CLI_COMMANDS) {
    const commandSegments = commandPath.split(" ");
    if (
      commandSegments.every((segment, index) => commandArgs[index] === segment)
    ) {
      return commandPath;
    }
  }
  return undefined;
}

/**
 * Resolve the host experimental policy before startup work begins.
 *
 * Non-experimental invocations fall back to the stable CLI when the
 * experimental subsection is malformed. Direct experimental invocations
 * consume the setting strictly and surface the original config error.
 */
export async function resolveExperimentalCliPolicy(
  fs: FileSystemService,
  args: readonly string[],
): Promise<ExperimentalSettings> {
  const commandPath = getExperimentalCliCommand(args);
  try {
    const settings = await loadExperimentalSettings(fs);
    if (commandPath && !settings.tools) {
      throw new ExperimentalToolsDisabledError(
        commandPath,
        settings.configPath,
      );
    }
    return settings;
  } catch (error) {
    if (commandPath) {
      throw error;
    }
    if (!(error instanceof ExperimentalConfigError)) {
      throw error;
    }
    return {
      tools: false,
      reportToolIssues: undefined,
      configPath: getAuthConfigPath(fs),
    };
  }
}
