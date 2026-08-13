// PARITY TEST — enforces:
//   PARITY-JSON-KEYS       CLI --json output and MCP text payload parse to
//                          deepEqual JSON objects for equivalent inputs.
//   PARITY-ERROR-ENVELOPE  Both surfaces emit { error, code, retryable, details? }.

import { describe, expect, it, mock, spyOn } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  type ReadFileResult,
} from "@githits/core-internal";
import {
  type PkgReadCommandDependencies,
  pkgReadAction,
} from "../commands/code/read.js";
import {
  createMockCodeNavigationService,
  defaultReadFileResult,
} from "../services/test-helpers.js";
import {
  createParityMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<PkgReadCommandDependencies> = {},
): PkgReadCommandDependencies {
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
  path: string | undefined,
  options: Parameters<typeof pkgReadAction>[2] = {},
  deps: PkgReadCommandDependencies = cliDeps(),
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  try {
    try {
      await pkgReadAction(spec, path, { ...options, json: true }, deps);
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
  path: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
}

async function mcpJson(
  args: McpArgs,
  readFileMock?: () => Promise<ReadFileResult>,
): Promise<unknown> {
  const service = createMockCodeNavigationService(
    readFileMock ? { readFile: readFileMock as never } : {},
  );
  const tool = createParityMcpTool("code_read", {
    codeNavigationService: service,
  });
  const result = await tool.handler({ ...args, format: "json" }, {});
  const parsed = JSON.parse(result.content[0]?.text ?? "") as Record<
    string,
    unknown
  >;
  // The MCP surface adds a `hint` field when its per-call span cap
  // truncates the request. The cap is intentionally MCP-only — the
  // CLI command path honors arbitrary ranges so humans can pipe
  // whole files. Strip the field here so the envelope shapes match
  // for parity comparison; cap behavior is covered by
  // `read-file.test.ts`.
  delete parsed.hint;
  return parsed;
}

describe("read_file parity", () => {
  it("PARITY-JSON-KEYS: happy package read CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultReadFileResult));
    const cli = await cliJson(
      "npm:express",
      "src/index.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-JSON-KEYS: line range CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultReadFileResult));
    const cli = await cliJson(
      "npm:express",
      "src/index.js",
      { start: "10", end: "40" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
        start_line: 10,
        end_line: 40,
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-JSON-KEYS: binary file fixture — both surfaces omit `content` and set `isBinary: true`", async () => {
    const binaryResult: ReadFileResult = {
      filePath: "assets/logo.png",
      isBinary: true,
      // content intentionally undefined (backend returns null)
    };
    const fn = mock(() => Promise.resolve(binaryResult));
    const cli = await cliJson(
      "npm:express",
      "assets/logo.png",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "assets/logo.png",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    const envelope = cli as {
      isBinary?: boolean;
      content?: string;
    };
    expect(envelope.isBinary).toBe(true);
    expect(envelope.content).toBeUndefined();
  });

  it("PARITY-JSON-KEYS: repo-URL addressing CLI === MCP", async () => {
    const fn = mock(() => Promise.resolve(defaultReadFileResult));
    // Commander binds the sole positional to the first argument in
    // repo-URL mode; action interprets it as the path.
    const cli = await cliJson(
      "src/index.js",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        gitRef: "main",
      },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: {
          repo_url: "https://github.com/expressjs/express",
          git_ref: "main",
        },
        path: "src/index.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
  });

  it("PARITY-ERROR-ENVELOPE: FILE_NOT_FOUND shares data with surface-native actions", async () => {
    const fn = mock(() =>
      Promise.reject(
        new CodeNavigationFileNotFoundError(
          "File not found: nope.js",
          "nope.js",
        ),
      ),
    );
    const cli = await cliJson(
      "npm:express",
      "nope.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "nope.js",
      },
      fn as never,
    );
    const cliEnvelope = cli as {
      code: string;
      details: { action?: string; filePath?: string };
    };
    const mcpEnvelope = mcp as {
      code: string;
      details: { action?: string; filePath?: string };
    };
    const { action: cliAction, ...cliDetails } = cliEnvelope.details;
    const { action: mcpAction, ...mcpDetails } = mcpEnvelope.details;

    expect({ ...cliEnvelope, details: cliDetails }).toEqual({
      ...mcpEnvelope,
      details: mcpDetails,
    });
    expect(cliEnvelope.code).toBe("FILE_NOT_FOUND");
    expect(cliAction).toContain("`githits code files`");
    expect(cliAction).toContain("`githits code read`");
    expect(cliAction).toContain("without a path prefix");
    expect(mcpAction).toContain("`code_files`");
    expect(mcpAction).toContain("`code_read`");
    expect(mcpAction).toContain("without `path_prefix`");
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
      "src/index.js",
      {},
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          readFile: fn as never,
        }),
      }),
    );
    const mcp = await mcpJson(
      {
        target: { registry: "npm", package_name: "express" },
        path: "src/index.js",
      },
      fn as never,
    );
    expect(cli).toEqual(mcp);
    expect((cli as { code: string; retryable: boolean }).code).toBe("INDEXING");
  });

  it("PARITY-ERROR-ENVELOPE: INVALID_ARGUMENT on reversed range", async () => {
    const cli = (await cliJson("npm:express", "src/index.js", {
      start: "40",
      end: "10",
    })) as { code: string; error: string; retryable: boolean };
    const mcp = (await mcpJson({
      target: { registry: "npm", package_name: "express" },
      path: "src/index.js",
      start_line: 40,
      end_line: 10,
    })) as { code: string; error: string; retryable: boolean };
    const { error: cliError, ...cliData } = cli;
    const { error: mcpError, ...mcpData } = mcp;

    expect(cliData).toEqual(mcpData);
    expect(cli.code).toBe("INVALID_ARGUMENT");
    expect(cliError).toContain("--start (40)");
    expect(cliError).toContain("--end (10)");
    expect(mcpError).toContain("start_line (40)");
    expect(mcpError).toContain("end_line (10)");
  });
});
