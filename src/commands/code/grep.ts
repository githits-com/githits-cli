import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { CodeNavigationService } from "../../services/index.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "../../shared/code-navigation-defaults.js";
import { shouldUseColors } from "../../shared/colors.js";
import {
  buildGrepFileParams,
  GREP_PATTERN_SEMANTICS_NOTE,
} from "../../shared/grep-file-request.js";
import {
  buildGrepFileSuccessPayload,
  formatGrepFileTerminal,
} from "../../shared/grep-file-response.js";
import { InvalidPackageSpecError, requireAuth } from "../../shared/index.js";
import { toPkgseerRegistryLowercase } from "../../shared/pkgseer-registry.js";
import {
  formatFileErrorWithFilesHint,
  handleCodeNavCommandError,
  parseIntCliOption,
  resolveCliCodeNavTarget,
} from "./code-nav-cli-helpers.js";

export interface PkgGrepCommandOptions {
  repoUrl?: string;
  gitRef?: string;
  context?: string;
  limit?: string;
  wait?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgGrepCommandDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `code grep` action. Addressing: `<spec>` or
 * `--repo-url <url> --git-ref <ref>`. Positional order:
 * `<pattern> <path>` in spec mode (after the spec); just
 * `<pattern> <path>` in repo-URL mode. Commander binds left-to-
 * right so we resolve the three positionals with context.
 */
export async function pkgGrepAction(
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
  options: PkgGrepCommandOptions,
  deps: PkgGrepCommandDependencies,
): Promise<void> {
  requireAuth(deps);

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidPackageSpecError(
        "Code navigation is not configured for this environment.",
      );
    }

    const hasRepoUrl = Boolean(options.repoUrl);
    const { spec, pattern, path } = resolvePositionals(
      first,
      second,
      third,
      hasRepoUrl,
    );
    if (!pattern || pattern.length === 0) {
      throw new InvalidPackageSpecError(
        "A <pattern> argument is required — pass the substring to search for.",
      );
    }
    if (!path || path.trim().length === 0) {
      throw new InvalidPackageSpecError(
        "A <path> argument is required — pass the path to the file within the package or repo.",
      );
    }

    const target = resolveCliCodeNavTarget(spec, options);
    const contextLines = parseIntCliOption(options.context, "--context", 0, 10);
    const maxMatches = parseIntCliOption(options.limit, "--limit", 1, 200);
    const wait = parseIntCliOption(
      options.wait,
      "--wait",
      0,
      MAX_WAIT_TIMEOUT_MS,
    );

    const build = buildGrepFileParams({
      target,
      path,
      pattern,
      contextLines,
      maxMatches,
      waitTimeoutMs: wait,
    });
    const result = await deps.codeNavigationService.grepFile(build.params);

    const payload = buildGrepFileSuccessPayload(result, {
      registry: target.registry
        ? toPkgseerRegistryLowercase(target.registry)
        : undefined,
      name: target.packageName,
      repoUrl: target.repoUrl,
      gitRef: target.gitRef,
      pattern: build.params.pattern,
      path: build.params.path,
      contextLinesExplicit: build.contextLinesExplicit,
      maxMatchesExplicit: build.maxMatchesExplicit,
      contextLines: build.params.contextLines ?? 0,
      maxMatches: build.params.maxMatches ?? 50,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      // `grep` convention: exit 1 when no match, 0 when ≥1 match.
      // `--json` still honours this so scripting stays consistent
      // across `--json` and plain callers.
      if (payload.totalMatches === 0) process.exit(1);
      return;
    }

    const rendered = formatGrepFileTerminal(payload, {
      useColors: shouldUseColors(),
      verbose: options.verbose ?? false,
    });
    process.stdout.write(rendered.stdout);
    if (rendered.stderr) process.stderr.write(rendered.stderr);
    if (payload.totalMatches === 0) process.exit(1);
  } catch (error) {
    // `grep` uses exit 2 for errors (distinct from "no match" =
    // exit 1). Keeps `if code grep X file; then …` scripts
    // correctly classifying missing-file / indexing errors.
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatFileErrorWithFilesHint,
      2,
    );
  }
}

function resolvePositionals(
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
  hasRepoUrl: boolean,
): {
  spec: string | undefined;
  pattern: string | undefined;
  path: string | undefined;
} {
  if (hasRepoUrl) {
    // In repo-URL mode: `<pattern> <path>`. Third positional is
    // a user error.
    if (third !== undefined) {
      throw new InvalidPackageSpecError(
        "In --repo-url mode, pass only <pattern> <path> — the package spec is replaced by --repo-url.",
      );
    }
    return { spec: undefined, pattern: first, path: second };
  }
  // Spec mode: `<spec> <pattern> <path>`. Pre-check the positional
  // count so users who forget the spec see a targeted error
  // rather than the generic "<path> is required" from later in the
  // action. Two args + no --repo-url is almost always "I forgot
  // the spec" or "I meant to use --repo-url".
  if (first !== undefined && second !== undefined && third === undefined) {
    throw new InvalidPackageSpecError(
      "In spec mode, all three positionals are required: <spec> <pattern> <path>. If you meant to target a repository instead, pass --repo-url <url> --git-ref <ref>.",
    );
  }
  return { spec: first, pattern: second, path: third };
}

const PKG_GREP_DESCRIPTION = `Search within a single file for a substring match.

${GREP_PATTERN_SEMANTICS_NOTE}
For symbol-shaped searches, prefer \`githits search --source symbol\`.

Addressing: <spec> (registry:name[@version]) OR --repo-url <url>
--git-ref <ref>. In spec mode pass <spec> <pattern> <path>; in
repo-URL mode pass only <pattern> <path>.

Default output is matching lines only (no line numbers, no
context) — same shape as \`grep\`, pipe-friendly. Use --context
<n> to include surrounding lines (0–10, default 0); nearby
matches with overlapping context merge into a single block.
Pass --verbose for a header, line-number gutter, and a \`>\`
marker on match lines. --limit caps the number of matches
(1–200, default 50).`;

export function registerCodeGrepCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("grep")
    .summary("Search within a file in an indexed dependency")
    .description(PKG_GREP_DESCRIPTION)
    .argument(
      "[arg1]",
      "In spec mode: package spec (e.g. npm:express). In --repo-url mode: the pattern.",
    )
    .argument(
      "[arg2]",
      "In spec mode: the pattern. In --repo-url mode: the path.",
    )
    .argument("[arg3]", "In spec mode: the path. Unused in --repo-url mode.")
    .option(
      "--repo-url <url>",
      "Repository URL addressing (requires --git-ref)",
    )
    .option(
      "--git-ref <ref>",
      "Tag, commit, branch, or HEAD. Required with --repo-url.",
    )
    .option(
      "--context <n>",
      "Context lines before and after each match (0-10, default 0). Nearby blocks merge — no duplicated lines.",
    )
    .option("--limit <n>", "Max matches to return (1-200, default 50)")
    .option(
      "--wait <ms>",
      `Indexing wait timeout (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option(
      "-v, --verbose",
      "Render a header and a line-number gutter alongside the matches",
    )
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        arg3: string | undefined,
        options: PkgGrepCommandOptions,
      ) => {
        const deps = await createContainer();
        await pkgGrepAction(arg1, arg2, arg3, options, {
          codeNavigationService: deps.codeNavigationService,
          codeNavigationUrl: deps.codeNavigationUrl,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
