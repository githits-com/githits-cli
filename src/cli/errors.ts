import {
  isDebugAreaEnabled,
  normalizeSingleLineText,
} from "@githits/core-internal";
import {
  AuthRequiredError,
  formatAuthRequiredForTerminal,
} from "@githits/mcp/internal";
import { AuthConfigError } from "../services/auth-config.js";
import { AuthStorageLockTimeoutError } from "../services/locked-auth-storage.js";
import { AuthStoragePolicyError } from "../services/mode-aware-file-auth-storage.js";

export interface CliErrorHandlerDeps {
  stderr: Pick<NodeJS.WriteStream, "write">;
  exit: (code: number) => never;
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
    error instanceof AuthStorageLockTimeoutError ||
    error instanceof AuthStoragePolicyError
  );
}
