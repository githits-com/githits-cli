import type { Command } from "commander";
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
      "List files, read files, and grep substrings inside indexed dependency source. Every command accepts either `<spec>` (registry:name[@version]) or `--repo-url <url> [--git-ref <ref>]`. Omitted package versions use the latest release; omitted repo refs use the default-branch intent. For package-level metadata use `githits pkg`.",
    );

  registerCodeFilesCommand(codeCommand);
  registerCodeReadCommand(codeCommand);
  registerCodeGrepCommand(codeCommand);
}
