// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable, details? }
//                          on every error path; MCP error text is always valid
//                          JSON.
//
// Assertion policy:
//   - Success fixtures + service-sourced error fixtures → `toEqual`.
//     Both surfaces route through the same classifier / envelope builder,
//     so envelopes are byte-identical.
//   - INVALID_ARGUMENT fixture (empty `packageName`) → `toMatchObject`.
//     CLI rejects in `parsePackageSpec` / `buildPackageSummaryParams`;
//     MCP rejects in `buildPackageSummaryParams` inside the handler
//     (schema is permissive). Both land on INVALID_ARGUMENT with
//     `retryable: false`, but the surface-specific validator produces
//     different `error` text — that divergence is intentional.
//
// Rule IDs are stable; changes to either this test or the parity doc
// are coordinated.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import {
  type PkgInfoCommandDependencies,
  pkgInfoAction,
} from "../commands/pkg/info.js";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createPackageSummaryTool } from "./package-summary.js";
import { isProcessExitSentinel } from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<PkgInfoCommandDependencies> = {},
): PkgInfoCommandDependencies {
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
  deps: PkgInfoCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgInfoAction(spec, { json: true }, deps);
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
  args: { registry: string; package_name: string },
  packageSummaryMock?: () => Promise<unknown>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageSummaryMock ? { packageSummary: packageSummaryMock as never } : {},
  );
  const tool = createPackageSummaryTool(service);
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return {
    json: JSON.parse(text),
    isError: result.isError,
  };
}

describe("package_summary parity", () => {
  it("PARITY-JSON-KEYS: happy path CLI === MCP", async () => {
    const cli = await cliJson("npm:express");
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "express",
    });
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
  });

  it("PARITY-JSON-KEYS: minimal-fields success CLI === MCP", async () => {
    const minimal = {
      package: {
        name: "obscure",
        latestVersion: "0.0.1",
      },
    };
    const packageSummary = mock(() => Promise.resolve(minimal));
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });

    const cli = await cliJson(
      "npm:obscure",
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "obscure" },
      packageSummary as never,
    );

    expect(cli).toEqual(json);
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND CLI === MCP", async () => {
    const error = new PackageIntelligenceTargetNotFoundError(
      "Package 'npm:ghost' not found.",
    );
    const packageSummary = mock(() => Promise.reject(error));
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });

    const cli = await cliJson(
      "npm:ghost",
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { registry: "npm", package_name: "ghost" },
      packageSummary as never,
    );

    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(cli).toEqual({
      error: "Package 'npm:ghost' not found.",
      code: "NOT_FOUND",
      retryable: false,
    });
  });

  it("PARITY-ERROR-ENVELOPE: BACKEND_ERROR CLI === MCP", async () => {
    const error = new PackageIntelligenceBackendError(
      "upstream timed out",
      504,
      "TIMEOUT",
    );
    const packageSummary = mock(() => Promise.reject(error));
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });

    const cli = await cliJson(
      "npm:express",
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { registry: "npm", package_name: "express" },
      packageSummary as never,
    );

    expect(isError).toBe(true);
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      code: "TIMEOUT",
      retryable: true,
      error: "upstream timed out",
    });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (empty packageName) — shape match via toMatchObject", async () => {
    // CLI: parsePackageSpec rejects the bare "npm:" (no name) via
    // InvalidPackageSpecError. MCP: buildPackageSummaryParams rejects
    // the empty package_name with InvalidPackageSpecError too. The
    // two surfaces share the classifier but produce different error
    // text — same shape, different message.
    const cli = await cliJson("npm:");
    const { json, isError } = await mcpJson({
      registry: "npm",
      package_name: "",
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
    // Both envelopes must contain the same recognisable shape even
    // when the wording differs.
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(json as object).sort(),
    );
  });
});
