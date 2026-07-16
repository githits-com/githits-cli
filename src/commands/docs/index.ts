import type { Command } from "commander";
import { registerDocsListCommand } from "./list.js";
import { registerDocsReadCommand } from "./read.js";

export async function registerDocsCommandGroup(
  program: Command,
): Promise<void> {
  const docsCommand = program
    .command("docs")
    .summary("Browse and read package documentation")
    .description(
      "Browse and read package documentation across hosted docs and repository-backed docs. Docs are mixed by default; entries are source-badged and repo-backed pages also expose exact file follow-up metadata.",
    );

  registerDocsListCommand(docsCommand);
  registerDocsReadCommand(docsCommand);
}
