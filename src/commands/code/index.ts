import type { Command } from "commander";
import {
  type CodeNavigationCapability,
  getCodeNavigationUrl,
} from "../../services/index.js";
import { isCodeNavigationCliSurfaceOpen } from "../../shared/code-navigation-cli-surface.js";
import { registerCodeFilesCommand } from "./files.js";
import { registerCodeGrepCommand } from "./grep.js";
import { registerCodeReadCommand } from "./read.js";

export interface CodeCommandGroupOptions {
  codeNavigationUrl?: string;
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
}

/**
 * Registers the code-navigation command group only when the endpoint URL
 * is configured and the capability gate is open for the CLI surface.
 */
export async function registerCodeCommandGroup(
  program: Command,
  options: CodeCommandGroupOptions = {},
): Promise<void> {
  const codeNavigationUrl = options.codeNavigationUrl ?? getCodeNavigationUrl();
  if (!codeNavigationUrl) {
    return;
  }

  if (!isCodeNavigationCliSurfaceOpen(options)) {
    return;
  }

  const codeCommand = program
    .command("code")
    .summary("Source-level operations on indexed dependencies")
    .description(
      "List files, read files, and grep substrings inside indexed dependency source. Every command accepts either `<spec>` (registry:name[@version]) or `--repo-url <url> --git-ref <ref>`. For symbol or unified discovery search use `githits search`; for package-level metadata use `githits pkg`.",
    );

  registerCodeFilesCommand(codeCommand);
  registerCodeReadCommand(codeCommand);
  registerCodeGrepCommand(codeCommand);
}
