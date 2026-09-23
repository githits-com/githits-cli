import type { ReadService } from "@githits/core-internal";
import {
  createReadFileServiceAdapter,
  createReadPackageDocServiceAdapter,
  DEFAULT_WAIT_TIMEOUT_MS,
  formatSelectorRead,
  InvalidPackageSpecError,
  MAX_WAIT_TIMEOUT_MS,
  mapCodeNavigationError,
  mapPackageIntelligenceError,
  normalizeReadWaitTimeoutMs,
  parseLinesOption,
  requireAuth,
  resolveReadLocator,
  shouldUseColors,
  validateReadRange,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../container.js";
import { recordCliErrorClassification } from "../shared/cli-error-diagnostics.js";
import { startSpinner } from "../shared/spinner.js";
import { SPINNER_MESSAGES } from "../shared/spinner-messages.js";
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
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ReadCommandDependencies
  extends PkgReadCommandDependencies,
    DocsReadCommandDependencies {
  readService: ReadService;
}

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

  if (options.selector !== undefined) {
    try {
      const selector = options.selector;
      if (!selector.trim())
        throw new InvalidPackageSpecError("--selector must be nonblank.");
      if (!options.repoUrl && options.gitRef !== undefined) {
        throw new InvalidPackageSpecError(
          "Provide either a compact target or --repo-url with optional --git-ref, not both.",
        );
      }
      if (options.repoUrl && secondArg !== undefined) {
        throw new InvalidPackageSpecError(
          "In --repo-url mode, pass at most one <path> positional.",
        );
      }
      const target = options.repoUrl
        ? `${options.repoUrl}${options.gitRef ? `@${options.gitRef}` : ""}`
        : (firstArg ?? "");
      const path = options.repoUrl ? firstArg : secondArg;
      const locator = resolveReadLocator(target, path);
      if (
        options.lines !== undefined &&
        (options.start !== undefined || options.end !== undefined)
      ) {
        throw new InvalidPackageSpecError(
          "Use --lines or --start / --end, not both.",
        );
      }
      const range = options.lines
        ? parseLinesOption(options.lines)
        : {
            startLine: parseIntCliOption(
              options.start,
              "--start",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
            endLine: parseIntCliOption(
              options.end,
              "--end",
              1,
              Number.MAX_SAFE_INTEGER,
            ),
          };
      validateReadRange(range.startLine, range.endLine);
      const wait = normalizeReadWaitTimeoutMs(
        parseIntCliOption(options.wait, "--wait", 0, MAX_WAIT_TIMEOUT_MS),
      );
      const spinner = startSpinner(SPINNER_MESSAGES.code, !options.json);
      const response = await deps.readService
        .read({
          target: locator.target,
          ...(locator.path ? { path: locator.path } : {}),
          selector,
          ...(range.startLine !== undefined
            ? { startLine: range.startLine }
            : {}),
          ...(range.endLine !== undefined ? { endLine: range.endLine } : {}),
          waitTimeoutMs: wait,
        })
        .finally(() => spinner.stop());
      const rendered = formatSelectorRead(
        response,
        {
          target: locator.target,
          selector,
          path: locator.path,
          verbose: options.verbose,
          useColors: shouldUseColors(),
          endLine: range.endLine,
        },
        options.json ? "cli-json" : "cli-text",
      );
      if (options.json) console.log(rendered);
      else process.stdout.write(rendered);
      return;
    } catch (error) {
      const docsError = mapPackageIntelligenceError(error);
      const mapped =
        docsError.code !== "UNKNOWN"
          ? docsError
          : mapCodeNavigationError(error);
      recordCliErrorClassification(
        docsError.code !== "UNKNOWN" ? "pkg-intel" : "code-nav",
        error,
        mapped,
      );
      if (options.json)
        console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
      else console.error(formatMappedErrorForTerminal(mapped));
      process.exit(1);
    }
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
    await pkgReadAction(target, path, options, {
      ...deps,
      codeNavigationService: createReadFileServiceAdapter(
        deps.readService,
        target,
      ),
    });
  } else {
    await docsReadAction(target, options, {
      ...deps,
      packageIntelligenceService: createReadPackageDocServiceAdapter(
        deps.readService,
      ),
    });
  }
}

export function registerReadCommand(program: Command): Command {
  return program
    .command("read")
    .summary("Read an indexed file, code symbol, or docs section")
    .description(
      "Read an exact file with <target> <path>, or a docs page with <target>. --selector selects a code symbol (path optional) or docs heading by its fragment ID; do not combine it with a docs URL fragment. Hosted/crawled docs read mutable current content; repository docs are snapshot-addressed. A docs URL fragment selects the heading's full subtree; --lines selects a page-relative range instead. Output is complete for piping.",
    )
    .argument(
      "[target-or-path]",
      "Docs target/page ID or package/repository target; with --repo-url, the file path",
    )
    .argument("[path]", "Exact file path within the package or repository")
    .option("--repo-url <url>", "Repository URL addressing")
    .option("--git-ref <ref>", "Git ref for --repo-url (code only)")
    .option(
      "--selector <name>",
      "Code symbol or logical documentation heading ID",
    )
    .option("--lines <range>", "Inclusive line range, e.g. 10-40, 10-, or -40")
    .option(
      "--start <n>",
      "Starting line (code or docs selector; alternative to --lines)",
    )
    .option(
      "--end <n>",
      "Ending line (code or docs selector; alternative to --lines)",
    )
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
