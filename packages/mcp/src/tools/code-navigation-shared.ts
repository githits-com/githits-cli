import type { CodeNavigationTarget } from "@githits/core-internal";
import {
  PKGSEER_REGISTRY_ARGS,
  PKGSEER_REGISTRY_LIST,
} from "@githits/core-internal";
import { z } from "zod";
import {
  type CodeNavigationRegistryArg,
  toCodeNavigationRegistry,
} from "../shared/code-navigation.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { parseCodeNavigationTargetSpec } from "../shared/code-navigation-target.js";
import { mcpMappedErrorResult } from "./shared.js";
import { errorResult, type ToolResult } from "./types.js";

// Re-export the wait-timeout default so callers already importing this
// module keep working; the canonical definition lives in
// src/shared/code-navigation-defaults.ts per the CLI/MCP parity rules.
export { DEFAULT_WAIT_TIMEOUT_MS } from "../shared/code-navigation-defaults.js";

const structuredCodeTargetShape: z.ZodRawShape = {
  registry: z
    .enum(PKGSEER_REGISTRY_ARGS)
    .optional()
    .describe(
      `Package registry (${PKGSEER_REGISTRY_LIST}). Required for package scope.`,
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
      "Git ref - tag, branch, commit, or HEAD. Omit with repo_url to request the backend-resolved default branch.",
    ),
};

export const structuredCodeTargetObject: z.ZodObject<z.ZodRawShape> = z.object(
  structuredCodeTargetShape,
);

export const structuredCodeTargetSchema: z.ZodType<StructuredCodeTargetArg> =
  structuredCodeTargetObject.describe(
    "Target: provide registry + package_name (package scope) or repo_url with optional git_ref (repo scope; omitted ref means default branch intent).",
  ) as z.ZodType<StructuredCodeTargetArg>;

export const codeTargetSchema: z.ZodType<CodeTargetArg> = z.union([
  structuredCodeTargetSchema,
  z
    .string()
    .min(1)
    .describe(
      "Compact target string. Package with explicit registry: `npm:react@18.2.0` or `npm:react` for latest release. Repository: `github:facebook/react`, `github.com/facebook/react`, `https://github.com/facebook/react`, or any repo form with `#HEAD` / `@HEAD` for a git ref. Output uses canonical `github:owner/repo#ref` form.",
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

  const registry = normaliseOptionalValue(target.registry)?.toLowerCase();
  const packageName = normaliseOptionalValue(target.package_name);
  const version = normaliseOptionalValue(target.version);
  const repoUrl = normaliseOptionalValue(target.repo_url);
  const gitRef = normaliseOptionalValue(target.git_ref);
  const hasPackageTarget = registry !== undefined || packageName !== undefined;
  const hasRepoTarget = repoUrl !== undefined || gitRef !== undefined;

  if (hasPackageTarget && hasRepoTarget) {
    return invalidTargetResult(
      "Invalid target: provide either registry + package_name or repo_url with optional git_ref, not both.",
    );
  }

  if (!hasPackageTarget && !hasRepoTarget) {
    return invalidTargetResult(
      "Missing target: provide registry + package_name or repo_url.",
    );
  }

  if (hasPackageTarget) {
    if (!registry || !packageName) {
      return invalidTargetResult(
        "Incomplete package target: both registry and package_name are required.",
      );
    }

    return {
      registry: toCodeNavigationRegistry(registry as CodeNavigationRegistryArg),
      packageName,
      version,
    };
  }

  if (!repoUrl) {
    return invalidTargetResult(
      "Incomplete repository target: repo_url is required.",
    );
  }

  return {
    repoUrl,
    gitRef,
  };
}

function normaliseOptionalValue(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function mappedInvalidTargetResult(error: unknown): ToolResult {
  const mapped = mapCodeNavigationError(error);
  return mcpMappedErrorResult(mapped);
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
