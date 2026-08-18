// PARITY TEST — enforces PARITY-EXPERIMENTAL-LOCAL, PARITY-JSON-KEYS, and
// PARITY-ERROR-ENVELOPE from docs/implementation/mcp-cli-parity.md.
// CLI and MCP use surface-native defaults, so every fixture selects an
// explicit view and JSON output before comparing the two local surfaces.

import { describe, expect, it, mock, spyOn } from "bun:test";
import { CodeDiffError, type CodeDiffParams } from "@githits/core-internal";
import {
  type CodeDiffCommandDependencies,
  codeDiffAction,
} from "../commands/code/diff.js";
import {
  createMockCodeNavigationService,
  defaultCodeDiffResult,
} from "../services/test-helpers.js";
import {
  createParityExperimentalMcpTool,
  isProcessExitSentinel,
} from "./parity-test-helpers.js";

function cliDeps(
  overrides: Partial<CodeDiffCommandDependencies> = {},
): CodeDiffCommandDependencies {
  return {
    codeNavigationService: createMockCodeNavigationService(),
    codeNavigationUrl: "https://pkgseer.dev/graphql",
    hasValidToken: true,
    mcpUrl: "https://mcp.githits.com",
    ...overrides,
  };
}

async function cliJson(
  arg1: string | undefined,
  arg2: string | undefined,
  arg3: string | undefined,
  options: Parameters<typeof codeDiffAction>[3],
  deps: CodeDiffCommandDependencies,
  pathGlobAfterDoubleDash = false,
): Promise<unknown> {
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  const errorSpy = spyOn(console, "error").mockImplementation(() => {});
  const exitSpy = spyOn(process, "exit").mockImplementation(() => {
    throw new Error("process.exit");
  });
  const originalExitCode = process.exitCode;
  process.exitCode = 0;
  try {
    try {
      await codeDiffAction(
        arg1,
        arg2,
        arg3,
        { ...options, json: true },
        deps,
        pathGlobAfterDoubleDash,
      );
    } catch (error) {
      if (!isProcessExitSentinel(error)) throw error;
    }
    const raw =
      (logSpy.mock.calls[0]?.[0] as string | undefined) ??
      (errorSpy.mock.calls[0]?.[0] as string | undefined);
    return raw ? JSON.parse(raw) : undefined;
  } finally {
    process.exitCode = originalExitCode;
    logSpy.mockRestore();
    errorSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe("code_diff parity", () => {
  it("PARITY-EXPERIMENTAL-LOCAL: explicit package requests share service params", async () => {
    const cliCodeDiff = mock((_params: CodeDiffParams) =>
      Promise.resolve(defaultCodeDiffResult),
    );
    const mcpCodeDiff = mock((_params: CodeDiffParams) =>
      Promise.resolve(defaultCodeDiffResult),
    );
    await cliJson(
      "npm:express",
      "4.18.1..4.18.2",
      "src/**/*.ts",
      { nameStatus: true, maxFiles: "12" },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: cliCodeDiff,
        }),
      }),
      true,
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff", {
      codeNavigationService: createMockCodeNavigationService({
        codeDiff: mcpCodeDiff,
      }),
    });
    await mcpTool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        path_glob: "src/**/*.ts",
        max_files: 12,
        format: "json",
      },
      {},
    );

    expect(cliCodeDiff).toHaveBeenCalledTimes(1);
    expect(mcpCodeDiff).toHaveBeenCalledTimes(1);
    expect(cliCodeDiff.mock.calls[0]?.[0]).toEqual(
      mcpCodeDiff.mock.calls[0]?.[0],
    );
    expect(cliCodeDiff.mock.calls[0]?.[0]).toEqual({
      target: { registry: "NPM", packageName: "express" },
      from: "4.18.1",
      to: "4.18.2",
      mode: "inventory",
      options: { maxFiles: 12, pathGlob: "src/**/*.ts" },
    });
  });

  it("PARITY-EXPERIMENTAL-LOCAL: explicit repository refs share normalized params", async () => {
    const cliCodeDiff = mock((_params: CodeDiffParams) =>
      Promise.resolve(defaultCodeDiffResult),
    );
    const mcpCodeDiff = mock((_params: CodeDiffParams) =>
      Promise.resolve(defaultCodeDiffResult),
    );
    await cliJson(
      "main..release",
      "src/**",
      undefined,
      { repoUrl: "https://github.com/expressjs/express", nameOnly: true },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: cliCodeDiff,
        }),
      }),
      true,
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff", {
      codeNavigationService: createMockCodeNavigationService({
        codeDiff: mcpCodeDiff,
      }),
    });
    await mcpTool.handler(
      {
        target: { repo_url: "https://github.com/expressjs/express" },
        from: "main",
        to: "release",
        view: "name-only",
        path_glob: "src/**",
        format: "json",
      },
      {},
    );

    expect(cliCodeDiff.mock.calls[0]?.[0]).toEqual(
      mcpCodeDiff.mock.calls[0]?.[0],
    );
    expect(cliCodeDiff.mock.calls[0]?.[0]).toEqual({
      target: { repoUrl: "https://github.com/expressjs/express" },
      from: "main",
      to: "release",
      mode: "inventory",
      options: { pathGlob: "src/**" },
    });
  });

  it("PARITY-JSON-KEYS: shared success result is CLI JSON === MCP JSON", async () => {
    const result = structuredClone(defaultCodeDiffResult);
    const cli = await cliJson(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mock(() => Promise.resolve(result)),
        }),
      }),
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff", {
      codeNavigationService: createMockCodeNavigationService({
        codeDiff: mock(() => Promise.resolve(result)),
      }),
    });
    const mcpResult = await mcpTool.handler(
      {
        target: "npm:express",
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        format: "json",
      },
      {},
    );

    expect(mcpResult.isError).toBeUndefined();
    expect(cli).toEqual(JSON.parse(mcpResult.content[0]?.text ?? "{}"));
  });

  it("PARITY-ERROR-ENVELOPE: typed CodeDiff error is CLI JSON === MCP JSON", async () => {
    const error = new CodeDiffError("Comparison was rate limited.", {
      code: "RATE_LIMITED",
      retryable: true,
      side: "to",
      retryAfterMs: 1500,
      stage: "PATCH",
      limitKind: "PATCH_BYTES",
    });
    const cli = await cliJson(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true },
      cliDeps({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mock(() => Promise.reject(error)),
        }),
      }),
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff", {
      codeNavigationService: createMockCodeNavigationService({
        codeDiff: mock(() => Promise.reject(error)),
      }),
    });
    const mcpResult = await mcpTool.handler(
      {
        target: "npm:express",
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(mcpResult.isError).toBe(true);
    expect(cli).toEqual(mcp);
    expect(cli).toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      details: {
        side: "to",
        retryAfterMs: 1500,
        stage: "PATCH",
        limitKind: "PATCH_BYTES",
      },
    });
  });

  it("PARITY-ERROR-ENVELOPE: invalid view/budget shares classification and envelope shape", async () => {
    const cli = await cliJson(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true, maxPatchBytes: "4096" },
      cliDeps(),
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff");
    const mcpResult = await mcpTool.handler(
      {
        target: "npm:express",
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        max_patch_bytes: 4096,
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(mcpResult.isError).toBe(true);
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
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });

  it("PARITY-ERROR-ENVELOPE: invalid target and endpoint keep stable shape", async () => {
    const cli = await cliJson(
      "npm:express@1.0.0",
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true },
      cliDeps(),
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff");
    const mcpResult = await mcpTool.handler(
      {
        target: "npm:express@1.0.0",
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(mcpResult.isError).toBe(true);
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
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });

  it("PARITY-ERROR-ENVELOPE: empty comparison endpoint keeps stable shape", async () => {
    const cli = await cliJson(
      "npm:express",
      "..4.18.2",
      undefined,
      { nameStatus: true },
      cliDeps(),
    );
    const mcpTool = createParityExperimentalMcpTool("code_diff");
    const mcpResult = await mcpTool.handler(
      {
        target: "npm:express",
        from: "",
        to: "4.18.2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(mcpResult.isError).toBe(true);
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
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });
});
