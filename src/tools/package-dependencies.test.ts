import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultDependencyReport,
} from "../services/test-helpers.js";
import { createPackageDependenciesTool } from "./package-dependencies.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createPackageDependenciesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("package_dependencies");
    expect(tool.description).toContain("npm, PyPI, Hex, Crates");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "include_importers",
      "include_transitive",
      "lifecycle",
      "max_depth",
      "package_name",
      "registry",
      "version",
    ]);
    expect(tool.annotations?.readOnlyHint).toBe(true);
  });

  it("does NOT expose an include_groups input (data-first envelope makes it a no-op)", () => {
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
        include_transitive: true,
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
          maxDepth?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.packageName).toBe("express");
    expect(calls[0]?.[0]?.version).toBe("5.2.1");
    expect(calls[0]?.[0]?.lifecycle).toEqual(["runtime", "development"]);
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(3);
  });

  it("emits the lean JSON envelope with runtime + groups blocks", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as {
      registry: string;
      name: string;
      runtime: { count: number };
      groups: { items: unknown[] };
    };
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.runtime.count).toBe(3);
    expect(payload.groups.items.length).toBe(2);
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
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: { lifecycles: string[] };
    };
    expect(payload.filter?.lifecycles).toEqual(["runtime", "development"]);
  });

  it("emits transitive block only when include_transitive is set", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const withoutTransitive = parseText(
      await tool.handler({ registry: "npm", package_name: "express" }, {}),
    ) as { transitive?: unknown };
    expect(withoutTransitive.transitive).toBeUndefined();
  });

  it("always fetches the DAG on the wire (depth=1 when include_transitive is absent) so runtime.items[].version resolves", async () => {
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
      { registry: "npm", package_name: "express" },
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
  it("rejects max_depth without include_transitive as INVALID_ARGUMENT", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express", max_depth: 3 },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain(
      "max_depth requires include_transitive: true",
    );
  });

  it("rejects include_importers without include_transitive as INVALID_ARGUMENT", async () => {
    const tool = createPackageDependenciesTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      {
        registry: "npm",
        package_name: "express",
        include_importers: true,
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain(
      "include_importers requires include_transitive: true",
    );
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
      "pkg deps only supports npm, pypi, hex, crates, vcpkg, and zig. Got: nuget.",
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
