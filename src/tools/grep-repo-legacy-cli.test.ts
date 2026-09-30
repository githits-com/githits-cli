import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  type GrepRepoParams,
} from "@githits/core-internal";
import {
  type PkgGrepCommandDependencies,
  pkgGrepAction,
} from "../commands/code/grep.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../services/test-helpers.js";

function cliDeps(
  overrides: Partial<PkgGrepCommandDependencies> = {},
): PkgGrepCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  first: string | undefined,
  second: string | undefined,
  third: string | undefined,
  options: Parameters<typeof pkgGrepAction>[3] = {},
  deps: PkgGrepCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const processExit = new Error("process.exit");
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw processExit;
  });
  try {
    try {
      await pkgGrepAction(
        first,
        second,
        third,
        { ...options, json: true },
        deps,
      );
    } catch (error) {
      if (error !== processExit) throw error;
    }
    const raw =
      (logSpy.mock.calls[0]?.[0] as string | undefined) ??
      (errSpy.mock.calls[0]?.[0] as string | undefined);
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe("legacy githits code grep JSON behavior", () => {
  it("returns the successful JSON fields and match details", async () => {
    const payload = await cliJson("npm:express", "middleware", "src/");

    expect(payload).toMatchObject({
      pattern: "middleware",
      matches: [
        {
          filePath: "src/index.js",
          line: 4,
          matchStartByte: 17,
          matchEndByte: 24,
          lineContent: "module.exports = require('./lib/express');",
          contextBefore: ["// Express entry point", "'use strict';", ""],
          contextAfter: [""],
          fileContentHash: "abc123",
          fileIntent: "production",
        },
      ],
      hasMore: false,
      filesScanned: 1,
      filesInScope: 1,
      totalMatches: 1,
      uniqueFilesMatched: 1,
      registry: "npm",
      name: "express",
      indexedVersion: "v5.2.1",
      resolution: {
        resolvedRef: "v5.2.1",
        commitSha: "abc123",
      },
      filter: { pathPrefix: "src/" },
    });
  });

  it("returns INDEXING details and retryability", async () => {
    const payload = (await cliJson(
      "npm:express",
      "middleware",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: mock(() =>
            Promise.reject(
              new CodeNavigationIndexingError("Indexing...", "ref_abc", [
                { version: "4.21.0", ref: "v4.21.0" },
              ]),
            ),
          ),
        }),
      }),
    )) as {
      code: string;
      retryable: boolean;
      error: string;
      details: { indexingRef: string; availableVersions: unknown[] };
    };

    expect(payload.code).toBe("INDEXING");
    expect(payload.retryable).toBe(true);
    expect(payload.error).toBe("Indexing...");
    expect(payload.details).toMatchObject({
      indexingRef: "ref_abc",
      availableVersions: [{ version: "4.21.0", ref: "v4.21.0" }],
    });
  });

  it("returns NOT_FOUND without path recovery guidance", async () => {
    const payload = (await cliJson(
      "npm:ghost",
      "middleware",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: mock(() =>
            Promise.reject(
              new CodeNavigationTargetNotFoundError("Package not found"),
            ),
          ),
        }),
      }),
    )) as {
      code: string;
      retryable: boolean;
      error: string;
      details?: { action?: string };
    };

    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.retryable).toBe(false);
    expect(payload.error).toBe("Package not found");
    expect(payload.details?.action).toBeUndefined();
  });

  it("returns FILE_NOT_FOUND with CLI list and code-grep actions", async () => {
    const payload = (await cliJson(
      "npm:express",
      "middleware",
      undefined,
      { path: "docs/missing.md" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: mock(() =>
            Promise.reject(
              new CodeNavigationFileNotFoundError(
                "Path not found in the index: docs/missing.md.",
                "docs/missing.md",
              ),
            ),
          ),
        }),
      }),
    )) as {
      code: string;
      retryable: boolean;
      details: { action?: string; filePath?: string };
    };

    expect(payload.code).toBe("FILE_NOT_FOUND");
    expect(payload.retryable).toBe(false);
    expect(payload.details.filePath).toBe("docs/missing.md");
    expect(payload.details.action).toContain('`githits list <target> "docs/"`');
    expect(payload.details.action).toContain("`--path <path>`");
    expect(payload.details.action).toContain("`githits code grep`");
  });

  it.each([
    [
      "FILE_PATH_EXCLUDED",
      "generated_or_large",
      "This path is excluded from the indexed source.",
    ],
    [
      "SOURCE_FILE_INVENTORY_UNKNOWN",
      "inventory_unavailable",
      "The source inventory cannot verify this path.",
    ],
  ] as const)(
    "returns %s authority details and CLI recovery actions",
    async (code, exclusionReason, guidance) => {
      const payload = (await cliJson(
        "hex:jason@1.4.4",
        "{",
        undefined,
        { path: "bench/data/issue-90.json" },
        cliDeps({
          codeNavigationService: createMockCodeNavigationService({
            grepRepo: mock(() =>
              Promise.reject(
                new CodeNavigationBackendError(
                  "Exact path is not queryable.",
                  undefined,
                  code,
                  false,
                  {
                    filePath: "bench/data/issue-90.json",
                    exclusionReason,
                  },
                ),
              ),
            ),
          }),
        }),
      )) as {
        code: string;
        retryable: boolean;
        details: {
          action?: string;
          filePath?: string;
          exclusionReason?: string;
          graphqlCode?: string;
        };
      };

      expect(payload).toMatchObject({
        code,
        retryable: false,
        details: {
          filePath: "bench/data/issue-90.json",
          exclusionReason,
          graphqlCode: code,
        },
      });
      expect(payload.details.action).toContain(guidance);
      expect(payload.details.action).toContain(
        '`githits list <target> "bench/data/"`',
      );
      expect(payload.details.action).toContain("`githits code grep`");
    },
  );

  it("returns an INVALID_ARGUMENT for a whitespace-only pattern", async () => {
    const payload = (await cliJson("npm:express", "   ", undefined)) as {
      code: string;
      retryable: boolean;
      error: string;
    };

    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.retryable).toBe(false);
    expect(payload.error).toContain("`<pattern>`");
    expect(payload.error).toContain("`githits list <target>`");
  });

  it("clamps 12 after-context lines while retaining 0 before-context lines", async () => {
    const grepRepo = mock((params: GrepRepoParams) => {
      expect(params.contextLinesBefore).toBe(0);
      expect(params.contextLinesAfter).toBe(10);
      return Promise.resolve(defaultGrepRepoResult);
    });
    const payload = (await cliJson(
      "npm:express",
      "router",
      undefined,
      { context: "12", beforeContext: "0" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({ grepRepo }),
      }),
    )) as {
      contextClamping: {
        requestedBefore: number;
        requestedAfter: number;
        effectiveBefore: number;
        effectiveAfter: number;
      };
      filter: {
        contextLines: number;
        contextLinesBefore: number;
        contextLinesAfter?: number;
      };
    };

    expect(payload.contextClamping).toEqual({
      requestedBefore: 0,
      requestedAfter: 12,
      effectiveBefore: 0,
      effectiveAfter: 10,
    });
    expect(payload.filter).toEqual({
      contextLines: 12,
      contextLinesBefore: 0,
    });
  });
});
