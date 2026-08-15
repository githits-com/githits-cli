import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationBackendError,
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  type GrepRepoResult,
} from "@githits/core-internal";
import {
  type PkgGrepCommandDependencies,
  pkgGrepAction,
} from "../commands/code/grep.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

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
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
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
      if (!isProcessExitSentinel(error)) throw error;
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

interface McpArgs {
  target: {
    registry?:
      | "npm"
      | "pypi"
      | "hex"
      | "crates"
      | "nuget"
      | "maven"
      | "zig"
      | "vcpkg"
      | "packagist"
      | "rubygems"
      | "go"
      | "swift";
    package_name?: string;
    version?: string;
    repo_url?: string;
    git_ref?: string;
  };
  pattern: string;
  path?: string;
  path_prefix?: string;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

async function mcpJson(
  args: McpArgs,
  grepRepoMock?: () => Promise<GrepRepoResult>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    grepRepoMock ? { grepRepo: grepRepoMock as never } : {},
  );
  const tool = createParityMcpTool("code_grep", {
    codeNavigationService: service,
  });
  // Parity is asserted against the JSON envelope. The MCP default is
  // text-v1, so this helper opts into JSON to match the CLI `--json`
  // payload shape.
  const result = await tool.handler({ ...args, format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("grep_repo parity", () => {
  it("PARITY-JSON-KEYS: happy package grep CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultGrepRepoResult));
    const cli = await cliJson(
      "npm:express",
      "middleware",
      "src/",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path_prefix: "src/",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-ERROR-ENVELOPE: INDEXING identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationIndexingError("Indexing...", "ref_abc", [
          { version: "4.21.0", ref: "v4.21.0" },
        ]),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      "middleware",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("INDEXING");
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationTargetNotFoundError("Package not found"),
      ),
    );
    const cli = await cliJson(
      "npm:ghost",
      "middleware",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "ghost" },
        pattern: "middleware",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("NOT_FOUND");
  });

  it("PARITY-ERROR-ENVELOPE: FILE_NOT_FOUND shares data with surface-native actions", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationFileNotFoundError(
          "Path not found in the index: docs/missing.md.",
          "docs/missing.md",
        ),
      ),
    );
    const cli = (await cliJson(
      "npm:express",
      "middleware",
      undefined,
      { path: "docs/missing.md" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepRepo: fn as never,
        }),
      }),
    )) as {
      details: { action?: string; filePath?: string };
    };
    const mcp = (await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "docs/missing.md",
      },
      fn as never,
    )) as {
      details: { action?: string; filePath?: string };
    };
    const { action: cliAction, ...cliDetails } = cli.details;
    const { action: mcpAction, ...mcpDetails } = mcp.details;

    expect({ ...cli, details: cliDetails }).toEqual({
      ...mcp,
      details: mcpDetails,
    });
    expect(cliAction).toContain("`githits code files`");
    expect(cliAction).toContain("`githits code grep`");
    expect(mcpAction).toContain("`code_files`");
    expect(mcpAction).toContain("`code_grep`");
  });

  it.each([
    ["FILE_PATH_EXCLUDED", "generated_or_large"],
    ["SOURCE_FILE_INVENTORY_UNKNOWN", "inventory_unavailable"],
  ] as const)(
    "PARITY-ERROR-ENVELOPE: %s exact-path authority details are identical",
    async (code, exclusionReason) => {
      const fn = mock(() =>
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
      );
      const cli = await cliJson(
        "hex:jason@1.4.4",
        "{",
        undefined,
        { path: "bench/data/issue-90.json" },
        cliDeps({
          codeNavigationService: createMockCodeNavigationService({
            grepRepo: fn as never,
          }),
        }),
      );
      const mcp = await mcpJson(
        {
          target: {
            registry: "hex",
            package_name: "jason",
            version: "1.4.4",
          },
          pattern: "{",
          path: "bench/data/issue-90.json",
        },
        fn as never,
      );

      const cliEnvelope = cli as {
        details: { action?: string };
      };
      const mcpEnvelope = mcp as {
        details: { action?: string };
      };
      const { action: cliAction, ...cliDetails } = cliEnvelope.details;
      const { action: mcpAction, ...mcpDetails } = mcpEnvelope.details;

      expect({ ...cliEnvelope, details: cliDetails }).toEqual({
        ...mcpEnvelope,
        details: mcpDetails,
      });
      expect(cliEnvelope).toMatchObject({
        code,
        retryable: false,
        details: {
          filePath: "bench/data/issue-90.json",
          exclusionReason,
          graphqlCode: code,
        },
      });
      expect(cliAction).toContain("`githits code files`");
      expect(cliAction).toContain("`githits code grep`");
      expect(mcpAction).toContain("`code_files`");
      expect(mcpAction).toContain("`code_grep`");
    },
  );

  it("PARITY-ERROR-ENVELOPE: whitespace-only pattern shares data with surface-native messages", async () => {
    const cli = (await cliJson("npm:express", "   ", undefined)) as {
      code: string;
      error: string;
      retryable: boolean;
    };
    const mcp = (await mcpJson({
      target: { registry: "npm", package_name: "express" },
      pattern: "   ",
    })) as { code: string; error: string; retryable: boolean };
    const { error: cliError, ...cliData } = cli;
    const { error: mcpError, ...mcpData } = mcp;

    expect(cliData).toEqual(mcpData);
    expect(cli.code).toBe("INVALID_ARGUMENT");
    expect(cliError).toContain("`<pattern>`");
    expect(cliError).toContain("`githits code files`");
    expect(mcpError).toContain("`pattern`");
    expect(mcpError).toContain("`code_files`");
  });
});
