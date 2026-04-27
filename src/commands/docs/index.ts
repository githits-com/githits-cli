import type { Command } from "commander";
import type { CodeNavigationCapability } from "../../services/index.js";
import {
  type GatedCommandGroupOptions,
  resolveGatedCommandGroupRegistrationState,
} from "../gated-command-group.js";
import { registerDocsListCommand } from "./list.js";
import { registerDocsReadCommand } from "./read.js";

export interface DocsCommandGroupOptions extends GatedCommandGroupOptions {
  capability?: CodeNavigationCapability;
}

export async function registerDocsCommandGroup(
  program: Command,
  options: DocsCommandGroupOptions = {},
): Promise<void> {
  const registration = await resolveGatedCommandGroupRegistrationState(options);
  if (!registration.shouldRegister) {
    return;
  }

  const docsCommand = program
    .command("docs")
    .summary("Browse and read mixed package documentation")
    .description(
      "Browse and read package documentation across hosted docs and repository-backed docs. Docs are mixed by default; entries are source-badged and repo-backed pages also expose exact file follow-up metadata.",
    );

  registerDocsListCommand(docsCommand);
  registerDocsReadCommand(docsCommand);
}
