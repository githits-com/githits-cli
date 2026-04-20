import { z } from "zod";
import type { CodeNavigationTarget } from "../services/index.js";
import {
  type CodeNavigationRegistryArg,
  toCodeNavigationRegistry,
} from "../shared/code-navigation.js";
import { errorResult, type ToolResult } from "./types.js";

// Re-export the wait-timeout default so callers already importing this
// module keep working; the canonical definition lives in
// src/shared/code-navigation-defaults.ts per the CLI/MCP parity rules.
export { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";

export const codeTargetSchema = z
  .object({
    registry: z
      .enum([
        "npm",
        "pypi",
        "hex",
        "crates",
        "nuget",
        "maven",
        "zig",
        "vcpkg",
        "packagist",
      ])
      .optional()
      .describe(
        "Package registry (npm, pypi, hex, etc.). Required for package scope.",
      ),
    package_name: z
      .string()
      .max(255)
      .optional()
      .describe("Package name. Required for package scope."),
    version: z
      .string()
      .max(100)
      .optional()
      .describe(
        "Package version, e.g. '4.18.2' (defaults to latest). For package scope only.",
      ),
    repo_url: z
      .string()
      .optional()
      .describe(
        "Repository URL (GitHub). Required for repo scope. Example: https://github.com/expressjs/express",
      ),
    git_ref: z
      .string()
      .optional()
      .describe(
        "Git ref - tag, branch, or commit. Required with repo_url. Use HEAD for latest.",
      ),
  })
  .describe(
    "Target: provide registry + package_name (package scope) or repo_url + git_ref (repo scope).",
  );

export type CodeTargetArg = {
  registry?: CodeNavigationRegistryArg;
  package_name?: string;
  version?: string;
  repo_url?: string;
  git_ref?: string;
};

/**
 * Validates and normalizes a code navigation target.
 *
 * Error results carry a JSON-encoded `{ error, code: "INVALID_ARGUMENT" }`
 * envelope per PARITY-ERROR-ENVELOPE — MCP error text must always be
 * valid JSON regardless of which validation branch fires.
 */
export function resolveCodeTarget(
  target: CodeTargetArg,
): CodeNavigationTarget | ToolResult {
  const hasPackageTarget = Boolean(target.registry || target.package_name);
  const hasRepoTarget = Boolean(target.repo_url || target.git_ref);

  if (hasPackageTarget && hasRepoTarget) {
    return invalidTargetResult(
      "Invalid target: provide either registry + package_name or repo_url + git_ref, not both.",
    );
  }

  if (!hasPackageTarget && !hasRepoTarget) {
    return invalidTargetResult(
      "Missing target: provide registry + package_name or repo_url + git_ref.",
    );
  }

  if (hasPackageTarget) {
    if (!target.registry || !target.package_name) {
      return invalidTargetResult(
        "Incomplete package target: both registry and package_name are required.",
      );
    }

    return {
      registry: toCodeNavigationRegistry(target.registry),
      packageName: target.package_name,
      version: target.version,
    };
  }

  if (!target.repo_url || !target.git_ref) {
    return invalidTargetResult(
      "Incomplete repository target: both repo_url and git_ref are required.",
    );
  }

  return {
    repoUrl: target.repo_url,
    gitRef: target.git_ref,
  };
}

function invalidTargetResult(message: string): ToolResult {
  return errorResult(
    JSON.stringify({ error: message, code: "INVALID_ARGUMENT" }),
  );
}
