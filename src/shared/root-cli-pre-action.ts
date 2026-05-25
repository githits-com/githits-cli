import type { Command } from "commander";
import {
  type LoginDependencies,
  type LoginFlowResult,
  type LoginOptions,
  printAutoLoginRecoveryHint,
} from "../commands/login.js";
import type { AuthSessionMetadata } from "../services/auth-session-metadata-storage.js";
import { getCommandPath, maybeAutoLoginBeforeCommand } from "./auto-login.js";
import { getAuthenticatedCommandMetadata } from "./command-metadata.js";

export interface RootCliPreActionDependencies {
  loadAuthSessionMetadata?: () => Promise<AuthSessionMetadata | null>;
  clearAuthSessionMetadata?: () => Promise<void>;
  createContainer: () => Promise<
    LoginDependencies & { hasValidToken: boolean }
  >;
  loginFlow: (
    options: LoginOptions,
    deps: LoginDependencies,
  ) => Promise<LoginFlowResult>;
  stdinIsTTY?: boolean;
  stdoutIsTTY?: boolean;
  exit?: (code: number) => void;
}

export function createRootCliPreAction(
  deps: RootCliPreActionDependencies,
): (thisCommand: Command, actionCommand?: Command) => Promise<void> {
  return async (thisCommand: Command, actionCommand?: Command) => {
    if (thisCommand.opts().color === false) {
      process.env.NO_COLOR = "1";
    }

    const command = actionCommand ?? thisCommand;
    const authResult = await maybeAutoLoginBeforeCommand(command, {
      ...deps,
      stdinIsTTY: deps.stdinIsTTY,
      stdoutIsTTY: deps.stdoutIsTTY,
    });
    if (authResult.status === "authenticated") {
      const continuationMessage = getPostLoginContinuationMessage(command);
      if (continuationMessage) {
        console.error(continuationMessage);
      }
    }

    if (authResult.status !== "failed") {
      return;
    }

    const failureMessage = authResult.message ?? "Authentication failed.";
    console.error(`${failureMessage}\n`);
    printAutoLoginRecoveryHint(failureMessage);
    (deps.exit ?? process.exit)(1);
  };
}

function getPostLoginContinuationMessage(command: Command): string | undefined {
  return getAuthenticatedCommandMetadata(getCommandPath(command).join(" "))
    ?.postLoginMessage;
}
