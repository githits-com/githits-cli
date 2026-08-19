import type { Command } from "commander";
import { shouldRegisterCliCommand } from "../../services/experimental-cli-policy.js";
import { registerCodeDiffCommand } from "./diff.js";
import { registerCodeFilesCommand } from "./files.js";
import { registerCodeGrepCommand } from "./grep.js";
import { registerCodeReadCommand } from "./read.js";

export interface CodeCommandGroupOptions {
  experimentalTools: boolean;
}

/**
 * Registers the code-navigation command group.
 */
export async function registerCodeCommandGroup(
  program: Command,
  options: CodeCommandGroupOptions,
): Promise<void> {
  const diffAvailable = shouldRegisterCliCommand(
    "code diff",
    options.experimentalTools,
  );
  const codeCommand = program
    .command("code")
    .summary("Inspect dependency source code and symbols")
    .description(buildCodeCommandDescription(diffAvailable));

  registerCodeFilesCommand(codeCommand);
  registerCodeReadCommand(codeCommand);
  registerCodeGrepCommand(codeCommand);
  if (diffAvailable) {
    registerCodeDiffCommand(codeCommand);
  }
}

function buildCodeCommandDescription(diffAvailable: boolean): string {
  const operations = diffAvailable
    ? "List files, read files, grep substrings, and compare exact trees"
    : "List files, read files, and grep substrings";
  const diffAddressing = diffAvailable
    ? "; diff keeps both versions or refs in its required `<from>..<to>` range"
    : "";
  return `${operations} inside indexed dependency source. Read/list/grep accept either \`<spec>\` (registry:name[@version]) or \`--repo-url <url> [--git-ref <ref>]\`${diffAddressing}. For package-level metadata use \`githits pkg\`.`;
}
