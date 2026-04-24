import { createContainer, type Dependencies } from "../container.js";
import {
  AuthRequiredError,
  printAuthInstructions,
  requireAuth,
} from "../shared/require-auth.js";
import { performLogin } from "./login.js";

export async function createAuthenticatedDependencies(
  deps: Dependencies,
  login: typeof performLogin = performLogin,
): Promise<Dependencies> {
  if (deps.hasValidToken) {
    return deps;
  }

  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    requireAuth(deps);
  }

  console.log("Not authenticated. Starting login...\n");

  const success = await login(deps);
  if (!success) {
    console.log("");
    printAuthInstructions();
    throw new AuthRequiredError("Authentication failed");
  }

  const refreshed = await deps.refreshAuth();
  return { ...deps, ...refreshed };
}

export function withAuthenticatedAction<TArgs extends unknown[]>(
  action: (...args: [...TArgs, Dependencies]) => Promise<void>,
  options: {
    createDeps?: () => Promise<Dependencies>;
    authenticateDeps?: (deps: Dependencies) => Promise<Dependencies>;
  } = {},
): (...args: unknown[]) => Promise<void> {
  const createDeps = options.createDeps ?? createContainer;
  const authenticateDeps =
    options.authenticateDeps ?? createAuthenticatedDependencies;

  return async (...args: unknown[]) => {
    try {
      const deps = await createDeps();
      const authenticatedDeps = await authenticateDeps(deps);
      const actionArgs = args.slice(0, Math.max(action.length - 1, 0)) as TArgs;
      await action(...actionArgs, authenticatedDeps);
    } catch (error) {
      if (error instanceof AuthRequiredError) {
        process.exit(1);
      }

      throw error;
    }
  };
}
