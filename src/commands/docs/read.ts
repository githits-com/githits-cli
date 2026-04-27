import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { PackageIntelligenceService } from "../../services/index.js";
import {
  buildReadPackageDocParams,
  buildReadPackageDocSuccessPayload,
  formatReadPackageDocTerminal,
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  parseLinesOption,
  requireAuth,
  shouldUseColors,
} from "../../shared/index.js";

export interface DocsReadCommandOptions {
  verbose?: boolean;
  json?: boolean;
  lines?: string;
}

export interface DocsReadCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

export async function docsReadAction(
  pageId: string,
  options: DocsReadCommandOptions,
  deps: DocsReadCommandDependencies,
): Promise<void> {
  requireAuth(deps);

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const range = options.lines ? parseLinesOption(options.lines) : undefined;

    const build = buildReadPackageDocParams({ pageId });
    const result = await deps.packageIntelligenceService.readPackageDoc(
      build.params,
    );
    const payload = buildReadPackageDocSuccessPayload(
      result,
      build.params.pageId,
      range,
    );

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    process.stdout.write(
      formatReadPackageDocTerminal(payload, {
        verbose: options.verbose ?? false,
        useColors: shouldUseColors(),
      }),
    );
  } catch (error) {
    handleDocsReadError(error, options.json ?? false);
  }
}

function handleDocsReadError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceError(error);

  if (json) {
    console.error(
      JSON.stringify({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable ?? false,
        ...(mapped.details ? { details: mapped.details } : {}),
      }),
    );
  } else {
    console.error(mapped.message);
  }

  process.exit(1);
}

const DOCS_READ_DESCRIPTION = `Read a documentation page by page ID.

Use page IDs from githits docs list, githits search --json, or MCP doc/search
results. Default output is content-only for easy piping; pass --verbose for a
metadata header. Use --lines for a bounded line range (e.g. \`--lines 10-40\`,
\`--lines 10-\` for open-ended, or \`--lines -40\` for the first 40 lines) —
useful when a page is too long to read whole.`;

export function registerDocsReadCommand(docsCommand: Command): Command {
  return docsCommand
    .command("read")
    .summary("Read a documentation page by page ID")
    .description(DOCS_READ_DESCRIPTION)
    .argument("<page-id>", "Documentation page ID from docs/search results")
    .option(
      "--lines <range>",
      "Bounded line range, e.g. 10-40, 10-, or -40 (1-indexed inclusive)",
    )
    .option("-v, --verbose", "Show metadata header before content")
    .option("--json", "Emit the JSON envelope")
    .action(async (pageId: string, options: DocsReadCommandOptions) => {
      const deps = await createContainer();
      await docsReadAction(pageId, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
