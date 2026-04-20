import type { Command } from "commander";
import { resolveStartupCodeNavigationRegistrationState } from "../../container.js";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
  getEnvApiToken,
  isCodeNavigationCliOverrideEnabled,
} from "../../services/index.js";
import { registerCodeSearchSymbolsCommand } from "./search-symbols.js";

export interface CodeCommandGroupOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
  envTokenPresent?: boolean;
  expiredStoredAuth?: boolean;
}

/**
 * Registers the capability-gated code-navigation command group.
 * Only exposed when the token advertises `code_navigation`, the
 * user sets `GITHITS_CODE_NAVIGATION=1`, an opaque env token is
 * present, or stored auth has expired.
 */
export async function registerCodeCommandGroup(
  program: Command,
  options: CodeCommandGroupOptions = {},
): Promise<void> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return;
  }

  const overrideEnabled =
    options.overrideEnabled ?? isCodeNavigationCliOverrideEnabled();
  const registrationState =
    options.capability !== undefined || options.expiredStoredAuth !== undefined
      ? {
          capability: options.capability ?? "unknown",
          expiredStoredAuth: options.expiredStoredAuth ?? false,
        }
      : await resolveStartupCodeNavigationRegistrationState();
  const capability = registrationState.capability;
  const envTokenPresent = options.envTokenPresent ?? Boolean(getEnvApiToken());

  if (
    !overrideEnabled &&
    capability !== "enabled" &&
    !envTokenPresent &&
    !registrationState.expiredStoredAuth
  ) {
    return;
  }

  const codeCommand = program
    .command("code")
    .summary("Search indexed dependency source code")
    .description(
      "Code-navigation commands for searching indexed dependency source. Requires the `code_navigation` capability on the active account.",
    );

  registerCodeSearchSymbolsCommand(codeCommand);
}
