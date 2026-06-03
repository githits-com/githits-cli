import { AuthConfigError } from "../services/auth-config.js";
import { AuthStorageLockTimeoutError } from "../services/locked-auth-storage.js";
import { AuthStoragePolicyError } from "../services/mode-aware-file-auth-storage.js";
import {
  AuthRequiredError,
  formatAuthRequiredForTerminal,
} from "../shared/require-auth.js";

export interface CliErrorHandlerDeps {
  stderr: Pick<NodeJS.WriteStream, "write">;
  exit: (code: number) => never;
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

  throw error;
}

function isUserFacingError(error: unknown): error is Error {
  return (
    error instanceof AuthConfigError ||
    error instanceof AuthStorageLockTimeoutError ||
    error instanceof AuthStoragePolicyError
  );
}
