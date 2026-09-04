import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  buildPackageVulnerabilitiesParams,
  buildPackageVulnerabilitiesSuccessPayload,
  formatPackageVulnerabilitiesTerminal,
  InvalidPackageSpecError,
  type MappedError,
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
  severity?: string;
  scope?: string;
  includeWithdrawn?: boolean;
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
 * info`, which always returns latest). Version flows through to the
 * backend; `minSeverity` and `includeWithdrawn` likewise go to the
 * wire. No client-side filtering — backend is single source of truth.
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
    const { params, filter } = buildPackageVulnerabilitiesParams({
      registry: parsed.registry,
      packageName: parsed.name,
      version: parsed.version,
      minSeverity: options.severity,
      includeWithdrawn: options.includeWithdrawn,
      advisoryScope: options.scope,
    });
    const report =
      await deps.packageIntelligenceService.packageVulnerabilities(params);

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

  console.error(formatVulnsTerminalError(mapped));
  process.exit(1);
}

/**
 * Format the terminal error line. Most codes fall through to the
 * bare mapped message (matches the `pkg info` handler pattern);
 * `VERSION_NOT_FOUND` gets an extra detail line echoing what the
 * user asked for and, when available, the versions the backend does
 * know about — this is the one case where the bare message
 * ("No matching version found") omits crucial context.
 */
function formatVulnsTerminalError(mapped: MappedError): string {
  if (mapped.code === "UPDATE_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (mapped.code !== "VERSION_NOT_FOUND") {
    return formatMappedErrorForTerminal(mapped);
  }
  const detail = mapped.details ?? {};
  const pkg = typeof detail.package === "string" ? detail.package : undefined;
  const requested =
    typeof detail.requestedVersion === "string"
      ? detail.requestedVersion
      : undefined;
  const lines = [mapped.message];
  if (pkg && requested) {
    lines.push(`  package:   ${pkg}`);
    lines.push(`  requested: ${requested}`);
  } else if (requested) {
    lines.push(`  requested: ${requested}`);
  }
  const rawAvailable = Array.isArray(detail.availableVersions)
    ? detail.availableVersions
    : undefined;
  const available = rawAvailable
    ?.map((entry) => (typeof entry?.version === "string" ? entry.version : ""))
    .filter((v): v is string => v.length > 0);
  if (available && available.length > 0) {
    const sample = available.slice(0, 5).join(", ");
    const more = available.length - 5;
    const suffix = more > 0 ? `, ... (+${more} more)` : "";
    lines.push(`  available: ${sample}${suffix}`);
  }
  return lines.join("\n");
}

const PKG_VULNS_DESCRIPTION = `Show known vulnerabilities for a package. Lists CVE / OSV advisories
with severity, affected version ranges, and fix versions. Default text is
capped for readability; use --verbose for all selected advisory rows or --json
for the complete structured envelope.

Package spec: <registry>:<name>[@<version>]. Supported registries:
npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, swift. vcpkg and zig are not supported.
Omit @<version> to check the latest release.
Example: githits pkg vulns npm:lodash@4.17.20 --severity high

Severity filter (--severity) and withdrawn-advisory visibility
(--include-withdrawn) are passed through to the backend; the
returned count reflects whatever survived the filter and active filters
are echoed in text and JSON output. Use --scope non_affecting to list
historical advisories that do not affect the inspected version, or --scope all
to list affected and historical package advisories together.`;

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
      "Advisory rows to return: affected, non_affecting, all (default: affected)",
    )
    .option(
      "--include-withdrawn",
      "Include retracted advisories (default: off)",
    )
    .option(
      "-v, --verbose",
      "Show aliases, modified/withdrawn dates, and malicious-advisory markers",
    )
    .option("--json", "Emit the lean JSON envelope")
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
