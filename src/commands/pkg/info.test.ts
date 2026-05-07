import { describe, expect, it, mock, spyOn } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "../../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultPackageSummary,
} from "../../services/test-helpers.js";
import { AuthRequiredError } from "../../shared/require-auth.js";
import { type PkgInfoCommandDependencies, pkgInfoAction } from "./info.js";

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
    const writes: string[] = [];
    const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      writes.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);

    await pkgInfoAction("npm:express", {}, createDeps());

    const combined = writes.join("");
    expect(combined).toContain("express @ 4.18.2 | MIT");
    expect(combined).toContain("Repository");
    expect(combined).toContain("63k stars, 14k forks, 123 issues");
    expect(combined).toContain("Vulnerabilities");
    expect(combined).not.toContain("Install");
    writeSpy.mockRestore();
  });

  it("prints the lean JSON envelope when --json is provided", async () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});

    await pkgInfoAction("npm:express", { json: true }, createDeps());

    const output = logSpy.mock.calls[0]?.[0] as string;
    const payload = JSON.parse(output);
    expect(payload.name).toBe("express");
    expect(payload.registry).toBe("npm");
    expect(payload.version).toBe("4.18.2");
    expect("install" in payload).toBe(false);
    expect("usage" in payload).toBe(false);
    logSpy.mockRestore();
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
