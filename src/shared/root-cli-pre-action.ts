import type { Command } from "commander";
import type {
  LoginDependencies,
  LoginFlowResult,
  LoginOptions,
} from "../commands/login.js";
import { maybeAutoLoginBeforeCommand } from "./auto-login.js";

export interface RootCliPreActionDependencies {
  createContainer: () => Promise<
    LoginDependencies & { hasValidToken: boolean }
  >;
  loginFlow: (
    options: LoginOptions,
    deps: LoginDependencies,
  ) => Promise<LoginFlowResult>;
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
    const authResult = await maybeAutoLoginBeforeCommand(command, deps);
    if (authResult.status !== "failed") {
      return;
    }

    console.error(`${authResult.message}\n`);
    console.error("Run `githits login` to try again.");
    (deps.exit ?? process.exit)(1);
  };
}
