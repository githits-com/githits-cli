import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  buildListPackageDocsParams,
  buildListPackageDocsSuccessPayload,
  formatListPackageDocsTerminal,
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  parsePackageSpec,
  requireAuth,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import { startSpinner } from "../../shared/spinner.js";
import { SPINNER_MESSAGES } from "../../shared/spinner-messages.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "../format-mapped-error.js";

export interface DocsListCommandOptions {
  limit?: string;
  after?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface DocsListCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

export async function docsListAction(
  spec: string,
  options: DocsListCommandOptions,
  deps: DocsListCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handleDocsListError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const parsed = parsePackageSpec(spec);
    const limit = parseLimitOption(options.limit);
    const build = buildListPackageDocsParams({
      registry: parsed.registry,
      packageName: parsed.name,
      version: parsed.version,
      limit,
      after: options.after,
    });
    const spinner = startSpinner(SPINNER_MESSAGES.docs, !options.json);
    const result = await deps.packageIntelligenceService
      .listPackageDocs(build.params)
      .finally(() => spinner.stop());
    const payload = buildListPackageDocsSuccessPayload(result, {
      limitExplicit: build.limitExplicit,
      afterExplicit: build.afterExplicit,
      limit: build.params.limit,
      after: build.params.after,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    process.stdout.write(
      formatListPackageDocsTerminal(payload, {
        verbose: options.verbose ?? false,
        useColors: shouldUseColors(),
      }),
    );
  } catch (error) {
    handleDocsListError(error, options.json ?? false);
  }
}

function parseLimitOption(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    throw new InvalidPackageSpecError(
      "--limit must be an integer between 1 and 500.",
    );
  }
  return parsed;
}

function handleDocsListError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceError(error);

  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
  } else {
    console.error(formatMappedErrorForTerminal(mapped));
  }

  process.exit(1);
}

const DOCS_LIST_DESCRIPTION = `List package documentation pages from mixed sources.

Docs are mixed by default: hosted/crawled docs and repository-backed docs
appear together. Every entry shows its page ID, source badge, and source
location. Repo-backed docs also carry exact file follow-up metadata in JSON.

Package spec: <registry>:<name>[@version].`;

export function registerDocsListCommand(docsCommand: Command): Command {
  return docsCommand
    .command("list")
    .summary("List documentation pages for a package")
    .description(DOCS_LIST_DESCRIPTION)
    .argument("<spec>", "Package spec, e.g. npm:express@5.2.1")
    .option("--limit <n>", "Max pages (1-500, default 100)")
    .option("--after <cursor>", "Pagination cursor from a prior response")
    .option("-v, --verbose", "Show updated timestamps when available")
    .option("--json", "Emit the JSON envelope")
    .action(async (spec: string, options: DocsListCommandOptions) => {
      const deps = await createContainer();
      await docsListAction(spec, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
