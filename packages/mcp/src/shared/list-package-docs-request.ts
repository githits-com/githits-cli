import type { ListPackageDocsParams } from "@githits/core-internal";
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

export interface ListPackageDocsRequestInput {
  registry: string;
  packageName: string;
  version?: string;
  limit?: number;
  after?: string;
}

export interface ListPackageDocsRequestBuildResult {
  params: ListPackageDocsParams;
  limitExplicit: boolean;
  afterExplicit: boolean;
}

export function buildListPackageDocsParams(
  input: ListPackageDocsRequestInput,
): ListPackageDocsRequestBuildResult {
  const rawPackageName = input.packageName?.trim() ?? "";
  if (!rawPackageName) {
    throw new InvalidPackageSpecError("Package name is required.");
  }

  const registry = input.registry?.trim().toLowerCase() ?? "";
  if (!isKnownPkgseerRegistryArg(registry)) {
    throw new UnsupportedRegistryError(
      `Unsupported registry '${input.registry}'. Supported: ${PKGSEER_REGISTRY_LIST}.`,
    );
  }

  const backendRegistry = toPkgseerRegistry(registry as PkgseerRegistryArg);
  const params: ListPackageDocsParams = {
    registry: backendRegistry,
    packageName: normalisePackageName(rawPackageName, backendRegistry),
  };

  const version = input.version?.trim();
  if (version) params.version = version;

  const after = input.after?.trim();
  if (after) params.after = after;

  if (input.limit !== undefined) {
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 500
    ) {
      throw new InvalidPackageSpecError(
        "Limit must be an integer between 1 and 500.",
      );
    }
    params.limit = input.limit;
  }

  return {
    params,
    limitExplicit: input.limit !== undefined,
    afterExplicit: Boolean(after),
  };
}

function normalisePackageName(
  packageName: string,
  registry: PkgseerRegistry,
): string {
  if (registry === "SWIFT" && /^github\.com\//i.test(packageName)) {
    return packageName.toLowerCase();
  }
  return packageName;
}
