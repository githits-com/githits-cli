import type { Command } from "commander";
import { resolveStartupCodeNavigationRegistrationState } from "../../container.js";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
  getEnvApiToken,
  isCodeNavigationCliOverrideEnabled,
} from "../../services/index.js";
import { registerCodeFilesCommand } from "./files.js";
import { registerCodeGrepCommand } from "./grep.js";
import { registerCodeReadCommand } from "./read.js";
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
    .summary("Source-level operations on indexed dependencies")
    .description(
      "Search exact tokens, list files, read files, and grep substrings inside indexed dependency source. Every command accepts either `<spec>` (registry:name[@version]) or `--repo-url <url> --git-ref <ref>`. For package-level metadata (versions, vulnerabilities, dependencies, changelog) use `githits pkg`.",
    );

  registerCodeSearchSymbolsCommand(codeCommand);
  registerCodeFilesCommand(codeCommand);
  registerCodeReadCommand(codeCommand);
  registerCodeGrepCommand(codeCommand);
}
