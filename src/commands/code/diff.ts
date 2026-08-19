import type { CodeDiffService } from "@githits/core-internal";
import {
  buildCodeDiffParams,
  buildCodeDiffSuccessPayload,
  CODE_DIFF_MAX_FILES_MAX,
  CODE_DIFF_MAX_FILES_MIN,
  CODE_DIFF_MAX_PATCH_BYTES_MAX,
  CODE_DIFF_MAX_PATCH_BYTES_MIN,
  type CodeDiffRequestBuildResult,
  type CodeDiffRequestInput,
  type CodeDiffView,
  formatCodeDiffTerminal,
  InvalidPackageSpecError,
  type MappedError,
  requireAuth,
  sanitizeTerminalText,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import { startSpinner } from "../../shared/spinner.js";
import { SPINNER_MESSAGES } from "../../shared/spinner-messages.js";
import { formatMappedErrorForTerminal } from "../format-mapped-error.js";
import {
  handleCodeNavCommandError,
  parseIntCliOption,
} from "./code-nav-cli-helpers.js";

export interface CodeDiffCommandOptions {
  repoUrl?: string;
  patch?: boolean;
  stat?: boolean;
  nameOnly?: boolean;
  nameStatus?: boolean;
  maxFiles?: string;
  maxPatchBytes?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface CodeDiffCommandDependencies {
  codeNavigationService: CodeDiffService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

export type CodeDiffCommandDependencyFactory =
  () => Promise<CodeDiffCommandDependencies>;

interface RootCommandWithRawArgs extends Command {
  rawArgs?: string[];
}

/** Execute the silent-dogfood CodeDiff CLI adapter. */
export async function codeDiffAction(
  arg1: string | undefined,
  arg2: string | undefined,
  arg3: string | undefined,
  options: CodeDiffCommandOptions,
  deps: CodeDiffCommandDependencies,
  pathGlobAfterDoubleDash = false,
): Promise<void> {
  let terminalExitCode: 1 | undefined;
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) {
      handleCodeNavCommandError(error, true, formatCodeDiffError);
    }
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidPackageSpecError(
        "Code navigation is not configured for this environment.",
      );
    }

    const positionals = resolvePositionals(
      arg1,
      arg2,
      arg3,
      options.repoUrl !== undefined,
    );
    if (positionals.pathGlob !== undefined && !pathGlobAfterDoubleDash) {
      throw new InvalidPackageSpecError(
        "Pass the repository-relative <path-glob> after `--`.",
      );
    }
    const view = resolveView(options);
    const build = buildCliCodeDiffParams({
      target: positionals.target,
      repoUrl: options.repoUrl,
      range: positionals.range,
      view,
      pathGlob: positionals.pathGlob,
      maxFiles: parseIntCliOption(
        options.maxFiles,
        "--max-files",
        CODE_DIFF_MAX_FILES_MIN,
        CODE_DIFF_MAX_FILES_MAX,
      ),
      maxPatchBytes: parseIntCliOption(
        options.maxPatchBytes,
        "--max-patch-bytes",
        CODE_DIFF_MAX_PATCH_BYTES_MIN,
        CODE_DIFF_MAX_PATCH_BYTES_MAX,
      ),
    });

    const spinner = startSpinner(SPINNER_MESSAGES.code, !options.json);
    const result = await deps.codeNavigationService
      .codeDiff(build.params)
      .finally(() => spinner.stop());
    const payload = buildCodeDiffSuccessPayload(result, {
      target: build.params.target,
      view: build.view,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    const formatted = formatCodeDiffTerminal(payload, {
      useColors: shouldUseColors(),
      verbose: options.verbose ?? false,
      explicitMaxFiles: options.maxFiles !== undefined,
      explicitMaxPatchBytes: options.maxPatchBytes !== undefined,
    });
    if (formatted.stdout) process.stdout.write(formatted.stdout);
    if (formatted.stderr) process.stderr.write(formatted.stderr);
    terminalExitCode = formatted.exitCode;
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatCodeDiffError,
    );
  }

  if (terminalExitCode !== undefined) process.exit(terminalExitCode);
}

function buildCliCodeDiffParams(
  input: CodeDiffRequestInput,
): CodeDiffRequestBuildResult {
  try {
    return buildCodeDiffParams(input);
  } catch (error) {
    if (!(error instanceof InvalidPackageSpecError)) throw error;
    const rewritten = error.message
      .replace(
        "The maximum patch byte limit is valid only when the view is patch.",
        "The `--max-patch-bytes` option is valid only when `--patch` is selected.",
      )
      .replace(/path glob/gi, "`<path-glob>`")
      .replace(
        "Repository target must identify a repository, not a package.",
        "`--repo-url` must identify a repository target.",
      )
      .replace(/`repoUrl`/g, "`--repo-url`")
      .replace(/`range`/g, "`<from>..<to>`");
    if (rewritten === error.message) throw error;
    throw new InvalidPackageSpecError(rewritten);
  }
}

interface ResolvedPositionals {
  target?: string;
  range: string;
  pathGlob?: string;
}

function resolvePositionals(
  arg1: string | undefined,
  arg2: string | undefined,
  arg3: string | undefined,
  repoMode: boolean,
): ResolvedPositionals {
  if (repoMode) {
    if (arg3 !== undefined) {
      throw new InvalidPackageSpecError(
        "Pass at most one repository-relative <path-glob> after `--`.",
      );
    }
    if (arg1 === undefined) {
      throw new InvalidPackageSpecError(
        "A <from>..<to> range is required after --repo-url.",
      );
    }
    return { range: arg1, pathGlob: arg2 };
  }

  if (arg1 === undefined) {
    throw new InvalidPackageSpecError(
      "An unversioned <target> and <from>..<to> range are required.",
    );
  }
  if (arg2 === undefined) {
    throw new InvalidPackageSpecError(
      "A <from>..<to> range is required after the target.",
    );
  }
  return { target: arg1, range: arg2, pathGlob: arg3 };
}

function resolveView(options: CodeDiffCommandOptions): CodeDiffView {
  const selected: CodeDiffView[] = [];
  if (options.patch) selected.push("patch");
  if (options.stat) selected.push("stat");
  if (options.nameOnly) selected.push("name-only");
  if (options.nameStatus) selected.push("name-status");
  if (selected.length > 1) {
    throw new InvalidPackageSpecError(
      "Choose only one diff view: --patch, --stat, --name-only, or --name-status.",
    );
  }
  return selected[0] ?? "patch";
}

/** Render bounded CodeDiff diagnostics without exposing raw GraphQL details. */
export function formatCodeDiffError(mapped: MappedError): string {
  const safe = (value: string): string => sanitizeTerminalText(value);
  const safeBlock = (value: string): string =>
    value
      .split("\n")
      .map((line) => safe(line))
      .join("\n");
  const lines = [safeBlock(formatMappedErrorForTerminal(mapped))];
  const details = mapped.details;
  if (!details) return lines[0] as string;

  if (details.side) lines.push(`  side: ${safe(details.side)}`);
  if (details.stage) lines.push(`  stage: ${safe(details.stage)}`);
  if (details.limitKind) lines.push(`  limit: ${safe(details.limitKind)}`);
  if (details.publishedVersions?.length) {
    lines.push(
      `  published versions: ${formatRecoveryList(
        details.publishedVersions,
        safe,
        details.publishedVersionsTruncated,
      )}`,
    );
  }
  if (details.availableRefs?.length) {
    lines.push(
      `  available refs: ${formatRecoveryList(
        details.availableRefs.map((entry) => entry.version ?? entry.ref),
        safe,
      )}`,
    );
  }
  if (details.suggestedRefs?.length) {
    lines.push(
      `  suggested refs: ${formatRecoveryList(
        details.suggestedRefs.map((entry) => entry.version ?? entry.ref),
        safe,
      )}`,
    );
  }
  return lines.join("\n");
}

function formatRecoveryList(
  values: string[],
  safe: (value: string) => string,
  backendTruncated = false,
): string {
  const limit = 8;
  const shown = values.slice(0, limit).map(safe).join(", ");
  const omitted = values.length - limit;
  if (backendTruncated) {
    return omitted > 0 ? `${shown} (+${omitted}+ more)` : `${shown} (+more)`;
  }
  return omitted > 0 ? `${shown} (+${omitted} more)` : shown;
}

const CODE_DIFF_DESCRIPTION = `Compare repository trees resolved from package versions or repository refs.

Diffs are always repository-wide, subject only to an explicit caller-supplied
path glob. Package targets resolve repository identity, versions, and exact
commits; they do not narrow files to a package directory. Sibling package paths
may appear, and a bounded relevance-ranked result may contain no files from the
addressed package.

The default output is a bounded patch, matching ordinary \`git diff\` where the
backend contract permits it. Select --stat, --name-only, or --name-status for
cheaper projections. Exactly one view may be selected.

Addressing: an unversioned <target> plus <from>..<to>, or --repo-url <url> plus
<from>..<to>. Versions and refs belong in the range, not the target. Direction
is always left-to-right; three-dot merge-base syntax is not supported.

After \`--\`, one optional <path-glob> applies a repository-relative bounded
glob. It supports *, ?, and an exact ** path component; it is not a full Git
pathspec. A backslash escapes one following non-slash character.

Target examples: \`npm:express\` or \`github:expressjs/express\`; keep versions
and refs in <from>..<to>. Empty diffs exit 0; suppressed patch output exits 1.
Patch output is applicable unified-diff content and may omit Git metadata such
as index and mode headers.`;

export function registerCodeDiffCommand(
  codeCommand: Command,
  createDependencies: CodeDiffCommandDependencyFactory = createCodeDiffCommandDependencies,
): Command {
  return codeCommand
    .command("diff")
    .summary("Compare resolved repository trees")
    .description(CODE_DIFF_DESCRIPTION)
    .usage(
      "[options] <target> <from>..<to> [-- <path-glob>]\n       githits code diff [options] --repo-url <url> <from>..<to> [-- <path-glob>]",
    )
    .argument(
      "[target-or-range]",
      "Package mode: target. Repository mode: from..to range.",
    )
    .argument(
      "[range-or-path-glob]",
      "Package mode: from..to range. Repository mode: path glob.",
    )
    .argument(
      "[path-glob]",
      "One repository-relative glob; must be passed after `--`.",
    )
    .option("--repo-url <url>", "Public GitHub repository URL addressing")
    .option("-p, --patch", "Emit bounded patches (default)")
    .option("--stat", "Emit per-file line statistics")
    .option("--name-only", "Emit changed paths only")
    .option("--name-status", "Emit change status and path")
    .option(
      "--max-files <n>",
      "Maximum relevance-ranked returned files (1-300)",
    )
    .option(
      "--max-patch-bytes <bytes>",
      "Maximum aggregate patch bytes (1024-2097152; patch view only)",
    )
    .option("-v, --verbose", "Emit exact resolution and scope diagnostics")
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        arg3: string | undefined,
        options: CodeDiffCommandOptions,
        command: Command,
      ) => {
        const deps = await createDependencies();
        await codeDiffAction(
          arg1,
          arg2,
          arg3,
          options,
          deps,
          pathGlobFollowsDoubleDash(
            command,
            options.repoUrl !== undefined ? arg2 : arg3,
          ),
        );
      },
    );
}

function pathGlobFollowsDoubleDash(
  command: Command,
  pathGlob: string | undefined,
): boolean {
  if (pathGlob === undefined) return false;
  let root = command;
  while (root.parent) root = root.parent;
  const rawArgs = (root as RootCommandWithRawArgs).rawArgs;
  if (!rawArgs) return false;
  return rawArgs.at(-2) === "--" && rawArgs.at(-1) === pathGlob;
}

async function createCodeDiffCommandDependencies(): Promise<CodeDiffCommandDependencies> {
  const deps = await createContainer();
  return {
    codeNavigationService: deps.codeNavigationService,
    codeNavigationUrl: deps.codeNavigationUrl,
    hasValidToken: deps.hasValidToken,
    mcpUrl: deps.mcpUrl,
  };
}
