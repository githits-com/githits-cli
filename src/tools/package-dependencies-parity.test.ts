// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable,
//                          details? } on every error path; MCP error text is
//                          always valid JSON.
//
// Assertion policy:
//   - Service-sourced success and error fixtures use `toEqual`: both
//     surfaces route through the same request builder and envelope
//     shaper, so backend facts match; recovery actions use native surface syntax.
//   - `INVALID_ARGUMENT` fixtures use `toMatchObject`: both surfaces
//     parse the canonical compact target and run the shared builder
//     in their handlers. Same envelope shape, potentially
//     surface-specific error text.

import { describe, expect, it, mock, spyOn } from "bun:test";
import type {
  DependencyReport,
  PackageIntelligenceService,
} from "@githits/core-internal";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "@githits/core-internal";
import {
  type PkgDepsCommandDependencies,
  pkgDepsAction,
} from "../commands/pkg/deps.js";
import {
  cratesFeatureDependencyReport,
  createMockPackageIntelligenceService,
  defaultDependencyReport,
  zeroDepDependencyReport,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<PkgDepsCommandDependencies> = {},
): PkgDepsCommandDependencies {
  return {
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

const issueDependencyReport: DependencyReport = {
  package: { name: "express", registry: "NPM", version: "5.2.1" },
  dependencies: {
    direct: [{ name: "shared", versionConstraint: "^1.0.0", type: "runtime" }],
    transitive: {
      totalEdges: 2,
      uniquePackagesCount: 1,
      uniqueDependencies: ["shared@1.0.0"],
      dependencyConflicts: [],
      circularDependencyCycles: [],
      dependencyGraph: {
        formatVersion: 4,
        nodes: [
          { registry: "NPM", name: "express", version: "5.2.1" },
          { registry: "NPM", name: "importer", version: "1.0.0" },
          { registry: "NPM", name: "shared", version: "1.0.0" },
        ],
        edges: [
          {
            toIndex: 2,
            constraint: "^1.0.0",
            dependencyType: "runtime",
          },
          {
            fromIndex: 1,
            toIndex: 2,
            constraint: "^2.0.0",
            dependencyType: "peer",
          },
        ],
      },
      dependencyIssues: {
        totalCount: 4,
        deprecatedCount: 1,
        outdatedCount: 1,
        duplicateCount: 1,
        conflictCount: 1,
        deprecatedPackages: [
          {
            registry: "NPM",
            name: "legacy",
            versions: ["1.0.0"],
            reasons: [{ version: "1.0.0", reason: "Use replacement" }],
          },
        ],
        outdatedPackages: [
          {
            registry: "NPM",
            name: "shared",
            latestVersion: "2.0.0",
            severity: "HIGH",
            versions: [{ version: "1.0.0", severity: "HIGH" }],
          },
        ],
        duplicatePackages: [
          { registry: "NPM", name: "duplicate", versions: ["1.0.0", "2.0.0"] },
        ],
        conflicts: [
          {
            registry: "NPM",
            name: "shared",
            versions: ["1.0.0", "2.0.0"],
            requiredVersions: ["^1.0.0", "^2.0.0"],
            conflictingEdges: [
              {
                toIndex: 2,
                versionConstraint: "^1.0.0",
                dependencyType: "runtime",
              },
              {
                fromIndex: 1,
                toIndex: 2,
                versionConstraint: "^2.0.0",
                dependencyType: "peer",
              },
            ],
          },
        ],
      },
    },
  },
};

async function cliJson(
  spec: string,
  options: Parameters<typeof pkgDepsAction>[1] = {},
  deps: PkgDepsCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgDepsAction(spec, { ...options, json: true }, deps);
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

async function mcpJson(
  args: {
    target: string;
    lifecycle?: string;
    include_importers?: boolean;
    include_issues?: boolean;
    max_depth?: number;
  },
  packageDependenciesMock?: () => Promise<DependencyReport>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageDependenciesMock
      ? { packageDependencies: packageDependenciesMock as never }
      : {},
  );
  const tool = createParityMcpTool("pkg_deps", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

describe("package_dependencies parity", () => {
  it("PARITY-JSON-KEYS: happy flat-runtime CLI === MCP", async () => {
    const packageDependencies = mock(
      (
        _params?: Parameters<
          PackageIntelligenceService["packageDependencies"]
        >[0],
      ) => Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies: packageDependencies as never,
    });
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "npm:express" },
      packageDependencies,
    );
    expect(isError).toBeUndefined();
    expect(packageDependencies).toHaveBeenCalledTimes(2);
    expect(packageDependencies.mock.calls).toEqual([
      [
        {
          registry: "NPM",
          packageName: "express",
          version: undefined,
          includeTransitive: true,
          includeTransitiveDetails: false,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 1,
          lifecycle: undefined,
        },
      ],
      [
        {
          registry: "NPM",
          packageName: "express",
          version: undefined,
          includeTransitive: true,
          includeTransitiveDetails: false,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 1,
          lifecycle: undefined,
        },
      ],
    ]);
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: Pub leaf path@1.9.0 preserves zero counts CLI === MCP", async () => {
    const pubLeafReport: DependencyReport = {
      package: { name: "path", registry: "PUB", version: "1.9.0" },
      dependencies: {
        direct: [],
        transitive: {
          totalEdges: 0,
          uniquePackagesCount: 0,
          uniqueDependencies: [],
        },
      },
    };
    const packageDependencies = mock(
      (
        _params?: Parameters<
          PackageIntelligenceService["packageDependencies"]
        >[0],
      ) => Promise.resolve(pubLeafReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies: packageDependencies as never,
    });
    const cli = await cliJson(
      "pub:path@1.9.0",
      { depth: "2" },
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "pub:path@1.9.0", max_depth: 2 },
      packageDependencies,
    );

    expect(isError).toBeUndefined();
    expect(packageDependencies).toHaveBeenCalledTimes(2);
    expect(packageDependencies.mock.calls).toEqual([
      [
        {
          registry: "PUB",
          packageName: "path",
          version: "1.9.0",
          includeTransitive: true,
          includeTransitiveDetails: true,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 2,
          lifecycle: undefined,
        },
      ],
      [
        {
          registry: "PUB",
          packageName: "path",
          version: "1.9.0",
          includeTransitive: true,
          includeTransitiveDetails: true,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 2,
          lifecycle: undefined,
        },
      ],
    ]);
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      registry: "pub",
      name: "path",
      version: "1.9.0",
      runtime: { count: 0, items: [] },
      transitive: { edges: 0, uniquePackages: 0 },
    });
    expect(
      (cli as { transitive?: { packages?: unknown[] } }).transitive?.packages,
    ).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: Pub graph preserves native identity and versions CLI === MCP", async () => {
    const pubGraphReport: DependencyReport = {
      package: {
        registry: "PUB",
        name: "Synthetic_Pub",
        version: "1.2.3+build.7",
      },
      dependencies: {
        direct: [
          {
            name: "collection",
            versionConstraint: "^1.18.0",
            type: "runtime",
          },
        ],
        transitive: {
          totalEdges: 2,
          uniquePackagesCount: 2,
          uniqueDependencies: ["collection@1.18.0", "meta@1.10.0"],
          dependencyGraph: {
            formatVersion: 4,
            nodes: [
              {
                registry: "PUB",
                name: "Synthetic_Pub",
                version: "1.2.3+build.7",
              },
              { registry: "PUB", name: "collection", version: "1.18.0" },
              { registry: "PUB", name: "meta", version: "1.10.0" },
            ],
            edges: [
              {
                fromIndex: 0,
                toIndex: 1,
                constraint: "^1.18.0",
                dependencyType: "runtime",
              },
              {
                fromIndex: 1,
                toIndex: 2,
                constraint: "^1.10.0",
                dependencyType: "runtime",
              },
            ],
          },
        },
      },
    };
    const packageDependencies = mock(
      (
        _params?: Parameters<
          PackageIntelligenceService["packageDependencies"]
        >[0],
      ) => Promise.resolve(pubGraphReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies: packageDependencies as never,
    });
    const cli = await cliJson(
      "pub:Synthetic_Pub@1.2.3+build.7",
      { depth: "2" },
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "pub:Synthetic_Pub@1.2.3+build.7", max_depth: 2 },
      packageDependencies,
    );

    expect(isError).toBeUndefined();
    expect(packageDependencies).toHaveBeenCalledTimes(2);
    expect(packageDependencies.mock.calls).toEqual([
      [
        {
          registry: "PUB",
          packageName: "Synthetic_Pub",
          version: "1.2.3+build.7",
          includeTransitive: true,
          includeTransitiveDetails: true,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 2,
          lifecycle: undefined,
        },
      ],
      [
        {
          registry: "PUB",
          packageName: "Synthetic_Pub",
          version: "1.2.3+build.7",
          includeTransitive: true,
          includeTransitiveDetails: true,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 2,
          lifecycle: undefined,
        },
      ],
    ]);
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      registry: "pub",
      name: "Synthetic_Pub",
      version: "1.2.3+build.7",
      runtime: {
        count: 1,
        items: [
          {
            name: "collection",
            constraint: "^1.18.0",
            version: "1.18.0",
          },
        ],
      },
      transitive: {
        edges: 2,
        uniquePackages: 2,
        packages: [
          { name: "collection", version: "1.18.0" },
          { name: "meta", version: "1.10.0" },
        ],
      },
    });
    expect(
      (
        cli as {
          transitive?: { dependencyGraph?: unknown; dag?: unknown };
        }
      ).transitive?.dependencyGraph,
    ).toBeUndefined();
    expect(
      (cli as { transitive?: { dag?: unknown } }).transitive?.dag,
    ).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: Go pinned target CLI === MCP", async () => {
    const packageDependencies = mock(
      (
        _params?: Parameters<
          PackageIntelligenceService["packageDependencies"]
        >[0],
      ) => Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies: packageDependencies as never,
    });
    const cli = await cliJson(
      "go:github.com/gin-gonic/gin@1.2.3",
      {},
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "go:github.com/gin-gonic/gin@1.2.3" },
      packageDependencies,
    );

    expect(isError).toBeUndefined();
    expect(packageDependencies).toHaveBeenCalledTimes(2);
    expect(packageDependencies.mock.calls).toEqual([
      [
        {
          registry: "GO",
          packageName: "github.com/gin-gonic/gin",
          version: "v1.2.3",
          includeTransitive: true,
          includeTransitiveDetails: false,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 1,
          lifecycle: undefined,
        },
      ],
      [
        {
          registry: "GO",
          packageName: "github.com/gin-gonic/gin",
          version: "v1.2.3",
          includeTransitive: true,
          includeTransitiveDetails: false,
          includeGroups: false,
          includeDependencyIssues: undefined,
          maxDepth: 1,
          lifecycle: undefined,
        },
      ],
    ]);
    expect(cli).toEqual(json);
  });

  it.each([
    "nuget:Newtonsoft.Json",
    "maven:org.apache.commons:commons-lang3",
    "packagist:monolog/monolog",
  ] as const)(
    "PARITY-JSON-KEYS: %s accepted registry CLI === MCP",
    async (spec) => {
      const cli = await cliJson(spec);
      const { json, isError } = await mcpJson({ target: spec });
      expect(isError).toBeUndefined();
      expect(cli).toEqual(json);
    },
  );

  it("PARITY-JSON-KEYS: zero-dep hot path CLI === MCP (omits groups block)", async () => {
    const zeroFn = mock(() => Promise.resolve(zeroDepDependencyReport));
    const cli = await cliJson(
      "npm:left-pad",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: zeroFn as never,
        }),
      }),
    );
    const { json } = await mcpJson({ target: "npm:left-pad" }, zeroFn as never);
    expect(cli).toEqual(json);
    expect((cli as { groups?: unknown }).groups).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: lifecycle=all full-view express CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultDependencyReport));
    const cli = await cliJson(
      "npm:express",
      { lifecycle: "all" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "npm:express", lifecycle: "all" },
      fn as never,
    );
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: lifecycle=optional CLI === MCP (tokio optional groups)", async () => {
    const fn = mock(() => Promise.resolve(cratesFeatureDependencyReport));
    const cli = await cliJson(
      "crates:tokio",
      { lifecycle: "optional" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "crates:tokio",
        lifecycle: "optional",
      },
      fn as never,
    );
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: lifecycle=runtime,development CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultDependencyReport));
    const cli = await cliJson(
      "npm:express",
      { lifecycle: "runtime,development" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        lifecycle: "runtime,development",
      },
      fn as never,
    );
    expect(cli).toEqual(json);
    // filter echo is canonicalised + sorted
    expect((cli as { filter?: { lifecycles: string[] } }).filter).toEqual({
      lifecycles: ["runtime", "development"],
    });
  });

  it("PARITY-JSON-KEYS: lifecycle=build matches nothing → groups.items:[] CLI === MCP", async () => {
    const filterEmptyReport: DependencyReport = {
      package: { name: "express", registry: "NPM", version: "5.2.1" },
      dependencies: {
        direct: [
          { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
        ],
      },
      dependencyGroups: { groups: [] },
    };
    const fn = mock(() => Promise.resolve(filterEmptyReport));
    const cli = await cliJson(
      "npm:express",
      { lifecycle: "build" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        lifecycle: "build",
      },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect((cli as { groups?: { items: unknown[] } }).groups).toEqual({
      items: [],
    });
  });

  it("PARITY-JSON-KEYS: Crates-target-cfg dedup round-trip preserves duplicates in JSON on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(cratesFeatureDependencyReport));
    const cli = await cliJson(
      "crates:tokio",
      { lifecycle: "all" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "crates:tokio", lifecycle: "all" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const items = (
      cli as {
        groups: { items: Array<{ name: string; items: unknown[] }> };
      }
    ).groups.items;
    const net = items.find((g) => g.name === "net");
    expect(net?.items.length).toBe(3); // libc, libc, mio — duplicates preserved
  });

  it("PARITY-JSON-KEYS: max_depth CLI === MCP (preprocessed packages[], no raw dag)", async () => {
    const transitiveReport: DependencyReport = {
      package: { name: "express", registry: "NPM", version: "5.2.1" },
      dependencies: {
        direct: [
          { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
        ],
        transitive: {
          totalEdges: 80,
          uniquePackagesCount: 45,
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
    const fn = mock(() => Promise.resolve(transitiveReport));
    // --verbose on the CLI enables importers in JSON; include_importers
    // on MCP does the same. Both surfaces route to the same lean
    // envelope shaper.
    const cli = await cliJson(
      "npm:express",
      { depth: "10", verbose: true },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        max_depth: 10,
        include_importers: true,
      },
      fn as never,
    );
    expect(cli).toEqual(json);
    const transitiveEnvelope = (
      cli as {
        transitive?: {
          packages?: unknown[];
          dependencyGraph?: unknown;
          dag?: unknown;
        };
      }
    ).transitive;
    expect(transitiveEnvelope?.packages).toEqual([
      {
        name: "accepts",
        version: "2.0.0",
        importers: [
          { name: "express", version: "5.2.1", constraint: "^2.0.0" },
        ],
      },
    ]);
    // Neither the typed `dependencyGraph` nor the legacy `dag` is
    // surfaced on this tool's envelope — both remain internal to
    // the service-level result.
    expect(transitiveEnvelope?.dependencyGraph).toBeUndefined();
    expect(transitiveEnvelope?.dag).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: max_depth defaults to lean packages (no importers) on both surfaces", async () => {
    const transitiveReport: DependencyReport = {
      package: { name: "express", registry: "NPM", version: "5.2.1" },
      dependencies: {
        direct: [],
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
    const fn = mock(() => Promise.resolve(transitiveReport));
    const cli = await cliJson(
      "npm:express",
      { depth: "10" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        max_depth: 10,
      },
      fn as never,
    );
    expect(cli).toEqual(json);
    const pkgs = (
      cli as { transitive?: { packages?: Array<Record<string, unknown>> } }
    ).transitive?.packages;
    expect(pkgs).toEqual([{ name: "accepts", version: "2.0.0" }]);
    // Importers absent — lean default.
    expect(pkgs?.[0]?.importers).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: unbounded issue analysis CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(issueDependencyReport));
    const cli = await cliJson(
      "npm:express",
      { issues: true },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        include_issues: true,
      },
      fn as never,
    );

    expect(cli).toEqual(json);
    expect((cli as { transitive?: unknown }).transitive).toBeUndefined();
    expect((cli as { issues?: { scope: unknown } }).issues?.scope).toEqual({
      mode: "full",
    });
    expect(
      (
        cli as {
          issues?: { conflicts: { items: Array<{ requirements: unknown[] }> } };
        }
      ).issues?.conflicts.items[0]?.requirements,
    ).toHaveLength(2);
  });

  it("PARITY-JSON-KEYS: bounded issue analysis CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(issueDependencyReport));
    const cli = await cliJson(
      "npm:express",
      { issues: true, depth: "4" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        include_issues: true,
        max_depth: 4,
      },
      fn as never,
    );

    expect(cli).toEqual(json);
    expect((cli as { transitive?: unknown }).transitive).toBeDefined();
    expect((cli as { issues?: { scope: unknown } }).issues?.scope).toEqual({
      mode: "depth_limited",
      maxDepth: 4,
    });
  });

  it("PARITY-JSON-KEYS: explicit false issue analysis remains unchanged CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultDependencyReport));
    const cli = await cliJson(
      "npm:express",
      { issues: false },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        target: "npm:express",
        include_issues: false,
      },
      fn as never,
    );

    expect(cli).toEqual(json);
    expect((cli as { issues?: unknown }).issues).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: versioned match suppresses requestedVersion on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultDependencyReport));
    const cli = await cliJson(
      "npm:express@5.2.1",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "npm:express@5.2.1" },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect(
      (cli as { requestedVersion?: string }).requestedVersion,
    ).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: versioned non-trivial diff surfaces requestedVersion on both surfaces", async () => {
    const resolvedReport: DependencyReport = {
      package: { name: "express", registry: "NPM", version: "4.17.2" },
      dependencies: { direct: [] },
    };
    const fn = mock(() => Promise.resolve(resolvedReport));
    const cli = await cliJson(
      "npm:express@4.17",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson({ target: "npm:express@4.17" }, fn as never);
    expect(cli).toEqual(json);
    expect((cli as { requestedVersion?: string }).requestedVersion).toBe(
      "4.17",
    );
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND CLI === MCP", async () => {
    const error = new PackageIntelligenceTargetNotFoundError(
      "Package 'npm:ghost' not found.",
    );
    const fn = mock(() => Promise.reject(error));
    const cli = await cliJson(
      "npm:ghost",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { target: "npm:ghost" },
      fn as never,
    );
    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(cli).toEqual({
      error: "Package 'npm:ghost' not found.",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("PARITY-ERROR-ENVELOPE: VERSION_NOT_FOUND shares facts with native actions", async () => {
    const previousArgv = process.argv;
    process.argv = [
      "bun",
      "src/cli.ts",
      "pkg",
      "deps",
      "npm:express@99.0.0",
      "--json",
    ];
    try {
      const error = new PackageIntelligenceVersionNotFoundError(
        "Version 99.0.0 not found",
        "npm:express",
        "99.0.0",
        ["5.2.1", "5.2.0"],
      );
      const fn = mock(() => Promise.reject(error));
      const cli = await cliJson(
        "npm:express@99.0.0",
        {},
        cliDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageDependencies: fn as never,
          }),
        }),
      );
      const { json } = await mcpJson(
        {
          target: "npm:express@99.0.0",
        },
        fn as never,
      );
      const envelope = json as {
        details: { action: string; [key: string]: unknown };
        [key: string]: unknown;
      };
      expect(envelope.details.action).toBe(
        'Retry pkg_deps with target="npm:express@5.2.1".',
      );
      const cliEnvelope = cli as typeof envelope;
      expect(cliEnvelope.details.action).toBe(
        "Try: githits pkg deps npm:express@5.2.1 --json",
      );
      const { action: _mcpAction, ...mcpFacts } = envelope.details;
      const { action: _cliAction, ...cliFacts } = cliEnvelope.details;
      expect({ ...cliEnvelope, details: cliFacts }).toEqual({
        ...envelope,
        details: mcpFacts,
      });
      expect(cli).toMatchObject({
        code: "VERSION_NOT_FOUND",
        retryable: false,
        details: {
          package: "npm:express",
          requestedVersion: "99.0.0",
          availablePackageVersions: ["5.2.1", "5.2.0"],
        },
      });
    } finally {
      process.argv = previousArgv;
    }
  });

  it("Pub unsupported target context preserves the typed backend outcome", async () => {
    const message =
      "This dependency graph requires an unsupported target context.";
    const error = new PackageIntelligenceBackendError(
      message,
      undefined,
      "DEPENDENCY_RESOLUTION_UNAVAILABLE",
      false,
    );
    const fn = mock(() => Promise.reject(error));
    const cli = await cliJson(
      "pub:Synthetic_Pub@1.2.3",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { target: "pub:Synthetic_Pub@1.2.3" },
      fn,
    );
    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(json).toEqual({
      code: "BACKEND_ERROR",
      error: message,
      retryable: false,
      details: { graphqlCode: "DEPENDENCY_RESOLUTION_UNAVAILABLE" },
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("PARITY-ERROR-ENVELOPE: BACKEND_ERROR (TIMEOUT) CLI === MCP", async () => {
    const error = new PackageIntelligenceBackendError(
      "upstream timed out",
      504,
      "TIMEOUT",
    );
    const fn = mock(() => Promise.reject(error));
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { target: "npm:express" },
      fn as never,
    );
    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      error: "upstream timed out",
    });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (unknown registry) — shape match", async () => {
    const cli = await cliJson("foobar:foo");
    const { json, isError } = await mcpJson({ target: "foobar:foo" });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: expect.any(String),
    });
    expect(json).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: expect.any(String),
    });
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(json as object).sort(),
    );
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (tag-style version) — shape match", async () => {
    const cli = await cliJson("npm:express@v4.18.0");
    const { json, isError } = await mcpJson({
      target: "npm:express@v4.18.0",
    });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect(json).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (invalid lifecycle token) — shape match", async () => {
    const cli = await cliJson("npm:express", { lifecycle: "dev" });
    const { json, isError } = await mcpJson({
      target: "npm:express",
      lifecycle: "dev",
    });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect(json).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });
});
