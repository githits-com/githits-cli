import type { CodeNavigationService } from "@githits/core-internal";
import {
  buildCodeDiffParams,
  buildCodeDiffSuccessPayload,
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
  codeNavigationService: CodeNavigationService | undefined;
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
    const build = buildCodeDiffParams({
      target: positionals.target,
      repoUrl: options.repoUrl,
      range: positionals.range,
      view,
      pathGlob: positionals.pathGlob,
      maxFiles: parseIntCliOption(options.maxFiles, "--max-files", 1, 300),
      maxPatchBytes: parseIntCliOption(
        options.maxPatchBytes,
        "--max-patch-bytes",
        1024,
        2_097_152,
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
    });
    if (formatted.stdout) process.stdout.write(formatted.stdout);
    if (formatted.stderr) process.stderr.write(formatted.stderr);
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatCodeDiffError,
    );
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
  const lines = [safe(formatMappedErrorForTerminal(mapped))];
  const details = mapped.details;
  if (!details) return lines[0] as string;

  if (details.side) lines.push(`  side: ${safe(details.side)}`);
  if (details.stage) lines.push(`  stage: ${safe(details.stage)}`);
  if (details.limitKind) lines.push(`  limit: ${safe(details.limitKind)}`);
  if (details.publishedVersions?.length) {
    lines.push(
      `  published versions: ${details.publishedVersions.slice(0, 8).map(safe).join(", ")}${details.publishedVersionsTruncated ? ", …" : ""}`,
    );
  }
  if (details.availableRefs?.length) {
    lines.push(
      `  available refs: ${details.availableRefs
        .slice(0, 8)
        .map((entry) => safe(entry.version ?? entry.ref))
        .join(", ")}`,
    );
  }
  if (details.suggestedRefs?.length) {
    lines.push(
      `  suggested refs: ${details.suggestedRefs
        .slice(0, 8)
        .map((entry) => safe(entry.version ?? entry.ref))
        .join(", ")}`,
    );
  }
  return lines.join("\n");
}

const CODE_DIFF_DESCRIPTION = `Compare two exact dependency source trees.

The default output is a bounded patch, matching ordinary \`git diff\` where the
backend contract permits it. Select --stat, --name-only, or --name-status for
cheaper projections. Exactly one view may be selected.

Addressing: an unversioned <target> plus <from>..<to>, or --repo-url <url> plus
<from>..<to>. Versions and refs belong in the range, not the target. Direction
is always left-to-right; three-dot merge-base syntax is not supported.

After \`--\`, one optional <path-glob> applies a repository-relative bounded
glob. It supports *, ?, and an exact ** path component; it is not a full Git
pathspec.`;

export function registerCodeDiffCommand(
  codeCommand: Command,
  createDependencies: CodeDiffCommandDependencyFactory = createCodeDiffCommandDependencies,
): Command {
  return codeCommand
    .command("diff")
    .summary("Compare two dependency source trees")
    .description(CODE_DIFF_DESCRIPTION)
    .argument(
      "[target-or-range]",
      "Unversioned target, or the range when using --repo-url.",
    )
    .argument(
      "[range-or-path-glob]",
      "from..to range, or the path glob when using --repo-url.",
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
    .option("--max-files <n>", "Maximum returned files (1-300)")
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
  const delimiter = rawArgs.lastIndexOf("--");
  return (
    delimiter >= 0 &&
    delimiter === rawArgs.length - 2 &&
    rawArgs[delimiter + 1] === pathGlob
  );
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
