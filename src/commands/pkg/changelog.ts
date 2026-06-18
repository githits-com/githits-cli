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

export interface PkgChangelogCommandOptions {
  repoUrl?: string;
  gitRef?: string;
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
 * Core `pkg changelog` action. Accepts either `<spec>` (same parser
 * as `pkg info` / `pkg vulns` / `pkg deps`) or `--repo-url <url>`,
 * mutually exclusive. `<spec>@<version>` is rejected at the shared
 * builder boundary — use `--to <version>` to cap by version.
 */
export async function pkgChangelogAction(
  spec: string | undefined,
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

    const parsed = spec !== undefined ? parsePackageSpec(spec) : undefined;
    const limit = resolveLimit(options);
    const includeBodies = options.body !== false;
    if (!includeBodies && options.verbose) {
      throw new InvalidPackageSpecError(
        "--no-body drops the bodies that --verbose uncaps — pass only one of the two flags.",
      );
    }

    const { params, explicitFilterFields } = buildPackageChangelogParams({
      registry: parsed?.registry,
      packageName: parsed?.name,
      specVersion: parsed?.version,
      repoUrl: options.repoUrl,
      gitRef: options.gitRef,
      fromVersion: options.from,
      toVersion: options.to,
      limit,
    });

    const report =
      await deps.packageIntelligenceService.packageChangelog(params);

    const payload = buildPackageChangelogSuccessPayload(report, {
      registry: params.registry
        ? toPkgseerRegistryLowercase(params.registry)
        : undefined,
      name: params.packageName,
      repoUrl: params.repoUrl,
      mode: params.fromVersion ? "range" : "latest",
      explicitFilterFields,
      includeBodies,
      fromVersion: params.fromVersion,
      toVersion: params.toVersion,
      limit: params.limit,
      gitRef: params.gitRef,
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
  const mapped = mapPackageIntelligenceError(error);

  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
    process.exit(1);
  }

  console.error(formatChangelogTerminalError(mapped));
  process.exit(1);
}

/**
 * Mirrors `pkg vulns` / `pkg deps` — enriches VERSION_NOT_FOUND with
 * the package and requested version (the shared helper populated
 * these from `fromVersion` / `toVersion` when `version` wasn't set).
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

const PKG_CHANGELOG_DESCRIPTION = `Fetch recent release notes or changelog entries for a package or
repository. By default shows the ten most recent entries with the
first 10 lines of each entry's body. Use --from for a full version
range, --limit to change the latest-mode count (1-50), --verbose to
uncap the body preview, and --no-body to drop bodies entirely.

Addressing: <spec> (registry:name) OR --repo-url <url>. Source
(GitHub Releases, CHANGELOG.md, or HexDocs) is shown on the summary
line.

Package spec: <registry>:<name>. Supported registries: ${PKGSEER_REGISTRY_LIST}. \`<spec>@<version>\`
is NOT accepted here — use --to <version> for "entries up to this
version".`;

export function registerPkgChangelogCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("changelog")
    .summary("Fetch release notes / changelog entries for a package")
    .description(PKG_CHANGELOG_DESCRIPTION)
    .argument(
      "[spec]",
      "Package spec, e.g. npm:express (mutually exclusive with --repo-url)",
    )
    .option(
      "--repo-url <url>",
      "Repository URL addressing (mutually exclusive with <spec>)",
    )
    .option(
      "--from <version>",
      "Start of version range (enables range mode; disables --limit)",
    )
    .option("--to <version>", "End of range / latest-mode cap")
    .option("--limit <n>", "Latest-mode entry count (1-50, default 10)")
    .option(
      "--git-ref <ref>",
      "Git branch/tag for CHANGELOG.md source (ignored for GitHub Releases / HexDocs)",
    )
    .option(
      "-v, --verbose",
      "Uncap the markdown body preview (default cap: 10 lines per entry)",
    )
    .option(
      "--no-body",
      "Drop body fields from entries (affects terminal + JSON)",
    )
    .option("--json", "Emit the JSON envelope")
    .action(
      async (spec: string | undefined, options: PkgChangelogCommandOptions) => {
        const deps = await createContainer();
        await pkgChangelogAction(spec, options, {
          packageIntelligenceService: deps.packageIntelligenceService,
          codeNavigationUrl: deps.codeNavigationUrl,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}
