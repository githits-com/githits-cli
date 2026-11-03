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
//   - INVALID_ARGUMENT fixture (missing package name) → `toEqual`.
//     Both surfaces reject the same `npm:` input through `parsePackageSpec`,
//     then share the builder and latest-only pin validation.
//
// Rule IDs are stable; changes to either this test or the parity doc
// are coordinated.

import { describe, expect, it, mock, spyOn } from "bun:test";
import type { PackageIntelligenceService } from "@githits/core-internal";
import {
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import {
  type PkgInfoCommandDependencies,
  pkgInfoAction,
} from "../commands/pkg/info.js";
import {
  createMockPackageIntelligenceService,
  defaultPackageSummary,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

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
  args: { target: string },
  packageSummaryMock?: () => Promise<unknown>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageSummaryMock ? { packageSummary: packageSummaryMock as never } : {},
  );
  const tool = createParityMcpTool("pkg_info", {
    packageIntelligenceService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return {
    json: JSON.parse(text),
    isError: result.isError,
  };
}

describe("package_summary parity", () => {
  it.each([
    ["positive", 12_345],
    ["zero", 0],
    ["unknown", undefined],
  ] as const)(
    "Pub preserves native-case identity and %s monthly counts in CLI/MCP JSON",
    async (_label, downloadsLastMonth) => {
      const packageName = "CaseSensitivePubPackage";
      const summary = structuredClone(defaultPackageSummary);
      summary.package.name = packageName;
      summary.package.registry = "PUB";
      summary.package.downloadsLastMonth = downloadsLastMonth;
      const packageSummary = mock(
        (
          _params?: Parameters<PackageIntelligenceService["packageSummary"]>[0],
        ) => Promise.resolve(summary),
      );
      const service = createMockPackageIntelligenceService({
        packageSummary: packageSummary as never,
      });

      const cli = await cliJson(
        `pub:${packageName}`,
        cliDeps({ packageIntelligenceService: service }),
      );
      const { json, isError } = await mcpJson(
        { target: `pub:${packageName}` },
        packageSummary as never,
      );

      expect(isError).toBeUndefined();
      expect(packageSummary).toHaveBeenCalledTimes(2);
      expect(packageSummary.mock.calls).toEqual([
        [
          {
            registry: "PUB",
            packageName,
            includeVerboseFields: true,
          },
        ],
        [
          {
            registry: "PUB",
            packageName,
            includeVerboseFields: true,
          },
        ],
      ]);
      expect(cli).toEqual(json);
      expect(cli).toMatchObject({
        registry: "pub",
        name: packageName,
      });
      const cliDownloads = (cli as Record<string, unknown>).downloads as Record<
        string,
        unknown
      >;
      const mcpDownloads = (json as Record<string, unknown>)
        .downloads as Record<string, unknown>;
      expect(cliDownloads.lastMonth).toBe(downloadsLastMonth);
      expect(mcpDownloads.lastMonth).toBe(downloadsLastMonth);
      expect(Object.hasOwn(cliDownloads, "lastMonth")).toBe(
        downloadsLastMonth !== undefined,
      );
      expect(Object.hasOwn(mcpDownloads, "lastMonth")).toBe(
        downloadsLastMonth !== undefined,
      );
    },
  );

  it("Pub formatter distinguishes zero from unknown monthly counts", async () => {
    const packageName = "CaseSensitivePubPackage";
    const zeroSummary = structuredClone(defaultPackageSummary);
    zeroSummary.package.name = packageName;
    zeroSummary.package.registry = "PUB";
    zeroSummary.package.downloadsLastMonth = 0;
    const unknownSummary = structuredClone(zeroSummary);
    unknownSummary.package.downloadsLastMonth = undefined;
    const zeroService = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.resolve(zeroSummary)) as never,
    });
    const unknownService = createMockPackageIntelligenceService({
      packageSummary: mock(() => Promise.resolve(unknownSummary)) as never,
    });

    const zeroWrites: string[] = [];
    const zeroWriteSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      zeroWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    try {
      await pkgInfoAction(
        `pub:${packageName}`,
        {},
        cliDeps({ packageIntelligenceService: zeroService }),
      );
    } finally {
      zeroWriteSpy.mockRestore();
    }

    const unknownWrites: string[] = [];
    const unknownWriteSpy = spyOn(process.stdout, "write").mockImplementation(((
      chunk: string | Uint8Array,
    ) => {
      unknownWrites.push(
        typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
      );
      return true;
    }) as typeof process.stdout.write);
    try {
      await pkgInfoAction(
        `pub:${packageName}`,
        {},
        cliDeps({ packageIntelligenceService: unknownService }),
      );
    } finally {
      unknownWriteSpy.mockRestore();
    }

    const zeroMcpTool = createParityMcpTool("pkg_info", {
      packageIntelligenceService: zeroService,
    });
    const zeroMcpResult = await zeroMcpTool.handler(
      { target: `pub:${packageName}`, format: "text" },
      {},
    );
    const unknownMcpTool = createParityMcpTool("pkg_info", {
      packageIntelligenceService: unknownService,
    });
    const unknownMcpResult = await unknownMcpTool.handler(
      { target: `pub:${packageName}`, format: "text" },
      {},
    );

    for (const text of [
      zeroWrites.join(""),
      zeroMcpResult.content[0]?.text ?? "",
    ]) {
      expect(text).toMatch(/Downloads\s+0 \/ month/);
    }
    for (const text of [
      unknownWrites.join(""),
      unknownMcpResult.content[0]?.text ?? "",
    ]) {
      expect(text).not.toMatch(/Downloads\s+.*\/ month/);
    }
  });

  it("PARITY-JSON-KEYS: happy path CLI === MCP", async () => {
    const packageSummary = mock(
      (_params?: Parameters<PackageIntelligenceService["packageSummary"]>[0]) =>
        Promise.resolve(defaultPackageSummary),
    );
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });
    const cli = await cliJson(
      "npm:express",
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "npm:express" },
      packageSummary as never,
    );
    expect(isError).toBeUndefined();
    expect(packageSummary).toHaveBeenCalledTimes(2);
    expect(packageSummary.mock.calls).toEqual([
      [
        {
          registry: "NPM",
          packageName: "express",
          includeVerboseFields: true,
        },
      ],
      [
        {
          registry: "NPM",
          packageName: "express",
          includeVerboseFields: true,
        },
      ],
    ]);
    expect(cli).toEqual(json);
    expect((cli as Record<string, unknown>).versionCount).toBe(214);
    expect(
      ((cli as Record<string, unknown>).downloads as Record<string, unknown>)
        .refreshedAt,
    ).toBe("2024-06-15");
    expect((cli as Record<string, unknown>).advisoryHistory).toEqual({
      total: 5,
    });
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
      { target: "npm:obscure" },
      packageSummary as never,
    );

    expect(cli).toEqual(json);
    expect(cli).not.toHaveProperty("advisoryHistory");
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
      { target: "npm:ghost" },
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
      { target: "npm:express" },
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

  it("PARITY-ERROR-ENVELOPE: latest-only pin CLI/MCP validation", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });
    const cli = await cliJson(
      "npm:express@5.2.1",
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target: "npm:express@5.2.1" },
      packageSummary as never,
    );

    expect(isError).toBe(true);
    expect(cli).toEqual({
      error: "pkg info always returns the latest version; omit @5.2.1.",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(json).toEqual({
      error: "pkg_info always returns the latest version; omit @5.2.1.",
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(json as object).sort(),
    );
    expect(packageSummary).not.toHaveBeenCalled();
  });

  it("Pub exact pins with build metadata are rejected before service calls", async () => {
    const packageSummary = mock(() => Promise.resolve(defaultPackageSummary));
    const service = createMockPackageIntelligenceService({
      packageSummary: packageSummary as never,
    });
    const target = "pub:CaseSensitivePubPackage@1.2.3+build.7";

    const cli = await cliJson(
      target,
      cliDeps({ packageIntelligenceService: service }),
    );
    const { json, isError } = await mcpJson(
      { target },
      packageSummary as never,
    );

    expect(isError).toBe(true);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect(json).toMatchObject({ code: "INVALID_ARGUMENT", retryable: false });
    expect((cli as Record<string, unknown>).error).toContain("1.2.3+build.7");
    expect((json as Record<string, unknown>).error).toContain("1.2.3+build.7");
    expect(packageSummary).not.toHaveBeenCalled();
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT (missing package name) CLI === MCP", async () => {
    // Both surfaces: parsePackageSpec rejects the bare "npm:" (no name)
    // before the shared package-summary builder or service is reached.
    const cli = await cliJson("npm:");
    const { json, isError } = await mcpJson({ target: "npm:" });

    expect(isError).toBe(true);
    expect(cli).toEqual(json);
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
});

describe("cargo CLI/MCP parity", () => {
  it("sends canonical CRATES params and returns identical metadata for alias/canonical targets", async () => {
    const fixture = {
      ...defaultPackageSummary,
      package: {
        ...defaultPackageSummary.package,
        registry: "CRATES" as const,
        name: "serde",
      },
    };
    const packageSummary = mock(
      (_params: Parameters<PackageIntelligenceService["packageSummary"]>[0]) =>
        Promise.resolve(fixture),
    );
    const service = createMockPackageIntelligenceService({ packageSummary });
    const outputs: unknown[] = [];
    for (const target of ["cargo:serde", "CrAtEs:serde", "CARGO:serde"]) {
      outputs.push(
        await cliJson(target, cliDeps({ packageIntelligenceService: service })),
      );
      const mcp = await mcpJson({ target }, packageSummary as never);
      expect(mcp.isError).toBeUndefined();
      outputs.push(mcp.json);
    }
    expect(packageSummary).toHaveBeenCalledTimes(6);
    for (const args of packageSummary.mock.calls)
      expect(args).toEqual([
        {
          registry: "CRATES",
          packageName: "serde",
          includeVerboseFields: true,
        },
      ]);
    for (const output of outputs) expect(output).toEqual(outputs[0]);
    expect(outputs[0]).toMatchObject({ registry: "crates", name: "serde" });
  });
});

describe("registry repository CLI/MCP parity", () => {
  for (const registryRepository of [
    {
      id: "maven:google",
      name: "Google Maven",
      url: "https://dl.google.com/dl/android/maven2",
    },
    {
      id: "maven:central",
      name: "Maven Central",
      url: "https://repo1.maven.org/maven2",
    },
    undefined,
  ]) {
    it(`retains text and JSON provenance: ${registryRepository?.id ?? "unknown"}`, async () => {
      const fixture = structuredClone(defaultPackageSummary);
      fixture.package.registryRepository = registryRepository;
      const packageSummary = mock(() => Promise.resolve(fixture));
      const service = createMockPackageIntelligenceService({ packageSummary });
      const cli = await cliJson(
        "npm:express",
        cliDeps({ packageIntelligenceService: service }),
      );
      const mcp = await mcpJson({ target: "npm:express" }, packageSummary);
      expect(cli).toEqual(mcp.json);
      expect(mcp.isError).toBeUndefined();
      expect(
        (cli as { registryRepository?: unknown }).registryRepository,
      ).toEqual(registryRepository);

      const writes: string[] = [];
      const writeSpy = spyOn(process.stdout, "write").mockImplementation(((
        chunk: string | Uint8Array,
      ) => {
        writes.push(
          typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk),
        );
        return true;
      }) as typeof process.stdout.write);
      try {
        await pkgInfoAction(
          "npm:express",
          {},
          cliDeps({ packageIntelligenceService: service }),
        );
      } finally {
        writeSpy.mockRestore();
      }
      const tool = createParityMcpTool("pkg_info", {
        packageIntelligenceService: service,
      });
      const result = await tool.handler({ target: "npm:express" }, {});
      for (const text of [writes.join(""), result.content[0]?.text ?? ""]) {
        if (registryRepository) {
          expect(text).toMatch(/^Repository[^\n]*\nPackage registry\s+/m);
          expect(text).toContain(registryRepository.name);
          expect(text).toContain(registryRepository.url);
        } else {
          expect(text).not.toContain("Package registry");
        }
        expect(text).toContain("History:");
        expect(text).toContain("Repository");
      }
    });
  }
});
