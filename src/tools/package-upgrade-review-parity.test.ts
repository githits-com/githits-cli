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

describe("statement classification CLI/MCP parity", () => {
  it("preserves exact statement URLs and uncut text in JSON with mode-specific selection", async () => {
    const response = structuredClone(defaultPackageUpgradeReviewResponse);
    const fullText = `Evidence ${"quoted context ".repeat(100)}END\u001b[31m`;
    const url = "https://example.com/History.md#L100-L120";
    response.reviews[0]!.changelog.entries = [];
    response.reviews[0]!.changelog.sampledEntries = [];
    response.reviews[0]!.changelog.riskItems = [
      {
        version: "5.0.0",
        tier: "MUST_ACT",
        ambiguous: false,
        tierConfidence: 0,
        text: fullText.slice(0, 1000),
        textTruncated: true,
        fullText,
        url,
        source: "CHANGELOG_FILE",
        model: "jev-1.13.0",
        formulation: "s-hier-v3",
      },
      {
        version: "5.0.0",
        tier: "SHOULD_KNOW",
        ambiguous: true,
        text: "No source URL.",
        textTruncated: false,
        fullText: "No source URL.",
        model: "jev-1.13.0",
        formulation: "s-hier-v2",
      },
    ];
    const packageUpgradeReview = mock(
      async (params: PackageUpgradeReviewParams) => {
        const result = structuredClone(response);
        if (params.includeChangelogFullText !== true) {
          for (const item of result.reviews[0]!.changelog.riskItems)
            delete item.fullText;
        }
        return result;
      },
    );
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview,
    });
    const args = {
      registry: "npm",
      package_name: "express",
      current_version: "4.18.0",
      target_version: "5.0.0",
    };
    for (const verbose of [false, true]) {
      const cli = await cliText(
        "npm:express@4.18.0..5.0.0",
        { verbose },
        cliDeps({ packageIntelligenceService: service }),
      );
      expect(
        packageUpgradeReview.mock.calls.at(-1)?.[0].includeChangelogFullText,
      ).toBe(false);
      const mcp = await mcpText({ ...args, verbose }, service);
      expect(
        packageUpgradeReview.mock.calls.at(-1)?.[0].includeChangelogFullText,
      ).toBe(false);
      expect(cli.trimEnd()).toBe(mcp);
    }
    const cli = await cliJson(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    expect(
      packageUpgradeReview.mock.calls.at(-1)?.[0].includeChangelogFullText,
    ).toBe(true);
    const mcp = await mcpJson(args, service);
    expect(
      packageUpgradeReview.mock.calls.at(-1)?.[0].includeChangelogFullText,
    ).toBe(true);
    expect(cli).toEqual(mcp.json);
    expect(mcp.json).toMatchObject({
      reviews: [
        {
          changelog: {
            riskItems: [
              {
                text: fullText.slice(0, 1000),
                textTruncated: true,
                fullText,
                url,
                tierConfidence: 0,
                ambiguous: false,
              },
              {
                fullText: "No source URL.",
                ambiguous: true,
                formulation: "s-hier-v2",
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(mcp.json)).not.toContain('"url":null');
    expect(response.reviews[0]!.changelog.riskItems[0]!.fullText).toBe(
      fullText,
    );
  });

  it("keeps uncertain tiers, oversize confidence and mixed per-item provenance faithful", async () => {
    const response = structuredClone(defaultPackageUpgradeReviewResponse);
    const item = {
      version: "5.0.0",
      tier: "MUST_ACT" as const,
      ambiguous: true,
      tierConfidence: 0.95,
      kind: undefined,
      kindConfidence: undefined,
      text: "Removed internal dependency.",
      textTruncated: false,
      heading: undefined,
      source: "RELEASES" as const,
      model: "jev-1.13.0",
      formulation: "s-hier-v2",
    };
    response.reviews[0]!.changelog.riskItems = [
      item,
      {
        ...item,
        tier: "SHOULD_KNOW",
        ambiguous: false,
        tierConfidence: 0.1,
        kind: "SECURITY_FIX",
        kindConfidence: 0.2,
        text: "Fixed an advisory.",
        formulation: "s-hier-v3",
      },
      {
        ...item,
        tier: "UNCLASSIFIED",
        ambiguous: false,
        tierConfidence: undefined,
        text: "Oversize release-note statement.",
        textTruncated: true,
        model: "jev-other",
        formulation: "older-formulation",
      },
    ];
    response.reviews[0]!.changelog.riskItems.push({
      ...item,
      tier: "SHOULD_KNOW",
      ambiguous: true,
      tierConfidence: 0.9,
      text: "Possibly deprecated usage.",
    });
    response.reviews[0]!.changelog.riskCoverage = {
      ...response.reviews[0]!.changelog.riskCoverage,
      itemsMustActConfident: 0,
      itemsMustActAmbiguous: 1,
      itemsShouldKnowConfident: 1,
      itemsShouldKnowAmbiguous: 1,
      itemsUnclassified: 1,
    };
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: mock(async () => response),
    });
    const args = {
      registry: "npm",
      package_name: "express",
      current_version: "4.18.0",
      target_version: "5.0.0",
    };
    const cli = await cliText(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcp = await mcpText(args, service);
    expect(cli.trimEnd()).toBe(mcp);
    expect(mcp).toContain("Possibly requires action (1)");
    expect(mcp).toContain('(uncertain) "Removed internal dependency."');
    expect(mcp).toContain("Too long to classify - read it (1)");
    expect(mcp).not.toContain('(uncertain) "Oversize release-note statement."');
    expect(mcp).toContain('(uncertain) "Possibly deprecated usage."');
    expect(mcp).not.toContain("escalated");
    expect(mcp.replace(/\s+/g, " ")).toContain(
      "0 require action (+1 uncertain) | 1 should know (+1 uncertain) | 1 too long to classify",
    );
    expect(mcp).toContain('[security fix] "Fixed an advisory."');
    const cliEnvelope = await cliJson(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcpEnvelope = await mcpJson(args, service);
    expect(cliEnvelope).toEqual(mcpEnvelope.json);
    expect(mcpEnvelope.json).toMatchObject({
      reviews: [
        {
          changelog: {
            riskItems: [
              {
                tier: "must_act",
                ambiguous: true,
                tierConfidence: 0.95,
                model: "jev-1.13.0",
                formulation: "s-hier-v2",
              },
              {
                tier: "should_know",
                ambiguous: false,
                tierConfidence: 0.1,
                kindConfidence: 0.2,
                formulation: "s-hier-v3",
              },
              {
                tier: "unclassified",
                textTruncated: true,
                model: "jev-other",
                formulation: "older-formulation",
              },
              {
                tier: "should_know",
                ambiguous: true,
                tierConfidence: 0.9,
              },
            ],
          },
        },
      ],
    });
    expect(JSON.stringify(mcpEnvelope.json)).not.toContain(
      '"tierConfidence":null',
    );
    expect(mcp).not.toContain("s-hier-v");
    expect(response.reviews[0]!.changelog.riskItems[0]!.tier).toBe("MUST_ACT");
  });

  it("preserves classifications, coverage, raw quotes and provenance in single and batch JSON and text", async () => {
    const response = structuredClone(defaultPackageUpgradeReviewResponse);
    const review = response.reviews[0]!;
    review.changelog.riskItems = [
      {
        version: "5.0.0",
        tier: "MUST_ACT",
        ambiguous: false,
        tierConfidence: 0.9,
        kind: "CHANGES_BEHAVIOR_OR_DEFAULT",
        kindConfidence: 0.8,
        text: "Request ignores false, 0 and empty string as body values. 漢字",
        textTruncated: true,
        heading: "Changes",
        source: "RELEASES",
        model: "jev-1.13.0",
        formulation: "d-hier-v1",
      },
    ];
    review.changelog.riskCoverage = {
      versionsClassified: 1,
      versionsNotAssessed: 2,
      versionsWithoutNotes: 3,
      versionsUnparseable: 4,
      unitsNoImpact: 5,
      itemsMustActConfident: 7,
      itemsMustActAmbiguous: 0,
      itemsShouldKnowConfident: 0,
      itemsShouldKnowAmbiguous: 0,
      itemsUnclassified: 0,
      itemsOmitted: 6,
    };
    review.changelog.breakingSignals = ["removed"];
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview: mock(async () => response),
    });
    const args = {
      registry: "npm",
      package_name: "express",
      current_version: "4.18.0",
      target_version: "5.0.0",
    };
    const cli = await cliJson(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcp = await mcpJson(args, service);
    expect(cli).toEqual(mcp.json);
    expect(mcp.json).toMatchObject({
      reviews: [
        {
          changelog: {
            riskItems: [
              {
                tier: "must_act",
                kind: "changes_behavior_or_default",
                source: "releases",
                text: review.changelog.riskItems[0]!.text,
                textTruncated: true,
                model: "jev-1.13.0",
                formulation: "d-hier-v1",
              },
            ],
            riskCoverage: review.changelog.riskCoverage,
            breakingSignals: ["removed"],
          },
        },
      ],
    });
    const cliDefault = await cliText(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    expect(cliDefault.trimEnd()).toBe(await mcpText(args, service));
    expect(cliDefault).toContain("Requires action (1)");
    expect(cliDefault).toContain("[statement truncated by backend]");
    const other = structuredClone(review);
    other.name = "other";
    other.changelog.riskItems = [];
    other.changelog.riskCoverage = {
      ...other.changelog.riskCoverage,
      itemsMustActConfident: 0,
      itemsMustActAmbiguous: 0,
      itemsShouldKnowConfident: 0,
      itemsShouldKnowAmbiguous: 0,
      itemsUnclassified: 0,
      itemsOmitted: 0,
    };
    response.reviews.unshift(other);
    response.summary.total = 2;
    const packages = [{ ...args, package_name: "other" }, args];
    const specs = ["npm:other@4.18.0..5.0.0", "npm:express@4.18.0..5.0.0"];
    const batchCli = await cliJson(
      undefined,
      { package: specs },
      cliDeps({ packageIntelligenceService: service }),
    );
    expect(batchCli).toEqual((await mcpJson({ packages }, service)).json);
    for (const verbose of [false, true]) {
      const text = await cliText(
        undefined,
        { package: specs, verbose },
        cliDeps({ packageIntelligenceService: service }),
      );
      expect(text.trimEnd()).toBe(
        await mcpText({ packages, verbose }, service),
      );
      expect(text.indexOf("npm:express")).toBeLessThan(
        text.indexOf("npm:other"),
      );
      expect(text.includes("Requires action (1)")).toBe(verbose);
    }
  });
});
