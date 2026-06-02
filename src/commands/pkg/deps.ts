import type { Command } from "commander";
import { createContainer } from "../../container.js";
import type { PackageIntelligenceService } from "../../services/index.js";
import { shouldUseColors } from "../../shared/colors.js";
import {
  formatMappedErrorForTerminal,
  InvalidPackageSpecError,
  type MappedError,
  mapPackageIntelligenceError,
  parsePackageSpec,
  requireAuth,
} from "../../shared/index.js";
import {
  buildPackageDependenciesParams,
  SUPPORTED_DEPS_REGISTRIES_LIST,
} from "../../shared/package-dependencies-request.js";
import {
  buildPackageDependenciesSuccessPayload,
  formatPackageDependenciesTerminal,
} from "../../shared/package-dependencies-response.js";

export interface PkgDepsCommandOptions {
  lifecycle?: string;
  depth?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgDepsCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

/**
 * Core `pkg deps` action. Accepts `<spec>[@<version>]`. The
 * `--lifecycle` filter is server-side (filters `dependencyGroups`
 * only) and implies the groups view. `--lifecycle all` renders the
 * structured view without filtering. `--depth N` opts into the
 * transitive block and caps traversal to that depth.
 */
export async function pkgDepsAction(
  spec: string,
  options: PkgDepsCommandOptions,
  deps: PkgDepsCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handlePkgDepsCommandError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const parsed = parsePackageSpec(spec);

    const userDepth = resolveDepth(options);
    const includeTransitiveOutput = userDepth !== undefined;
    // Always fetch the transitive DAG on the wire — even in plain
    // mode we need it to resolve the concrete version for each
    // direct dep (`name@version` in display), and for `--verbose`
    // to annotate per-entry importer provenance. When the user
    // didn't request transitive output, cap at depth 1 so the payload
    // stays lean.
    const wireIncludeTransitive = true;
    const wireMaxDepth = includeTransitiveOutput ? userDepth : 1;

    const { params, canonicalLifecycles } = buildPackageDependenciesParams({
      registry: parsed.registry,
      packageName: parsed.name,
      version: parsed.version,
      lifecycle: options.lifecycle,
      includeTransitive: wireIncludeTransitive,
      maxDepth: wireMaxDepth,
    });

    const report =
      await deps.packageIntelligenceService.packageDependencies(params);

    if (options.json) {
      const payload = buildPackageDependenciesSuccessPayload(report, {
        requestedVersion: parsed.version,
        canonicalLifecycles,
        includeTransitive: includeTransitiveOutput,
        maxDepth: userDepth,
        // Tie `--verbose` to JSON richness too: agents reading the
        // envelope see the same detail as the terminal's verbose
        // output. Default `--json` keeps the payload lean (~4×
        // smaller on large graphs like jest).
        includeImporters: options.verbose ?? false,
      });
      console.log(JSON.stringify(payload));
      return;
    }

    const showGroups = canonicalLifecycles.some((entry) => entry !== "runtime");

    const output = formatPackageDependenciesTerminal(report, {
      verbose: options.verbose,
      useColors: shouldUseColors(),
      requestedVersion: parsed.version,
      canonicalLifecycles:
        canonicalLifecycles.length > 0 ? canonicalLifecycles : undefined,
      includeTransitive: includeTransitiveOutput,
      maxDepth: userDepth,
      showGroups,
    });
    process.stdout.write(output);
  } catch (error) {
    handlePkgDepsCommandError(error, options.json ?? false);
  }
}

function resolveDepth(options: PkgDepsCommandOptions): number | undefined {
  const raw = options.depth;
  if (raw === undefined) return undefined;
  // Require the raw string to be an exact integer. `parseInt` would
  // silently truncate `3.5 → 3` or `5abc → 5`; on a public CLI that
  // silently corrupts caller intent rather than surfacing the typo.
  if (!/^-?\d+$/.test(raw.trim())) {
    throw new InvalidPackageSpecError(
      `--depth expects an integer between 1 and 10. Got '${raw}'.`,
    );
  }
  const parsed = Number.parseInt(raw, 10);
  return parsed;
}

function handlePkgDepsCommandError(error: unknown, json: boolean): never {
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

  console.error(formatDepsTerminalError(mapped));
  process.exit(1);
}

/**
 * Mirrors `pkg vulns` — enriches VERSION_NOT_FOUND with the package
 * and requested version, plus an `available:` sample when the backend
 * provides one.
 */
function formatDepsTerminalError(mapped: MappedError): string {
  if (mapped.code === "UPDATE_REQUIRED") {
    return formatMappedErrorForTerminal(mapped);
  }
  if (mapped.code !== "VERSION_NOT_FOUND") return mapped.message;
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
    const suffix = more > 0 ? `, … (+${more} more)` : "";
    lines.push(`  available: ${sample}${suffix}`);
  }
  return lines.join("\n");
}

const PKG_DEPS_DESCRIPTION = `Analyze package dependencies. By default shows the flat list of
direct runtime dependencies. Use --lifecycle all for the structured view
(dev / peer / build / optional, plus registry-specific feature / TFM
groups). Runtime group rows include resolved versions when available.
--depth opts into aggregate edge / unique-package counts, conflict detection,
and circular-dependency flags capped to that traversal depth.

Package spec: <registry>:<name>[@<version>]. Supported registries:
${SUPPORTED_DEPS_REGISTRIES_LIST}. Omit @<version> for the latest release. v-prefixed versions are accepted for Swift only.`;

export function registerPkgDepsCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("deps")
    .summary("Analyze dependencies for a package")
    .description(PKG_DEPS_DESCRIPTION)
    .argument("<spec>", "Package spec, e.g. npm:express or npm:express@4.18.0")
    .option(
      "-l, --lifecycle <phases>",
      "Dependency lifecycle breadth (runtime, development, build, peer, optional, all; comma-separated for multi-select except all).",
    )
    .option(
      "--depth <n>",
      "Show transitive output and cap traversal depth (1-10). Omit for direct dependencies only.",
    )
    .option(
      "-v, --verbose",
      "Show conditionType / selectionMode / environmentConstraints metadata in the groups view",
    )
    .option("--json", "Emit the lean JSON envelope")
    .action(async (spec: string, options: PkgDepsCommandOptions) => {
      const deps = await createContainer();
      await pkgDepsAction(spec, options, {
        packageIntelligenceService: deps.packageIntelligenceService,
        codeNavigationUrl: deps.codeNavigationUrl,
        hasValidToken: deps.hasValidToken,
        mcpUrl: deps.mcpUrl,
      });
    });
}
