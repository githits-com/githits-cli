import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { CodeNavigationService } from "../../services/index.js";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
} from "../../shared/code-navigation-defaults.js";
import { shouldUseColors } from "../../shared/colors.js";
import { InvalidPackageSpecError, requireAuth } from "../../shared/index.js";
import {
  buildListFilesParams,
  type ListFilesRequestBuildResult,
  type ListFilesRequestInput,
} from "../../shared/list-files-request.js";
import {
  buildListFilesSuccessPayload,
  formatListFilesTerminal,
} from "../../shared/list-files-response.js";
import { toPkgseerRegistryLowercase } from "../../shared/pkgseer-registry.js";
import {
  formatIndexingError,
  handleCodeNavCommandError,
  parseIntCliOption,
  resolveCliCodeNavTarget,
} from "./code-nav-cli-helpers.js";

export interface PkgFilesCommandOptions {
  repoUrl?: string;
  gitRef?: string;
  path?: string;
  glob?: string[];
  ext?: string[];
  fileType?: string[];
  language?: string[];
  fileIntent?: string[];
  excludeIntent?: string[];
  excludeDocs?: boolean;
  excludeTests?: boolean;
  hidden?: boolean;
  limit?: string;
  wait?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgFilesCommandDependencies {
  codeNavigationService: CodeNavigationService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `code files` action. Positional order mirrors the sibling
 * file-exploration commands:
 *   `code files <spec> [path-prefix]`
 *   `code files --repo-url <url> --git-ref <ref> [path-prefix]`
 * Commander binds left-to-right; we resolve (spec, path-prefix) from
 * the two optional positionals based on whether repo-URL mode is
 * active.
 */
export async function pkgFilesAction(
  firstArg: string | undefined,
  secondArg: string | undefined,
  options: PkgFilesCommandOptions,
  deps: PkgFilesCommandDependencies,
): Promise<void> {
  requireAuth(deps);

  try {
    if (!deps.codeNavigationUrl || !deps.codeNavigationService) {
      throw new InvalidPackageSpecError(
        "Code navigation is not configured for this environment.",
      );
    }

    const hasRepoUrl = Boolean(options.repoUrl);
    const { spec, pathPrefix } = resolvePositionals(
      firstArg,
      secondArg,
      hasRepoUrl,
    );

    const target = resolveCliCodeNavTarget(spec, options);
    const limit = parseIntCliOption(options.limit, "--limit", 1, 1000);
    const wait = parseIntCliOption(
      options.wait,
      "--wait",
      0,
      MAX_WAIT_TIMEOUT_MS,
    );

    const build = buildCliListFilesParams({
      target,
      path: options.path,
      pathPrefix,
      globs: options.glob,
      extensions: options.ext,
      fileTypes: options.fileType,
      languages: options.language,
      fileIntents: options.fileIntent,
      excludeFileIntents: options.excludeIntent,
      excludeDocFiles: options.excludeDocs,
      excludeTestFiles: options.excludeTests,
      includeHidden: options.hidden,
      limit,
      waitTimeoutMs: wait,
    });
    const result = await deps.codeNavigationService.listFiles(build.params);

    const payload = buildListFilesSuccessPayload(result, {
      registry: target.registry
        ? toPkgseerRegistryLowercase(target.registry)
        : undefined,
      name: target.packageName,
      repoUrl: target.repoUrl,
      gitRef: target.gitRef,
      path: build.filterEcho.path,
      pathPrefix: build.filterEcho.pathPrefix,
      globs: build.filterEcho.globs,
      extensions: build.filterEcho.extensions,
      fileTypes: build.filterEcho.fileTypes,
      languages: build.filterEcho.languages,
      fileIntent: build.filterEcho.fileIntent,
      fileIntents: build.filterEcho.fileIntents,
      excludeFileIntents: build.filterEcho.excludeFileIntents,
      excludeDocFiles: build.filterEcho.excludeDocFiles,
      excludeTestFiles: build.filterEcho.excludeTestFiles,
      includeHidden: build.filterEcho.includeHidden,
      limit: build.filterEcho.limit,
      explicit: build.explicit,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    const rendered = formatListFilesTerminal(payload, {
      verbose: options.verbose ?? false,
      useColors: shouldUseColors(),
    });
    process.stdout.write(rendered.stdout);
    if (rendered.stderr) process.stderr.write(rendered.stderr);
  } catch (error) {
    handleCodeNavCommandError(
      error,
      options.json ?? false,
      formatIndexingError,
    );
  }
}

function collectRepeatable(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function buildCliListFilesParams(
  input: ListFilesRequestInput,
): ListFilesRequestBuildResult {
  try {
    return buildListFilesParams(input);
  } catch (error) {
    if (!(error instanceof InvalidPackageSpecError)) throw error;
    const rewritten = error.message
      .replace(/^`path`/, "`--path`")
      .replace(/`globs`/g, "`--glob`")
      .replace(/`extensions`/g, "`--ext`")
      .replace(/`file_types`/g, "`--file-type`")
      .replace(/`languages`/g, "`--language`")
      .replace(/`file_intent`/g, "`--file-intent`")
      .replace(/`file_intents`/g, "`--file-intent`")
      .replace(/`exclude_file_intents`/g, "`--exclude-intent`")
      .replace(/`path_prefix`/g, "`[path-prefix]`");
    if (rewritten === error.message) throw error;
    throw new InvalidPackageSpecError(rewritten);
  }
}

// Detects strings that look like `<registry>:<rest>` — used to flag
// a common user mistake where a package spec is passed together with
// --repo-url. We'd otherwise silently treat it as a (meaningless)
// path-prefix.
const REGISTRY_SPEC_HINT =
  /^(npm|pypi|hex|crates|nuget|maven|zig|vcpkg|packagist):/i;

function resolvePositionals(
  firstArg: string | undefined,
  secondArg: string | undefined,
  hasRepoUrl: boolean,
): { spec: string | undefined; pathPrefix: string | undefined } {
  if (hasRepoUrl) {
    // Repo-URL mode: the package spec is replaced by --repo-url, so
    // a single positional is the path-prefix. A second one is a
    // user error.
    if (secondArg !== undefined) {
      throw new InvalidPackageSpecError(
        "In --repo-url mode, pass only [path-prefix] — the package spec is replaced by --repo-url.",
      );
    }
    if (firstArg && REGISTRY_SPEC_HINT.test(firstArg)) {
      throw new InvalidPackageSpecError(
        `'${firstArg}' looks like a package spec. Provide either a package spec or \`--repo-url\` + \`--git-ref\`, not both.`,
      );
    }
    return { spec: undefined, pathPrefix: firstArg };
  }
  return { spec: firstArg, pathPrefix: secondArg };
}

const PKG_FILES_DESCRIPTION = `List files in an indexed dependency. Default returns up to 200
entries; pass [path-prefix] to scope to a directory and --limit to
fetch more. Returned paths feed directly into \`githits code read\`
and \`githits code grep\`.

[path-prefix] is a literal directory prefix (e.g. \`src/\` or
\`lib/parser\`). Use --path for exact-file selectors, repeatable
--glob for glob selectors, and --ext / --file-type / --language /
--file-intent to intersect further. When [path-prefix], --path, and
--glob are combined they are OR-ed — a file matches if any selector
matches.

Addressing: <spec> (registry:name[@version]) OR --repo-url <url>
--git-ref <ref>. Supported registries: npm, pypi, hex, crates,
vcpkg, zig, nuget, maven, packagist.

By default each result is a bare path for easy piping; pass
--verbose to include language / file-type / size annotations.

On an INDEXING response, the dependency is being indexed on-demand
— retry with a longer --wait (up to 60000 ms) or pick one of the
already-indexed versions surfaced in the error detail.`;

export function registerCodeFilesCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("files")
    .summary("List files in an indexed dependency")
    .description(PKG_FILES_DESCRIPTION)
    .argument(
      "[spec-or-prefix]",
      "Spec mode: package spec (e.g. npm:express). Repo mode (with --repo-url): the path-prefix.",
    )
    .argument(
      "[path-prefix]",
      "Spec mode only: literal directory prefix (not a glob). Ignored with --repo-url.",
    )
    .option(
      "--repo-url <url>",
      "Repository URL addressing (requires --git-ref)",
    )
    .option(
      "--git-ref <ref>",
      "Tag, commit, branch, or HEAD. Required with --repo-url.",
    )
    .option("--path <path>", "Exact file selector")
    .option(
      "--glob <glob>",
      "Glob selector (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--ext <ext>",
      "Extension filter without leading dot (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--file-type <type>",
      "File type filter such as source or doc (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--language <language>",
      "Language filter matching aigrep language names (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--file-intent <intent>",
      "Inclusive file-intent filter (repeatable: production, test, benchmark, example, generated, fixture, build, vendor)",
      collectRepeatable,
      [] as string[],
    )
    .option(
      "--exclude-intent <intent>",
      "Exclude these file intents after inclusive filtering (repeatable)",
      collectRepeatable,
      [] as string[],
    )
    .option("--exclude-docs", "Skip files classified as documentation")
    .option("--exclude-tests", "Skip files classified as tests")
    .option("--hidden", "Include dotfiles and dot-prefixed paths")
    .option("--limit <n>", "Max entries (1-1000, default 200)")
    .option(
      "--wait <ms>",
      `Indexing wait timeout (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS})`,
    )
    .option(
      "-v, --verbose",
      "Annotate each path with language / file-type / byte size",
    )
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        arg1: string | undefined,
        arg2: string | undefined,
        options: PkgFilesCommandOptions,
      ) => {
        const deps = await createContainer();
        await pkgFilesAction(arg1, arg2, options, {
          codeNavigationService: deps.codeNavigationService,
          codeNavigationUrl: deps.codeNavigationUrl,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
