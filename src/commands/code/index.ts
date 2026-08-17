import type { Command } from "commander";
import { registerCodeDiffCommand } from "./diff.js";
import { registerCodeFilesCommand } from "./files.js";
import { registerCodeGrepCommand } from "./grep.js";
import { registerCodeReadCommand } from "./read.js";

/**
 * Registers the code-navigation command group.
 */
export async function registerCodeCommandGroup(
  program: Command,
): Promise<void> {
  const codeCommand = program
    .command("code")
    .summary("Inspect dependency source code and symbols")
    .description(
      "List files, read files, grep substrings, and compare exact trees inside indexed dependency source. Read/list/grep accept either `<spec>` (registry:name[@version]) or `--repo-url <url> [--git-ref <ref>]`; diff keeps both versions or refs in its required `<from>..<to>` range. For package-level metadata use `githits pkg`.",
    );

  registerCodeFilesCommand(codeCommand);
  registerCodeReadCommand(codeCommand);
  registerCodeGrepCommand(codeCommand);
  registerCodeDiffCommand(codeCommand);
}
