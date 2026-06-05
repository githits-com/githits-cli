import type { PackageIntelligenceService } from "@githits/core-internal";
import { PKGSEER_REGISTRY_LIST } from "@githits/core-internal";
import {
  buildPackageSummaryParams,
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  parsePackageSpec,
  requireAuth,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "../format-mapped-error.js";

export interface PkgInfoCommandOptions {
  verbose?: boolean;
  json?: boolean;
}

export interface PkgInfoCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `pkg info` action. Rejects `@<version>` with a clear
 * INVALID_ARGUMENT (never silently swaps to latest), then delegates
 * to the shared request builder and response formatter.
 */
export async function pkgInfoAction(
  spec: string,
  options: PkgInfoCommandOptions,
  deps: PkgInfoCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handlePkgInfoCommandError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const parsed = parsePackageSpec(spec);
    if (parsed.version !== undefined) {
      throw new InvalidPackageSpecError(
        `pkg info always returns the latest version; omit @${parsed.version}.`,
      );
    }

    const { params } = buildPackageSummaryParams({
      registry: parsed.registry,
      packageName: parsed.name,
    });
    const summary =
      await deps.packageIntelligenceService.packageSummary(params);

    if (options.json) {
      const payload = buildPackageSummarySuccessPayload(summary);
      console.log(JSON.stringify(payload));
      return;
    }

    const output = formatPackageSummaryTerminal(summary, {
      verbose: options.verbose,
      useColors: shouldUseColors(),
    });
    process.stdout.write(output);
  } catch (error) {
    handlePkgInfoCommandError(error, options.json ?? false);
  }
}

function handlePkgInfoCommandError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceError(error);

  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    process.exit(1);
  }

  // Bare mapped message. Domain messages (`Package 'npm:foo' not found.`,
  // `pkg info always returns the latest version; omit @4.18.0.`) are
  // already caller-readable.
  console.error(formatMappedErrorForTerminal(mapped));
  process.exit(1);
}

const PKG_INFO_DESCRIPTION = `Latest-version package overview for dependency triage.

Default output shows license, description, repository popularity
(stars/forks/issues and [ARCHIVED] when applicable), downloads,
publish age, and vulnerability status. --verbose adds GitHub
language/topics/last-pushed, recent advisories, and recent changes.

Package spec: <registry>:<name>. Supported registries: ${PKGSEER_REGISTRY_LIST}.

Example: githits pkg info npm:express

Always returns data for the latest published version.`;

export function registerPkgInfoCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("info")
    .summary("Show a package overview")
    .description(PKG_INFO_DESCRIPTION)
    .argument("<spec>", "Package spec, e.g. npm:express or pypi:requests")
    .option(
      "-v, --verbose",
      "Show GitHub language/topics/last-pushed, recent advisories, and recent changes",
    )
    .option("--json", "Emit the lean JSON envelope")
    .action(async (spec: string, options: PkgInfoCommandOptions) => {
      const deps = await createContainer();
      await pkgInfoAction(spec, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
