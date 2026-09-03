import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  AuthenticationError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import { AuthRequiredError } from "@githits/mcp/internal";
import { Command } from "commander";
import {
  createMockPackageIntelligenceService,
  defaultPackageSummary,
} from "../../services/test-helpers.js";
import {
  type PkgInfoCommandDependencies,
  pkgInfoAction,
  registerPkgInfoCommand,
} from "./info.js";

describe("pkg info help", () => {
  it("describes latest and package-wide advisory evidence plus verbose metadata", () => {
    const command = registerPkgInfoCommand(new Command().command("pkg"));
    const rawHelp = command.helpInformation();
    const help = rawHelp.replace(/\s+/g, " ");

    expect(help).toContain("latest affected count");
    expect(help).toContain("package-wide advisory history count");
    expect(help).toContain("separate package-wide advisory");
    expect(help).toContain("published-version count");
    expect(help).toContain("download refresh date");
    expect(help).toContain("advisory history");
    expect(help).toContain("advisory history (all versions)");
    expect(help).toContain("history (all versions), and recent changes");
    expect(
      rawHelp
        .split("\n")
        .some((line) => line.trim() === "history (all versions),"),
    ).toBe(false);
    expect(help).toContain("githits pkg vulns <registry>:<name> --scope all");
  });
});

describe("pkgInfoAction", () => {
  const mcpUrl = "https://mcp.githits.com";

  function createDeps(
    overrides: Partial<PkgInfoCommandDependencies> = {},
  ): PkgInfoCommandDependencies {
    return {
      packageIntelligenceService: createMockPackageIntelligenceService(),
      codeNavigationUrl: "https://pkgseer.dev",
      hasValidToken: true,
      mcpUrl,
      ...overrides,
    };
  }

  it("renders the default terminal block via stdout.write", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgInfoAction(
      "npm:express",
      {},
      createDeps({ packageIntelligenceService: service }),
    );

    const combined = writes.join("");
    expect(combined).toContain("express @ 4.18.2 | MIT");
    expect(combined).toContain("Repository");
    expect(combined).toContain("63k stars, 14k forks, 123 issues");
    expect(combined).toContain("Vulnerabilities");
    expect(combined).not.toContain("advisory_scope");
    expect(combined).not.toContain("Install");
    const calls = packageSummary.mock.calls as unknown as Array<
      [{ includeVerboseFields: boolean }]
    >;
    expect(calls[0]?.[0]?.includeVerboseFields).toBe(false);
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is provided", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgInfoAction(
      "npm:express",
      { json: true },
      createDeps({ packageIntelligenceService: service }),
    );

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.name).toBe("express");
    expect(payload.registry).toBe("npm");
    expect(payload.version).toBe("4.18.2");
    expect(payload.versionCount).toBe(214);
    expect(payload.downloads.refreshedAt).toBe("2024-06-15");
    expect(payload.advisoryHistory).toEqual({ total: 5 });
    expect("install" in payload).toBe(false);
    expect("usage" in payload).toBe(false);
    const calls = packageSummary.mock.calls as unknown as Array<
      [{ includeVerboseFields: boolean }]
    >;
    expect(calls[0]?.[0]?.includeVerboseFields).toBe(true);
    logSpy.mockRestore();
  });

  it("requests verbose fields for --verbose text", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgInfoAction(
      "npm:express",
      { verbose: true },
      createDeps({ packageIntelligenceService: service }),
    );

    expect(writes.join("")).toContain("214 published");
    expect(writes.join("")).toContain("refreshed 2024-06-15");
    const calls = packageSummary.mock.calls as unknown as Array<
      [{ includeVerboseFields: boolean }]
    >;
    expect(calls[0]?.[0]?.includeVerboseFields).toBe(true);
    writeSpy.mockRestore();
  });

  it("uses CLI-specific history guidance without leaking MCP syntax", async () => {
    const summary = structuredClone(defaultPackageSummary);
    summary.security = {
      vulnerabilityCount: 0,
      allVulnerabilityCount: 5,
      hasCurrentVulnerabilities: false,
      recentVulnerabilities: [],
    };
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.resolve(summary)),
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

    await pkgInfoAction(
      "npm:express",
      {},
      createDeps({ packageIntelligenceService: service }),
    );
    const output = writes.join("");
    expect(output).toContain(
      "Inspect history: githits pkg vulns npm:express --scope all",
    );
    expect(output).not.toContain("advisory_scope");
    writeSpy.mockRestore();
  });

  it("rejects @version with INVALID_ARGUMENT — non-JSON path writes stderr and exits 1", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgInfoAction("npm:express@4.18.0", {}, createDeps());
    } catch {
      // expected process.exit throw
    }

    const combined = errorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(combined).toContain(
      "pkg info always returns the latest version; omit @4.18.0.",
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("rejects @version with INVALID_ARGUMENT — --json path emits the envelope to stderr", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgInfoAction("npm:express@4.18.0", { json: true }, createDeps());
    } catch {
      // expected process.exit throw
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.retryable).toBe(false);
    expect(payload.error).toBe(
      "pkg info always returns the latest version; omit @4.18.0.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("classifies backend errors via mapPackageIntelligenceError", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError(
            "Package 'npm:ghost' not found.",
          ),
        ),
      ),
    });

    try {
      await pkgInfoAction(
        "npm:ghost",
        {},
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    expect(errorSpy.mock.calls[0]?.[0]).toBe("Package 'npm:ghost' not found.");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("routes service classification through --json error envelope", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() =>
        Promise.reject(
          new PackageIntelligenceTargetNotFoundError("Package not found"),
        ),
      ),
    });

    try {
      await pkgInfoAction(
        "npm:ghost",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    const output = errorSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.error).toBe("Package not found");
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI auth remediation for service auth failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.reject(new AuthenticationError())),
    });

    try {
      await pkgInfoAction(
        "npm:express",
        {},
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    expect(errorSpy.mock.calls[0]?.[0]).toBe(
      "Authentication required. Run `githits login` to authenticate or set GITHITS_API_TOKEN.",
    );
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves CLI auth remediation in JSON service auth failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.reject(new AuthenticationError())),
    });

    try {
      await pkgInfoAction(
        "npm:express",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toEqual({
      error: "Authentication required.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "local" },
    });
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("preserves server auth rejection source in JSON service auth failures", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const service = createMockPackageIntelligenceService({
      packageSummary: mock(() =>
        Promise.reject(
          new AuthenticationError(
            "GitHits could not accept the authentication token.",
            "server",
          ),
        ),
      ),
    });

    try {
      await pkgInfoAction(
        "npm:express",
        { json: true },
        createDeps({ packageIntelligenceService: service }),
      );
    } catch {
      // expected
    }

    expect(JSON.parse(errorSpy.mock.calls[0]?.[0] as string)).toEqual({
      error: "GitHits could not accept the authentication token.",
      code: "AUTH_REQUIRED",
      retryable: false,
      details: { authSource: "server" },
    });
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("throws AuthRequiredError before calling the service when unauthenticated", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({ packageSummary });

    await expect(
      pkgInfoAction(
        "npm:express",
        {},
        createDeps({
          packageIntelligenceService: service,
          hasValidToken: false,
        }),
      ),
    ).rejects.toThrow(AuthRequiredError);

    expect(packageSummary).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("errors when pkgseer URL / service are missing", async () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await pkgInfoAction(
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
