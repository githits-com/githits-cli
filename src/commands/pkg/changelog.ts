import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  PKGSEER_REGISTRY_LIST,
  toPkgseerRegistryLowercase,
} from "@githits/core-internal";
import {
  buildPackageChangelogParams,
  buildPackageChangelogSuccessPayload,
  formatPackageChangelogTerminal,
  InvalidPackageSpecError,
  type MappedError,
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

export interface PkgChangelogCommandOptions {
  from?: string;
  to?: string;
  limit?: string;
  verbose?: boolean;
  noBody?: boolean;
  // Commander's `--no-body` flag is surfaced as `body: false` in
  // options; we map it to `includeBodies` in the builder.
  body?: boolean;
  json?: boolean;
}

export interface PkgChangelogCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `pkg changelog` action. Accepts a compact package target
 * (`registry:name`, `@version`, or `@from..to`) plus compatible
 * package range flags.
 */
export async function pkgChangelogAction(
  spec: string,
  options: PkgChangelogCommandOptions,
  deps: PkgChangelogCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handlePkgChangelogCommandError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const limit = resolveLimit(options);
    const includeBodies = options.body !== false;
    if (!includeBodies && options.verbose) {
      throw new InvalidPackageSpecError(
        "--no-body drops the bodies that --verbose uncaps — pass only one of the two flags.",
      );
    }

    const { params, mode, explicitFilterFields } = buildPackageChangelogParams({
      target: spec,
      fromVersion: options.from,
      toVersion: options.to,
      limit,
      includeBodies,
    });

    const report =
      await deps.packageIntelligenceService.packageChangelog(params);

    const payload = buildPackageChangelogSuccessPayload(report, {
      registry: toPkgseerRegistryLowercase(params.registry),
      name: params.packageName,
      mode,
      explicitFilterFields,
      includeBodies,
      fromVersion: params.fromVersion,
      toVersion: params.toVersion,
      limit: params.limit,
      version: params.version,
    });

    if (options.json) {
      console.log(JSON.stringify(payload));
      return;
    }

    const output = formatPackageChangelogTerminal(payload, {
      verbose: options.verbose ?? false,
      useColors: shouldUseColors(),
    });
    process.stdout.write(output);
  } catch (error) {
    handlePkgChangelogCommandError(error, options.json ?? false);
  }
}

function resolveLimit(options: PkgChangelogCommandOptions): number | undefined {
  const raw = options.limit;
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidPackageSpecError(
      `--limit expects an integer between 1 and 50. Got '${raw}'.`,
    );
  }
  return Number.parseInt(raw, 10);
}

function handlePkgChangelogCommandError(error: unknown, json: boolean): never {
  const mapped = mapPackageIntelligenceErrorForCli(error);

  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    process.exit(1);
  }

  console.error(formatChangelogTerminalError(mapped));
  process.exit(1);
}

/**
 * Mirrors `pkg vulns` / `pkg deps` — enriches VERSION_NOT_FOUND with
 * the package and requested version.
 */
function formatChangelogTerminalError(mapped: MappedError): string {
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

const PKG_CHANGELOG_DESCRIPTION = `Find release notes and changelog history for a package.
By default shows up to ten latest-mode entries with the first 10
lines of each entry's body. Pin a version for one selected release,
or use @from..to for a closed interval. --from/--to remain as
package range flags on a bare spec. --limit changes the latest-mode
count (1-50). --verbose uncaps the body preview; --no-body drops
bodies entirely.

Package spec: <registry>:<name>[@<version> | @<from>..<to>]. Package-only;
repository and site targets are rejected. Supported registries:
${PKGSEER_REGISTRY_LIST}.`;

export function registerPkgChangelogCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("changelog")
    .summary("Find release notes and changelog history for a package")
    .description(PKG_CHANGELOG_DESCRIPTION)
    .argument(
      "<spec>",
      "Package spec, e.g. npm:express, npm:express@5.2.1, or npm:express@4.21.2..5.2.1",
    )
    .option(
      "--from <version>",
      "Exclusive start of version range (enables range mode; disables --limit)",
    )
    .option("--to <version>", "End of range / latest-mode cap")
    .option("--limit <n>", "Latest-mode entry count (1-50, default 10)")
    .option(
      "-v, --verbose",
      "Uncap the markdown body preview (default cap: 10 lines per entry)",
    )
    .option(
      "--no-body",
      "Drop body fields from entries (affects terminal + JSON)",
    )
    .option("--json", "Emit the JSON envelope")
    .action(async (spec: string, options: PkgChangelogCommandOptions) => {
      const deps = await createContainer();
      await pkgChangelogAction(spec, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
