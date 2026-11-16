import { sanitizeTerminalText } from "./terminal-text.js";

export const RISK_KIND_LABELS: Record<string, string> = {
  removes_or_renames_api: "removal",
  changes_behavior_or_default: "behavior",
  raises_runtime_or_platform_requirement: "runtime/platform",
  changes_packaging_or_module_format: "packaging/modules",
  deprecates_without_removal: "deprecation",
  security_fix: "security fix",
  notable_change: "notable change",
};

export const PENDING_CLASSIFICATION_MESSAGE =
  "Classification is still running or may have failed. Rerun in a few seconds to a minute to fill not-assessed versions from completed stored labels, without rerunning the model.";

export function safeRiskText(value: string): string {
  return sanitizeTerminalText(value.replace(/\s+/g, " ")).trim();
}
