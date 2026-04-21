// PARITY TEST — enforces:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable, details? }.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgGrepCommandDependencies,
  pkgGrepAction,
} from "../commands/code/grep.js";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  type GrepFileResult,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultGrepFileResult,
} from "../services/test-helpers.js";
import { createGrepFileTool } from "./grep-file.js";

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
  path: string;
  pattern: string;
  context_lines?: number;
  max_matches?: number;
  wait_timeout_ms?: number;
}

async function mcpJson(
  args: McpArgs,
  grepFileMock?: () => Promise<GrepFileResult>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    grepFileMock ? { grepFile: grepFileMock as never } : {},
  );
  const tool = createGrepFileTool(service);
  const result = await tool.handler(args, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("grep_file parity", () => {
  it("PARITY-JSON-KEYS: happy package grep CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultGrepFileResult));
    const cli = await cliJson(
      "npm:express",
      "middleware",
      "src/index.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "src/index.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-JSON-KEYS: filter echoes context + max_matches on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultGrepFileResult));
    const cli = await cliJson(
      "npm:express",
      "middleware",
      "src/index.js",
      { context: "5", limit: "100" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "src/index.js",
        context_lines: 5,
        max_matches: 100,
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect(
      (cli as { filter?: { contextLines?: number; maxMatches?: number } })
        .filter,
    ).toEqual({
      contextLines: 5,
      maxMatches: 100,
    });
  });

  it("PARITY-JSON-KEYS: repo-URL addressing CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultGrepFileResult));
    const cli = await cliJson(
      "middleware",
      "src/index.js",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: {
          repo_url: "https://github.com/expressjs/express",
          git_ref: "main",
        },
        pattern: "middleware",
        path: "src/index.js",
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
      "src/index.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "src/index.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("INDEXING");
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationTargetNotFoundError("File not found in repository"),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      "middleware",
      "nope.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          grepFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "nope.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("NOT_FOUND");
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT for empty pattern on both surfaces", async () => {
    const cli = await cliJson("npm:express", "", "src/index.js", {});
    const mcp = await mcpJson({
      target: { registry: "npm", package_name: "express" },
      pattern: "",
      path: "src/index.js",
    });
    expect(cli).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(mcp).toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
