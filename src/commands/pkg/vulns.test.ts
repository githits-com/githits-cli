import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockPackageIntelligenceService,
  defaultVulnerabilityReport,
} from "../../services/test-helpers.js";
import {
  type PkgVulnsCommandDependencies,
  pkgVulnsAction,
  registerPkgVulnsCommand,
} from "./vulns.js";

function transitiveVulnerabilityReport() {
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

describe("pkg vulns help", () => {
  it("registers --transitive with truthful opt-in guidance", () => {
    const command = registerPkgVulnsCommand(new Command().command("pkg"));
    const help = command.helpInformation();
    expect(help).toContain("--transitive");
    expect(command.description()).toContain(
      "npm-audit-style evidence covering vulnerabilities in versions",
    );
    expect(command.description()).toContain("adds graph-analysis cost");
    expect(command.description()).toContain(
      "--scope and --include-withdrawn affect direct package rows only",
    );
  });
});

describe("pkgVulnsAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgVulnsCommandDependencies> = {},
  ): PkgVulnsCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("renders the default terminal block via stdout.write", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgVulnsAction("npm:express", {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("express @ 4.18.0 | npm");
    expect(combined).toContain("6 vulnerabilities affect this version");
    expect(combined).toContain("MALWARE");
    expect(combined).toContain("Fix version: 4.18.2.");
    expect(combined).toContain("... (+1 more; use -v)");
    writeSpy.mockRestore();
  });

  it("--verbose renders all advisory rows", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgVulnsAction("npm:express", { verbose: true }, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("GHSA-nnnn-nnnn-nnnn");
    expect(combined).not.toContain("... (+1 more; use -v)");
    writeSpy.mockRestore();
  });

  it.each([undefined, false, true] as const)(
    "passes transitive=%s to the service without changing direct filters",
    async (transitive) => {
      const packageVulnerabilities = mock(() =>
        Promise.resolve(defaultVulnerabilityReport),
      );
      const service = createMockPackageIntelligenceService({
        packageVulnerabilities,
      });
      const writeSpy = spyOn(process.stdout, "write").mockImplementation(
        (() => true) as typeof process.stdout.write,
      );

      await pkgVulnsAction(
        "npm:express",
        {
          severity: "high",
          scope: "all",
          includeWithdrawn: true,
          ...(transitive === undefined ? {} : { transitive }),
        },
        createDeps({ packageIntelligenceService: service }),
      );

      const params = (
        packageVulnerabilities.mock.calls as unknown as Array<
          [
            {
              minSeverity?: number;
              advisoryScope?: string;
              includeWithdrawn?: boolean;
              includeTransitive?: boolean;
            },
          ]
        >
      )[0]?.[0] as {
        minSeverity?: number;
        advisoryScope?: string;
        includeWithdrawn?: boolean;
        includeTransitive?: boolean;
      };
      expect(params).toMatchObject({
        minSeverity: 7.0,
        advisoryScope: "ALL",
        includeWithdrawn: true,
      });
      expect(params.includeTransitive).toBe(transitive);
      writeSpy.mockRestore();
    },
  );

  it("renders and emits the additive transitive audit for --transitive", async () => {
    const report = transitiveVulnerabilityReport();
    const packageVulnerabilities = mock(() => Promise.resolve(report));
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (chunk: string | Uint8Array) => {
        writes.push(
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
        );
        return true;
      },
    );

    await pkgVulnsAction(
      "npm:express",
      { transitive: true, verbose: true },
      createDeps({ packageIntelligenceService: service }),
    );
    expect(writes.join("")).toContain("Resolved dependencies");
    expect(writes.join("")).toContain("body-parser@1.19.0");
    expect(writes.join("")).toContain("higher fixes 2.0.0");
    expect(
      (
        packageVulnerabilities.mock.calls as unknown as Array<
          [Record<string, unknown>]
        >
      )[0]?.[0],
    ).toMatchObject({
      includeTransitive: true,
    });
    writeSpy.mockRestore();

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgVulnsAction(
      "npm:express",
      { transitive: true, json: true },
      createDeps({ packageIntelligenceService: service }),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      transitive?: { packages: Array<{ name: string }> };
    };
    expect(payload.transitive?.packages[0]?.name).toBe("body-parser");
    logSpy.mockRestore();
  });

  it("passes combined filters through and preserves transitive withdrawal semantics", async () => {
    const report = transitiveVulnerabilityReport();
    report.transitive = {
      totalPackagesAnalyzed: 0,
      affectedPackageCount: 0,
      affectedOccurrenceCount: 0,
      packages: [],
    };
    const packageVulnerabilities = mock(() => Promise.resolve(report));
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgVulnsAction(
      "npm:express",
      {
        severity: "HIGH",
        scope: "all",
        includeWithdrawn: true,
        transitive: true,
        json: true,
      },
      createDeps({ packageIntelligenceService: service }),
    );
    const params = (
      packageVulnerabilities.mock.calls as unknown as Array<
        [Record<string, unknown>]
      >
    )[0]?.[0] as {
      registry: string;
      packageName: string;
      version?: string;
      minSeverity?: number;
      advisoryScope?: string;
      includeWithdrawn?: boolean;
      includeTransitive?: boolean;
    };
    expect(params).toEqual({
      registry: "NPM",
      packageName: "express",
      version: undefined,
      minSeverity: 7.0,
      includeWithdrawn: true,
      includeTransitive: true,
      advisoryScope: "ALL",
    });
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string) as {
      filter?: unknown;
      transitive?: { withdrawnAdvisoriesIncluded: boolean };
    };
    expect(payload.filter).toEqual({
      minSeverity: "high",
      advisoryScope: "all",
      includeWithdrawn: true,
    });
    expect(payload.transitive?.withdrawnAdvisoriesIncluded).toBe(false);
    logSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is set", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgVulnsAction("npm:express", { json: true }, createDeps());

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.name).toBe("express");
    expect(payload.summary.total).toBe(6);
    expect(payload.summary.bySeverity.malware).toBe(1);
    logSpy.mockRestore();
  });

  it("--json --verbose matches --json", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgVulnsAction("npm:express", { json: true }, createDeps());
    await pkgVulnsAction(
      "npm:express",
      { json: true, verbose: true },
      createDeps(),
    );

    expect(JSON.parse(logSpy.mock.calls[1]?.[0] as string)).toEqual(
      JSON.parse(logSpy.mock.calls[0]?.[0] as string),
    );
    logSpy.mockRestore();
  });

  it("echoes filters in terminal text and JSON", async () => {
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgVulnsAction(
      "npm:express",
      { severity: "HIGH", includeWithdrawn: true },
      createDeps(),
    );

    const combined = writes.join("");
    expect(combined).toContain("Filter  severity >= high");
    expect(combined).toContain("Filter  include withdrawn");
    writeSpy.mockRestore();

    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    await pkgVulnsAction(
      "npm:express",
      { severity: "HIGH", includeWithdrawn: true, json: true },
      createDeps(),
    );
    const payload = JSON.parse(logSpy.mock.calls[0]?.[0] as string);
    expect(payload.filter).toEqual({
      minSeverity: "high",
      includeWithdrawn: true,
    });
    logSpy.mockRestore();
  });

  it("passes --scope through and echoes it", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgVulnsAction(
      "npm:express",
      { scope: "non_affecting" },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [{ advisoryScope?: string }]
    >;
    expect(calls[0]?.[0]?.advisoryScope).toBe("NON_AFFECTING");
    expect(writes.join("")).toContain("Scope   historical advisories only");
    writeSpy.mockRestore();
  });

  it("passes version from spec to the service", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgVulnsAction(
      "npm:express@4.17.0",
      {},
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [{ version?: string }]
    >;
    expect(calls[0]?.[0]?.version).toBe("4.17.0");
    writeSpy.mockRestore();
  });

  it("passes --severity → minSeverity float on the wire", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgVulnsAction(
      "npm:express",
      { severity: "high" },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [{ minSeverity?: number }]
    >;
    expect(calls[0]?.[0]?.minSeverity).toBe(7.0);
    writeSpy.mockRestore();
  });

  it("tolerates uppercase --severity input", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgVulnsAction(
      "npm:express",
      { severity: "CRITICAL" },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [{ minSeverity?: number }]
    >;
    expect(calls[0]?.[0]?.minSeverity).toBe(9.0);
    writeSpy.mockRestore();
  });

  it("passes --include-withdrawn through to the wire", async () => {
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await pkgVulnsAction(
      "npm:express",
      { includeWithdrawn: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const calls = packageVulnerabilities.mock.calls as unknown as Array<
      [{ includeWithdrawn?: boolean }]
    >;
    expect(calls[0]?.[0]?.includeWithdrawn).toBe(true);
    writeSpy.mockRestore();
  });

  it("rejects unsupported registry (vcpkg) client-side with bare message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgVulnsAction("vcpkg:foo", {}, createDeps());
    } catch {
      // expected exit
    }

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "pkg vulns only supports npm, pypi, hex, crates, nuget, maven, packagist, rubygems, go, and swift. Got: vcpkg.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects bad --severity label with INVALID_ARGUMENT", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgVulnsAction("npm:express", { severity: "severe" }, createDeps());
    } catch {
      // expected
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("Unsupported severity 'severe'");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects tag-style versions with an actionable INVALID_ARGUMENT message", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgVulnsAction("npm:express@v4.18.0", {}, createDeps());
    } catch {
      // expected
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("Invalid version 'v4.18.0'");
    expect(msg).toContain("without a leading 'v'");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes service NOT_FOUND through --json error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });

    try {
      await pkgVulnsAction(
        "npm:ghost",
        { json: true, transitive: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
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
      packageVulnerabilities: mock(() =>
        Promise.reject(
          new PackageIntelligenceVersionNotFoundError(
            "No matching version found",
            "npm:lodash",
            "99.99.99",
            undefined,
          ),
        ),
      ),
    });

    try {
      await pkgVulnsAction(
        "npm:lodash@99.99.99",
        {},
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected exit
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("No matching version found");
    expect(msg).toContain("package:   npm:lodash");
    expect(msg).toContain("requested: 99.99.99");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("includes available-versions sample line when backend returns them", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageVulnerabilities: mock(() =>
        Promise.reject(
          new PackageIntelligenceVersionNotFoundError(
            "No matching version found",
            "express",
            "99.0.0",
            ["4.18.2", "4.18.1", "4.18.0", "4.17.4", "4.17.3", "4.17.2"],
          ),
        ),
      ),
    });

    try {
      await pkgVulnsAction(
        "npm:express@99.0.0",
        {},
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected exit
    }

    const msg = errorSpy.mock.calls[0]?.[0] as string;
    expect(msg).toContain("available: 4.18.2, 4.18.1, 4.18.0, 4.17.4, 4.17.3");
    expect(msg).toContain("(+1 more)");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError before calling service when unauthenticated", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const packageVulnerabilities = mock(() =>
      Promise.resolve(defaultVulnerabilityReport),
    );
    const service = createMockPackageIntelligenceService({
      packageVulnerabilities,
    });

    await expect(
      pkgVulnsAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: service,
          hasValidToken: false,
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(packageVulnerabilities).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("errors when pkgseer URL / service are missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgVulnsAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: undefined,
          codeNavigationUrl: undefined,
        }),
      );
    } catch {
      // expected
    }

    const combined = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(combined).toContain("Package intelligence is not configured");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
