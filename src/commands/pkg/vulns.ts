import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  buildPackageVulnerabilitiesParams,
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
  InvalidPackageSpecError,
  parsePackageSpec,
  requireAuth,
  shouldUseColors,
} from "@githits/mcp/internal";
import type { Command } from "commander";
import { createContainer } from "../../container.js";
import { mapPackageIntelligenceErrorForCli } from "../../shared/cli-error-diagnostics.js";
import {
  buildCliMappedErrorPayload,
  formatMappedErrorForTerminal,
} from "../format-mapped-error.js";

export interface PkgVulnsCommandOptions {
  details?: boolean;
  severity?: string;
  scope?: string;
  includeWithdrawn?: boolean;
  transitive?: boolean;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgVulnsCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `pkg vulns` action. Accepts `<spec>@<version>` (unlike `pkg
 * info`, which selects the default release). Version flows through to the
 * backend; `minSeverity`, `includeWithdrawn`, and opt-in `includeTransitive`
 * likewise go to the wire. No client-side filtering — backend is single
 * source of truth.
 */
export async function pkgVulnsAction(
  spec: string,
  options: PkgVulnsCommandOptions,
  deps: PkgVulnsCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handlePkgVulnsCommandError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const parsed = parsePackageSpec(spec);
    const { params: builtParams, filter } = buildPackageVulnerabilitiesParams({
      includeSourceDetails: options.details,
      registry: parsed.registry,
      packageName: parsed.name,
      version: parsed.version,
      minSeverity: options.severity,
      includeWithdrawn: options.includeWithdrawn,
      includeTransitive: options.transitive,
      advisoryScope: options.scope,
    });
    const params = {
      ...builtParams,
      includeTransitiveAdvisoryDetails:
        options.json === true ||
        (options.verbose === true &&
          (builtParams.advisoryScope ?? "AFFECTED") !== "AFFECTED"),
    };
    const report =
      await deps.packageIntelligenceService.packageVulnerabilities(params);

    if (report.sourceDetails?.some((entry) => entry.error))
      process.exitCode = 1;

    if (options.json) {
      const payload = buildPackageVulnerabilitiesSuccessPayload(report, {
        requestedVersion: params.version,
        filter,
      });
      console.log(JSON.stringify(payload));
      return;
    }

    const output = formatPackageVulnerabilitiesTerminal(report, {
      verbose: options.verbose,
      useColors: shouldUseColors(),
      requestedVersion: params.version,
      filter,
      surface: "cli",
      terminalWidth: process.stdout.columns,
    });
    process.stdout.write(output);
  } catch (error) {
    handlePkgVulnsCommandError(error, options.json ?? false);
  }
}

function handlePkgVulnsCommandError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceErrorForCli(error);

  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    process.exit(1);
  }

  console.error(formatMappedErrorForTerminal(mapped));
  process.exit(1);
}

const PKG_VULNS_DESCRIPTION = `Show known vulnerabilities for a package, with severity, affected ranges and fix evidence.
CLI text shows every selected direct and transitive advisory row. --verbose expands
assessment fields, including aliases, dates and complete range/fix evidence; row
count is unchanged. --json returns structured assessment data.

Use --details to include full advisory text and source metadata from OSV for every
selected direct advisory. This adds live source reads and can produce long output;
pipe to a pager or redirect as needed. --verbose and --json alone do not request
source reports. Source reports do not recompute the assessment or recommend
upgrades. Source failures retain assessments and exit nonzero.
For one advisory report, including dependency advisories: githits vulns <id> --verbose.

Package spec: <registry>:<name>[@<version>]. Supported registries:
npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, swift, pub. vcpkg and zig are not supported.
Omit @<version> to check the latest release.
Example: githits pkg vulns npm:lodash@4.17.20 --severity high

--severity and --include-withdrawn are passed through to the backend; active
filters are echoed in text and JSON. Use --scope non_affecting for advisories
that do not affect this version, --scope unknown for unevaluated advisories with
reasons, or --scope all for all package advisory assessments.

Use --transitive for vulnerabilities in versions resolved by the dependency graph.
This adds graph-analysis cost and is separate from package-wide advisory history.
--severity and --scope apply to direct and transitive rows. --include-withdrawn
affects direct rows only; transitive withdrawn advisories remain excluded.`;

export function registerPkgVulnsCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("vulns")
    .summary("List known vulnerabilities for a package")
    .description(PKG_VULNS_DESCRIPTION)
    .argument("<spec>", "Package spec, e.g. npm:express or npm:express@4.18.0")
    .option(
      "-s, --severity <level>",
      "Only show advisories at or above this severity (low, medium, high, critical). Omit to see all.",
    )
    .option(
      "--scope <scope>",
      "Advisory rows to return: affected, non_affecting, unknown, all (default: affected)",
    )
    .option(
      "--include-withdrawn",
      "Include retracted advisories (default: off)",
    )
    .option(
      "--transitive",
      "Audit vulnerabilities in versions resolved by the dependency graph (opt-in; adds graph-analysis cost)",
    )
    .option(
      "-v, --verbose",
      "Expand assessment fields: aliases, dates, malicious-advisory markers and complete range/fix evidence; row count is unchanged",
    )
    .option(
      "--details",
      "Include full advisory text and source metadata from OSV (selected direct advisories; extra source reads)",
    )
    .option(
      "--json",
      "Emit structured assessment data; combine with --details for source reports",
    )
    .action(async (spec: string, options: PkgVulnsCommandOptions) => {
      const deps = await createContainer();
      await pkgVulnsAction(spec, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
