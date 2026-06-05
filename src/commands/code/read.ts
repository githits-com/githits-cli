import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "../../shared/code-navigation-defaults.js";
import { shouldUseColors } from "../../shared/colors.js";
import { InvalidPackageSpecError } from "../../shared/package-spec.js";
import { withReadFileRecovery } from "../../shared/read-file-error.js";
import { buildReadFileParams } from "../../shared/read-file-request.js";
import {
  buildReadFileSuccessPayload,
  formatReadFileTerminal,
} from "../../shared/read-file-response.js";
import { requireAuth } from "../../shared/require-auth.js";
import { startSpinner } from "../../shared/spinner.js";
import { SPINNER_MESSAGES } from "../../shared/spinner-messages.js";
import {
  formatFileErrorWithFilesHint,
  handleCodeNavCommandError,
  parseIntCliOption,
  resolveCliCodeNavTarget,
} from "./code-nav-cli-helpers.js";

export interface PkgReadCommandOptions {
  repoUrl?: string;
  gitRef?: string;
  lines?: string;
  start?: string;
  end?: string;
  wait?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgReadCommandDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `code read` action. Accepts `<spec>` OR
 * `--repo-url <url> [--git-ref <ref>]` (mutually exclusive) and a
 * required `<path>` positional.
 *
 * Line-range grammar:
 *  `--lines 10-40`   → start=10, end=40
 *  `--lines 10-`     → start=10, end=EOF
 *  `--lines -40`     → start=1, end=40
 *  `--lines 10`      → rejected (did you mean `--lines 10-` or `--start 10`?)
 *  `--lines 40-10`   → rejected (reversed)
 *  `--start N --end M` → equivalent
 *  `--lines` combined with `--start`/`--end` → rejected
 */
export async function pkgReadAction(
  firstArg: string | undefined,
  secondArg: string | undefined,
  options: PkgReadCommandOptions,
  deps: PkgReadCommandDependencies,
): Promise<void> {
  let requestedFilePath = "";

  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) {
      handleCodeNavCommandError(error, true, formatFileErrorWithFilesHint);
    }
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidPackageSpecError(
        "Code navigation is not configured for this environment.",
      );
    }

    // Commander binds two optional positionals left-to-right.
    // Resolve our (spec, path) pair based on whether repo-URL mode
    // is active:
    //   `code read <spec> <path>`         → firstArg=spec, secondArg=path
    //   `code read --repo-url X [--git-ref Y] <path>`
    //                                     → firstArg=path, secondArg=undefined
    const hasRepoUrl = Boolean(options.repoUrl);
    const { spec, path } = resolvePositionals(firstArg, secondArg, hasRepoUrl);
    if (!path || path.trim().length === 0) {
      throw new InvalidPackageSpecError(
        "A <path> argument is required — pass the path to the file within the package or repo.",
      );
    }

    const target = resolveCliCodeNavTarget(spec, options);
    const pathWithRange = parsePathWithOptionalRange(path.trim());
    requestedFilePath = pathWithRange.filePath;
    const range = resolveLineRange(options, pathWithRange);
    const wait = parseIntCliOption(
      options.wait,
      "--wait",
      0,
      MAX_WAIT_TIMEOUT_MS,
    );

    const build = buildReadFileParams({
      target,
      filePath: pathWithRange.filePath,
      startLine: range.startLine,
      endLine: range.endLine,
      waitTimeoutMs: wait,
    });
    const spinner = startSpinner(SPINNER_MESSAGES.code, !options.json);
    const result = await deps.codeNavigationService
      .readFile(build.params)
      .finally(() => spinner.stop());

    const payload = buildReadFileSuccessPayload(result, {
      registry: target.registry
        ? toPkgseerRegistryLowercase(target.registry)
        : undefined,
      name: target.packageName,
      repoUrl: target.repoUrl,
      gitRef: target.gitRef,
      requestedFilePath: build.params.filePath,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    process.stdout.write(
      formatReadFileTerminal(payload, {
        useColors: shouldUseColors(),
        verbose: options.verbose ?? false,
      }),
    );
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatFileErrorWithFilesHint,
      1,
      (mapped) => withReadFileRecovery(mapped, requestedFilePath),
    );
  }
}

function resolvePositionals(
  firstArg: string | undefined,
  secondArg: string | undefined,
  hasRepoUrl: boolean,
): { spec: string | undefined; path: string | undefined } {
  if (hasRepoUrl) {
    // In repo-URL mode the package spec doesn't apply. A single
    // positional is the path; a second one is an error.
    if (secondArg !== undefined) {
      throw new InvalidPackageSpecError(
        "In --repo-url mode, pass only the <path> positional — the package spec is replaced by --repo-url.",
      );
    }
    return { spec: undefined, path: firstArg };
  }
  // Spec mode: require both positionals to avoid Commander's
  // left-bind-ambiguous single-positional case.
  return { spec: firstArg, path: secondArg };
}

interface LineRange {
  startLine?: number;
  endLine?: number;
}

interface ParsedPathWithRange {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

function resolveLineRange(
  options: PkgReadCommandOptions,
  pathWithRange: ParsedPathWithRange,
): LineRange {
  const hasLines = Boolean(options.lines);
  const hasStart = Boolean(options.start);
  const hasEnd = Boolean(options.end);
  const hasPathRange =
    pathWithRange.startLine !== undefined ||
    pathWithRange.endLine !== undefined;

  if ((hasLines || hasPathRange) && (hasStart || hasEnd)) {
    throw new InvalidPackageSpecError(
      "Use one line-range form only — path:start-end, --lines, or --start / --end. Pick one.",
    );
  }

  if (hasLines && hasPathRange) {
    throw new InvalidPackageSpecError(
      "Use one line-range form only — path:start-end or --lines. Pick one.",
    );
  }

  if (hasPathRange) {
    return {
      startLine: pathWithRange.startLine,
      endLine: pathWithRange.endLine,
    };
  }

  if (hasLines) {
    return parseLinesOption(options.lines as string);
  }

  return {
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
}

/**
 * Parse the `--lines` concise form. Grammar pinned to:
 *  `"N-M"` → start=N, end=M (both integers)
 *  `"N-"`  → start=N, end=EOF
 *  `"-M"`  → start=1, end=M
 * Anything else rejects with a hint.
 */
function parseLinesOption(raw: string): LineRange {
  const trimmed = raw.trim();
  const dashIndex = trimmed.indexOf("-");
  if (dashIndex < 0) {
    throw new InvalidPackageSpecError(
      `--lines expects a range like \`10-40\`, \`10-\`, or \`-40\`. Single-line form isn't accepted — use --start ${trimmed}.`,
    );
  }

  const startRaw = trimmed.slice(0, dashIndex).trim();
  const endRaw = trimmed.slice(dashIndex + 1).trim();

  if (startRaw.length === 0 && endRaw.length === 0) {
    throw new InvalidPackageSpecError(
      "--lines requires at least one bound. Use `10-40`, `10-` for open end, or `-40` for open start.",
    );
  }

  const startLine =
    startRaw.length > 0
      ? requirePositiveInteger(startRaw, "--lines start")
      : undefined;
  const endLine =
    endRaw.length > 0
      ? requirePositiveInteger(endRaw, "--lines end")
      : undefined;

  if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
    throw new InvalidPackageSpecError(
      `--lines range is reversed: ${startLine} > ${endLine}.`,
    );
  }

  if (startLine === undefined && endLine !== undefined) {
    return { startLine: 1, endLine };
  }
  return { startLine, endLine };
}

function parsePathWithOptionalRange(path: string): ParsedPathWithRange {
  const match = path.match(/^(.*):(\d+)(?:-(\d+)?)?$/);
  if (!match) {
    return { filePath: path };
  }

  const filePath = match[1]?.trim();
  const startRaw = match[2];
  const endRaw = match[3];

  if (!filePath) {
    throw new InvalidPackageSpecError(
      `Invalid path with range: '${path}'. Use <path>:<start>-<end>.`,
    );
  }
  if (!startRaw) {
    throw new InvalidPackageSpecError(
      `Invalid path with range: '${path}'. Use <path>:<start>-<end>.`,
    );
  }

  const startLine = requirePositiveInteger(startRaw, "path range start");
  const endLine =
    endRaw !== undefined && endRaw.length > 0
      ? requirePositiveInteger(endRaw, "path range end")
      : startLine;

  if (startLine > endLine) {
    throw new InvalidPackageSpecError(
      `Path range is reversed: ${startLine} > ${endLine}.`,
    );
  }

  return { filePath, startLine, endLine };
}

function requirePositiveInteger(raw: string, label: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new InvalidPackageSpecError(
      `${label} must be a positive integer. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  if (parsed < 1) {
    throw new InvalidPackageSpecError(
      `${label} must be ≥ 1 (lines are 1-indexed). Got ${parsed}.`,
    );
  }
  return parsed;
}

const PKG_READ_DESCRIPTION = `Read a file from an indexed dependency.

Default output is the raw file content — pipe-friendly for
downstream tools (\`code read … | grep …\`). Pass --verbose for a
header and a line-number gutter.

Use --lines for a bounded range (e.g. \`--lines 10-40\`) or append a
range directly to the path (e.g. \`src/index.js:10-40\`). The \`path\`
comes directly from \`githits code files\`.

Addressing: <spec> (registry:name[@version]) OR --repo-url <url>
--git-ref <ref>. <path> is package-relative for spec addressing,
repo-relative for --repo-url.

Binary files show a one-line sentinel instead of content. When a
path is missing, the response is a FILE_NOT_FOUND error — use
\`code files\` to discover available paths.`;

export function registerCodeReadCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("read")
    .summary("Read a file from an indexed dependency")
    .description(PKG_READ_DESCRIPTION)
    .argument(
      "[spec-or-path]",
      "In spec mode: package spec (e.g. npm:express). In --repo-url mode: the file path. See examples in `--help`.",
    )
    .argument(
      "[path]",
      "File path (spec mode only — in --repo-url mode use the first positional).",
    )
    .option(
      "--repo-url <url>",
      "Repository URL addressing (defaults to the repo default branch)",
    )
    .option(
      "--git-ref <ref>",
      "Optional tag, commit, branch, or HEAD for --repo-url.",
    )
    .option(
      "--lines <start-end>",
      "Line range (e.g. `10-40`, `10-` for open end, `-40` for open start)",
    )
    .option("--start <n>", "Starting line (1-indexed). Alternative to --lines.")
    .option("--end <n>", "Ending line (inclusive). Alternative to --lines.")
    .option(
      "--wait <ms>",
      `Indexing wait timeout (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option(
      "-v, --verbose",
      "Render a header and a line-number gutter alongside the content",
    )
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        spec: string | undefined,
        path: string | undefined,
        options: PkgReadCommandOptions,
      ) => {
        const deps = await createContainer();
        await pkgReadAction(spec, path, options, {
          codeNavigationService: deps.codeNavigationService,
          codeNavigationUrl: deps.codeNavigationUrl,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
