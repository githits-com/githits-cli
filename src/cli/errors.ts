import {
  AuthConfigError,
  AuthStorageLockTimeoutError,
  AuthStoragePolicyError,
} from "../services/index.js";
import { AuthRequiredError } from "../shared/require-auth.js";

export interface CliErrorHandlerDeps {
  stderr: Pick<NodeJS.WriteStream, "write">;
  exit: (code: number) => never;
}

export function handleCliError(
  error: unknown,
  deps: CliErrorHandlerDeps,
): never {
  if (error instanceof AuthRequiredError) {
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
