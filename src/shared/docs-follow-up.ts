import type { PackageDocSourceKind } from "../services/index.js";

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
