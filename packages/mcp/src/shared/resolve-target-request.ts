import {
  isKnownPkgseerRegistryArg,
  PKGSEER_REGISTRY_LIST,
  type PkgseerRegistry,
  type PkgseerRegistryArg,
  type ResolveTargetKind,
  type ResolveTargetParams,
  toPkgseerRegistry,
} from "@githits/core-internal";
import {
  InvalidArgumentError,
  InvalidPackageSpecError,
} from "./package-spec.js";
import { parseUnifiedSearchTargetSpec } from "./unified-search-target.js";

export const RESOLVE_TARGET_DEFAULT_LIMIT = 8;
export const RESOLVE_TARGET_MAX_LIMIT = 20;

export interface ResolveTargetRequestInput {
  name: string;
  query?: string;
  registry?: string;
  registries?: string[];
  preferKind?: string;
  intentHints?: string[];
  limit?: number;
  includeDetailedFields: boolean;
}

export function buildResolveTargetParams(
  input: ResolveTargetRequestInput,
): ResolveTargetParams {
  const name = input.name?.trim() ?? "";
  if (!name) throw new InvalidPackageSpecError("Target name is required.");
  rejectCanonicalTarget(name);

  const limit = input.limit ?? RESOLVE_TARGET_DEFAULT_LIMIT;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > RESOLVE_TARGET_MAX_LIMIT
  ) {
    throw new InvalidPackageSpecError(
      `limit expects an integer between 1 and ${RESOLVE_TARGET_MAX_LIMIT}. Got ${String(limit)}.`,
    );
  }

  const params: ResolveTargetParams = {
    name,
    limit,
    includeDetailedFields: input.includeDetailedFields,
  };
  const query = input.query?.trim();
  if (query) params.query = query;

  const registries = parseRegistries(input.registries ?? input.registry);
  if (registries.length > 0) params.registries = registries;

  const preferredKind = parsePreferredKind(input.preferKind);
  if (preferredKind) params.preferredKinds = [preferredKind];

  const intentHints = normaliseStrings(input.intentHints);
  if (intentHints.length > 0) params.intentHints = intentHints;
  return params;
}

/** Keep fuzzy resolution aligned with the target grammar used downstream. */
function rejectCanonicalTarget(name: string): void {
  try {
    parseUnifiedSearchTargetSpec(name);
  } catch (error) {
    if (error instanceof InvalidArgumentError) return;
    throw error;
  }
  throw new InvalidArgumentError(
    `Canonical target ${JSON.stringify(name)} does not need resolution. Pass it directly to the next GitHits tool.`,
  );
}

function parseRegistries(
  value: string | string[] | undefined,
): PkgseerRegistry[] {
  if (value === undefined) return [];
  const registries: PkgseerRegistry[] = [];
  const values = Array.isArray(value) ? value : value.split(",");
  for (const raw of values) {
    const registry = raw.trim().toLowerCase();
    if (!registry) continue;
    if (!isKnownPkgseerRegistryArg(registry)) {
      throw new InvalidPackageSpecError(
        `Unsupported registry '${raw.trim()}'. Supported: ${PKGSEER_REGISTRY_LIST}.`,
      );
    }
    const mapped = toPkgseerRegistry(registry as PkgseerRegistryArg);
    if (!registries.includes(mapped)) registries.push(mapped);
  }
  return registries;
}

function parsePreferredKind(
  value: string | undefined,
): ResolveTargetKind | undefined {
  const kind = value?.trim().toLowerCase();
  if (!kind) return undefined;
  if (kind === "package") return "PACKAGE";
  if (kind === "repository") return "REPOSITORY";
  if (kind === "site") return "SITE";
  throw new InvalidPackageSpecError(
    `Preferred kind expects package, repository, or site. Got '${value}'.`,
  );
}

function normaliseStrings(values: string[] | undefined): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values ?? []) {
    const value = raw.trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}
