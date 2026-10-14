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
  resolvePackageChangelogView,
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
  verbatim?: boolean;
  noBody?: boolean;
  // Commander's `--no-body` flag is surfaced as `body: false` in
  // options; shared view resolution maps it to timeline mode.
  body?: boolean;
  json?: boolean;
  changes?: string;
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
    const { view } = resolvePackageChangelogView({
      omitBodies: options.body === false || options.noBody === true,
      verbatim: options.verbatim,
      verbose: options.verbose,
      json: options.json,
    });

    const { params, mode, explicitFilterFields, changes } =
      buildPackageChangelogParams({
        target: spec,
        fromVersion: options.from,
        toVersion: options.to,
        limit,
        view,
        changes: options.changes,
      });

    const report = await deps.packageIntelligenceService.packageChangelog({
      ...params,
      includeJsonFields: options.json === true,
    });

    const payload = buildPackageChangelogSuccessPayload(report, {
      registry: toPkgseerRegistryLowercase(params.registry),
      name: params.packageName,
      mode,
      changes,
      explicitFilterFields,
      view,
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
      useColors: shouldUseColors(),
      terminalWidth: process.stdout.columns,
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
By default shows all parsed release-note statements, with available agent
classifications and nearby sources. Pin a version for one selected release,
or use @from..to for releases after from through to (from excluded,
to included). --from/--to remain package range flags. --limit changes
latest-mode entry count (1-50). --changes actionable|important|all limits
statements; all is the default. --verbatim shows full original notes instead;
--verbose is a deprecated alias. --no-body shows a version/date/URL timeline.
JSON includes full statement evidence; --verbatim --json includes original bodies.

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
    .option("--to <version>", "Inclusive end of range / latest-mode cap")
    .option(
      "--limit <n>",
      "Latest-mode or upper-cap entry count (1-50, default 10)",
    )
    .option("-v, --verbose", "Deprecated alias for --verbatim")
    .option(
      "--verbatim",
      "Show original full notes instead of parsed statements",
    )
    .option(
      "--no-body",
      "Show only the version/date/URL timeline; skip parsing and classification",
    )
    .option(
      "--changes <view>",
      "Statements: actionable, important (actionable + should know), all (default); ignored with --verbatim and --no-body",
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
