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
//   - `INVALID_ARGUMENT` fixtures use `toMatchObject` when surface
//     wording can differ; identical compact targets use `toEqual`.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type ChangelogReport,
  PackageIntelligenceBackendError,
  PackageIntelligenceTargetNotFoundError,
  PackageIntelligenceVersionNotFoundError,
} from "@githits/core-internal";
import {
  type PkgChangelogCommandDependencies,
  pkgChangelogAction,
} from "../commands/pkg/changelog.js";
import {
  createMockPackageIntelligenceService,
  defaultChangelogReport,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

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
  spec: string,
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

interface McpArgs {
  changes?: string;
  target: string;
  limit?: number;
  omit_bodies?: boolean;
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
  const tool = createParityMcpTool("pkg_changelog", {
    packageIntelligenceService: service,
  });
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
      { target: "npm:express" },
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

  it("PARITY-JSON-KEYS: exact pin CLI === MCP", async () => {
    const exactReport: ChangelogReport = {
      ...defaultChangelogReport,
      entries: [{ ...defaultChangelogReport.entries[0]!, hasChangelog: true }],
    };
    const fn = mock(() => Promise.resolve(exactReport));
    const cli = await cliJson(
      "npm:express@5.2.1",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "npm:express@5.2.1" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      mode: string;
      filter?: { version?: string };
      entries: { items: Array<{ hasChangelog?: boolean; version?: string }> };
    };
    expect(envelope.mode).toBe("exact");
    expect(envelope.filter?.version).toBe("5.2.1");
    expect(envelope.entries.items[0]?.hasChangelog).toBe(true);
    expect(envelope.entries.items[0]?.version).toBe("5.2.1");
  });

  it("PARITY-JSON-KEYS: range mode echoes filter and flips mode", async () => {
    const rangeReport: ChangelogReport = {
      ...defaultChangelogReport,
      entries: [defaultChangelogReport.entries[0]!],
    };
    const fn = mock(() => Promise.resolve(rangeReport));
    const cli = await cliJson(
      "npm:express@5.0.0..",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "npm:express@5.0.0.." },
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

  it("PARITY-JSON-KEYS: no-body (CLI --no-body === MCP omit_bodies: true)", async () => {
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
      { target: "npm:express", omit_bodies: true },
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
    const { json } = await mcpJson({ target: "npm:express" }, fn as never);
    expect(cli).toEqual(json);
    const envelope = cli as {
      entries: { items: Array<{ body?: string }> };
    };
    expect(envelope.entries.items[0]?.body).toBe("## Patch\n- fixed a thing");
  });

  it("PARITY-JSON-KEYS: empty entries lossless on both surfaces", async () => {
    const emptyReport: ChangelogReport = {
      ...defaultChangelogReport,
      source: undefined,
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
    const { json } = await mcpJson({ target: "npm:express" }, fn as never);
    expect(cli).toEqual(json);
    const envelope = cli as {
      source?: string;
      entries: { count: number; items: unknown[] };
    };
    expect(envelope.source).toBeUndefined();
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
      { target: "npm:express" },
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
      { target: "npm:does-not-exist" },
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
          "5.2.999",
          undefined,
        ),
      ),
    );
    const cli = await cliJson(
      "npm:express@5.2.999",
      {},
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn as never,
        }),
      }),
    );
    const { json } = await mcpJson(
      { target: "npm:express@5.2.999" },
      fn as never,
    );
    expect(cli).toEqual(json);
    const envelope = cli as {
      code: string;
      details?: { package?: string; requestedVersion?: string };
    };
    expect(envelope.code).toBe("VERSION_NOT_FOUND");
    expect(envelope.details?.package).toBe("npm:express");
    expect(envelope.details?.requestedVersion).toBe("5.2.999");
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
    const { json } = await mcpJson({ target: "npm:express" }, fn as never);
    expect(cli).toEqual(json);
    expect((cli as { code: string }).code).toBe("BACKEND_ERROR");
    expect((cli as { retryable: boolean }).retryable).toBe(true);
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT for repository targets matches on both surfaces", async () => {
    const cli = await cliJson("github:expressjs/express", {});
    const { json } = await mcpJson({ target: "github:expressjs/express" });
    expect(cli).toEqual(json);
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("package-only"),
      retryable: false,
    });
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT for from + limit matches on both surfaces", async () => {
    const cli = await cliJson("npm:express", { from: "5.0.0", limit: "10" });
    const { json } = await mcpJson({
      target: "npm:express@5.0.0..",
      limit: 10,
    });
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

// The backend supplies filtered items; neither host filters a capped result locally.
describe("classification filter parity", () => {
  for (const target of [
    "npm:express",
    "npm:express@5.2.1",
    "npm:express@5.0.0..5.2.1",
  ]) {
    for (const changes of ["actionable", "important", "all"]) {
      it(`${target} ${changes} preserves all-tier coverage and per-item evidence`, async () => {
        const report: ChangelogReport = {
          ...defaultChangelogReport,
          riskItems: [
            {
              version: "5.2.1",
              tier: "MUST_ACT",
              ambiguous: true,
              tierConfidence: 0.95,
              text: "Possible default change.",
              textTruncated: false,
              fullText: "Possible default change.",
              source: "RELEASES",
              url: "https://example.com/v5.2.1",
              model: "jev-1.13.0",
              formulation: "s-hier-v5",
            },
          ],
          riskCoverage: {
            ...defaultChangelogReport.riskCoverage!,
            itemsMustActAmbiguous: 1,
            itemsShouldKnowConfident: 13,
            itemsOmitted: 2,
          },
        };
        const fn = mock(() => Promise.resolve(report));
        const cli = await cliJson(
          target,
          { changes },
          cliDeps({
            packageIntelligenceService: createMockPackageIntelligenceService({
              packageChangelog: fn,
            }),
          }),
        );
        const mcp = await mcpJson({ target, changes }, fn);
        expect(cli).toEqual(mcp.json);
        expect(cli).toMatchObject({
          filter: { changes },
          riskItems: [
            { tier: "must_act", ambiguous: true, formulation: "s-hier-v5" },
          ],
          riskCoverage: { itemsShouldKnowConfident: 13, itemsOmitted: 2 },
        });
        const calls = fn.mock.calls as unknown as Array<
          [Record<string, unknown>]
        >;
        expect(calls[0]?.[0]).toEqual(calls[1]?.[0]);
        expect(calls[0]?.[0]?.riskTiers).toEqual(
          changes === "actionable"
            ? ["MUST_ACT"]
            : changes === "important"
              ? ["MUST_ACT", "SHOULD_KNOW"]
              : undefined,
        );
        expect(calls[0]?.[0]?.includeRiskJsonFields).toBe(true);
      });
    }
  }
  it("ignores changes and skips risk fields in both timeline JSON surfaces", async () => {
    const cli = await cliJson("npm:express", {
      changes: "ignored",
      body: false,
    });
    const mcp = await mcpJson({
      target: "npm:express",
      changes: "ignored",
      omit_bodies: true,
    });
    expect(cli).toEqual(mcp.json);
    expect(cli).not.toHaveProperty("riskItems");
    expect(cli).not.toHaveProperty("riskCoverage");
    expect(cli).not.toHaveProperty("filter.changes");
  });
  it("maps invalid active changes identically before service access", async () => {
    const fn = mock(() => Promise.resolve(defaultChangelogReport));
    const cli = await cliJson(
      "npm:express",
      { changes: "safe" },
      cliDeps({
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn,
        }),
      }),
    );
    const mcp = await mcpJson({ target: "npm:express", changes: "safe" }, fn);
    expect(cli).toEqual(mcp.json);
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe("classified changelog text parity", () => {
  for (const changes of ["actionable", "important", "all"]) {
    it(`shares the same version-grouped evidence for ${changes}`, async () => {
      const report: ChangelogReport = {
        ...defaultChangelogReport,
        entries: [
          {
            version: "5.2.1",
            body: "Original short release note.",
            htmlUrl: "https://example.com/v5.2.1",
          },
        ],
        riskItems: [
          {
            version: "5.2.1",
            tier: "MUST_ACT",
            ambiguous: true,
            text: "Possible behavior change.",
            textTruncated: false,
            source: "RELEASES",
            url: "https://example.com/v5.2.1",
            model: "jev",
            formulation: "s-hier-v5",
          },
        ],
        riskCoverage: {
          ...defaultChangelogReport.riskCoverage!,
          itemsMustActAmbiguous: 1,
        },
      };
      const fn = mock(() => Promise.resolve(report));
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
        await pkgChangelogAction(
          "npm:express@5.2.1",
          { changes },
          cliDeps({
            packageIntelligenceService: createMockPackageIntelligenceService({
              packageChangelog: fn,
            }),
          }),
        );
      } finally {
        writeSpy.mockRestore();
      }
      const tool = createParityMcpTool("pkg_changelog", {
        packageIntelligenceService: createMockPackageIntelligenceService({
          packageChangelog: fn,
        }),
      });
      const result = await tool.handler(
        { target: "npm:express@5.2.1", changes },
        {},
      );
      expect(result.content[0]?.text).toBe(
        Bun.stripANSI(writes.join("")).trimEnd(),
      );
      expect(result.content[0]?.text).toContain("(uncertain)");
    });
  }
});
