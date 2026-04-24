import type { CodeNavigationCapability } from "../services/index.js";

export interface CodeNavigationCliSurfaceOptions {
  overrideEnabled?: boolean;
  capability?: CodeNavigationCapability;
}

export function isCodeNavigationCliSurfaceOpen(
  options: CodeNavigationCliSurfaceOptions,
): boolean {
  return options.overrideEnabled === true || options.capability === "enabled";
}
