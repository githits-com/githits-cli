import { z } from "zod";
import type { CodeNavigationTarget } from "../services/index.js";
import {
  type CodeNavigationRegistryArg,
  toCodeNavigationRegistry,
} from "../shared/code-navigation.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { parseCodeNavigationTargetSpec } from "../shared/code-navigation-target.js";
import { errorResult, type ToolResult } from "./types.js";

// Re-export the wait-timeout default so callers already importing this
// module keep working; the canonical definition lives in
// src/shared/code-navigation-defaults.ts per the CLI/MCP parity rules.
export { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";

export const structuredCodeTargetSchema = z
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

export const codeTargetSchema = z.union([
  structuredCodeTargetSchema,
  z
    .string()
    .min(1)
    .describe(
      "Compact target string. Package: `npm:react@18.2.0`. Repository: `https://github.com/facebook/react#HEAD` (git ref suffix optional, defaults to HEAD).",
    ),
]);

export type StructuredCodeTargetArg = {
  registry?: CodeNavigationRegistryArg;
  package_name?: string;
  version?: string;
  repo_url?: string;
  git_ref?: string;
};

export type CodeTargetArg = StructuredCodeTargetArg | string;

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
  if (typeof target === "string") {
    try {
      return parseCodeNavigationTargetSpec(target);
    } catch (error) {
      return mappedInvalidTargetResult(error);
    }
  }

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
    if (!target.repo_url) {
      return invalidTargetResult(
        "Incomplete repository target: repo_url is required.",
      );
    }

    return {
      repoUrl: target.repo_url,
      gitRef: target.git_ref ?? "HEAD",
    };
  }

  return {
    repoUrl: target.repo_url,
    gitRef: target.git_ref,
  };
}

function mappedInvalidTargetResult(error: unknown): ToolResult {
  const mapped = mapCodeNavigationError(error);
  return errorResult(
    JSON.stringify({
      error: mapped.message,
      code: mapped.code,
      retryable: mapped.retryable ?? false,
      ...(mapped.details ? { details: mapped.details } : {}),
    }),
  );
}

function invalidTargetResult(message: string): ToolResult {
  return errorResult(
    JSON.stringify({
      error: message,
      code: "INVALID_ARGUMENT",
      retryable: false,
    }),
  );
}
