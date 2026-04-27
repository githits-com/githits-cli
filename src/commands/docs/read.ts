import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { PackageIntelligenceService } from "../../services/index.js";
import {
  buildReadPackageDocParams,
  buildReadPackageDocSuccessPayload,
  formatReadPackageDocTerminal,
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  requireAuth,
  shouldUseColors,
} from "../../shared/index.js";

export interface DocsReadCommandOptions {
  verbose?: boolean;
  json?: boolean;
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

    const build = buildReadPackageDocParams({ pageId });
    const result = await deps.packageIntelligenceService.readPackageDoc(
      build.params,
    );
    const payload = buildReadPackageDocSuccessPayload(
      result,
      build.params.pageId,
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
metadata header. Repo-backed pages also expose exact file follow-up metadata in
JSON.`;

export function registerDocsReadCommand(docsCommand: Command): Command {
  return docsCommand
    .command("read")
    .summary("Read a documentation page by page ID")
    .description(DOCS_READ_DESCRIPTION)
    .argument("<page-id>", "Documentation page ID from docs/search results")
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
