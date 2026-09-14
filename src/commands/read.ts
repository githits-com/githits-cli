import {
  DEFAULT_WAIT_TIMEOUT_MS,
  InvalidPackageSpecError,
  MAX_WAIT_TIMEOUT_MS,
  normalizeReadWaitTimeoutMs,
  requireAuth,
  resolveReadLocator,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import {
  handleCodeNavCommandError,
  parseIntCliOption,
} from "./code/code-nav-cli-helpers.js";
import {
  type PkgReadCommandDependencies,
  type PkgReadCommandOptions,
  pkgReadAction,
} from "./code/read.js";
import {
  type DocsReadCommandDependencies,
  docsReadAction,
} from "./docs/read.js";
import { formatMappedErrorForTerminal } from "./format-mapped-error.js";

export interface ReadCommandDependencies
  extends PkgReadCommandDependencies,
    DocsReadCommandDependencies {}

/** Dispatch CLI reads without imposing the MCP output caps on piped content. */
export async function readAction(
  firstArg: string | undefined,
  secondArg: string | undefined,
  options: PkgReadCommandOptions,
  deps: ReadCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json)
      handleCodeNavCommandError(error, true, formatMappedErrorForTerminal);
    throw error;
  }

  // Explicit repo mode keeps the existing single-path positional contract.
  if (options.repoUrl !== undefined) {
    return pkgReadAction(firstArg, secondArg, options, deps);
  }
  let target: string;
  let path: string | undefined;
  try {
    ({ target, path } = resolveReadLocator(firstArg ?? "", secondArg));
    if (!path) {
      if (
        options.start !== undefined ||
        options.end !== undefined ||
        options.gitRef !== undefined
      ) {
        throw new InvalidPackageSpecError(
          "Documentation reads use --lines for page-relative ranges; --start, --end and --git-ref are code-only.",
        );
      }
      normalizeReadWaitTimeoutMs(
        parseIntCliOption(options.wait, "--wait", 0, MAX_WAIT_TIMEOUT_MS),
      );
    }
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatMappedErrorForTerminal,
    );
  }
  if (path) {
    await pkgReadAction(target, path, options, deps);
  } else {
    await docsReadAction(target, options, deps);
  }
}

export function registerReadCommand(program: Command): Command {
  return program
    .command("read")
    .summary("Read an indexed file or documentation page")
    .description(
      "Read a file with <target> <path>, or a docs page with its emitted target alone. Pass docs URL fragments unchanged to select their indexed section; --lines overrides the fragment. Default output is complete content for piping. Package and repository targets use the same compact syntax as code files.",
    )
    .argument(
      "[target-or-path]",
      "Docs target/page ID or package/repository target; with --repo-url, the file path",
    )
    .argument("[path]", "Exact file path within the package or repository")
    .option("--repo-url <url>", "Repository URL addressing")
    .option("--git-ref <ref>", "Git ref for --repo-url (code only)")
    .option("--lines <range>", "Inclusive line range, e.g. 10-40, 10-, or -40")
    .option("--start <n>", "Starting line (code only; alternative to --lines)")
    .option("--end <n>", "Ending line (code only; alternative to --lines)")
    .option(
      "--wait <ms>",
      `Code indexing wait (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS}); validated but unused for docs`,
    )
    .option("-v, --verbose", "Show metadata and line numbers")
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        target: string | undefined,
        path: string | undefined,
        options: PkgReadCommandOptions,
      ) => {
        const deps = await createContainer();
        await readAction(target, path, options, deps);
      },
    );
}
