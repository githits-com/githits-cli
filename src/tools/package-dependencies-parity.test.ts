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
//     shaper, so envelopes are byte-identical.
//   - `INVALID_ARGUMENT` fixtures use `toMatchObject`: CLI rejects
//     in `buildPackageDependenciesParams` after `parsePackageSpec`;
//     MCP rejects in the same builder via the in-handler pattern.
//     Same envelope shape, surface-specific error text.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgDepsCommandDependencies,
  pkgDepsAction,
} from "../commands/pkg/deps.js";
import type { DependencyReport } from "../services/index.js";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "../services/index.js";
import {
  cratesFeatureDependencyReport,
  createMockPackageIntelligenceService,
  defaultDependencyReport,
  zeroDepDependencyReport,
} from "../services/test-helpers.js";
import { createPackageDependenciesTool } from "./package-dependencies.js";

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
    } catch {
      // CLI error paths call process.exit — caught.
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
    registry: string;
    package_name: string;
    version?: string;
    lifecycle?: string;
    include_transitive?: boolean;
    include_importers?: boolean;
    max_depth?: number;
  },
  packageDependenciesMock?: () => Promise<DependencyReport>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageDependenciesMock
      ? { packageDependencies: packageDependenciesMock as never }
      : {},
  );
  const tool = createPackageDependenciesTool(service);
  const result = await tool.handler(args, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

describe("package_dependencies parity", () => {
  it("PARITY-JSON-KEYS: happy flat-runtime CLI === MCP", async () => {
    const cli = await cliJson("npm:express");
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
    });
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
  });

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
    const { json } = await mcpJson(
      { registry: "npm", package_name: "left-pad" },
      zeroFn as never,
    );
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
      { registry: "npm", package_name: "express", lifecycle: "all" },
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
        registry: "crates",
        package_name: "tokio",
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
        registry: "npm",
        package_name: "express",
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
        registry: "npm",
        package_name: "express",
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
      { registry: "crates", package_name: "tokio", lifecycle: "all" },
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

  it("PARITY-JSON-KEYS: include_transitive CLI === MCP (preprocessed packages[], no raw dag)", async () => {
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
      { transitive: true, verbose: true },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        registry: "npm",
        package_name: "express",
        include_transitive: true,
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

  it("PARITY-JSON-KEYS: include_transitive defaults to lean packages (no importers) on both surfaces", async () => {
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
      { transitive: true },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageDependencies: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      {
        registry: "npm",
        package_name: "express",
        include_transitive: true,
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
      { registry: "npm", package_name: "express", version: "5.2.1" },
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
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", version: "4.17" },
      fn as never,
    );
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
      { registry: "npm", package_name: "ghost" },
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

  it("PARITY-ERROR-ENVELOPE: VERSION_NOT_FOUND with structured details CLI === MCP", async () => {
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
        registry: "npm",
        package_name: "express",
        version: "99.0.0",
      },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      code: "VERSION_NOT_FOUND",
      retryable: false,
      details: {
        package: "npm:express",
        requestedVersion: "99.0.0",
        availableVersions: [
          { version: "5.2.1", ref: "5.2.1" },
          { version: "5.2.0", ref: "5.2.0" },
        ],
      },
    });
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
      { registry: "npm", package_name: "express" },
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

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (unsupported registry) — shape match", async () => {
    const cli = await cliJson("nuget:foo");
    const { json, isError } = await mcpJson({
      registry: "nuget",
      package_name: "foo",
    });
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
      registry: "npm",
      package_name: "express",
      version: "v4.18.0",
    });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect(json).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (invalid lifecycle token) — shape match", async () => {
    const cli = await cliJson("npm:express", { lifecycle: "dev" });
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
      lifecycle: "dev",
    });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect(json).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
  });
});
