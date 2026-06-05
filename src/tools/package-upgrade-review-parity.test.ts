// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable,
//                          details? } on every error path; MCP error text is
//                          always valid JSON.

import { describe, expect, it, mock, spyOn } from "bun:test";
import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  type PkgUpgradeReviewCommandDependencies,
  pkgUpgradeReviewAction,
} from "../commands/pkg/upgrade-review.js";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createPackageUpgradeReviewTool } from "./package-upgrade-review.js";
import { isProcessExitSentinel } from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<PkgUpgradeReviewCommandDependencies> = {},
): PkgUpgradeReviewCommandDependencies {
  return {
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  spec: string | undefined,
  options: Parameters<typeof pkgUpgradeReviewAction>[1] = {},
  deps: PkgUpgradeReviewCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgUpgradeReviewAction(spec, { ...options, json: true }, deps);
    } catch (error) {
      if (!isProcessExitSentinel(error)) throw error;
    }
    const fromLog = logSpy.mock.calls[0]?.[0] as string | undefined;
    const fromErr = errSpy.mock.calls[0]?.[0] as string | undefined;
    const raw = fromLog ?? fromErr;
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

interface McpUpgradeReviewArgs {
  registry?: string;
  package_name?: string;
  current_version?: string;
  target_version?: string;
  packages?: Array<{
    registry: string;
    package_name: string;
    current_version: string;
    target_version: string;
  }>;
  skip_transitive_security?: boolean;
  include_dependency_issues?: boolean;
  min_severity?: string;
}

async function mcpJson(
  args: McpUpgradeReviewArgs,
  service: PackageIntelligenceService = createMockPackageIntelligenceService(),
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const tool = createPackageUpgradeReviewTool(service);
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

describe("package_upgrade_review parity", () => {
  it("PARITY-JSON-KEYS: single-package CLI === MCP", async () => {
    const cli = await cliJson("npm:express@4.18.0", { to: "5.0.0" });
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
      current_version: "4.18.0",
      target_version: "5.0.0",
    });

    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: batch CLI === MCP", async () => {
    const cli = await cliJson(undefined, {
      package: ["npm:express@4.18.0..5.0.0", "npm:zod@4.3.6..4.4.3"],
      transitiveSecurity: false,
    });
    const { json } = await mcpJson({
      packages: [
        {
          registry: "npm",
          package_name: "express",
          current_version: "4.18.0",
          target_version: "5.0.0",
        },
        {
          registry: "npm",
          package_name: "zod",
          current_version: "4.3.6",
          target_version: "4.4.3",
        },
      ],
      skip_transitive_security: true,
    });

    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: batch per-package unknown CLI === MCP", async () => {
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock((params) => {
        if (params.packageName === "zod") {
          return Promise.reject(new Error("vulnerability lookup failed"));
        }
        return createMockPackageIntelligenceService().packageVulnerabilities(
          params,
        );
      }) as never,
    });
    const cli = await cliJson(
      undefined,
      {
        package: ["npm:express@4.18.0..5.0.0", "npm:zod@4.3.6..4.4.3"],
        transitiveSecurity: false,
      },
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json } = await mcpJson(
      {
        packages: [
          {
            registry: "npm",
            package_name: "express",
            current_version: "4.18.0",
            target_version: "5.0.0",
          },
          {
            registry: "npm",
            package_name: "zod",
            current_version: "4.3.6",
            target_version: "4.4.3",
          },
        ],
        skip_transitive_security: true,
      },
      service,
    );

    expect(cli).toEqual(json);
    const reviews = (cli as { reviews: Array<{ unknowns: string[] }> }).reviews;
    expect(reviews).toHaveLength(2);
    expect(reviews[1]?.unknowns.join("\n")).toContain(
      "vulnerability check failed",
    );
  });

  it("PARITY-ERROR-ENVELOPE: invalid target version shape matches", async () => {
    const cli = await cliJson("npm:express@4.18.0", { to: "v5.0.0" });
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
      current_version: "4.18.0",
      target_version: "v5.0.0",
    });

    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });
});
