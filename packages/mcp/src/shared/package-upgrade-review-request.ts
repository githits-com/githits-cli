import type { PackageUpgradeDependencyProbeParams } from "@githits/core-internal";
import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  InvalidPackageSpecError,
  UnsupportedRegistryError,
} from "./package-spec.js";
import { normalisePackageVersion } from "./package-version.js";
import {
  SEVERITY_LABEL_TO_CVSS,
  type SeverityLabel,
} from "./package-vulnerabilities-request.js";

export interface UpgradeReviewPackageInput {
  registry: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
}

export interface PackageUpgradeReviewRequestInput {
  registry?: string;
  packageName?: string;
  currentVersion?: string;
  targetVersion?: string;
  packages?: UpgradeReviewPackageInput[];
  includeTransitiveSecurity?: boolean;
  includeDependencyIssues?: boolean;
  minSeverity?: string;
}

export interface UpgradeReviewPackageRequest {
  registry: PkgseerRegistry;
  registryLabel: string;
  packageName: string;
  currentVersion: string;
  targetVersion: string;
}

export interface PackageUpgradeReviewOptions {
  includeTransitiveSecurity: boolean;
  includeDependencyIssues: boolean;
  includeDependencyChanges: boolean;
  changelogLimit: number;
  minSeverityLabel?: SeverityLabel;
  minSeverity?: number;
}

export interface PackageUpgradeReviewRequestBuildResult {
  packages: UpgradeReviewPackageRequest[];
  options: PackageUpgradeReviewOptions;
}

const DEFAULT_CHANGELOG_LIMIT = 20;
export const PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES = 30;

export function buildPackageUpgradeReviewRequest(
  input: PackageUpgradeReviewRequestInput,
): PackageUpgradeReviewRequestBuildResult {
  const batch = input.packages?.filter((pkg) => !isBlankPackageInput(pkg));
  const hasBatch = Array.isArray(batch) && batch.length > 0;
  const hasSingle =
    hasNonBlankValue(input.registry) ||
    hasNonBlankValue(input.packageName) ||
    hasNonBlankValue(input.currentVersion) ||
    hasNonBlankValue(input.targetVersion);

  if (hasBatch && hasSingle) {
    throw new InvalidPackageSpecError(
      "Pass either packages[] or registry/package_name/current_version/target_version, not both.",
    );
  }
  if (!hasBatch && !hasSingle) {
    throw new InvalidPackageSpecError(
      "Package upgrade review requires either packages[] or registry, package_name, current_version, and target_version.",
    );
  }

  const packages = hasBatch
    ? parseBatch(batch)
    : [
        parsePackageInput({
          registry: input.registry ?? "",
          packageName: input.packageName ?? "",
          currentVersion: input.currentVersion ?? "",
          targetVersion: input.targetVersion ?? "",
        }),
      ];

  const minSeverityLabel = resolveMinSeverityLabel(input.minSeverity);

  return {
    packages,
    options: {
      includeTransitiveSecurity: input.includeTransitiveSecurity !== false,
      includeDependencyIssues: input.includeDependencyIssues === true,
      includeDependencyChanges: true,
      changelogLimit: DEFAULT_CHANGELOG_LIMIT,
      minSeverityLabel,
      minSeverity:
        minSeverityLabel !== undefined && minSeverityLabel !== "low"
          ? SEVERITY_LABEL_TO_CVSS[minSeverityLabel]
          : undefined,
    },
  };
}

export function buildUpgradeDependencyProbeParams(
  pkg: UpgradeReviewPackageRequest,
  version: string,
  options: PackageUpgradeReviewOptions,
): PackageUpgradeDependencyProbeParams {
  return {
    registry: pkg.registry,
    packageName: pkg.packageName,
    version,
    minSeverity: options.minSeverity,
    includeGroups: true,
    includeTransitiveSecurity: options.includeTransitiveSecurity,
    includeDependencyIssues: options.includeDependencyIssues,
    includeDependencyChanges: options.includeDependencyChanges,
  };
}

function hasNonBlankValue(value: string | undefined): boolean {
  return value !== undefined && value.trim().length > 0;
}

function isBlankPackageInput(input: UpgradeReviewPackageInput): boolean {
  return !(
    hasNonBlankValue(input.registry) ||
    hasNonBlankValue(input.packageName) ||
    hasNonBlankValue(input.currentVersion) ||
    hasNonBlankValue(input.targetVersion)
  );
}

function parseBatch(
  packages: UpgradeReviewPackageInput[] | undefined,
): UpgradeReviewPackageRequest[] {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new InvalidPackageSpecError(
      "packages[] must contain at least one upgrade.",
    );
  }
  if (packages.length > PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES) {
    throw new InvalidPackageSpecError(
      `packages[] must contain at most ${PACKAGE_UPGRADE_REVIEW_MAX_PACKAGES} upgrades.`,
    );
  }
  return packages.map(parsePackageInput);
}

function parsePackageInput(
  input: UpgradeReviewPackageInput,
): UpgradeReviewPackageRequest {
  const registryArg = input.registry?.trim().toLowerCase() ?? "";
  if (!isKnownPkgseerRegistryArg(registryArg)) {
    throw new UnsupportedRegistryError(
      `Unsupported registry '${input.registry}'. Supported: ${PKGSEER_REGISTRY_LIST}.`,
    );
  }
  const packageName = input.packageName?.trim() ?? "";
  if (packageName.length === 0) {
    throw new InvalidPackageSpecError("Package name is required.");
  }
  const registry = toPkgseerRegistry(registryArg as PkgseerRegistryArg);
  const currentVersion = normaliseVersion(
    input.currentVersion,
    "current_version",
    registry,
  );
  const targetVersion = normaliseVersion(
    input.targetVersion,
    "target_version",
    registry,
  );
  return {
    registry,
    registryLabel: registryArg,
    packageName,
    currentVersion,
    targetVersion,
  };
}

function normaliseVersion(
  raw: string | undefined,
  fieldName: string,
  registry: PkgseerRegistry,
): string {
  const version = normalisePackageVersion(raw, registry);
  if (version === undefined) {
    throw new InvalidPackageSpecError(`${fieldName} is required.`);
  }
  return version;
}

function resolveMinSeverityLabel(
  raw: string | undefined,
): SeverityLabel | undefined {
  if (raw === undefined) return undefined;
  const lower = raw.trim().toLowerCase();
  if (lower.length === 0) return undefined;
  if (
    lower === "low" ||
    lower === "medium" ||
    lower === "high" ||
    lower === "critical"
  ) {
    return lower;
  }
  throw new InvalidPackageSpecError(
    `Unsupported min_severity '${raw}'. Expected one of: low, medium, high, critical.`,
  );
}
