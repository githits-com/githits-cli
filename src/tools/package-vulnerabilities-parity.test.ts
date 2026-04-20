// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable,
//                          details? } on every error path; MCP error text is
//                          always valid JSON.
//
// Assertion policy (locked in the P2 plan; matches shipped
// search_symbols / package_summary precedent):
//   - Service-sourced success and error fixtures use `toEqual`: both
//     surfaces route through the same classifier / envelope builder,
//     so envelopes are byte-identical.
//   - `INVALID_ARGUMENT` fixture uses `toMatchObject`: CLI rejects
//     unsupported registries in `buildPackageVulnerabilitiesParams`
//     (via `parsePackageSpec` for the first leg, then
//     `supportsVulnerabilitiesRegistry`); MCP rejects in the same
//     builder via the in-handler pattern. Same envelope shape,
//     potentially surface-specific error text.
//
// Fixture count: ten (eight `toEqual` + two `toMatchObject`).

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgVulnsCommandDependencies,
  pkgVulnsAction,
} from "../commands/pkg/vulns.js";
import type { VulnerabilityReport } from "../services/index.js";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultVulnerabilityReport,
} from "../services/test-helpers.js";
import { createPackageVulnerabilitiesTool } from "./package-vulnerabilities.js";

function cliDeps(
  overrides: Partial<PkgVulnsCommandDependencies> = {},
): PkgVulnsCommandDependencies {
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
  options: Parameters<typeof pkgVulnsAction>[1] = {},
  deps: PkgVulnsCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgVulnsAction(spec, { ...options, json: true }, deps);
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
    min_severity?: string;
    include_withdrawn?: boolean;
  },
  packageVulnerabilitiesMock?: () => Promise<VulnerabilityReport>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageVulnerabilitiesMock
      ? { packageVulnerabilities: packageVulnerabilitiesMock as never }
      : {},
  );
  const tool = createPackageVulnerabilitiesTool(service);
  const result = await tool.handler(args, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

function zeroVulnsReport(): VulnerabilityReport {
  return {
    package: { name: "clean", registry: "NPM", version: "1.0.0" },
    security: {
      vulnerabilityCount: 0,
      currentVersionAffected: false,
      upgradePaths: [],
      vulnerabilities: [],
    },
  };
}

describe("package_vulnerabilities parity", () => {
  it("PARITY-JSON-KEYS: happy path CLI === MCP", async () => {
    const cli = await cliJson("npm:express");
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
    });
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: zero-vulns hot path CLI === MCP", async () => {
    const zeroFn = mock(() => Promise.resolve(zeroVulnsReport()));
    const cli = await cliJson(
      "npm:clean",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: zeroFn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "clean" },
      zeroFn as never,
    );
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: filtered success CLI === MCP", async () => {
    // Simulate the backend returning a filter-aware count: only the
    // high and critical advisories (2 total) plus the malware one
    // (included because a null severity + isMalicious still counts
    // as malware, not below-threshold) — a filter typically returns
    // just banded advisories above the threshold.
    const sourceAdvisories =
      defaultVulnerabilityReport.security?.vulnerabilities ?? [];
    const critAdvisory = sourceAdvisories[1];
    const highAdvisory = sourceAdvisories[2];
    if (!critAdvisory || !highAdvisory) {
      throw new Error(
        "fixture setup: expected at least 3 advisories in default report",
      );
    }
    const filteredReport: VulnerabilityReport = {
      package: { name: "express", registry: "NPM", version: "4.18.0" },
      security: {
        vulnerabilityCount: 2,
        currentVersionAffected: true,
        upgradePaths: ["4.18.2"],
        vulnerabilities: [critAdvisory, highAdvisory],
      },
    };
    const fn = mock(() => Promise.resolve(filteredReport));
    const cli = await cliJson(
      "npm:express",
      { severity: "high" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", min_severity: "high" },
      fn as never,
    );
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: versioned success (caller and backend match) CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultVulnerabilityReport));
    const cli = await cliJson(
      "npm:express@4.18.0",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", version: "4.18.0" },
      fn as never,
    );
    expect(cli).toEqual(json);
    // Both surfaces should omit requestedVersion.
    expect(
      (cli as { requestedVersion?: string }).requestedVersion,
    ).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: versioned real diff surfaces requestedVersion on both surfaces", async () => {
    // Fixture where the backend resolves a "4.17" tag to concrete
    // "4.17.2"; the requestedVersion echoes the caller's input.
    const resolvedReport: VulnerabilityReport = {
      package: { name: "express", registry: "NPM", version: "4.17.2" },
      security: {
        vulnerabilityCount: 0,
        currentVersionAffected: false,
        upgradePaths: [],
        vulnerabilities: [],
      },
    };
    const fn = mock(() => Promise.resolve(resolvedReport));
    const cli = await cliJson(
      "npm:express@4.17",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: fn as never,
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
          packageVulnerabilities: fn as never,
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
      ["4.18.2", "4.18.1"],
    );
    const fn = mock(() => Promise.reject(error));
    const cli = await cliJson(
      "npm:express@99.0.0",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", version: "99.0.0" },
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
          { version: "4.18.2", ref: "4.18.2" },
          { version: "4.18.1", ref: "4.18.1" },
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
          packageVulnerabilities: fn as never,
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

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (unsupported registry) — shape match via toMatchObject", async () => {
    // CLI: parsePackageSpec accepts vcpkg (it's a known registry),
    // then buildPackageVulnerabilitiesParams rejects via the tool-
    // local predicate. MCP: schema is permissive; the same builder
    // runs in-handler and rejects. Same envelope shape, identical
    // error text because the message is a literal string in the
    // builder.
    const cli = await cliJson("vcpkg:foo");
    const { json, isError } = await mcpJson({
      registry: "vcpkg",
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

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (tag-style version) — shape match via toMatchObject", async () => {
    const cli = await cliJson("npm:express@v4.18.0");
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
      version: "v4.18.0",
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

  it("PARITY-PERMISSIVE-SCHEMA: uppercase min_severity input is tolerated on both surfaces (envelope parity)", async () => {
    // Permissive schema + in-handler validation means uppercase
    // severity input flows through buildPackageVulnerabilitiesParams
    // on both surfaces. CLI: parses via resolveMinSeverity. MCP:
    // schema is z.string(), validation delegated to the builder.
    // Both should succeed and emit the same success envelope; no
    // raw Zod error surfaces on either side.
    const fn = mock(() => Promise.resolve(defaultVulnerabilityReport));
    const cli = await cliJson(
      "npm:express",
      { severity: "CRITICAL" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageVulnerabilities: fn as never,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { registry: "npm", package_name: "express", min_severity: "CRITICAL" },
      fn as never,
    );
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
  });

  it("PARITY-PERMISSIVE-SCHEMA: invalid min_severity label produces INVALID_ARGUMENT envelope on both surfaces", async () => {
    // "severe" is not a known label. Both surfaces should reject
    // via the in-handler builder with a structured envelope; neither
    // should surface a raw Zod error.
    const cli = await cliJson("npm:express", { severity: "severe" });
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
      min_severity: "severe",
    });
    expect(isError).toBe(true);
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(json).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
  });
});
