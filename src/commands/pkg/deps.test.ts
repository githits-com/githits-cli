import { describe, expect, it, mock, spyOn } from "bun:test";
import type { DependencyReport } from "@githits/core-internal";
import {
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockPackageIntelligenceService,
  defaultDependencyReport,
} from "../../services/test-helpers.js";
import {
  type PkgDepsCommandDependencies,
  pkgDepsAction,
  registerPkgDepsCommand,
} from "./deps.js";

describe("pkgDepsAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgDepsCommandDependencies> = {},
  ): PkgDepsCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  function issueDependencyReport(): DependencyReport {
    return {
      package: { name: "express", registry: "NPM", version: "5.2.1" },
      dependencies: {
        direct: [
          { name: "accepts", versionConstraint: "^2.0.0", type: "runtime" },
        ],
        transitive: {
          dependencyIssues: {
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
                reasons: [{ version: "1.0.0", reason: "legacy" }],
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
              {
                registry: "NPM",
                name: "alpha-duplicate",
                versions: ["1.0.0"],
              },
              {
                registry: "NPM",
                name: "beta-duplicate",
                versions: ["1.0.0"],
              },
              {
                registry: "NPM",
                name: "gamma-duplicate",
                versions: ["1.0.0"],
              },
              {
                registry: "NPM",
                name: "zeta-duplicate",
                versions: ["1.0.0"],
              },
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
          },
        },
      },
    };
  }

  it("renders the default runtime block via stdout.write", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgDepsAction("npm:express", {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("express @ 5.2.1 | npm");
    expect(combined).toContain("3 direct runtime dependencies");
    expect(combined).toContain("Runtime dependencies:");
    expect(combined).toContain(
      "Hidden groups: development - use --lifecycle all.",
    );
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is set", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgDepsAction("npm:express", { json: true }, createDeps());

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.registry).toBe("npm");
    expect(payload.runtime.count).toBe(3);
    expect(payload.groups).toBeUndefined();
    logSpy.mockRestore();
  });

  it.each([
    ["nuget:Newtonsoft.Json", "NUGET", "Newtonsoft.Json"],
    [
      "maven:org.apache.commons:commons-lang3",
      "MAVEN",
      "org.apache.commons:commons-lang3",
    ],
    ["packagist:monolog/monolog", "PACKAGIST", "monolog/monolog"],
  ] as const)(
    "accepts %s and sends the canonical backend registry",
    async (spec, expectedRegistry, expectedName) => {
      const packageDependencies = mock(() =>
        Promise.resolve(defaultDependencyReport),
      );
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      await pkgDepsAction(
        spec,
        { json: true },
        createDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageDependencies,
          }),
        }),
      );

      const calls = packageDependencies.mock.calls as unknown as Array<
        [{ registry: string; packageName: string }]
      >;
      expect(calls[0]?.[0]).toMatchObject({
        registry: expectedRegistry,
        packageName: expectedName,
      });
      logSpy.mockRestore();
    },
  );

  it("shows groups when a non-runtime lifecycle is set", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgDepsAction(
      "npm:express",
      { lifecycle: "development" },
      createDeps(),
    );

    const combined = writes.join("");
    // Under the new semantic model the groups block is additive, not
    // replacement. Direct-deps summary + list still render; groups
    // block appears beneath.
    expect(combined).toContain("direct runtime dependencies");
    expect(combined).toMatch(/\d+ groups? \(/);
    writeSpy.mockRestore();
  });

  it("sends depth=1 for default direct-deps mode", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgDepsAction(
      "npm:express",
      {},
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [
        {
          includeTransitive?: boolean;
          includeTransitiveDetails?: boolean;
          includeGroups?: boolean;
          maxDepth?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.includeTransitiveDetails).toBe(false);
    expect(calls[0]?.[0]?.includeGroups).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(1);
    writeSpy.mockRestore();
  });

  it("skips groups for default JSON deps mode", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgDepsAction(
      "npm:express",
      { json: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeGroups?: boolean }]
    >;
    expect(calls[0]?.[0]?.includeGroups).toBe(false);
    logSpy.mockRestore();
  });

  it("sends maxDepth and renders transitive output when --depth N is set", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgDepsAction(
      "npm:express",
      { depth: "5" },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [
        {
          includeTransitive?: boolean;
          includeTransitiveDetails?: boolean;
          includeGroups?: boolean;
          maxDepth?: number;
        },
      ]
    >;
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.includeTransitiveDetails).toBe(true);
    expect(calls[0]?.[0]?.includeGroups).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(5);
    writeSpy.mockRestore();
  });

  it("registers --issues and truthful verbose help", () => {
    const pkgCommand = new Command();
    const depsCommand = registerPkgDepsCommand(pkgCommand);
    const help = depsCommand.helpInformation();

    expect(depsCommand.description()).toContain("--issues");
    expect(help).toContain("--issues");
    expect(help).toContain("deprecated");
    expect(help).toContain("outdated");
    expect(help).toContain("duplicate");
    expect(help).toContain("conflict");
    expect(help).toContain("importer");
  });

  it("requests unbounded issue analysis without exposing ordinary transitive output", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(issueDependencyReport()),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgDepsAction(
      "npm:express",
      { issues: true, json: true },
      createDeps({ packageIntelligenceService: service }),
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

    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
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
    expect(payload.issues?.deprecated.count).toBe(4);
    expect(payload.issues?.outdated.count).toBe(4);
    expect(payload.issues?.duplicates.count).toBe(4);
    expect(payload.issues?.conflicts.count).toBe(4);
    logSpy.mockRestore();
  });

  it("uses --depth as the issue graph bound and exposes transitive output", async () => {
    const packageDependencies = mock(() =>
      Promise.resolve(issueDependencyReport()),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgDepsAction(
      "npm:express",
      { issues: true, depth: "4", json: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeDependencyIssues?: boolean; maxDepth?: number }]
    >;
    expect(calls[0]?.[0]?.includeDependencyIssues).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(4);
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      transitive?: unknown;
      issues?: { scope: { mode: string; maxDepth?: number } };
    };
    expect(payload.transitive).toBeDefined();
    expect(payload.issues?.scope).toEqual({
      mode: "depth_limited",
      maxDepth: 4,
    });
    logSpy.mockRestore();
  });

  it("renders compact issue evidence with the exact complete-detail hint", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const service = createMockPackageIntelligenceService({
      packageDependencies: mock(() => Promise.resolve(issueDependencyReport())),
    });

    await pkgDepsAction(
      "npm:express",
      { issues: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const output = writes.join("");
    const hint = "Use --verbose for complete issue details.";
    expect(output).toContain("Dependency issues: 16 (full graph)");
    expect(output.split(hint).length - 1).toBe(1);
    expect(output).not.toContain("zeta-deprecated");
    writeSpy.mockRestore();
  });

  it("renders every issue row in verbose mode without a truncation hint", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    const service = createMockPackageIntelligenceService({
      packageDependencies: mock(() => Promise.resolve(issueDependencyReport())),
    });

    await pkgDepsAction(
      "npm:express",
      { issues: true, verbose: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const output = writes.join("");
    expect(output).toContain("zeta-deprecated");
    expect(output).toContain("zeta-outdated");
    expect(output).toContain("zeta-duplicate");
    expect(output).toContain("zeta-conflict [1.0.0, 2.0.0]: ^1.0.0");
    expect(output).not.toContain("Use --verbose for complete issue details.");
    writeSpy.mockRestore();
  });

  it("passes the current terminal width to compact issue formatting", async () => {
    const writes: string[] = [];
    const columnsDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "columns",
    );
    Object.defineProperty(process.stdout, "columns", {
      configurable: true,
      writable: true,
      value: 36,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    try {
      await pkgDepsAction(
        "npm:express",
        { issues: true },
        createDeps({
          packageIntelligenceService: createMockPackageIntelligenceService({
            packageDependencies: mock(() =>
              Promise.resolve(issueDependencyReport()),
            ),
          }),
        }),
      );

      const output = writes.join("");
      const hint = "Use --verbose for complete issue details.";
      const issueLines = output
        .slice(output.indexOf("Dependency issues"))
        .trimEnd()
        .split("\n");
      expect(issueLines.every((line) => line.length <= 36)).toBe(true);
      expect(output).toContain("  Deprecated 4 | Outdated 4 | Dup...");
      expect(output.replace(/\s+/g, " ").split(hint).length - 1).toBe(1);
    } finally {
      writeSpy.mockRestore();
      if (columnsDescriptor) {
        Object.defineProperty(process.stdout, "columns", columnsDescriptor);
      } else {
        Reflect.deleteProperty(process.stdout, "columns");
      }
    }
  });

  it("rejects non-numeric --depth input", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction("npm:express", { depth: "abc" }, createDeps());
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("--depth expects an integer");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it.each(["3.5", "5abc", "abc5", "3.0"])(
    "rejects partially-numeric --depth input %s (no silent truncation)",
    async (input) => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      try {
        await pkgDepsAction("npm:express", { depth: input }, createDeps());
      } catch {
        /* expected */
      }

      const msg = errorSpy.mock.calls[0]?.[0] as string;
      expect(msg).toContain("--depth expects an integer");
      errorSpy.mockRestore();
      exitSpy.mockRestore();
    },
  );

  it("rejects tag-style versions with INVALID_ARGUMENT hint", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction("npm:express@v4.18.0", {}, createDeps());
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("git tag");
    expect(msg).toContain("4.18.0");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes NOT_FOUND through --json error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageDependencies: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });

    try {
      await pkgDepsAction(
        "npm:ghost",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      /* expected */
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.code).toBe("NOT_FOUND");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("enriches VERSION_NOT_FOUND terminal output with package + requested version", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageDependencies: mock(() =>
        Promise.reject(
          new PackageIntelligenceVersionNotFoundError(
            "No matching version found",
            "npm:express",
            "99.0.0",
            undefined,
          ),
        ),
      ),
    });

    try {
      await pkgDepsAction(
        "npm:express@99.0.0",
        {},
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("No matching version found");
    expect(msg).toContain("package:   npm:express");
    expect(msg).toContain("requested: 99.0.0");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError before calling service when unauthenticated", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const packageDependencies = mock(() =>
      Promise.resolve(defaultDependencyReport),
    );
    const service = createMockPackageIntelligenceService({
      packageDependencies,
    });

    await expect(
      pkgDepsAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: service,
          hasValidToken: false,
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(packageDependencies).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("errors when pkgseer URL / service are missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: undefined,
          codeNavigationUrl: undefined,
        }),
      );
    } catch {
      /* expected */
    }

    expect(errorSpy.mock.calls[0]?.[0]).toContain("not configured");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
