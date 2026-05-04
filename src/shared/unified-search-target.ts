import type { CodeNavigationTarget } from "../services/index.js";
import { parseCodeNavigationTargetSpec } from "./code-navigation-target.js";

export function parseUnifiedSearchTargetSpec(
  spec: string,
): CodeNavigationTarget {
  return parseCodeNavigationTargetSpec(spec);
}
