// PARITY TEST — enforces:
//   PARITY-JSON-KEYS       CLI --json output and MCP `format: "json"` payload
//                          parse to deepEqual JSON objects for equivalent
//                          inputs. The MCP default is `text-v1`; this helper
//                          opts into JSON to compare like-for-like.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable, details? }.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  type PkgFilesCommandDependencies,
  pkgFilesAction,
} from "../commands/code/files.js";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
  type ListFilesResult,
} from "../services/index.js";
import {
  createMockCodeNavigationService,
  defaultListFilesResult,
} from "../services/test-helpers.js";
import { createListFilesTool } from "./list-files.js";
import { isProcessExitSentinel } from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<PkgFilesCommandDependencies> = {},
): PkgFilesCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    codeNavigationUrl: "https://pkgseer.dev",
    hasValidToken: true,
    mcpUrl: "https://mcp.example.com",
    ...overrides,
  };
}

async function cliJson(
  spec: string | undefined,
  pathPrefix: string | undefined,
  options: Parameters<typeof pkgFilesAction>[2] = {},
  deps: PkgFilesCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      // In spec mode the CLI takes (spec, path-prefix) positionals;
      // in repo-URL mode it takes (path-prefix, undefined).
      const hasRepoUrl = Boolean(options.repoUrl);
      const first = hasRepoUrl ? pathPrefix : spec;
      const second = hasRepoUrl ? undefined : pathPrefix;
      await pkgFilesAction(first, second, { ...options, json: true }, deps);
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
      | "go";
    package_name?: string;
    version?: string;
    repo_url?: string;
    git_ref?: string;
  };
  path?: string;
  path_prefix?: string;
  globs?: string[];
  extensions?: string[];
  file_types?: string[];
  languages?: string[];
  file_intent?: string;
  file_intents?: string[];
  exclude_file_intents?: string[];
  exclude_doc_files?: boolean;
  exclude_test_files?: boolean;
  include_hidden?: boolean;
  limit?: number;
  wait_timeout_ms?: number;
  format?: "json" | "text" | "text-v1";
}

async function mcpJson(
  args: McpArgs,
  listFilesMock?: () => Promise<ListFilesResult>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    listFilesMock ? { listFiles: listFilesMock as never } : {},
  );
  const tool = createListFilesTool(service);
  // Parity is asserted against the JSON envelope. The MCP default is
  // text-v1, so this helper opts into JSON to match the CLI `--json`
  // payload shape.
  const result = await tool.handler({ ...args, format: "json" }, {});
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("list_files parity", () => {
  it("PARITY-JSON-KEYS: happy package addressing CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultListFilesResult));
    const cli = await cliJson(
      "npm:express",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    const envelope = cli as { registry: string; total: number };
    expect(envelope.registry).toBe("npm");
    expect(envelope.total).toBe(2);
  });

  it("PARITY-JSON-KEYS: repo-URL addressing CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultListFilesResult));
    const cli = await cliJson(
      undefined,
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: {
          repo_url: "https://github.com/expressjs/express",
          git_ref: "main",
        },
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-JSON-KEYS: path_prefix echoes in filter block on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultListFilesResult));
    const cli = await cliJson(
      "npm:express",
      "src/",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path_prefix: "src/",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect(
      (cli as { filter?: { pathPrefix?: string } }).filter?.pathPrefix,
    ).toBe("src/");
  });

  it("PARITY-JSON-KEYS: explicit limit echoes in filter block on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultListFilesResult));
    const cli = await cliJson(
      "npm:express",
      undefined,
      { limit: "50" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        limit: 50,
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { filter?: { limit?: number } }).filter?.limit).toBe(50);
  });

  it("PARITY-JSON-KEYS: advanced filters echo identically on both surfaces", async () => {
    const fn = mock(() => Promise.resolve(defaultListFilesResult));
    const cli = await cliJson(
      "npm:express",
      "src/",
      {
        path: "README.md",
        glob: ["test/**/*.js"],
        ext: ["js"],
        fileType: ["source"],
        language: ["JavaScript"],
        fileIntent: ["production", "test"],
        excludeIntent: ["generated"],
        excludeDocs: true,
        excludeTests: false,
        hidden: true,
      },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "README.md",
        path_prefix: "src/",
        globs: ["test/**/*.js"],
        extensions: ["js"],
        file_types: ["source"],
        languages: ["JavaScript"],
        file_intents: ["production", "test"],
        exclude_file_intents: ["generated"],
        exclude_doc_files: true,
        exclude_test_files: false,
        include_hidden: true,
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-ERROR-ENVELOPE: INDEXING identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationIndexingError(
          "Target is still indexing.",
          "ref_abc",
          [{ version: "4.21.0", ref: "v4.21.0" }],
        ),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string; retryable: boolean }).code).toBe("INDEXING");
    expect((cli as { code: string; retryable: boolean }).retryable).toBe(true);
  });

  it("PARITY-ERROR-ENVELOPE: NOT_FOUND identical on both surfaces", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationTargetNotFoundError("Package not found"),
      ),
    );
    const cli = await cliJson(
      "npm:ghost",
      undefined,
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          listFiles: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "ghost" },
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string }).code).toBe("NOT_FOUND");
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT on both surfaces carries `retryable: false` (full shape)", async () => {
    const cli = await cliJson(undefined, undefined, {});
    const mcp = await mcpJson({ target: {} });
    // Assert the exact shape (including retryable) so future drift
    // surfaces here rather than in a production agent's envelope.
    // Message text differs by surface; that's acceptable.
    expect(cli).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: expect.any(String),
    });
    expect(mcp).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: expect.any(String),
    });
    // Both surfaces must have the same set of keys.
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });
});
