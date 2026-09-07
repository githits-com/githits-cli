import { describe, expect, it, mock } from "bun:test";
import type { DependencyReport } from "@githits/core-internal";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import { z } from "zod";
import {
  createMockPackageIntelligenceService,
  defaultDependencyReport,
} from "../services/test-helpers.js";
import { SUPPORTED_DEPS_REGISTRIES_LIST } from "../shared/package-dependencies-request.js";
import { createPackageDependenciesTool } from "./package-dependencies.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

const transitiveDependencyReport: DependencyReport = {
  package: { name: "express", registry: "NPM", version: "5.2.1" },
  dependencies: {
    direct: [{ name: "accepts", versionConstraint: "^2.0.0", type: "runtime" }],
    transitive: {
      totalEdges: 1,
      uniquePackagesCount: 1,
      uniqueDependencies: ["accepts@2.0.0"],
      dependencyConflicts: [],
      circularDependencyCycles: [],
      dependencyGraph: {
        formatVersion: 4,
        nodes: [
          { registry: "npm", name: "express", version: "5.2.1" },
          { registry: "npm", name: "accepts", version: "2.0.0" },
        ],
        edges: [
          {
            fromIndex: 0,
            toIndex: 1,
            constraint: "^2.0.0",
            dependencyType: "runtime",
          },
        ],
      },
    },
  },
};

function issueDependencyReport(): DependencyReport {
  const report = structuredClone(transitiveDependencyReport);
  const transitive = report.dependencies?.transitive;
  if (!transitive) throw new Error("expected transitive fixture");
  transitive.dependencyIssues = {
    totalCount: 16,
    deprecatedCount: 4,
    outdatedCount: 4,
    duplicateCount: 4,
    conflictCount: 4,
    deprecatedPackages: [
      {
        registry: "NPM",
        name: "alpha-deprecated",
        versions: ["1.0.0"],
        reasons: [],
      },
      {
        registry: "NPM",
        name: "beta-deprecated",
        versions: ["1.0.0"],
        reasons: [],
      },
      {
        registry: "NPM",
        name: "gamma-deprecated",
        versions: ["1.0.0"],
        reasons: [],
      },
      {
        registry: "NPM",
        name: "zeta-deprecated",
        versions: ["1.0.0"],
        reasons: [],
      },
    ],
    outdatedPackages: [
      {
        registry: "NPM",
        name: "alpha-outdated",
        latestVersion: "2.0.0",
        severity: "HIGH",
        versions: [{ version: "1.0.0", severity: "HIGH" }],
      },
      {
        registry: "NPM",
        name: "beta-outdated",
        severity: "LOW",
        versions: [{ version: "1.0.0", severity: "LOW" }],
      },
      {
        registry: "NPM",
        name: "gamma-outdated",
        severity: "MEDIUM",
        versions: [{ version: "1.0.0", severity: "MEDIUM" }],
      },
      {
        registry: "NPM",
        name: "zeta-outdated",
        severity: "UNKNOWN",
        versions: [{ version: "1.0.0", severity: "UNKNOWN" }],
      },
    ],
    duplicatePackages: [
      { registry: "NPM", name: "alpha-duplicate", versions: ["1.0.0"] },
      { registry: "NPM", name: "beta-duplicate", versions: ["1.0.0"] },
      { registry: "NPM", name: "gamma-duplicate", versions: ["1.0.0"] },
      { registry: "NPM", name: "zeta-duplicate", versions: ["1.0.0"] },
    ],
    conflicts: [
      {
        registry: "NPM",
        name: "alpha-conflict",
        versions: ["1.0.0", "2.0.0"],
        requiredVersions: ["^1.0.0"],
        conflictingEdges: [],
      },
      {
        registry: "NPM",
        name: "beta-conflict",
        versions: ["1.0.0", "2.0.0"],
        requiredVersions: ["^1.0.0"],
        conflictingEdges: [],
      },
      {
        registry: "NPM",
        name: "gamma-conflict",
        versions: ["1.0.0", "2.0.0"],
        requiredVersions: ["^1.0.0"],
        conflictingEdges: [],
      },
      {
        registry: "NPM",
        name: "zeta-conflict",
        versions: ["1.0.0", "2.0.0"],
        requiredVersions: ["^1.0.0"],
        conflictingEdges: [],
      },
    ],
  };
  return report;
}

describe("createPackageDependenciesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_deps");
    expect(tool.description).toContain(
      `Supports ${SUPPORTED_DEPS_REGISTRIES_LIST}.`,
    );
    expect(tool.description).not.toContain(
      "Supports npm, PyPI, Hex, Crates, Zig, vcpkg, RubyGems, Go, and Swift.",
    );
    expect(tool.description).toContain(
      "Inspect what a package depends on, directly or transitively",
    );
    expect(tool.description).toContain("include_issues: true");
    expect(tool.description).toContain(
      "deprecated, outdated, duplicate, and conflict analysis",
    );
    expect(tool.description).toContain("issues scan the full graph");
    expect(tool.description).toContain("max_depth");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "format",
      "include_importers",
      "include_issues",
      "lifecycle",
      "max_depth",
      "package_name",
      "registry",
      "version",
    ]);
    const schema = z.toJSONSchema(z.object(tool.schema));
    expect(schema.properties?.include_issues).toMatchObject({
      type: "boolean",
    });
    const issueSchema = schema.properties?.include_issues;
    if (!issueSchema) throw new Error("expected include_issues schema");
    expect((issueSchema as { description?: string }).description).toContain(
      "Without `max_depth`, this traverses the full graph",
    );
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("does NOT expose an include_groups input (lifecycle is the breadth knob)", () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    expect(Object.keys(tool.schema)).not.toContain("include_groups");
  });
});

describe("createPackageDependenciesTool — happy path", () => {
  it("calls service.packageDependencies with normalised params", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        version: "5.2.1",
        lifecycle: "runtime,development",
        max_depth: 3,
      },
      {},
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [
        {
          registry: string;
          packageName: string;
          version?: string;
          lifecycle?: string[];
          includeTransitive?: boolean;
          includeTransitiveDetails?: boolean;
          includeGroups?: boolean;
          maxDepth?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.version).toBe("5.2.1");
    expect(calls[0]?.[0]?.lifecycle).toEqual(["development"]);
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.includeTransitiveDetails).toBe(true);
    expect(calls[0]?.[0]?.includeGroups).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(3);
  });

  it.each([
    ["nuget", "NUGET"],
    ["maven", "MAVEN"],
    ["packagist", "PACKAGIST"],
  ] as const)(
    "accepts %s and sends the canonical backend registry",
    async (registry, expectedRegistry) => {
      const packageDependencies = mock(() =>
        Promise.resolve(defaultDependencyReport),
      );
      const tool = createPackageDependenciesTool(
        createMockPackageIntelligenceService({ packageDependencies }),
      );

      const result = await tool.handler(
        { registry, package_name: "example", format: "json" },
        {},
      );

      expect(result.isError).toBeUndefined();
      const calls = packageDependencies.mock.calls as unknown as Array<
        [{ registry: string; packageName: string }]
      >;
      expect(calls[0]?.[0]).toMatchObject({
        registry: expectedRegistry,
        packageName: "example",
      });
    },
  );

  it("uses the canonical Go version for wire and response comparisons", async () => {
    const goReport = structuredClone(defaultDependencyReport);
    goReport.package = {
      name: "example.com/mod",
      registry: "GO",
      version: "v1.2.3",
    };
    const packageDependencies = mock(() => Promise.resolve(goReport));
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService({ packageDependencies }),
    );

    const jsonResult = await tool.handler(
      {
        registry: "go",
        package_name: "example.com/mod",
        version: "1.2.3",
        format: "json",
      },
      {},
    );
    const textResult = await tool.handler(
      {
        registry: "go",
        package_name: "example.com/mod",
        version: "1.2.3",
      },
      {},
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ version?: string }]
    >;
    expect(calls.map(([params]) => params.version)).toEqual([
      "v1.2.3",
      "v1.2.3",
    ]);
    expect(
      (parseText(jsonResult) as { requestedVersion?: string }).requestedVersion,
    ).toBeUndefined();
    expect(textResult.content[0]?.text).not.toContain("(requested");
  });

  it("fetches groups for default text so hidden group hints can render", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    await tool.handler({ registry: "npm", package_name: "express" }, {});

    const calls = packageDependencies.mock.calls as unknown as Array<
      [
        {
          includeTransitiveDetails?: boolean;
          includeGroups?: boolean;
        },
      ]
    >;
    expect(calls[0]?.[0]?.includeTransitiveDetails).toBe(false);
    expect(calls[0]?.[0]?.includeGroups).toBe(true);
  });

  it("skips groups for default JSON deps mode", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeGroups?: boolean }]
    >;
    expect(calls[0]?.[0]?.includeGroups).toBe(false);
  });

  it("emits compact text with runtime block by default", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("express @ 5.2.1 | npm");
    expect(text).toContain("3 direct runtime dependencies");
    expect(text).toContain(
      'Hidden groups: development - pass lifecycle="all".',
    );
    expect(text).toContain("Runtime dependencies:");
    expect(text).not.toContain("--lifecycle");
    expect(text).toContain("accepts");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("emits the lean JSON envelope when format=json", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );
    const payload = parseText(result) as {
      registry: string;
      name: string;
      runtime: { count: number };
      groups?: { items: unknown[] };
    };
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.runtime.count).toBe(3);
    expect(payload.groups).toBeUndefined();
  });

  it("surfaces filter.lifecycles when lifecycle is set", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        lifecycle: "development",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: { lifecycles: string[] };
    };
    expect(payload.filter?.lifecycles).toEqual(["development"]);
  });

  it("accepts lifecycle as a pre-split array (MCP agents' natural shape)", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        lifecycle: ["runtime", "development"],
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: { lifecycles: string[] };
    };
    expect(payload.filter?.lifecycles).toEqual(["runtime", "development"]);
  });

  it("emits transitive block only when max_depth is set", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService({
        packageDependencies: mock(() =>
          Promise.resolve(transitiveDependencyReport),
        ),
      }),
    );
    const withoutTransitive = parseText(
      await tool.handler(
        { registry: "npm", package_name: "express", format: "json" },
        {},
      ),
    ) as { transitive?: unknown };
    expect(withoutTransitive.transitive).toBeUndefined();

    const withTransitive = parseText(
      await tool.handler(
        {
          registry: "npm",
          package_name: "express",
          max_depth: 3,
          format: "json",
        },
        {},
      ),
    ) as { transitive?: unknown };
    expect(withTransitive.transitive).toBeDefined();
  });

  it("always fetches the DAG on the wire (depth=1 when max_depth is absent) so runtime.items[].version resolves", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve({
        package: { name: "express", registry: "NPM", version: "5.2.1" },
        dependencies: {
          direct: [
            { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
          ],
          transitive: {
            totalEdges: 1,
            uniquePackagesCount: 1,
            uniqueDependencies: ["accepts@2.0.0"],
            dependencyConflicts: [],
            circularDependencyCycles: [],
            dependencyGraph: {
              formatVersion: 4,
              nodes: [
                { registry: "npm", name: "express", version: "5.2.1" },
                { registry: "npm", name: "accepts", version: "2.0.0" },
              ],
              edges: [
                {
                  fromIndex: 0,
                  toIndex: 1,
                  constraint: "^2.0.0",
                  dependencyType: "runtime",
                },
              ],
            },
          },
        },
      }),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    const result = await tool.handler(
      { registry: "npm", package_name: "express", format: "json" },
      {},
    );

    // Wire-level: includeTransitive:true at depth 1 even when the
    // caller didn't ask for the transitive block.
    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeTransitive?: boolean; maxDepth?: number }]
    >;
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(1);

    // Envelope: runtime.items[].version is resolved from the DAG even
    // though the `transitive` block itself is hidden.
    const payload = parseText(result) as {
      runtime: {
        items: Array<{ name: string; version?: string; constraint?: string }>;
      };
      transitive?: unknown;
    };
    expect(payload.runtime.items[0]).toEqual({
      name: "accepts",
      constraint: "^2.0.0",
      version: "2.0.0",
    });
    expect(payload.transitive).toBeUndefined();
  });

  it("requests unbounded issue analysis without exposing ordinary transitive output", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(issueDependencyReport()),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_issues: true,
        format: "json",
      },
      {},
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [
        {
          includeDependencyIssues?: boolean;
          includeTransitive?: boolean;
          includeTransitiveDetails?: boolean;
          includeGroups?: boolean;
          maxDepth?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.includeDependencyIssues).toBe(true);
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.includeTransitiveDetails).toBe(false);
    expect(calls[0]?.[0]?.includeGroups).toBe(false);
    expect(calls[0]?.[0]?.maxDepth).toBeUndefined();

    const payload = parseText(result) as {
      transitive?: unknown;
      issues?: {
        total: number;
        scope: { mode: string; maxDepth?: number };
        deprecated: { count: number; items: unknown[] };
        outdated: { count: number; items: unknown[] };
        duplicates: { count: number; items: unknown[] };
        conflicts: { count: number; items: unknown[] };
      };
    };
    expect(payload.transitive).toBeUndefined();
    expect(payload.issues?.total).toBe(16);
    expect(payload.issues?.scope).toEqual({ mode: "full" });
    expect(payload.issues?.deprecated).toMatchObject({
      count: 4,
      items: expect.any(Array),
    });
    expect(payload.issues?.outdated.count).toBe(4);
    expect(payload.issues?.duplicates.count).toBe(4);
    expect(payload.issues?.conflicts.count).toBe(4);
  });

  it("uses a bounded issue graph and ordinary transitive output when max_depth is supplied", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(issueDependencyReport()),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const tool = createPackageDependenciesTool(service);

    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_issues: true,
        max_depth: 4,
        format: "json",
      },
      {},
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeDependencyIssues?: boolean; maxDepth?: number }]
    >;
    expect(calls[0]?.[0]?.includeDependencyIssues).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(4);
    const payload = parseText(result) as {
      transitive?: unknown;
      issues?: { scope: { mode: string; maxDepth?: number } };
    };
    expect(payload.transitive).toBeDefined();
    expect(payload.issues?.scope).toEqual({
      mode: "depth_limited",
      maxDepth: 4,
    });
  });

  it.each([undefined, false] as const)(
    "does not request issue analysis when include_issues is %s",
    async (includeIssues) => {
      const packageDependencies = mock(() =>
        Promise.resolve(defaultDependencyReport),
      );
      const service = createMockPackageIntelligenceService({
        packageDependencies,
      });
      const tool = createPackageDependenciesTool(service);
      const args = {
        registry: "npm",
        package_name: "express",
        format: "json" as const,
        ...(includeIssues === undefined
          ? {}
          : { include_issues: includeIssues }),
      };

      const result = await tool.handler(args, {});
      const calls = packageDependencies.mock.calls as unknown as Array<
        [
          {
            includeDependencyIssues?: boolean;
            includeTransitive?: boolean;
            maxDepth?: number;
          },
        ]
      >;
      expect(calls[0]?.[0]?.includeDependencyIssues).toBe(includeIssues);
      expect(calls[0]?.[0]?.includeTransitive).toBe(true);
      expect(calls[0]?.[0]?.maxDepth).toBe(1);
      expect(
        (parseText(result) as { issues?: unknown }).issues,
      ).toBeUndefined();
    },
  );

  it("adds the exact MCP JSON hint only when compact issue output is truncated", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService({
        packageDependencies: mock(() =>
          Promise.resolve(issueDependencyReport()),
        ),
      }),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_issues: true,
      },
      {},
    );

    const text = result.content[0]?.text ?? "";
    const hint = 'Pass format: "json" for complete issue details.';
    expect(text).toContain("Dependency issues: 16 (full graph)");
    expect(text).toContain(
      "  Deprecated 4 | Outdated 4 | Duplicates 4 | Conflicts 4",
    );
    expect(text.split(hint).length - 1).toBe(1);
    expect(text).not.toContain("zeta-deprecated");
  });
});

describe("createPackageDependenciesTool — silent-noop rejection", () => {
  it("include_importers alone requests the transitive block with provenance", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService({
        packageDependencies: mock(() =>
          Promise.resolve(transitiveDependencyReport),
        ),
      }),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_importers: true,
        format: "json",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as { transitive?: unknown };
    expect(payload.transitive).toBeDefined();
  });
});

describe("createPackageDependenciesTool — validation errors via in-handler builder", () => {
  it("returns INVALID_ARGUMENT for tag-style version", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", version: "v4.18.0" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("git tag");
  });

  it("returns INVALID_ARGUMENT for unknown lifecycle token", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", lifecycle: "dev" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("Unknown lifecycle 'dev'");
  });
});

describe("createPackageDependenciesTool — service errors", () => {
  it("classifies PackageIntelligenceTargetNotFoundError as NOT_FOUND envelope", async () => {
    const service = createMockPackageIntelligenceService({
      packageDependencies: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createPackageDependenciesTool(service);
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
      packageDependencies: mock(() => Promise.reject(new Error("boom"))),
    });
    const tool = createPackageDependenciesTool(service);
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("UNKNOWN");
  });
});
