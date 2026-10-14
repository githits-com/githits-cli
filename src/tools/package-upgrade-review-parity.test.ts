// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable,
//                          details? } on every error path; MCP error text is
//                          always valid JSON.

import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  PackageIntelligenceService,
  PackageUpgradeReviewParams,
} from "@githits/core-internal";
import {
  type PkgUpgradeReviewCommandDependencies,
  pkgUpgradeReviewAction,
} from "../commands/pkg/upgrade-review.js";
import {
  createMockPackageIntelligenceService,
  defaultPackageUpgradeReviewResponse,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

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
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const originalStdoutWrite = process.stdout.write;
  let stdout = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    try {
      await pkgUpgradeReviewAction(spec, { ...options, json: true }, deps);
    } catch (error) {
      if (!isProcessExitSentinel(error)) throw error;
    }
    const fromErr = errSpy.mock.calls[0]?.[0] as string | undefined;
    const raw = stdout.trim() || fromErr;
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    process.stdout.write = originalStdoutWrite;
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

async function cliText(
  spec: string | undefined,
  options: Parameters<typeof pkgUpgradeReviewAction>[1] = {},
  deps: PkgUpgradeReviewCommandDependencies = cliDeps(),
): Promise<string> {
  const originalStdoutWrite = process.stdout.write;
  const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    "columns",
  );
  const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(
    process.stdout,
    "isTTY",
  );
  const noColorDescriptor = Object.getOwnPropertyDescriptor(
    process.env,
    "NO_COLOR",
  );
  let stdout = "";
  try {
    Object.defineProperty(process.stdout, "columns", {
      value: 80,
      configurable: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      value: false,
      configurable: true,
    });
    process.env.NO_COLOR = "1";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      stdout += chunk.toString();
      return true;
    }) as typeof process.stdout.write;
    await pkgUpgradeReviewAction(spec, { ...options, json: false }, deps);
    return stdout;
  } finally {
    process.stdout.write = originalStdoutWrite;
    restoreProperty(process.stdout, "columns", stdoutColumnsDescriptor);
    restoreProperty(process.stdout, "isTTY", stdoutIsTTYDescriptor);
    restoreProperty(process.env, "NO_COLOR", noColorDescriptor);
  }
}

function restoreProperty(
  target: object,
  property: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, property, descriptor);
  } else {
    Reflect.deleteProperty(target, property);
  }
}

interface McpUpgradeReviewArgs {
  changes?: string;
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
  verbose?: boolean;
}

async function mcpJson(
  args: McpUpgradeReviewArgs,
  service: PackageIntelligenceService = createMockPackageIntelligenceService(),
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const tool = createParityMcpTool("pkg_upgrade_review", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

async function mcpText(
  args: McpUpgradeReviewArgs,
  service: PackageIntelligenceService = createMockPackageIntelligenceService(),
): Promise<string> {
  const tool = createParityMcpTool("pkg_upgrade_review", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "text" }, {});
  return result.content[0]?.text ?? "";
}

describe("package_upgrade_review parity", () => {
  it("PARITY-TEXT-FORMATTER: CLI and MCP use the same no-color formatter", async () => {
    const stdoutColumnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    const stdoutIsTTYDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );
    const noColorDescriptor = Object.getOwnPropertyDescriptor(
      process.env,
      "NO_COLOR",
    );
    try {
      Object.defineProperty(process.stdout, "columns", {
        value: 132,
        configurable: true,
      });
      Object.defineProperty(process.stdout, "isTTY", {
        value: true,
        configurable: true,
      });
      delete process.env.NO_COLOR;

      const cli = await cliText("npm:express@4.18.0", { to: "5.0.0" });
      expect(process.stdout.columns).toBe(132);
      expect(process.stdout.isTTY).toBe(true);
      expect(process.env.NO_COLOR).toBeUndefined();
      const mcp = await mcpText({
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
      });

      expect(cli.endsWith("\n")).toBe(true);
      expect(cli.trimEnd()).toBe(mcp);
      expect(mcp).toStartWith("Upgrade review - 1 package");
      expect(mcp).not.toContain("\x1b[");
    } finally {
      restoreProperty(process.stdout, "columns", stdoutColumnsDescriptor);
      restoreProperty(process.stdout, "isTTY", stdoutIsTTYDescriptor);
      restoreProperty(process.env, "NO_COLOR", noColorDescriptor);
    }
  });

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

  it("PARITY-JSON-KEYS: backend unknown evidence CLI === MCP", async () => {
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: mock(() =>
        Promise.resolve({
          summary: {
            total: 2,
            withUnknowns: 1,
            withAddedAdvisories: 0,
            withBreakingSignals: 0,
            withDirectDependencyChanges: 0,
            withTransitiveVulnerabilityAdditions: 0,
          },
          reviews: [
            defaultPackageUpgradeReviewResponse.reviews[0]!,
            {
              ...defaultPackageUpgradeReviewResponse.reviews[0]!,
              name: "zod",
              currentVersion: "4.3.6",
              targetVersion: "4.4.3",
              unknowns: ["vulnerability check failed: backend timeout"],
            },
          ],
        }),
      ) as never,
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

describe("complete statement CLI/MCP parity", () => {
  const args = {
    registry: "npm",
    package_name: "express",
    current_version: "4.18.0",
    target_version: "5.0.0",
  };
  function evidenceService() {
    const response = structuredClone(defaultPackageUpgradeReviewResponse);
    response.reviews[0]!.changelog.statements = {
      totalCount: 2,
      matchingCount: 2,
      coverage: [
        {
          version: "5.0.0",
          status: "CLASSIFIED",
          statementsTotal: 2,
          statementsAssessed: 2,
          statementsNotAssessed: 0,
          statementsNoImpact: 0,
          statementsUnclassified: 0,
        },
      ],
      items: [
        {
          version: "5.0.0",
          position: 0,
          sourceIndex: 0,
          sourcePosition: 7,
          source: "CHANGELOG_FILE",
          url: "https://example.com/History.md#section",
          text: "* Changed behavior",
          textTruncated: true,
          fullText: "Uncut statement\u001b[31m",
          context: {
            text: "Parent context",
            textTruncated: false,
            fullText: "Full parent context",
          },
          classification: {
            tier: "MUST_ACT",
            ambiguous: false,
            tierConfidence: 0.01,
            kind: "CHANGES_BEHAVIOR_OR_DEFAULT",
            kindConfidence: 0.5,
            model: "jev",
            formulation: "v2",
          },
        },
        {
          version: "5.0.0",
          position: 1,
          sourceIndex: 1,
          sourcePosition: 3,
          source: "RELEASES",
          url: "https://example.com/release",
          text: "* Possible deprecation",
          textTruncated: false,
          fullText: "* Possible deprecation",
          classification: {
            tier: "SHOULD_KNOW",
            ambiguous: true,
            tierConfidence: 0.99,
            kind: "DEPRECATES_WITHOUT_REMOVAL",
            kindConfidence: 0.7,
            model: "other",
            formulation: "v3",
          },
        },
      ],
    };
    response.reviews[0]!.changelog.riskCoverage.itemsMustActConfident = 1;
    response.reviews[0]!.changelog.riskCoverage.itemsShouldKnowAmbiguous = 1;
    const packageUpgradeReview = mock(
      async (params: PackageUpgradeReviewParams) => {
        const result = structuredClone(response);
        result.reviews = params.packages.map((pkg) => ({
          ...structuredClone(result.reviews[0]!),
          ...pkg,
        }));
        result.summary.total = result.reviews.length;
        if (params.changelogView === "triage") {
          delete result.reviews[0]!.changelog.statements;
          delete result.reviews[0]!.changelog.entries;
          delete result.reviews[0]!.changelog.sampledEntries;
          delete result.reviews[0]!.changelog.keywordEntries;
        } else if (params.changelogView !== "json")
          for (const item of result.reviews[0]!.changelog.statements!.items) {
            delete item.fullText;
            delete item.sourcePosition;
            if (item.context) delete item.context.fullText;
            if (item.classification) {
              delete item.classification.tierConfidence;
              delete item.classification.kindConfidence;
              delete item.classification.model;
              delete item.classification.formulation;
            }
          }
        return result;
      },
    );
    return {
      service: createMockPackageIntelligenceService({ packageUpgradeReview }),
      packageUpgradeReview,
      response,
    };
  }
  for (const changes of [undefined, " ", "actionable", "important", "all"])
    it(`matches text, JSON and effective filter for ${changes ?? "default"}`, async () => {
      const { service, packageUpgradeReview, response } = evidenceService();
      for (const verbose of [false, true]) {
        const cli = await cliText(
          "npm:express@4.18.0..5.0.0",
          { changes, verbose },
          cliDeps({ packageIntelligenceService: service }),
        );
        const mcp = await mcpText({ ...args, changes, verbose }, service);
        expect(cli.trimEnd()).toBe(mcp);
        expect(mcp).toContain("* [!behavior] Changed behavior");
        expect(mcp).toContain("* [deprecation] (uncertain)");
        expect(mcp).toContain("https://example.com/History.md#section");
        expect(mcp).not.toContain("Uncut statement");
        expect(packageUpgradeReview.mock.calls.at(-1)?.[0].changelogView).toBe(
          "text",
        );
      }
      const cli = await cliJson(
        "npm:express@4.18.0..5.0.0",
        { changes },
        cliDeps({ packageIntelligenceService: service }),
      );
      const mcp = await mcpJson({ ...args, changes }, service);
      expect(cli).toEqual(mcp.json);
      const payload = cli as {
        filter?: { changes: string };
        reviews: {
          changelog: {
            statements: {
              selection: string;
              items: {
                classification: {
                  tier: string;
                  ambiguous: boolean;
                  formulation: string;
                };
              }[];
            };
          };
        }[];
      };
      expect(payload.reviews[0]!.changelog.statements.selection).toBe(
        changes?.trim() || "focused",
      );
      expect(payload.filter?.changes).toBe(changes?.trim() || undefined);
      expect(packageUpgradeReview.mock.calls.at(-1)?.[0].changelogView).toBe(
        "json",
      );
      expect(JSON.stringify(payload)).toContain("Uncut statement\\u001b[31m");
      expect(JSON.stringify(payload)).not.toContain('"riskItems"');
      expect(
        response.reviews[0]!.changelog.statements!.items[0]!.classification
          ?.tier,
      ).toBe("MUST_ACT");
    });
  it("matches compact batch triage without selecting statement arrays", async () => {
    const { service, packageUpgradeReview } = evidenceService();
    const packages = [
      {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
      },
      {
        registry: "npm",
        package_name: "lodash",
        current_version: "4.0.0",
        target_version: "5.0.0",
      },
    ];
    const cli = await cliText(
      undefined,
      {
        package: ["npm:express@4.18.0..5.0.0", "npm:lodash@4.0.0..5.0.0"],
        changes: "important",
      },
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcp = await mcpText({ packages, changes: "important" }, service);
    expect(cli.trimEnd()).toBe(mcp);
    expect(packageUpgradeReview.mock.calls.at(-1)?.[0].changelogView).toBe(
      "triage",
    );
  });
  it("matches invalid changes error envelopes", async () => {
    const cli = await cliJson("npm:express@4.18.0..5.0.0", {
      changes: "invalid",
    });
    const mcp = await mcpJson({ ...args, changes: "invalid" });
    expect(cli).toEqual(mcp.json);
    expect(mcp.isError).toBe(true);
  });
});
