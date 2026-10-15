import {
  normalizeSingleLineText,
  SessionIdConfigError,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  buildAuthRequiredErrorPayload,
  formatAuthRequiredForTerminal,
} from "@githits/mcp/internal";
import { CommanderError, InvalidArgumentError } from "commander";
import { AuthConfigError } from "../services/auth-config.js";
import { ExperimentalToolsDisabledError } from "../services/experimental-cli-policy.js";
import { ExperimentalConfigError } from "../services/experimental-config.js";
import { AuthStorageLockTimeoutError } from "../services/locked-auth-storage.js";
import { AuthStoragePolicyError } from "../services/mode-aware-file-auth-storage.js";
import { isDebugAreaEnabled } from "../shared/debug-log.js";

export interface CliErrorHandlerDeps {
  stderr: Pick<NodeJS.WriteStream, "write">;
  exit: (code: number) => never;
  json?: boolean;
}

export async function runCliMain(
  operation: () => Promise<void>,
  deps: CliErrorHandlerDeps,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    handleCliError(error, deps);
  }
}

export function handleCliError(
  error: unknown,
  deps: CliErrorHandlerDeps,
): never {
  // Commander also throws after successfully printing help or version.
  if (error instanceof CommanderError && error.exitCode === 0) {
    deps.exit(0);
  }

  if (deps.json) {
    const argumentError = isJsonArgumentError(error);
    const message =
      error instanceof CommanderError && error.code === "commander.help"
        ? "Unknown or missing command. Run githits --help for usage."
        : isUserFacingError(error) || error instanceof CommanderError
          ? error.message
          : error instanceof Error
            ? normalizeSingleLineText(error.message) || "Unexpected error."
            : "Unexpected error.";
    const payload =
      error instanceof AuthRequiredError
        ? buildAuthRequiredErrorPayload(error)
        : {
            error: message,
            code: argumentError ? "INVALID_ARGUMENT" : "UNKNOWN",
            retryable: false,
          };
    deps.stderr.write(`${JSON.stringify(payload)}\n`);
    deps.exit(1);
  }

  if (error instanceof AuthRequiredError) {
    deps.stderr.write(`${formatAuthRequiredForTerminal(error)}\n`);
    deps.exit(1);
  }

  if (isUserFacingError(error)) {
    deps.stderr.write(`${error.message}\n\n`);
    deps.exit(1);
  }

  const message =
    error instanceof Error
      ? normalizeSingleLineText(error.message) || "Unexpected error."
      : "Unexpected error.";
  deps.stderr.write(`${message}\n`);
  if (error instanceof Error && isDebugAreaEnabled("cli") && error.stack) {
    deps.stderr.write(`${error.stack}\n`);
  }
  deps.stderr.write(
    "Run 'githits doctor' to diagnose, or report this at https://github.com/githits-com/githits-cli/issues\n",
  );
  deps.exit(1);
}

function isUserFacingError(error: unknown): error is Error {
  return (
    error instanceof AuthConfigError ||
    error instanceof SessionIdConfigError ||
    error instanceof ExperimentalConfigError ||
    error instanceof ExperimentalToolsDisabledError ||
    error instanceof AuthStorageLockTimeoutError ||
    error instanceof AuthStoragePolicyError ||
    error instanceof InvalidArgumentError
  );
}

function isJsonArgumentError(error: unknown): error is Error {
  return (
    error instanceof CommanderError ||
    error instanceof AuthConfigError ||
    error instanceof SessionIdConfigError ||
    error instanceof ExperimentalConfigError ||
    error instanceof ExperimentalToolsDisabledError ||
    error instanceof InvalidArgumentError
  );
}
