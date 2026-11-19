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
  it("keeps unclassified notes and distinct source and analysis gaps across detailed and compact views", async () => {
    const target = "hex:plug@1.20.4";
    const upstreamNote = "Publisher's release note";
    const coverage = [
      {
        version: "1.20.4",
        status: "NOT_ASSESSED" as const,
        statementsTotal: 2,
        statementsAssessed: 1,
        statementsNotAssessed: 1,
        statementsNoImpact: 1,
        statementsUnclassified: 0,
      },
      {
        version: "1.20.3",
        status: "WITHOUT_NOTES" as const,
        statementsTotal: 0,
        statementsAssessed: 0,
        statementsNotAssessed: 0,
        statementsNoImpact: 0,
        statementsUnclassified: 0,
        generation: { status: "PENDING" as const, reason: "generating" },
      },
    ];
    const args = {
      registry: "hex",
      package_name: "plug",
      current_version: "1.20.2",
      target_version: "1.20.4",
    };
    const spec = "hex:plug@1.20.2..1.20.4";
    const packageUpgradeReview = mock(
      async (params: PackageUpgradeReviewParams) => {
        const response = structuredClone(defaultPackageUpgradeReviewResponse);
        const review = response.reviews[0]!;
        Object.assign(review, params.packages[0]);
        Object.assign(review.changelog.riskCoverage, {
          versionsNotAssessed: 1,
          versionsWithoutNotes: 1,
          unitsNoImpact: 1,
        });
        if (params.changelogView === "triage") {
          delete review.changelog.statements;
          response.reviews.push({
            ...structuredClone(defaultPackageUpgradeReviewResponse.reviews[0]!),
            ...params.packages[1]!,
          });
        } else {
          const items = params.statementTiers
            ? []
            : [null, { tier: "NO_IMPACT" as const, ambiguous: false }].map(
                (classification, position) => ({
                  version: "1.20.4",
                  position,
                  sourceIndex: 0,
                  text: position === 0 ? upstreamNote : "Known no-impact note",
                  textTruncated: false,
                  source: "CHANGELOG_FILE",
                  url: "https://example.com/CHANGELOG.md",
                  classification,
                }),
              );
          review.changelog.statements = {
            items,
            coverage,
            totalCount: 2,
            matchingCount: items.length,
          };
        }
        return response;
      },
    );
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview,
    });
    const deps = cliDeps({ packageIntelligenceService: service });
    for (const changes of [undefined, "all", "actionable", "important"]) {
      const cli = await cliJson(spec, { changes }, deps);
      expect(cli).toEqual((await mcpJson({ ...args, changes }, service)).json);
      expect(cli).toHaveProperty(
        "reviews.0.changelog.analysis.0.kind",
        "classification_incomplete",
      );
      expect(cli).toHaveProperty(
        "reviews.0.changelog.analysis.0.retry.cli",
        `githits pkg changelog ${target}`,
      );
      expect(cli).toHaveProperty(
        "reviews.0.changelog.analysis.1.kind",
        "commit_analysis_incomplete",
      );
      expect(cli).toHaveProperty(
        "reviews.0.changelog.analysis.1.retry.mcp.arguments.target",
        "hex:plug@1.20.3",
      );
      expect(cli).toHaveProperty(
        "reviews.0.changelog.statements.coverage.1.status",
        "without_notes",
      );
      const matching = changes === "all" ? 2 : changes === undefined ? 1 : 0;
      expect(cli).toHaveProperty(
        "reviews.0.changelog.statements.matchingCount",
        matching,
      );
      if (matching > 0) {
        expect(cli).toHaveProperty(
          "reviews.0.changelog.statements.items.0.classification",
          null,
        );
        expect(cli).toHaveProperty(
          "reviews.0.changelog.statements.items.0.classificationStatus",
          "unclassified",
        );
      }
      const cliRendered = (await cliText(spec, { changes }, deps)).replace(
        /\s+/g,
        " ",
      );
      const mcpRendered = (
        await mcpText({ ...args, changes }, service)
      ).replace(/\s+/g, " ");
      for (const text of [cliRendered, mcpRendered]) {
        expect(text.includes(`[unclassified] ${upstreamNote}`)).toBe(
          matching > 0,
        );
        expect(text.includes("Known no-impact note")).toBe(changes === "all");
        expect(text).toContain(
          "1.20.3 Upstream release notes aren't available to this request and GitHits commit analysis is running. Please retry later with",
        );
        expect(text).not.toMatch(/release notes.*\bpending\b/i);
      }
      expect(cliRendered).toContain(
        `Please retry later with githits pkg changelog ${target}`,
      );
      expect(mcpRendered).toContain(
        `Please retry later with pkg_changelog {"target":"${target}"}`,
      );
    }
    const compactCli = await cliText(
      undefined,
      { package: [spec, "npm:express@4.18.0..5.0.0"] },
      deps,
    );
    const compactMcp = await mcpText(
      {
        packages: [
          args,
          {
            registry: "npm",
            package_name: "express",
            current_version: "4.18.0",
            target_version: "5.0.0",
          },
        ],
      },
      service,
    );
    for (const raw of [compactCli, compactMcp]) {
      const text = raw.replace(/\s+/g, " ");
      expect(text).toContain(
        "GitHits hasn't checked all the release notes yet.",
      );
      expect(text).not.toContain("commit-based changelog analysis");
      expect(text).toContain("1 without notes");
      expect(text).not.toContain(upstreamNote);
    }
    expect(compactCli.replace(/\s+/g, " ")).toContain(
      `githits pkg changelog ${target}`,
    );
    expect(compactMcp.replace(/\s+/g, " ")).toContain(
      'pkg_changelog {"target":"hex:plug@1.20.4"}',
    );
  });

  for (const migrationGuides of [
    [
      { url: "https://example.com/migrate", label: "Version 5 changes" },
      { url: "https://example.com/upgrade", label: "Migration guide" },
      { url: "https://example.com/next" },
    ],
    [],
    undefined,
  ]) {
    it(`preserves ${migrationGuides === undefined ? "absent" : migrationGuides.length ? "available" : "empty"} migration guides across CLI and MCP text/JSON`, async () => {
      const service = createMockPackageIntelligenceService({
        packageUpgradeReview: mock(async () => ({
          ...defaultPackageUpgradeReviewResponse,
          reviews: [
            {
              ...defaultPackageUpgradeReviewResponse.reviews[0]!,
              migrationGuides,
            },
          ],
        })),
      });
      const args = {
        registry: "npm",
        package_name: "express",
        current_version: "4.18.0",
        target_version: "5.0.0",
      };
      const cli = await cliText(
        "npm:express@4.18.0",
        { to: "5.0.0" },
        cliDeps({ packageIntelligenceService: service }),
      );
      const mcp = await mcpText(args, service);
      expect(cli.trimEnd()).toBe(mcp);
      expect(mcp.match(/Migration guide available at/g) ?? []).toHaveLength(
        migrationGuides?.length ?? 0,
      );
      if (migrationGuides?.length) {
        expect(mcp).toContain(
          "Migration guide available at https://example.com/migrate (Version 5 changes)",
        );
        expect(mcp).toContain(
          "Migration guide available at https://example.com/upgrade\n",
        );
        expect(mcp).toContain(
          "Migration guide available at https://example.com/next\n",
        );
        expect(mcp).not.toContain("(Migration guide)");
      }
      const cliPayload = await cliJson(
        "npm:express@4.18.0",
        { to: "5.0.0" },
        cliDeps({ packageIntelligenceService: service }),
      );
      const { json, isError } = await mcpJson(args, service);
      expect(isError).toBeUndefined();
      expect(cliPayload).toEqual(json);
      expect(
        (json as { reviews: Array<{ migrationGuides?: unknown }> }).reviews[0]
          ?.migrationGuides,
      ).toEqual(migrationGuides);
    });
  }

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

  it("PARITY-JSON-KEYS: Pub upgrade preserves versions and evidence CLI === MCP", async () => {
    const currentVersion = "1.2.3+build.7";
    const targetVersion = "1.2.4+build.8";
    const unknown = "synthetic Pub advisory evidence unavailable";
    const response = structuredClone(defaultPackageUpgradeReviewResponse);
    response.summary.withUnknowns = 1;
    response.summary.withDirectDependencyChanges = 1;
    const review = response.reviews[0]!;
    review.registry = "PUB";
    review.name = "Synthetic_Pub";
    review.currentVersion = currentVersion;
    review.targetVersion = targetVersion;
    review.latestVersion = targetVersion;
    review.versionDelta = "PATCH";
    review.security.current!.version = currentVersion;
    review.security.target!.version = targetVersion;
    review.changelog.entries![0]!.version = targetVersion;
    review.changelog.entries![0]!.htmlUrl =
      "https://example.com/releases/1-2-4";
    review.dependencyChanges!.direct.added = [
      {
        name: "collection",
        registry: "PUB",
        fromVersions: [],
        toVersions: ["1.18.0"],
        constraint: "^1.18.0",
        type: "RUNTIME",
      },
    ];
    review.unknowns = [unknown];

    const packageUpgradeReview = mock((_params: PackageUpgradeReviewParams) =>
      Promise.resolve(response),
    );
    const service = createMockPackageIntelligenceService({
      packageUpgradeReview,
    });
    const cli = await cliJson(
      `pub:Synthetic_Pub@${currentVersion}`,
      { to: targetVersion },
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      {
        registry: "pub",
        package_name: "Synthetic_Pub",
        current_version: currentVersion,
        target_version: targetVersion,
      },
      service,
    );

    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
    expect(packageUpgradeReview).toHaveBeenCalledTimes(2);
    expect(
      packageUpgradeReview.mock.calls.map(([params]) => params.packages),
    ).toEqual([
      [
        {
          registry: "PUB",
          name: "Synthetic_Pub",
          currentVersion,
          targetVersion,
        },
      ],
      [
        {
          registry: "PUB",
          name: "Synthetic_Pub",
          currentVersion,
          targetVersion,
        },
      ],
    ]);
    expect(cli).toMatchObject({
      summary: {
        total: 1,
        withUnknowns: 1,
        withDirectDependencyChanges: 1,
        withAddedAdvisories: 0,
        withTransitiveVulnerabilityAdditions: 0,
      },
      reviews: [
        {
          registry: "pub",
          name: "Synthetic_Pub",
          currentVersion,
          targetVersion,
          latestVersion: targetVersion,
          versionDelta: "patch",
          security: {
            current: {
              version: currentVersion,
              affectedCount: 0,
              nonAffectingCount: 0,
              allCount: 0,
              advisories: [],
            },
            target: {
              version: targetVersion,
              affectedCount: 0,
              nonAffectingCount: 0,
              allCount: 0,
              advisories: [],
            },
            added: [],
            removed: [],
            notAddressed: [],
            fixed: [],
            introduced: [],
            unchanged: [],
          },
          changelog: {
            entries: [
              {
                version: targetVersion,
                htmlUrl: "https://example.com/releases/1-2-4",
              },
            ],
          },
          unknowns: [unknown],
        },
      ],
    });
    const outputReview = (
      cli as {
        reviews: Array<{
          dependencyChanges: {
            direct: { added: Array<Record<string, unknown>> };
          };
        }>;
      }
    ).reviews[0]!;
    expect(outputReview.dependencyChanges.direct.added).toEqual([
      {
        name: "collection",
        registry: "pub",
        fromVersions: [],
        toVersions: ["1.18.0"],
        constraint: "^1.18.0",
        type: "runtime",
      },
    ]);
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
              unknownDetails: [
                {
                  section: "SECURITY",
                  code: "lookup_failed",
                  message: "vulnerability check failed: backend timeout",
                },
              ],
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
  it("preserves generated statement and coverage evidence across CLI and MCP", async () => {
    const { service, response } = evidenceService();
    const statements = response.reviews[0]!.changelog.statements!;
    const item = statements.items[1]!;
    Object.assign(item, {
      source: "GENERATED",
      url: undefined,
      heading: undefined,
      commits: [{ sha: "abcdef0123456789", url: null }],
    });
    item.classification!.ambiguous = false;
    delete item.classification!.tierConfidence;
    const generation = {
      status: "GENERATED" as const,
      reason: null,
    };
    statements.coverage[0]!.generation = generation;
    const cli = await cliJson(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcp = await mcpJson(args, service);
    expect(cli).toEqual(mcp.json);
    expect(cli).toHaveProperty(
      "reviews.0.changelog.statements.items.1.commits",
      [item.commits![0]!.sha],
    );
    expect(cli).toHaveProperty(
      "reviews.0.changelog.statements.coverage.0.generation",
      { status: "generated" },
    );
    const cliResult = await cliText(
      "npm:express@4.18.0..5.0.0",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const mcpResult = await mcpText(args, service);
    expect(cliResult.trimEnd()).toBe(mcpResult);
    expect(mcpResult.replace(/\s+/g, " ")).toContain(
      "(generated from commits)",
    );
    expect(mcpResult).not.toContain("Server notice");
  });
  it("keeps MCP upgrade text compact even with many generated citations", async () => {
    const { service, response } = evidenceService();
    const statements = response.reviews[0]!.changelog.statements!;
    for (const item of statements.items) item.textTruncated = false;
    Object.assign(statements.items[1]!, {
      source: "GENERATED",
      url: undefined,
      commits: Array.from({ length: 7 }, (_, i) => ({
        sha: `abcdef${i}123456789`,
        url: null,
      })),
    });
    statements.coverage[0]!.generation = {
      status: "GENERATED",
      reason: null,
    };
    const text = (await mcpText(args, service)).replace(/\s+/g, " ");
    expect(text).toContain("(generated from commits)");
    expect(text).not.toContain("Cited commits");
    expect(text).not.toContain("abcdef0");
    expect(text).not.toContain("Server notice");
    expect(text).not.toContain("--json");
  });
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
