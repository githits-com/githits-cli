import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgGrepCommandDependencies,
  pkgGrepAction,
} from "../commands/code/grep.js";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  type GrepRepoResult,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../services/test-helpers.js";
import { createGrepRepoTool } from "./grep-repo.js";

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
    } catch {
      /* error paths call process.exit — caught */
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
      | "packagist";
    package_name?: string;
    version?: string;
    repo_url?: string;
    git_ref?: string;
  };
  pattern: string;
  path_prefix?: string;
  wait_timeout_ms?: number;
}

async function mcpJson(
  args: McpArgs,
  grepRepoMock?: () => Promise<GrepRepoResult>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    grepRepoMock ? { grepRepo: grepRepoMock as never } : {},
  );
  const tool = createGrepRepoTool(service);
  const result = await tool.handler(args, {});
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

  it("PARITY-ERROR-ENVELOPE: whitespace-only pattern is INVALID_ARGUMENT on both surfaces", async () => {
    const cli = await cliJson("npm:express", "   ", undefined);
    const mcp = await mcpJson({
      target: { registry: "npm", package_name: "express" },
      pattern: "   ",
    });
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("INVALID_ARGUMENT");
  });
});
