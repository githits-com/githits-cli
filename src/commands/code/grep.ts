import type { CodeNavigationService } from "@githits/core-internal";
import { toPkgseerRegistryLowercase } from "@githits/core-internal";
import {
  buildGrepRepoParams,
  buildGrepRepoSuccessPayload,
  DEFAULT_WAIT_TIMEOUT_MS,
  formatGrepRepoTerminal,
  GREP_REPO_PATTERN_NOTE,
  GREP_REPO_SYMBOL_FIELDS_NOTE,
  type GrepRepoRequestBuildResult,
  type GrepRepoRequestInput,
  InvalidPackageSpecError,
  MAX_WAIT_TIMEOUT_MS,
  requireAuth,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { startSpinner } from "../../shared/spinner.js";
import { SPINNER_MESSAGES } from "../../shared/spinner-messages.js";
import {
  formatFileErrorWithFilesHint,
  handleCodeNavCommandError,
  parseIntCliOption,
  resolveCliCodeNavTarget,
  withCliGrepFileRecovery,
} from "./code-nav-cli-helpers.js";

export interface PkgGrepCommandOptions {
  repoUrl?: string;
  gitRef?: string;
  path?: string;
  glob?: string[];
  ext?: string[];
  regex?: boolean;
  caseSensitive?: boolean;
  context?: string;
  beforeContext?: string;
  afterContext?: string;
  limit?: string;
  perFileLimit?: string;
  excludeDocs?: boolean;
  excludeTests?: boolean;
  cursor?: string;
  symbolField?: string[];
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

export async function pkgGrepAction(
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
  options: PkgGrepCommandOptions,
  deps: PkgGrepCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) {
      handleCodeNavCommandError(error, true, formatFileErrorWithFilesHint, 2);
    }
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidPackageSpecError(
        "Code navigation is not configured for this environment.",
      );
    }

    const hasRepoUrl = Boolean(options.repoUrl);
    const { spec, pattern, pathPrefix } = resolvePositionals(
      first,
      second,
      third,
      hasRepoUrl,
    );
    if (pattern === undefined) {
      throw new InvalidPackageSpecError(
        "A <pattern> argument is required — pass the text to search for.",
      );
    }

    const target = resolveCliCodeNavTarget(spec, options);
    const contextLines = parseIntCliOption(options.context, "--context", 0, 10);
    const beforeContext = parseIntCliOption(
      options.beforeContext,
      "--before-context",
      0,
      10,
    );
    const afterContext = parseIntCliOption(
      options.afterContext,
      "--after-context",
      0,
      10,
    );
    const maxMatches = parseIntCliOption(options.limit, "--limit", 1, 1000);
    const maxMatchesPerFile = parseIntCliOption(
      options.perFileLimit,
      "--per-file-limit",
      0,
      1000,
    );
    const wait = parseIntCliOption(
      options.wait,
      "--wait",
      0,
      MAX_WAIT_TIMEOUT_MS,
    );

    const build = buildCliGrepParams({
      target,
      pattern,
      path: options.path,
      pathPrefix,
      globs: options.glob,
      extensions: options.ext,
      patternType: options.regex ? "regex" : undefined,
      caseSensitive: options.caseSensitive,
      excludeDocFiles: options.excludeDocs,
      excludeTestFiles: options.excludeTests,
      contextLines,
      contextLinesBefore: beforeContext,
      contextLinesAfter: afterContext,
      maxMatches,
      maxMatchesPerFile,
      cursor: options.cursor,
      symbolFields: options.symbolField,
      waitTimeoutMs: wait,
    });
    const spinner = startSpinner(SPINNER_MESSAGES.code, !options.json);
    const result = await deps.codeNavigationService
      .grepRepo(build.params)
      .finally(() => spinner.stop());

    const payload = buildGrepRepoSuccessPayload(result, {
      registry: target.registry
        ? toPkgseerRegistryLowercase(target.registry)
        : undefined,
      name: target.packageName,
      repoUrl: target.repoUrl,
      gitRef: target.gitRef,
      pattern: build.params.pattern,
      patternType: build.params.patternType === "REGEX" ? "regex" : "literal",
      caseSensitive: build.params.caseSensitive ?? false,
      path: options.path,
      pathPrefix,
      globs: options.glob,
      extensions: options.ext,
      contextLines,
      contextLinesBefore: build.params.contextLinesBefore ?? 0,
      contextLinesAfter: build.params.contextLinesAfter ?? 0,
      maxMatches: build.params.maxMatches ?? 50,
      maxMatchesPerFile: build.params.maxMatchesPerFile,
      cursor: options.cursor,
      symbolFields: build.params.symbolFields,
      excludeDocFiles: build.params.excludeDocFiles,
      excludeTestFiles: build.params.excludeTestFiles,
      explicit: build.explicit,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      if (payload.totalMatches === 0) process.exitCode = 1;
      return;
    }

    const rendered = formatGrepRepoTerminal(payload, {
      useColors: shouldUseColors(),
      verbose: options.verbose ?? false,
      headingStyle:
        (process.stdout.isTTY ?? false) && !(options.verbose ?? false),
      withContext:
        (build.params.contextLinesBefore ?? 0) > 0 ||
        (build.params.contextLinesAfter ?? 0) > 0,
    });
    process.stdout.write(rendered.stdout);
    if (rendered.stderr) process.stderr.write(rendered.stderr);
    if (payload.totalMatches === 0) process.exitCode = 1;
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatFileErrorWithFilesHint,
      2,
      withCliGrepFileRecovery,
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
  pathPrefix: string | undefined;
} {
  if (hasRepoUrl) {
    if (third !== undefined) {
      throw new InvalidPackageSpecError(
        "In --repo-url mode, pass only <pattern> [path-prefix] — the package spec is replaced by --repo-url.",
      );
    }
    return { spec: undefined, pattern: first, pathPrefix: second };
  }
  if (first !== undefined && second === undefined) {
    throw new InvalidPackageSpecError(
      "In spec mode, pass at least <spec> <pattern>. If you meant to target a repository instead, pass --repo-url <url> with optional --git-ref <ref>.",
    );
  }
  return { spec: first, pattern: second, pathPrefix: third };
}

function collectRepeatable(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

/**
 * Translate CLI-reachable, backtick-delimited MCP validation tokens. Anchored
 * rules prevent replacements inside user values echoed after `Got:`.
 */
function buildCliGrepParams(
  input: GrepRepoRequestInput,
): GrepRepoRequestBuildResult {
  try {
    return buildGrepRepoParams(input);
  } catch (error) {
    if (!(error instanceof InvalidPackageSpecError)) throw error;
    const rewritten = error.message
      .replace(/^`pattern`/, "`<pattern>`")
      .replace(/`globs`/g, "`--glob`")
      .replace(/`extensions`/g, "`--ext`")
      .replace(/^`symbol_fields`/, "`--symbol-field`")
      .replace(/`code_files`/g, "`githits code files`");
    if (rewritten === error.message) throw error;
    throw new InvalidPackageSpecError(rewritten);
  }
}

const CLI_GREP_PATTERN_NOTE = GREP_REPO_PATTERN_NOTE.replace(
  "with no path, path_prefix, or glob",
  "with no --path, [path-prefix], or --glob",
)
  .replace("pass case_sensitive: true", "pass --case-sensitive")
  .replace(
    "(`path`, `path_prefix`, `globs`)",
    "(--path, [path-prefix], --glob)",
  )
  .replace(
    "Use `extensions` to intersect further.",
    "Use --ext to intersect further.",
  );

const PKG_GREP_DESCRIPTION = `Deterministic text grep over indexed dependency and repository source files.

${CLI_GREP_PATTERN_NOTE}
Use \`githits search\` for discovery; use \`githits code grep\` when you know the text or regex to match.

Addressing: <target> (registry:name[@version], github:org/repo[#ref|@ref],
github.com/org/repo[#ref|@ref], or https://github.com/org/repo[#ref|@ref]) OR --repo-url
<url> [--git-ref <ref>]. Omitted package version means latest release.
In target mode pass <target> <pattern> [path-prefix]; in --repo-url mode pass only <pattern> [path-prefix].

[path-prefix] matches the same literal prefix semantics as \`githits code files\`.
Use --path for one exact file, repeatable --glob for glob narrowing, and
repeatable --ext for extension filtering. When [path-prefix], --path, and
--glob are combined they are unioned — a file matches if any selector matches;
use --ext to narrow further (intersection).

Default output is \`file:line:text\`, pipe-friendly like grep. Use -C / -A / -B
for context, --verbose for grouped output, and --cursor to continue a paginated
grep run. --symbol-field hydrates enclosing symbol metadata (appears under each
match in --verbose output; full payload in --json).`;

export function registerCodeGrepCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("grep")
    .summary("Deterministic text grep over indexed dependency source")
    .description(PKG_GREP_DESCRIPTION)
    .argument(
      "[spec-or-pattern]",
      "Target mode: package spec or repo shorthand. With --repo-url: the pattern.",
    )
    .argument(
      "[pattern-or-prefix]",
      "Spec mode: the pattern. Repo mode: optional path-prefix.",
    )
    .argument(
      "[path-prefix]",
      "Spec mode only: optional path-prefix. Ignored with --repo-url.",
    )
    .option(
      "--repo-url <url>",
      "Repository URL addressing (defaults to the repo default branch)",
    )
    .option(
      "--git-ref <ref>",
      "Optional tag, commit, branch, or HEAD for --repo-url.",
    )
    .option("--path <path>", "Exact file path to grep")
    .option(
      "--glob <glob>",
      "Glob scope (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--ext <ext>",
      "Extension filter without leading dot (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option("--regex", "Interpret the pattern as RE2 regex")
    .option("--case-sensitive", "Enable ASCII case-sensitive matching")
    .option(
      "-C, --context <n>",
      "Context lines before and after each match (0-10)",
    )
    .option(
      "-B, --before-context <n>",
      "Context lines before each match (0-10)",
    )
    .option("-A, --after-context <n>", "Context lines after each match (0-10)")
    .option("--exclude-docs", "Skip files classified as documentation")
    .option("--exclude-tests", "Skip files classified as tests")
    .option(
      "--limit <n>",
      "Max matches to return on this page (1-1000, default 50)",
    )
    .option(
      "--per-file-limit <n>",
      "Cap matches per file within this page (0-1000, 0 = unlimited)",
    )
    .option(
      "--cursor <cursor>",
      "Opaque nextCursor from a previous grep result",
    )
    .option(
      "--symbol-field <field>",
      `Repeatable; surfaces in --json and under each --verbose match. ${GREP_REPO_SYMBOL_FIELDS_NOTE}`,
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--wait <ms>",
      `Indexing wait timeout (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option("-v, --verbose", "Render grouped output with file headers")
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        arg3: string | undefined,
        options: PkgGrepCommandOptions,
      ) => {
        const { createContainer } = await import("../../container.js");
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
