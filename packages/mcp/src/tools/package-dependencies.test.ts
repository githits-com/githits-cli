import { describe, expect, it, mock } from "bun:test";
import type { DependencyReport } from "@githits/core-internal";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import {
  createMockPackageIntelligenceService,
  defaultDependencyReport,
} from "../services/test-helpers.js";
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

describe("createPackageDependenciesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("pkg_deps");
    // Canonical registry order from PKGSEER_REGISTRY_ARGS, restricted
    // to the deps-supported subset.
    expect(tool.description).toContain(
      "npm, PyPI, Hex, Crates, Zig, vcpkg, RubyGems, Go, and Swift",
    );
    expect(tool.description).toContain("dependency graph");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "format",
      "include_importers",
      "lifecycle",
      "max_depth",
      "package_name",
      "registry",
      "version",
    ]);
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
  it("returns INVALID_ARGUMENT for unsupported registry (nuget)", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "nuget", package_name: "Newtonsoft.Json" },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toBe(
      "pkg deps only supports npm, pypi, hex, crates, zig, vcpkg, rubygems, go, swift. Got: nuget.",
    );
  });

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
