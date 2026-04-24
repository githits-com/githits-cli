import type { Command } from "commander";
import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOptions,
} from "../commands/login.js";
import { getCommandPath, maybeAutoLoginBeforeCommand } from "./auto-login.js";

export interface RootCliPreActionDependencies {
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

    console.error(`${authResult.message}\n`);
    console.error("Run `githits login` to try again.");
    (deps.exit ?? process.exit)(1);
  };
}

function getPostLoginContinuationMessage(command: Command): string | undefined {
  switch (getCommandPath(command).join(" ")) {
    case "example":
      return "Authentication complete. Running example search...";
    case "languages":
      return "Authentication complete. Loading supported languages...";
    case "feedback":
      return "Authentication complete. Submitting feedback...";
    default:
      return undefined;
  }
}
