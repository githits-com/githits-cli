import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { PackageIntelligenceService } from "../../services/index.js";
import { shouldUseColors } from "../../shared/colors.js";
import {
  InvalidPackageSpecError,
  mapPackageIntelligenceError,
  parsePackageSpec,
  requireAuth,
} from "../../shared/index.js";
import { buildPackageSummaryParams } from "../../shared/package-summary-request.js";
import {
  buildPackageSummarySuccessPayload,
  formatPackageSummaryTerminal,
} from "../../shared/package-summary-response.js";

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
  requireAuth(deps);

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
    console.error(
      JSON.stringify({
        error: mapped.message,
        code: mapped.code,
        retryable: mapped.retryable ?? false,
        ...(mapped.details ? { details: mapped.details } : {}),
      }),
    );
    process.exit(1);
  }

  // Bare mapped message — matches `search_symbols` structure, not its
  // wording. Domain messages (`Package 'npm:foo' not found.`,
  // `pkg info always returns the latest version; omit @4.18.0.`) are
  // already caller-readable.
  console.error(mapped.message);
  process.exit(1);
}

const PKG_INFO_DESCRIPTION = `Get a package overview — latest version, license, description,
repository, downloads, GitHub stars, install command, and known
vulnerabilities. Use before picking a dependency or to orient on what
a package is.

Package spec: <registry>:<name>. Supported registries: npm, pypi, hex,
crates, nuget, maven, zig, vcpkg, packagist.

Always returns data for the latest published version.`;

export function registerPkgInfoCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("info")
    .summary("Show a package overview")
    .description(PKG_INFO_DESCRIPTION)
    .argument("<spec>", "Package spec, e.g. npm:express or pypi:requests")
    .option(
      "-v, --verbose",
      "Show advisories, install usage, topics, and recent changes",
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
