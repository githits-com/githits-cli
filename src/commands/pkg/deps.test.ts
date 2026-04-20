import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "../../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultDependencyReport,
} from "../../services/test-helpers.js";
import { AuthRequiredError } from "../../shared/require-auth.js";
import { type PkgDepsCommandDependencies, pkgDepsAction } from "./deps.js";

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
    expect(combined).toContain("express @ 5.2.1 · npm");
    expect(combined).toContain("3 direct runtime dependencies");
    expect(combined).toContain("Hidden groups: development — use --groups.");
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is set", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgDepsAction("npm:express", { json: true }, createDeps());

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.registry).toBe("npm");
    expect(payload.runtime.count).toBe(3);
    expect(payload.groups.items.length).toBe(2);
    logSpy.mockRestore();
  });

  it("implies --groups when --lifecycle is set (groups block appears beneath direct deps list)", async () => {
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

  it("sends undefined maxDepth when --transitive is set without --depth (backend's full-graph default applies)", async () => {
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
      { transitive: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeTransitive?: boolean; maxDepth?: number }]
    >;
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBeUndefined();
    writeSpy.mockRestore();
  });

  it("sends maxDepth when --transitive --depth N are both set", async () => {
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
      { transitive: true, depth: "5" },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageDependencies.mock.calls as unknown as Array<
      [{ includeTransitive?: boolean; maxDepth?: number }]
    >;
    expect(calls[0]?.[0]?.includeTransitive).toBe(true);
    expect(calls[0]?.[0]?.maxDepth).toBe(5);
    writeSpy.mockRestore();
  });

  it("rejects non-numeric --depth input", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction(
        "npm:express",
        { transitive: true, depth: "abc" },
        createDeps(),
      );
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("--depth expects an integer");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it.each([
    "3.5",
    "5abc",
    "abc5",
    "3.0",
  ])("rejects partially-numeric --depth input %s (no silent truncation)", async (input) => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction(
        "npm:express",
        { transitive: true, depth: input },
        createDeps(),
      );
    } catch {
      /* expected */
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("--depth expects an integer");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects unsupported registry (nuget) with tool-specific message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgDepsAction("nuget:Newtonsoft.Json", {}, createDeps());
    } catch {
      /* expected */
    }

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "pkg deps only supports npm, pypi, hex, crates, vcpkg, and zig. Got: nuget.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

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
