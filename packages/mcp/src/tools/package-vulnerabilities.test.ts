import { describe, expect, it, mock } from "bun:test";
import type { VulnerabilityReport } from "@githits/core-internal";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import {
  createMockPackageIntelligenceService,
  defaultVulnerabilityReport,
} from "../services/test-helpers.js";
import { createPackageVulnerabilitiesTool } from "./package-vulnerabilities.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

function transitiveVulnerabilityReport(): VulnerabilityReport {
  const report = structuredClone(defaultVulnerabilityReport);
  report.transitive = {
    totalPackagesAnalyzed: 2,
    affectedPackageCount: 1,
    affectedOccurrenceCount: 1,
    packages: [
      {
        registry: "NPM",
        name: "body-parser",
        affectedOccurrenceCount: 1,
        occurrences: [
          {
            version: "1.19.0",
            affectsResolvedVersion: true,
            matchedAffectedVersionRanges: ["< 2.0.0"],
            fixVersionsAboveResolved: ["2.0.0"],
            nearestFixedVersion: "2.0.0",
            advisory: {
              osvId: "GHSA-body-parser",
              aliases: ["CVE-body-parser"],
              summary: "Body parser issue",
              severityScore: 8.0,
            },
          },
        ],
      },
    ],
  };
  return report;
}

describe("createPackageVulnerabilitiesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_vulns");
    expect(tool.description).toContain("NuGet, Maven, Packagist");
    expect(tool.description).toContain("Swift");
    expect(tool.description).toContain("vcpkg and Zig");
    expect(tool.description).toContain(
      "Check current package advisories. Do not trust your memory for vulnerabilities.",
    );
    expect(tool.description).toContain(
      "Advisories can be published or revised after training; a cutoff disclaimer is not current evidence.",
    );
    expect(tool.description).toContain(
      '`{"registry":"npm","package_name":"next","advisory_scope":"all"}`',
    );
    expect(tool.description).toContain(
      "identifiers and aliases, including CVEs when available",
    );
    expect(tool.description).toContain("identifier aliases (including CVEs)");
    expect(tool.description).toContain(
      "npm-audit-style evidence covering vulnerabilities in versions resolved by the dependency graph",
    );
    expect(tool.description).toContain(
      "distinct from package-wide advisory history",
    );
    expect(tool.description).toContain(
      "`advisory_scope` and `include_withdrawn` affect direct rows only",
    );
    expect(Object.keys(tool.schema).sort()).toEqual([
      "advisory_scope",
      "format",
      "include_transitive",
      "include_withdrawn",
      "min_severity",
      "package_name",
      "registry",
      "verbose",
      "version",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("keeps the discovery sentence and first 80 characters stable", () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const firstSentence = tool.description.match(/^[^.]+\./)?.[0] ?? "";
    expect(firstSentence).toBe("Check current package advisories.");
    expect(firstSentence.length).toBeLessThanOrEqual(79);
    expect(tool.description.slice(0, 80)).toBe(
      "Check current package advisories. Do not trust your memory for vulnerabilities. ",
    );
  });
});

describe("createPackageVulnerabilitiesTool — happy path", () => {
  it("calls service.packageVulnerabilities with normalised params", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const tool = createPackageVulnerabilitiesTool(service);

    await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        version: "4.18.0",
        min_severity: "high",
        advisory_scope: "all",
        include_withdrawn: true,
      },
      {},
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [
        {
          registry: string;
          packageName: string;
          version?: string;
          minSeverity?: number;
          includeWithdrawn?: boolean;
          advisoryScope?: string;
        },
      ]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.version).toBe("4.18.0");
    expect(calls[0]?.[0]?.minSeverity).toBe(7.0);
    expect(calls[0]?.[0]?.includeWithdrawn).toBe(true);
    expect(calls[0]?.[0]?.advisoryScope).toBe("ALL");
  });

  it("returns compact text on success by default", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("express @ 4.18.0 | npm");
    expect(text).toContain("vulnerabilities affect this version");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("returns complete text when verbose=true", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", verbose: true },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("GHSA-nnnn-nnnn-nnnn");
    expect(text).not.toContain("use -v");
    expect(text).not.toContain("... (+1 more");
  });

  it.each([undefined, false, true] as const)(
    "passes include_transitive=%s to the service without changing the direct request",
    async (includeTransitive) => {
      const packageVulnerabilities = mock(() =>
        Promise.resolve(defaultVulnerabilityReport),
      );
      const tool = createPackageVulnerabilitiesTool(
        createMockPackageIntelligenceService({ packageVulnerabilities }),
      );
      await tool.handler(
        {
          registry: "npm",
          package_name: "express",
          min_severity: "high",
          advisory_scope: "all",
          include_withdrawn: true,
          ...(includeTransitive === undefined
            ? {}
            : { include_transitive: includeTransitive }),
        },
        {},
      );
      const params = (
        packageVulnerabilities.mock.calls as unknown as Array<
          [
            {
              registry: string;
              packageName: string;
              minSeverity?: number;
              advisoryScope?: string;
              includeWithdrawn?: boolean;
              includeTransitive?: boolean;
            },
          ]
        >
      )[0]?.[0] as {
        registry: string;
        packageName: string;
        minSeverity?: number;
        advisoryScope?: string;
        includeWithdrawn?: boolean;
        includeTransitive?: boolean;
      };
      expect(params).toMatchObject({
        registry: "NPM",
        packageName: "express",
        minSeverity: 7.0,
        advisoryScope: "ALL",
        includeWithdrawn: true,
      });
      expect(params.includeTransitive).toBe(includeTransitive);
    },
  );

  it("renders and returns the complete transitive audit when requested", async () => {
    const report = transitiveVulnerabilityReport();
    const packageVulnerabilities = mock(() => Promise.resolve(report));
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService({ packageVulnerabilities }),
    );
    const textResult = await tool.handler(
      { registry: "npm", package_name: "express", include_transitive: true },
      {},
    );
    expect(textResult.content[0]?.text).toContain("Resolved dependencies");
    expect(textResult.content[0]?.text).toContain("body-parser@1.19.0");
    const verboseResult = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_transitive: true,
        verbose: true,
      },
      {},
    );
    expect(verboseResult.content[0]?.text).toContain("higher fixes 2.0.0");

    const jsonResult = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_transitive: true,
        format: "json",
      },
      {},
    );
    const payload = parseText(jsonResult) as {
      transitive?: { packages: Array<{ name: string }> };
    };
    expect(payload.transitive?.packages[0]?.name).toBe("body-parser");
    expect(
      (
        packageVulnerabilities.mock.calls as unknown as Array<
          [Record<string, unknown>]
        >
      )[0]?.[0],
    ).toMatchObject({
      includeTransitive: true,
    });
  });

  it("uses MCP-native cap hint in default text", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("... (+1 more; use verbose=true or format=json)");
    expect(text).not.toContain("use -v");
  });

  it("returns JSON-stringified lean envelope when format=json", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.version).toBe("4.18.0");
    expect((payload.summary as { total: number }).total).toBe(6);
  });

  it("echoes explicit filters in JSON", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        min_severity: "HIGH",
        advisory_scope: "non_affecting",
        include_withdrawn: true,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { filter?: unknown };
    expect(payload.filter).toEqual({
      minSeverity: "high",
      advisoryScope: "non_affecting",
      includeWithdrawn: true,
    });
  });

  it("keeps direct filters direct-only while transitive mode remains opted in", async () => {
    const report = transitiveVulnerabilityReport();
    report.transitive = {
      totalPackagesAnalyzed: 0,
      affectedPackageCount: 0,
      affectedOccurrenceCount: 0,
      packages: [],
    };
    const packageVulnerabilities = mock(() => Promise.resolve(report));
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService({ packageVulnerabilities }),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        min_severity: "high",
        advisory_scope: "all",
        include_withdrawn: true,
        include_transitive: true,
        format: "json",
      },
      {},
    );
    expect(parseText(result)).toMatchObject({
      filter: {
        minSeverity: "high",
        advisoryScope: "all",
        includeWithdrawn: true,
      },
      transitive: {
        withdrawnAdvisoriesIncluded: false,
      },
    });
    expect(
      (
        packageVulnerabilities.mock.calls as unknown as Array<
          [Record<string, unknown>]
        >
      )[0]?.[0],
    ).toMatchObject({
      minSeverity: 7.0,
      advisoryScope: "ALL",
      includeWithdrawn: true,
      includeTransitive: true,
    });
  });

  it("ignores verbose for JSON output shape", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const normal = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const verbose = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        format: "json",
        verbose: true,
      },
      {},
    );
    expect(parseText(verbose)).toEqual(parseText(normal));
  });

  it("surfaces requestedVersion when caller passes a real-diff version", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        version: "4.17",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { requestedVersion?: string };
    expect(payload.requestedVersion).toBe("4.17");
  });

  it("rejects tag-style versions with INVALID_ARGUMENT", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", version: "v4.18.0" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("without a leading 'v'");
  });
});

describe("createPackageVulnerabilitiesTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT envelope for unsupported registry (vcpkg)", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "vcpkg", package_name: "foo" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      retryable: boolean;
      error: string;
    };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.retryable).toBe(false);
    expect(payload.error).toBe(
      "pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: vcpkg.",
    );
  });

  it("returns INVALID_ARGUMENT envelope for truly unknown registry", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "cargo", package_name: "serde" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error.toLowerCase()).toContain("unsupported registry");
  });

  it("returns INVALID_ARGUMENT envelope for empty package_name", async () => {
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });
});

describe("createPackageVulnerabilitiesTool — service errors", () => {
  it("classifies PackageIntelligenceTargetNotFoundError as NOT_FOUND envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createPackageVulnerabilitiesTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "ghost" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });

  it("classifies unexpected Error as UNKNOWN", async () => {
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageVulnerabilitiesTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });

  it("rethrows caller cancellation while transitive mode is requested", async () => {
    const controller = new AbortController();
    const reason = new Error("caller cancelled");
    controller.abort(reason);
    const tool = createPackageVulnerabilitiesTool(
      createMockPackageIntelligenceService({
        packageVulnerabilities: mock(() => Promise.reject(reason)),
      }),
    );
    await expect(
      tool.handler(
        {
          registry: "npm",
          package_name: "express",
          include_transitive: true,
        },
        { signal: controller.signal },
      ),
    ).rejects.toBe(reason);
  });
});
