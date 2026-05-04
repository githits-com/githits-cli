// PARITY TEST — enforces rule IDs from docs/implementation/mcp-cli-parity.md:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable,
//                          details? } on every error path; MCP error text is
//                          always valid JSON.
//
// Assertion policy (matches the other pkg-intel parity tests):
//   - Service-sourced success / error fixtures use `toEqual`: both
//     surfaces route through the same request builder and envelope
//     shaper, so envelopes are byte-identical.
//   - `INVALID_ARGUMENT` fixtures use `toMatchObject`: CLI rejects in
//     `buildPackageChangelogParams` after `parsePackageSpec`; MCP
//     rejects in the same builder. Same envelope shape, surface-
//     specific error text.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgChangelogCommandDependencies,
  pkgChangelogAction,
} from "../commands/pkg/changelog.js";
import {
  type ChangelogReport,
  PackageIntelligenceBackendError,
  PackageIntelligenceChangelogSourceNotFoundError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "../services/index.js";
import {
  createMockPackageIntelligenceService,
  defaultChangelogReport,
} from "../services/test-helpers.js";
import { createPackageChangelogTool } from "./package-changelog.js";

function cliDeps(
  overrides: Partial<PkgChangelogCommandDependencies> = {},
): PkgChangelogCommandDependencies {
  return {
    packageIntelligenceService: createMockPackageIntelligenceService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  spec: string | undefined,
  options: Parameters<typeof pkgChangelogAction>[1] = {},
  deps: PkgChangelogCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgChangelogAction(spec, { ...options, json: true }, deps);
    } catch {
      /* CLI error paths call process.exit — caught. */
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

interface McpArgs {
  registry?: string;
  package_name?: string;
  repo_url?: string;
  from_version?: string;
  to_version?: string;
  limit?: number;
  git_ref?: string;
  include_bodies?: boolean;
}

async function mcpJson(
  args: McpArgs,
  packageChangelogMock?: () => Promise<ChangelogReport>,
): Promise<{ json: unknown; isError: boolean | undefined }> {
  const service = createMockPackageIntelligenceService(
    packageChangelogMock
      ? { packageChangelog: packageChangelogMock as never }
      : {},
  );
  const tool = createPackageChangelogTool(service);
  const result = await tool.handler({ ...args, format: "json" }, {});
  const text = result.content[0]?.text ?? "";
  return { json: JSON.parse(text), isError: result.isError };
}

describe("package_changelog parity", () => {
  it("PARITY-JSON-KEYS: happy latest-mode CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultChangelogReport));
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
    const envelope = cli as {
      registry: string;
      name: string;
      source: string;
      mode: string;
      entries: { count: number; items: unknown[] };
    };
    expect(envelope.registry).toBe("npm");
    expect(envelope.name).toBe("express");
    expect(envelope.source).toBe("releases");
    expect(envelope.mode).toBe("latest");
    expect(envelope.entries.count).toBe(2);
  });

  it("PARITY-JSON-KEYS: range mode (--from / from_version) echoes filter and flips mode", async () => {
    const rangeReport: ChangelogReport = {
      ...defaultChangelogReport,
      entries: [defaultChangelogReport.entries[0]!],
    };
    const fn = mock(() => Promise.resolve(rangeReport));
    const cli = await cliJson(
      "npm:express",
      { from: "5.0.0" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", from_version: "5.0.0" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      mode: string;
      filter?: { fromVersion?: string };
    };
    expect(envelope.mode).toBe("range");
    expect(envelope.filter?.fromVersion).toBe("5.0.0");
  });

  it("PARITY-JSON-KEYS: repo-URL addressing (CLI --repo-url === MCP repo_url)", async () => {
    const fn = mock(() => Promise.resolve(defaultChangelogReport));
    const cli = await cliJson(
      undefined,
      { repoUrl: "https://github.com/expressjs/express" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { repo_url: "https://github.com/expressjs/express" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      repoUrl?: string;
      registry?: string;
      name?: string;
    };
    expect(envelope.repoUrl).toBe("https://github.com/expressjs/express");
    expect(envelope.registry).toBeUndefined();
    expect(envelope.name).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: no-body (CLI --no-body === MCP include_bodies: false)", async () => {
    const fn = mock(() => Promise.resolve(defaultChangelogReport));
    const cli = await cliJson(
      "npm:express",
      { body: false },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", include_bodies: false },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      entries: { items: Array<{ body?: string }> };
    };
    for (const item of envelope.entries.items) {
      expect(item.body).toBeUndefined();
    }
  });

  it("PARITY-JSON-KEYS: default includes bodies on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultChangelogReport));
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      entries: { items: Array<{ body?: string }> };
    };
    expect(envelope.entries.items[0]?.body).toBe("## Patch\n- fixed a thing");
  });

  it("PARITY-JSON-KEYS: empty entries lossless on both surfaces", async () => {
    const emptyReport: ChangelogReport = {
      ...defaultChangelogReport,
      entries: [],
    };
    const fn = mock(() => Promise.resolve(emptyReport));
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as { entries: { count: number; items: unknown[] } };
    expect(envelope.entries.count).toBe(0);
    expect(envelope.entries.items).toEqual([]);
  });

  it("PARITY-JSON-KEYS: package version entries without source succeed on both surfaces", async () => {
    const noSourceReport: ChangelogReport = {
      ...defaultChangelogReport,
      source: undefined,
      entries: [defaultChangelogReport.entries[0]!],
    };
    const fn = mock(() => Promise.resolve(noSourceReport));
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json, isError } = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(isError).toBeUndefined();
    expect(cli).toEqual(json);
    const envelope = cli as {
      source?: string;
      entries: { count: number; items: Array<{ version?: string }> };
    };
    expect(envelope.source).toBeUndefined();
    expect(envelope.entries.count).toBe(1);
    expect(envelope.entries.items[0]?.version).toBe("5.2.1");
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND (no changelog source) identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceChangelogSourceNotFoundError(
          "No changelog source available for npm:obscure (tried GitHub Releases, CHANGELOG.md, and HexDocs).",
        ),
      ),
    );
    const cli = await cliJson(
      "npm:obscure",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "obscure" },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect((cli as { code: string }).code).toBe("NOT_FOUND");
  });

  it("PARITY-ERROR-ENVELOPE: PackageIntelligenceTargetNotFoundError (package missing) identical", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceTargetNotFoundError("Package not found"),
      ),
    );
    const cli = await cliJson(
      "npm:does-not-exist",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "does-not-exist" },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect((cli as { code: string }).code).toBe("NOT_FOUND");
  });

  it("PARITY-ERROR-ENVELOPE: VERSION_NOT_FOUND with structured details identical", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceVersionNotFoundError(
          "No matching version found",
          "npm:express",
          "99.0.0",
          undefined,
        ),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      { from: "99.0.0" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express", from_version: "99.0.0" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      code: string;
      details?: { package?: string; requestedVersion?: string };
    };
    expect(envelope.code).toBe("VERSION_NOT_FOUND");
    expect(envelope.details?.package).toBe("npm:express");
    expect(envelope.details?.requestedVersion).toBe("99.0.0");
  });

  it("PARITY-ERROR-ENVELOPE: BACKEND_ERROR identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new PackageIntelligenceBackendError(
          "Upstream timed out",
          504,
          "UPSTREAM_ERROR",
          true,
        ),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { registry: "npm", package_name: "express" },
      fn as never,
    );
    expect(cli).toEqual(json);
    expect((cli as { code: string }).code).toBe("BACKEND_ERROR");
    expect((cli as { retryable: boolean }).retryable).toBe(true);
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT for <spec>@<version> matches shape", async () => {
    const cli = await cliJson("npm:express@5.0.0", {});
    const { json } = await mcpJson({
      registry: "npm",
      package_name: "express",
      // The MCP surface has no `<spec>@<version>` channel; we test
      // the equivalent rule from the other direction — a different
      // builder rule (from + limit). The shape is the concern here,
      // not identical text.
    });
    // CLI envelope is an error; MCP hits the default service mock
    // happy path, so shapes differ by design. Instead assert CLI
    // matches the shared envelope contract.
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.any(String),
      retryable: false,
    });
    // Sanity: MCP rejects from + limit with INVALID_ARGUMENT too.
    const mcpReject = await mcpJson({
      registry: "npm",
      package_name: "express",
      from_version: "5.0.0",
      limit: 10,
    });
    expect(mcpReject.json).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.any(String),
      retryable: false,
    });
    // Suppress unused-var warning on `json` — we don't compare it.
    void json;
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT for from + limit matches on both surfaces", async () => {
    const cli = await cliJson("npm:express", { from: "5.0.0", limit: "10" });
    const { json } = await mcpJson({
      registry: "npm",
      package_name: "express",
      from_version: "5.0.0",
      limit: 10,
    });
    // Shape parity — message text differs (CLI gets the Node error
    // surface, MCP the JSON payload). toMatchObject covers both.
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("latest-mode"),
      retryable: false,
    });
    expect(json).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("latest-mode"),
      retryable: false,
    });
  });
});
