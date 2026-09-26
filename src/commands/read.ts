import {
  MalformedCodeNavigationResponseError,
  type ReadService,
  toPkgseerRegistryLowercase,
} from "@githits/core-internal";
import {
  buildReadFileSuccessPayload,
  DEFAULT_WAIT_TIMEOUT_MS,
  formatReadFileTerminal,
  formatReadResult,
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
import {
  formatFileErrorWithFilesHint,
  handleCodeNavCommandError,
  parseIntCliOption,
  resolveCliCodeNavTarget,
  withCliReadFileRecovery,
} from "./code/code-nav-cli-helpers.js";
import {
  buildCliReadFileParams,
  type PkgReadCommandDependencies,
  type PkgReadCommandOptions,
  parsePathWithOptionalRange,
  pkgReadAction,
  resolveLineRange,
} from "./code/read.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "./format-mapped-error.js";

export interface ReadCommandDependencies extends PkgReadCommandDependencies {
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

  if (options.selector !== undefined || !options.repoUrl) {
    let requestedFilePath = "";
    let exactFile = false;
    let exactRequest:
      | ReturnType<typeof buildCliReadFileParams>["params"]
      | undefined;
    try {
      const selector = options.selector;
      if (selector !== undefined && !selector.trim())
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
      exactFile =
        selector === undefined &&
        locator.path !== undefined &&
        !locator.target.includes("#");
      const pathWithRange =
        exactFile && locator.path
          ? parsePathWithOptionalRange(locator.path)
          : undefined;
      if (pathWithRange) requestedFilePath = pathWithRange.filePath;
      if (
        !exactFile &&
        options.lines !== undefined &&
        (options.start !== undefined || options.end !== undefined)
      ) {
        throw new InvalidPackageSpecError(
          "Use --lines or --start / --end, not both.",
        );
      }
      const range = pathWithRange
        ? resolveLineRange(options, pathWithRange)
        : options.lines
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
      if (!exactFile) validateReadRange(range.startLine, range.endLine);
      const wait = normalizeReadWaitTimeoutMs(
        parseIntCliOption(options.wait, "--wait", 0, MAX_WAIT_TIMEOUT_MS),
      );
      if (pathWithRange) {
        const exactTarget = resolveCliCodeNavTarget(locator.target, {});
        const build = buildCliReadFileParams({
          target: exactTarget,
          filePath: pathWithRange.filePath,
          startLine: range.startLine,
          endLine: range.endLine,
          waitTimeoutMs: wait,
        });
        exactRequest = build.params;
        requestedFilePath = exactRequest.filePath;
      }
      const spinner = startSpinner("Reading indexed content...", !options.json);
      const response = await deps.readService
        .read({
          target: locator.target,
          ...(locator.path
            ? { path: exactRequest?.filePath ?? locator.path }
            : {}),
          ...(selector !== undefined ? { selector } : {}),
          ...(range.startLine !== undefined
            ? { startLine: range.startLine }
            : {}),
          ...(range.endLine !== undefined ? { endLine: range.endLine } : {}),
          waitTimeoutMs: wait,
        })
        .finally(() => spinner.stop());
      if (exactRequest) {
        if (response.source !== "code") {
          throw new MalformedCodeNavigationResponseError(
            "Malformed response from code navigation service.",
          );
        }
        const servedSha = response.result.targetResolution?.served?.commitSha;
        // Current repository-page IDs append the file path to a pinned SHA.
        // The code-target parser treats that suffix as part of the ref.
        const snapshotPageId =
          /@[a-f0-9]{40}\//i.test(locator.target) &&
          locator.target.endsWith(`/${requestedFilePath}`);
        const payload = buildReadFileSuccessPayload(response.result, {
          registry: exactRequest.target.registry
            ? toPkgseerRegistryLowercase(exactRequest.target.registry)
            : undefined,
          name: exactRequest.target.packageName,
          repoUrl: exactRequest.target.repoUrl,
          gitRef: snapshotPageId ? servedSha : exactRequest.target.gitRef,
          requestedFilePath,
        });
        if (options.json) console.log(JSON.stringify(payload));
        else
          process.stdout.write(
            formatReadFileTerminal(payload, {
              useColors: shouldUseColors(),
              verbose: options.verbose,
            }),
          );
        return;
      }
      const rendered = formatReadResult(
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
      if (exactFile) {
        handleCodeNavCommandError(
          error,
          options.json ?? false,
          formatFileErrorWithFilesHint,
          1,
          (mapped) => withCliReadFileRecovery(mapped, requestedFilePath),
        );
      }
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
  return pkgReadAction(firstArg, secondArg, options, deps);
}

export function registerReadCommand(program: Command): Command {
  return program
    .command("read")
    .summary("Read an indexed file, code symbol, or docs section")
    .description(
      "Read an exact file with <target> <path> (optionally <path>:N-M), a code symbol with <target>#symbol (optional exact path), or a docs page with <target>. The resolved target determines code or docs presentation; preserve emitted docs locators. --selector selects a code symbol or docs heading by its fragment ID; do not combine it with a docs URL fragment. Hosted/crawled docs read mutable current content; repository docs are snapshot-addressed and return indexed file content. An HTTP(S) docs URL fragment selects the heading's full subtree; explicit bounds select a page-relative range instead. Output is complete for piping.",
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
    .option("--start <n>", "Starting line (alternative to --lines)")
    .option("--end <n>", "Ending line (alternative to --lines)")
    .option(
      "--wait <ms>",
      `Indexing wait (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS})`,
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
