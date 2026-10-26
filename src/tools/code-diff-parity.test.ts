// PARITY TEST — enforces PARITY-EXPLICIT-CALLS, PARITY-JSON-KEYS, and
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
  createParityMcpTool,
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
  it("PARITY-EXPLICIT-CALLS: explicit package requests share service params", async () => {
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
    const mcpTool = createParityMcpTool("code_diff", {
      codeNavigationService: createMockCodeNavigationService({
        codeDiff: mcpCodeDiff,
      }),
    });
    await mcpTool.handler(
      {
        target: "npm:express",
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

  it.each([
    "https://github.com/expressjs/express",
    "https://codeberg.org/zigil/decimal",
    "https://gitlab.com/group/subgroup/project",
  ])(
    "PARITY-EXPLICIT-CALLS: explicit repository refs share normalized params %s",
    async (repoUrl) => {
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
        { repoUrl: repoUrl, nameOnly: true },
        cliDeps({
          codeNavigationService: createMockCodeNavigationService({
            codeDiff: cliCodeDiff,
          }),
        }),
        true,
      );
      const mcpTool = createParityMcpTool("code_diff", {
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mcpCodeDiff,
        }),
      });
      await mcpTool.handler(
        {
          target: repoUrl,
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
        target: { repoUrl: repoUrl },
        from: "main",
        to: "release",
        mode: "inventory",
        options: { pathGlob: "src/**" },
      });
    },
  );

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
    const mcpTool = createParityMcpTool("code_diff", {
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
    const mcpTool = createParityMcpTool("code_diff", {
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

  it("preserves nonretryable RAW_DIFF_UNAVAILABLE and resolved refs on CLI/MCP", async () => {
    const partial = {
      fromResolution: {
        requested: "old",
        ref: "old",
        commitSha: "1".repeat(40),
        refKind: "TAG" as const,
      },
      toResolution: {
        requested: "new",
        ref: "new",
        commitSha: "2".repeat(40),
        refKind: "SHA" as const,
      },
    };
    const error = new CodeDiffError(
      "Raw diffs are unavailable for this repository provider",
      { code: "RAW_DIFF_UNAVAILABLE", retryable: false },
      partial,
    );
    const service = createMockCodeNavigationService({
      codeDiff: mock(() => Promise.reject(error)),
    });
    const target = "LP:~Owner/+git/Repo";
    const cli = await cliJson(
      target,
      "old..new",
      undefined,
      { nameStatus: true },
      cliDeps({ codeNavigationService: service }),
    );
    const mcp = await createParityMcpTool("code_diff", {
      codeNavigationService: service,
    }).handler({ target, from: "old", to: "new", format: "json" }, {});
    expect(mcp.isError).toBe(true);
    expect(cli).toEqual(JSON.parse(mcp.content[0]?.text ?? "{}"));
    expect(cli).toMatchObject({
      code: "RAW_DIFF_UNAVAILABLE",
      retryable: false,
      details: {
        codeDiffResolution: {
          from: partial.fromResolution,
          to: partial.toResolution,
        },
      },
    });
  });

  it("PARITY-ERROR-ENVELOPE: version alternatives retain backend order and refs", async () => {
    const previousArgv = process.argv;
    process.argv = [
      "bun",
      "src/cli.ts",
      "code",
      "diff",
      "npm:express",
      "3.21.2..4.15.5",
      "--name-status",
      "--json",
    ];
    try {
      const availableVersions = [
        { version: "2.1.1", ref: "2.1.1" },
        { version: "4.0.0", ref: "4.0.0" },
        { ref: "0123456789abcdef0123456789abcdef01234567" },
      ];
      const error = new CodeDiffError(
        "The published package version has no resolvable source ref",
        {
          code: "VERSION_NOT_FOUND",
          retryable: false,
          side: "from",
          availableVersions,
        },
      );
      const cli = await cliJson(
        "npm:express",
        "3.21.2..4.15.5",
        undefined,
        { nameStatus: true },
        cliDeps({
          codeNavigationService: createMockCodeNavigationService({
            codeDiff: mock(() => Promise.reject(error)),
          }),
        }),
      );
      const mcpTool = createParityMcpTool("code_diff", {
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mock(() => Promise.reject(error)),
        }),
      });
      const mcpResult = await mcpTool.handler(
        {
          target: "npm:express",
          from: "3.21.2",
          to: "4.15.5",
          view: "name-status",
          format: "json",
        },
        {},
      );
      const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

      expect(mcpResult.isError).toBe(true);
      expect(mcp.details.action).toBe('Retry code_diff with from="2.1.1".');
      const cliEnvelope = cli as typeof mcp;
      expect(cliEnvelope.details.action).toBe(
        "Try: githits code diff npm:express 2.1.1..4.15.5 --name-status --json",
      );
      const { action: _mcpAction, ...mcpFacts } = mcp.details;
      const { action: _cliAction, ...cliFacts } = cliEnvelope.details;
      expect({ ...cliEnvelope, details: cliFacts }).toEqual({
        ...mcp,
        details: mcpFacts,
      });
      expect({ ...cliEnvelope, details: cliFacts }).toEqual({
        error: "The published package version has no resolvable source ref",
        code: "VERSION_NOT_FOUND",
        retryable: false,
        details: { side: "from", availableVersions },
      });
    } finally {
      process.argv = previousArgv;
    }
  });

  it("PARITY-ERROR-ENVELOPE: invalid view/budget shares classification and envelope shape", async () => {
    const cli = await cliJson(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true, maxPatchBytes: "4096" },
      cliDeps(),
    );
    const mcpTool = createParityMcpTool("code_diff");
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
      error:
        "The `--max-patch-bytes` option is valid only when `--patch` is selected.",
    });
    expect(mcp).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error:
        "The maximum patch byte limit is valid only when the view is patch.",
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
    const mcpTool = createParityMcpTool("code_diff");
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
      error:
        "Package targets must not include a version; put both versions in `<from>..<to>`.",
    });
    expect(mcp).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error:
        "Package targets must not include a version; put both versions in the comparison endpoints.",
    });
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });

  it("PARITY-ERROR-ENVELOPE: CLI and MCP repository ref messages name their endpoint shapes", async () => {
    const cli = await cliJson(
      "github:expressjs/express@main",
      "1..2",
      undefined,
      { nameStatus: true },
      cliDeps(),
    );
    const mcpTool = createParityMcpTool("code_diff");
    const mcpResult = await mcpTool.handler(
      {
        target: "github:expressjs/express@main",
        from: "1",
        to: "2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");

    expect(cli).toEqual({
      code: "INVALID_ARGUMENT",
      error:
        "Repository targets must not include a ref; put both refs in `<from>..<to>`.",
      retryable: false,
    });
    expect(mcp).toEqual({
      code: "INVALID_ARGUMENT",
      error:
        "Repository targets must not include a ref; put both refs in the comparison endpoints.",
      retryable: false,
    });
  });

  it("PARITY-ERROR-ENVELOPE: CLI and MCP reject legacy repository refs with the canonical replacement", async () => {
    const target = "github:expressjs/express#main";
    const cli = await cliJson(
      target,
      "1..2",
      undefined,
      { nameStatus: true },
      cliDeps(),
    );
    const mcpTool = createParityMcpTool("code_diff");
    const mcpResult = await mcpTool.handler(
      {
        target,
        from: "1",
        to: "2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    const mcp = JSON.parse(mcpResult.content[0]?.text ?? "{}");
    const expected = {
      code: "INVALID_ARGUMENT",
      error:
        'Repository target "github:expressjs/express#main" uses legacy #ref syntax. Use "github:expressjs/express@main"; # is reserved for semantic fragments.',
      retryable: false,
    };

    expect(mcpResult.isError).toBe(true);
    expect(cli).toEqual(expected);
    expect(mcp).toEqual(expected);
  });

  it("PARITY-ERROR-ENVELOPE: empty comparison endpoint keeps stable shape", async () => {
    const cli = await cliJson(
      "npm:express",
      "..4.18.2",
      undefined,
      { nameStatus: true },
      cliDeps(),
    );
    const mcpTool = createParityMcpTool("code_diff");
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
      error: "Diff range endpoints must not be empty.",
    });
    expect(mcp).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
      error: "Diff from endpoint must not be empty.",
    });
    expect(Object.keys(cli as object).sort()).toEqual(
      Object.keys(mcp as object).sort(),
    );
  });
});

it.each(["tag_inferred", "unverified", "declared_revision_unavailable"])(
  "discloses %s independently in CLI/MCP diff text and JSON",
  async (state) => {
    const registry =
      state === "declared_revision_unavailable" ? "NPM" : "MAVEN";
    const name = registry === "MAVEN" ? "example:library" : "library";
    const target = `${registry.toLowerCase()}:${name}`;
    const result = structuredClone(defaultCodeDiffResult);
    result.package = {
      registry,
      name,
      repoUrl: "https://github.com/example/library",
    };
    result.fromResolution.releaseCorrespondence = state;
    result.toResolution.releaseCorrespondence = "manifest_matched";
    const codeDiff = mock(async () => result);
    const service = createMockCodeNavigationService({ codeDiff });
    const deps = cliDeps({ codeNavigationService: service });
    const tool = createParityMcpTool("code_diff", {
      codeNavigationService: service,
    });
    const cli = await cliJson(
      target,
      "4.18.1..4.18.2",
      undefined,
      { nameStatus: true },
      deps,
    );
    const mcpJson = await tool.handler(
      {
        target,
        from: "4.18.1",
        to: "4.18.2",
        view: "name-status",
        format: "json",
      },
      {},
    );
    expect(cli).toEqual(JSON.parse(mcpJson.content[0]?.text ?? "{}"));
    expect(cli).toMatchObject({
      from: { releaseCorrespondence: state },
      to: { releaseCorrespondence: "manifest_matched" },
    });
    const out = spyOn(process.stdout, "write").mockImplementation(() => true);
    const err = spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      await codeDiffAction(
        target,
        "4.18.1..4.18.2",
        undefined,
        { nameStatus: true },
        deps,
      );
      expect(out.mock.calls.map(([v]) => String(v)).join("")).toBe(
        "M\tlib/express.js\n",
      );
      const cliText = err.mock.calls.map(([v]) => String(v)).join("");
      const mcpText =
        (
          await tool.handler(
            { target, from: "4.18.1", to: "4.18.2", view: "name-status" },
            {},
          )
        ).content[0]?.text ?? "";
      for (const text of [cliText, mcpText]) {
        const flat = text.replace(/\s+/g, " ");
        expect(flat).toContain("library@4.18.1");
        expect(flat).toContain("From source: github:example/library@v4.18.1");
        expect(flat).not.toContain("To source: github:"); // Matched side carries no uncertainty notice.
        expect(flat).toContain(
          state === "tag_inferred"
            ? "version tag"
            : state === "unverified"
              ? "match to"
              : "listed revision for",
        );
      }
      expect(codeDiff).toHaveBeenCalledTimes(4);
    } finally {
      out.mockRestore();
      err.mockRestore();
    }
  },
);
