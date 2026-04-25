import type { Command } from "commander";
import type { CodeNavigationCapability } from "../../services/index.js";
import {
  type GatedCommandGroupOptions,
  resolveGatedCommandGroupRegistrationState,
} from "../gated-command-group.js";
import { registerCodeFilesCommand } from "./files.js";
import { registerCodeGrepCommand } from "./grep.js";
import { registerCodeReadCommand } from "./read.js";
import { registerCodeSearchSymbolsCommand } from "./search-symbols.js";

export interface CodeCommandGroupOptions extends GatedCommandGroupOptions {
  capability?: CodeNavigationCapability;
}

/**
 * Registers the capability-gated code-navigation command group.
 * Only exposed when the token advertises `code_navigation`, the
 * user sets `GITHITS_CODE_NAVIGATION=1` for local development, or
 * stored auth has expired and the direct command path needs a chance
 * to refresh before the CLI can re-evaluate capability.
 */
export async function registerCodeCommandGroup(
  program: Command,
  options: CodeCommandGroupOptions = {},
): Promise<void> {
  const registration = await resolveGatedCommandGroupRegistrationState(options);
  if (!registration.shouldRegister) {
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
