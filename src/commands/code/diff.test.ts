import { describe, expect, it, mock, spyOn } from "bun:test";
import { Command } from "commander";
import {
  createMockCodeNavigationService,
  defaultCodeDiffResult,
} from "../../services/test-helpers.js";
import {
  type CodeDiffCommandDependencies,
  codeDiffAction,
  formatCodeDiffError,
  registerCodeDiffCommand,
} from "./diff.js";

function dependencies(
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

describe("codeDiffAction", () => {
  it("uses patch mode by default and omits backend defaults", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const stdout = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await codeDiffAction(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      {},
      dependencies({
        codeNavigationService: createMockCodeNavigationService({ codeDiff }),
      }),
    );

    expect(codeDiff).toHaveBeenCalledWith({
      target: { registry: "NPM", packageName: "express" },
      from: "4.18.1",
      to: "4.18.2",
      mode: "patches",
    });
    expect(String(stdout.mock.calls[0]?.[0])).toContain("@@ -1 +1 @@");
    stdout.mockRestore();
  });

  it("maps repo mode, inventory view, bounds, and one positional glob", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const stdout = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );

    await codeDiffAction(
      "v1..v2",
      "src/**/*.ts",
      undefined,
      {
        repoUrl: "https://github.com/expressjs/express",
        nameStatus: true,
        maxFiles: "12",
      },
      dependencies({
        codeNavigationService: createMockCodeNavigationService({ codeDiff }),
      }),
      true,
    );

    expect(codeDiff).toHaveBeenCalledWith({
      target: { repoUrl: "https://github.com/expressjs/express" },
      from: "v1",
      to: "v2",
      mode: "inventory",
      options: { maxFiles: 12, pathGlob: "src/**/*.ts" },
    });
    expect(String(stdout.mock.calls[0]?.[0])).toBe("M\tlib/express.js\n");
    stdout.mockRestore();
  });

  it("emits the selected-view JSON envelope", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});

    await codeDiffAction(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { nameOnly: true, json: true },
      dependencies(),
    );

    const payload = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(payload.view).toBe("name-only");
    expect(payload.from.commitSha).toBe("from-sha");
    expect(payload.files).toEqual([
      { path: "lib/express.js", pathEncoding: "utf8" },
    ]);
    log.mockRestore();
  });

  it("keeps failed post-inventory content as successful evidence", async () => {
    const stdout = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const stderr = spyOn(process.stderr, "write").mockImplementation(
      (() => true) as typeof process.stderr.write,
    );
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.contentCoverage = "FAILED";
    result.raw.contentFailure = {
      code: "RAW_DIFF_LIMIT_EXCEEDED",
      retryable: false,
      stage: "content",
      limitKind: "max_content_entries",
    };
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: undefined,
      additions: undefined,
      deletions: undefined,
      contentStatus: "UNAVAILABLE",
    };

    await codeDiffAction(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      {},
      dependencies({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mock(() => Promise.resolve(result)),
        }),
      }),
    );

    expect(String(stderr.mock.calls[0]?.[0])).toContain(
      "Requested content failed",
    );
    stdout.mockRestore();
    stderr.mockRestore();
  });

  it.each([
    [{ patch: true, stat: true }, "Choose only one diff view"],
    [{ stat: true, maxPatchBytes: "2048" }, "valid only"],
    [{ maxFiles: "0" }, "--max-files expects"],
  ] as const)(
    "rejects invalid options before network I/O",
    async (options, text) => {
      const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("process.exit");
      });

      try {
        await codeDiffAction(
          "npm:express",
          "1.0.0..2.0.0",
          undefined,
          options,
          dependencies({
            codeNavigationService: createMockCodeNavigationService({
              codeDiff,
            }),
          }),
        );
      } catch {
        // process.exit is mocked as a throw.
      }

      expect(error.mock.calls[0]?.[0]).toContain(text);
      expect(codeDiff).not.toHaveBeenCalled();
      error.mockRestore();
      exit.mockRestore();
    },
  );

  it("rejects a third positional in repo mode", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await codeDiffAction(
        "v1..v2",
        "src/**",
        "extra",
        { repoUrl: "https://github.com/x/y" },
        dependencies(),
      );
    } catch {
      // process.exit is mocked as a throw.
    }
    expect(error.mock.calls[0]?.[0]).toContain("at most one");
    error.mockRestore();
    exit.mockRestore();
  });

  it("requires the Git-style -- delimiter before a path glob", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await codeDiffAction(
        "npm:express",
        "1.0.0..2.0.0",
        "src/**/*.ts",
        {},
        dependencies({
          codeNavigationService: createMockCodeNavigationService({ codeDiff }),
        }),
      );
    } catch {
      // process.exit is mocked as a throw.
    }
    expect(error.mock.calls[0]?.[0]).toContain("after `--`");
    expect(codeDiff).not.toHaveBeenCalled();
    error.mockRestore();
    exit.mockRestore();
  });
});

describe("formatCodeDiffError", () => {
  it("renders bounded recovery fields", () => {
    const output = formatCodeDiffError({
      code: "VERSION_NOT_FOUND",
      message: "Version was not found.",
      retryable: false,
      details: {
        side: "from",
        publishedVersions: ["2.0.0", "1.0.0"],
        publishedVersionsTruncated: true,
        stage: "resolution",
      },
    });

    expect(output).toContain("side: from");
    expect(output).toContain("stage: resolution");
    expect(output).toContain("2.0.0, 1.0.0, …");
  });
});

describe("registerCodeDiffCommand", () => {
  it("registers the dogfood surface without --git-ref", () => {
    const parent = new Command("code");
    const command = registerCodeDiffCommand(parent);

    expect(command.name()).toBe("diff");
    expect(
      command.options.some((option) => option.long === "--name-status"),
    ).toBe(true);
    expect(command.options.some((option) => option.long === "--git-ref")).toBe(
      false,
    );
  });

  it("accepts a path glob only when the raw argv suffix is -- <glob>", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const stdout = spyOn(process.stdout, "write").mockImplementation(
      (() => true) as typeof process.stdout.write,
    );
    const program = new Command("githits");
    const code = program.command("code");
    registerCodeDiffCommand(code, async () =>
      dependencies({
        codeNavigationService: createMockCodeNavigationService({ codeDiff }),
      }),
    );

    await program.parseAsync([
      "node",
      "githits",
      "code",
      "diff",
      "npm:express",
      "1.0.0..2.0.0",
      "--",
      "src/**/*.ts",
    ]);

    const calls = codeDiff.mock.calls as unknown as Array<
      [{ options?: { pathGlob?: string } }]
    >;
    expect(calls[0]?.[0].options?.pathGlob).toBe("src/**/*.ts");
    stdout.mockRestore();
  });

  it.each([
    [
      "glob before trailing delimiter",
      [
        "node",
        "githits",
        "code",
        "diff",
        "npm:express",
        "1.0.0..2.0.0",
        "src/**/*.ts",
        "--",
      ],
    ],
    [
      "root delimiter",
      [
        "node",
        "githits",
        "--",
        "code",
        "diff",
        "npm:express",
        "1.0.0..2.0.0",
        "src/**/*.ts",
      ],
    ],
  ] as const)("rejects a path glob with a %s", async (_label, argv) => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    const program = new Command("githits");
    const code = program.command("code");
    registerCodeDiffCommand(code, async () =>
      dependencies({
        codeNavigationService: createMockCodeNavigationService({ codeDiff }),
      }),
    );

    try {
      await program.parseAsync([...argv]);
    } catch {
      // process.exit is mocked as a throw.
    }

    expect(error.mock.calls[0]?.[0]).toContain("after `--`");
    expect(codeDiff).not.toHaveBeenCalled();
    error.mockRestore();
    exit.mockRestore();
  });
});
