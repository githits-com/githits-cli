import type { PackageDocSourceKind } from "@githits/core-internal";

export function lowerDocSourceKind(
  value: PackageDocSourceKind | undefined,
): "crawled" | "repo" | undefined {
  switch (value) {
    case "CRAWLED":
      return "crawled";
    case "REPOSITORY":
      return "repo";
    default:
      return undefined;
  }
}
