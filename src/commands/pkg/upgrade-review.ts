import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  buildPackageUpgradeReview,
  buildPackageUpgradeReviewRequest,
  formatPackageUpgradeReviewTerminal,
  InvalidPackageSpecError,
  PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES,
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

export interface PkgUpgradeReviewCommandOptions {
  to?: string;
  package?: string[];
  transitiveSecurity?: boolean;
  dependencyIssues?: boolean;
  minSeverity?: string;
  verbose?: boolean;
  json?: boolean;
}

export interface PkgUpgradeReviewCommandDependencies {
  packageIntelligenceService: PackageIntelligenceService | undefined;
  codeNavigationUrl: string | undefined;
  hasValidToken: boolean;
  mcpUrl: string;
}

export async function pkgUpgradeReviewAction(
  spec: string | undefined,
  options: PkgUpgradeReviewCommandOptions,
  deps: PkgUpgradeReviewCommandDependencies,
): Promise<void> {
  try {
    requireAuth(deps);
  } catch (error) {
    if (options.json) handlePkgUpgradeReviewCommandError(error, true);
    throw error;
  }

  try {
    if (!deps.codeNavigationUrl || !deps.packageIntelligenceService) {
      throw new InvalidPackageSpecError(
        "Package intelligence is not configured for this environment.",
      );
    }

    const request = buildPackageUpgradeReviewRequest({
      ...parseSingleSpec(spec, options),
      packages: parsePackageOptions(options.package),
      includeTransitiveSecurity: options.transitiveSecurity,
      includeDependencyIssues: options.dependencyIssues,
      minSeverity: options.minSeverity,
    });
    const response = await buildPackageUpgradeReview(
      deps.packageIntelligenceService,
      request.packages,
      request.options,
    );

    if (options.json) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }
    process.stdout.write(
      formatPackageUpgradeReviewTerminal(response, {
        verbose: options.verbose === true,
        useColors: shouldUseColors(),
        terminalWidth: process.stdout.columns,
      }),
    );
  } catch (error) {
    handlePkgUpgradeReviewCommandError(error, options.json ?? false);
  }
}

function handlePkgUpgradeReviewCommandError(
  error: unknown,
  json: boolean,
): never {
  const mapped = mapPackageIntelligenceErrorForCli(error);
  if (json) {
    console.error(JSON.stringify(buildCliMappedErrorPayload(mapped)));
  } else {
    console.error(formatMappedErrorForTerminal(mapped));
  }
  process.exit(1);
}

function parseSingleSpec(
  spec: string | undefined,
  options: PkgUpgradeReviewCommandOptions,
): {
  registry?: string;
  packageName?: string;
  currentVersion?: string;
  targetVersion?: string;
} {
  if (spec === undefined) return {};
  if (options.package && options.package.length > 0) {
    throw new InvalidPackageSpecError(
      "Pass one of these forms: positional <spec>@<current> --to <target>; positional <spec>@<current>..<target> range; or repeatable --package entries. Choose one form.",
    );
  }
  if (hasUnsupportedArrowRangeIntent(spec)) {
    throw new InvalidPackageSpecError(unsupportedArrowRangeMessage(spec));
  }
  if (hasPackageRangeIntent(spec)) {
    const parsedRange = splitPackageRange(spec);
    if (!parsedRange) {
      throw new InvalidPackageSpecError(invalidPositionalRangeMessage(spec));
    }
    if (options.to !== undefined) {
      throw new InvalidPackageSpecError(
        `Positional range '${spec}' already contains the target version. Use '${spec}' without --to, or split it as '${parsedRange.left}' --to '${parsedRange.target}'.`,
      );
    }
    const parsed = parsePackageSpec(parsedRange.left);
    return {
      registry: parsed.registry,
      packageName: parsed.name,
      currentVersion: parsedRange.currentVersion,
      targetVersion: parsedRange.target,
    };
  }
  const parsed = parsePackageSpec(spec);
  if (!parsed.version) {
    throw new InvalidPackageSpecError(
      "Single-package upgrade review requires <spec>@<current> and --to <target>.",
    );
  }
  if (!options.to) {
    throw new InvalidPackageSpecError(
      "Single-package upgrade review requires --to <target>.",
    );
  }
  return {
    registry: parsed.registry,
    packageName: parsed.name,
    currentVersion: parsed.version,
    targetVersion: options.to,
  };
}

function hasPackageRangeIntent(value: string): boolean {
  const versionSeparatorIndex = findVersionSeparatorIndex(value);
  if (versionSeparatorIndex === undefined) return false;
  const versionSuffix = value.slice(versionSeparatorIndex + 1);
  return versionSuffix.includes("..");
}

function hasUnsupportedArrowRangeIntent(value: string): boolean {
  const versionSeparatorIndex = findVersionSeparatorIndex(value);
  if (versionSeparatorIndex === undefined) return false;
  return value.slice(versionSeparatorIndex + 1).includes("->");
}

function positionalRangeGrammar(): string {
  return "Expected <registry>:<name>@<current>..<target>.";
}

function invalidPositionalRangeMessage(value: string): string {
  return `Invalid positional range '${value}'. ${positionalRangeGrammar()}`;
}

function unsupportedArrowRangeMessage(value: string): string {
  return `Invalid positional range '${value}'. The '->' delimiter is not supported; use <registry>:<name>@<current>..<target>.`;
}

function parsePackageOptions(values: string[] | undefined):
  | Array<{
      registry: string;
      packageName: string;
      currentVersion: string;
      targetVersion: string;
    }>
  | undefined {
  if (!values || values.length === 0) return undefined;
  return values.map((value) => {
    return parseUpgradeReviewPackageOption(value);
  });
}

export function parseUpgradeReviewPackageOption(value: string): {
  registry: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
} {
  if (hasUnsupportedArrowRangeIntent(value)) {
    throw new InvalidPackageSpecError(invalidPackageOptionMessage(value));
  }
  const parsedRange = splitPackageRange(value);
  if (!parsedRange) {
    throw new InvalidPackageSpecError(invalidPackageOptionMessage(value));
  }
  const parsed = parsePackageSpec(parsedRange.left);
  return {
    registry: parsed.registry,
    packageName: parsed.name,
    currentVersion: parsedRange.currentVersion,
    targetVersion: parsedRange.target,
  };
}

function splitPackageRange(
  value: string,
): { left: string; currentVersion: string; target: string } | undefined {
  const versionSeparatorIndex = findVersionSeparatorIndex(value);
  if (versionSeparatorIndex === undefined) return undefined;
  const versionSuffix = value.slice(versionSeparatorIndex + 1);
  if (versionSuffix.includes("...")) return undefined;
  const parts = versionSuffix.split("..");
  if (parts.length === 2 && parts[0] && parts[1]) {
    return {
      left: `${value.slice(0, versionSeparatorIndex + 1)}${parts[0]}`,
      currentVersion: parts[0],
      target: parts[1],
    };
  }
  return undefined;
}

function findVersionSeparatorIndex(value: string): number | undefined {
  const colonIndex = value.indexOf(":");
  const atIndex = value.lastIndexOf("@");
  return atIndex > colonIndex + 1 ? atIndex : undefined;
}

function invalidPackageOptionMessage(value: string): string {
  if (hasUnsupportedArrowRangeIntent(value)) {
    return `Invalid --package '${value}'. The '->' delimiter is not supported; use <registry>:<name>@<current>..<target>.`;
  }
  return `Invalid --package '${value}'. Expected <registry>:<name>@<current>..<target>.`;
}

const DESCRIPTION = `Report evidence for a package upgrade without assigning risk.

Single package range: githits pkg upgrade-review npm:zod@4.3.6..4.4.3
Single package with separate target: githits pkg upgrade-review npm:zod@4.3.6 --to 4.4.3
Batch: githits pkg upgrade-review --package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0
Batch accepts at most ${PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES} upgrades.

Use .. for positional and repeatable --package ranges.

The review checks current and target vulnerabilities, target deprecation metadata,
the changelog range, peer dependency changes, and optional transitive security /
dependency-issue diffs. It reports facts only; the caller owns the final
assessment.`;

export function registerPkgUpgradeReviewCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("upgrade-review")
    .summary("Report dependency upgrade evidence")
    .description(DESCRIPTION)
    .argument(
      "[spec]",
      "Package spec with current version; use a .. range for an inline target or --to for a separate target, e.g. npm:zod@4.3.6..4.4.3",
    )
    .option("--to <version>", "Target version for single-package mode")
    .option(
      "--package <spec>",
      `Repeatable batch entry (maximum ${PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES}): <registry>:<name>@<current>..<target>`,
      collectPackage,
      [] as string[],
    )
    .option(
      "--no-transitive-security",
      "Skip transitive vulnerability summaries",
    )
    .option("--dependency-issues", "Diff transitive dependency issue summaries")
    .option(
      "--min-severity <label>",
      "Minimum direct advisory severity: low, medium, high, critical",
    )
    .option(
      "-v, --verbose",
      "Show dependency change examples, including transitive version changes",
    )
    .option("--json", "Emit the JSON envelope")
    .action(
      async (
        spec: string | undefined,
        options: PkgUpgradeReviewCommandOptions,
      ) => {
        const deps = await createContainer();
        await pkgUpgradeReviewAction(spec, options, {
          packageIntelligenceService: deps.packageIntelligenceService,
          codeNavigationUrl: deps.codeNavigationUrl,
          hasValidToken: deps.hasValidToken,
          mcpUrl: deps.mcpUrl,
        });
      },
    );
}

function collectPackage(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}
