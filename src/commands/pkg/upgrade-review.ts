import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  buildPackageUpgradeReview,
  buildPackageUpgradeReviewRequest,
  formatPackageUpgradeReviewTerminal,
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
      console.log(JSON.stringify(response));
      return;
    }
    process.stdout.write(
      formatPackageUpgradeReviewTerminal(response, {
        verbose: options.verbose === true,
        useColors: shouldUseColors(),
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
  const mapped = mapPackageIntelligenceError(error);
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
      "Pass either a single <spec>@<current> with --to or repeatable --package entries, not both.",
    );
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
  const parsedRange = splitPackageRange(value);
  if (!parsedRange) {
    throw new InvalidPackageSpecError(invalidPackageOptionMessage(value));
  }
  const parsed = parsePackageSpec(parsedRange.left);
  if (!parsed.version) {
    throw new InvalidPackageSpecError(
      `Invalid --package '${value}'. The left side must include @<current>.`,
    );
  }
  return {
    registry: parsed.registry,
    packageName: parsed.name,
    currentVersion: parsed.version,
    targetVersion: parsedRange.target,
  };
}

function splitPackageRange(
  value: string,
): { left: string; target: string } | undefined {
  for (const delimiter of ["->", ".."] as const) {
    const parts = value.split(delimiter);
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { left: parts[0], target: parts[1] };
    }
  }
  return undefined;
}

function invalidPackageOptionMessage(value: string): string {
  const expected =
    "Expected <registry>:<name>@<current>..<target> or quoted <registry>:<name>@<current>-><target>.";
  if (value.endsWith("-")) {
    return `Invalid --package '${value}'. The shell likely treated '>' as output redirection. ${expected}`;
  }
  return `Invalid --package '${value}'. ${expected}`;
}

const DESCRIPTION = `Report evidence for a package upgrade without assigning risk.

Single package: githits pkg upgrade-review npm:zod@4.3.6 --to 4.4.3
Batch: githits pkg upgrade-review --package npm:zod@4.3.6..4.4.3 --package npm:lint-staged@16.2.7..16.4.0

The older -> delimiter is still accepted when quoted, but unquoted > is shell
redirection in zsh/bash. Prefer .. for repeatable --package entries.

The review checks current and target vulnerabilities, target deprecation metadata,
the changelog range, peer dependency changes, and optional transitive security /
dependency-issue diffs. It reports facts only; the caller owns the final
assessment.`;

export function registerPkgUpgradeReviewCommand(pkgCommand: Command): Command {
  return pkgCommand
    .command("upgrade-review")
    .summary("Report dependency upgrade evidence")
    .description(DESCRIPTION)
    .argument("[spec]", "Package spec with current version, e.g. npm:zod@4.3.6")
    .option("--to <version>", "Target version for single-package mode")
    .option(
      "--package <spec>",
      "Repeatable batch entry: <registry>:<name>@<current>..<target>",
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
