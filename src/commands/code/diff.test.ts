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
    expect(payload.to.commitSha).toBe("to-sha");
    expect(payload.scope).toEqual({ status: "repository" });
    expect(payload.files).toEqual([
      { path: "lib/express.js", pathEncoding: "utf8" },
    ]);
    log.mockRestore();
  });

  it("emits authoritative patch headers in JSON", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: "--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n",
    };

    await codeDiffAction(
      "npm:express",
      "4.18.1..4.18.2",
      undefined,
      { json: true },
      dependencies({
        codeNavigationService: createMockCodeNavigationService({
          codeDiff: mock(() => Promise.resolve(result)),
        }),
      }),
    );

    const payload = JSON.parse(log.mock.calls[0]?.[0] as string);
    expect(payload.files[0].path).toBe("lib/express.js");
    expect(payload.files[0].patch).toStartWith(
      "--- a/lib/express.js\n+++ b/lib/express.js\n",
    );
    log.mockRestore();
  });

  it("suppresses failed post-inventory patch content and exits nonzero", async () => {
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

    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
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
    } catch {
      // process.exit is mocked as a throw.
    }

    expect(String(stderr.mock.calls[0]?.[0])).toContain(
      "Requested content failed",
    );
    expect(String(stderr.mock.calls[0]?.[0])).toContain(
      "Patch output was suppressed",
    );
    expect(stdout).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
    stdout.mockRestore();
    stderr.mockRestore();
    exit.mockRestore();
  });

  it.each([
    [{ patch: true, stat: true }, "Choose only one diff view", undefined],
    [
      { stat: true, maxPatchBytes: "2048" },
      "`--max-patch-bytes` is valid only",
      "maxPatchBytes",
    ],
    [{ maxFiles: "0" }, "--max-files expects", undefined],
  ] as const)(
    "rejects invalid options before network I/O",
    async (options, text, forbidden) => {
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
      if (forbidden) expect(error.mock.calls[0]?.[0]).not.toContain(forbidden);
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

  it("uses CLI-native wording for invalid path globs", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await codeDiffAction(
        "npm:express",
        "1.0.0..2.0.0",
        ":(exclude)lib/**",
        {},
        dependencies({
          codeNavigationService: createMockCodeNavigationService({ codeDiff }),
        }),
        true,
      );
    } catch {
      // process.exit is mocked as a throw.
    }
    expect(error.mock.calls[0]?.[0]).toContain("`<path-glob>`");
    expect(error.mock.calls[0]?.[0]).toContain("pathspec magic");
    expect(error.mock.calls[0]?.[0]).not.toContain("pathGlob");
    expect(codeDiff).not.toHaveBeenCalled();
    error.mockRestore();
    exit.mockRestore();
  });

  it.each([
    {
      arg1: "npm:express@5.0.0",
      arg2: "1.0.0..2.0.0",
      options: {},
      expected: "`<from>..<to>`",
      forbidden: "`range`",
    },
    {
      arg1: "1.0.0..2.0.0",
      arg2: undefined,
      options: { repoUrl: "npm:express" },
      expected: "`--repo-url`",
      forbidden: "`repoUrl`",
    },
  ])("uses CLI names for target validation", async (testCase) => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });
    try {
      await codeDiffAction(
        testCase.arg1,
        testCase.arg2,
        undefined,
        testCase.options,
        dependencies(),
      );
    } catch {
      // process.exit is mocked as a throw.
    }
    expect(error.mock.calls[0]?.[0]).toContain(testCase.expected);
    expect(error.mock.calls[0]?.[0]).not.toContain(testCase.forbidden);
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

  it("uses diff-specific target guidance", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    try {
      await codeDiffAction(
        "express",
        "1.0.0..2.0.0",
        undefined,
        {},
        dependencies({
          codeNavigationService: createMockCodeNavigationService({ codeDiff }),
        }),
      );
    } catch {
      // process.exit is mocked as a throw.
    }

    expect(error.mock.calls[0]?.[0]).toContain(
      "unversioned package target `<registry>:<name>`",
    );
    expect(error.mock.calls[0]?.[0]).not.toContain("[@<version>]");
    expect(error.mock.calls[0]?.[0]).not.toContain("[#ref|@ref]");
    expect(error.mock.calls[0]?.[0]).toContain("supported registries");
    expect(error.mock.calls[0]?.[0]).toContain("npm");
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
    expect(output).toContain("2.0.0, 1.0.0 (+more)");
  });

  it("marks locally truncated recovery lists", () => {
    const output = formatCodeDiffError({
      code: "REF_NOT_FOUND",
      message: "Ref was not found.",
      retryable: false,
      details: {
        availableRefs: Array.from({ length: 10 }, (_, index) => ({
          ref: `ref-${index}`,
        })),
      },
    });

    expect(output).toContain("ref-0, ref-1");
    expect(output).toContain("(+2 more)");
  });

  it("preserves a local lower bound when the backend also truncated", () => {
    const output = formatCodeDiffError({
      code: "VERSION_NOT_FOUND",
      message: "Version was not found.",
      retryable: false,
      details: {
        publishedVersions: Array.from(
          { length: 10 },
          (_, index) => `${index}.0.0`,
        ),
        publishedVersionsTruncated: true,
      },
    });

    expect(output).toContain("(+2+ more)");
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

  it("shows the two concrete invocation forms in help", () => {
    const program = new Command("githits");
    const command = registerCodeDiffCommand(program.command("code"));
    const help = command.helpInformation();

    expect(help).toContain(
      "githits code diff [options] <target> <from>..<to> [-- <path-glob>]",
    );
    expect(help).toContain(
      "githits code diff [options] --repo-url <url> <from>..<to> [-- <path-glob>]",
    );
    expect(help).not.toContain("[target-or-range] [range-or-path-glob]");
    expect(help).toContain(
      "Compare repository trees resolved from package versions or repository refs",
    );
    expect(help).toContain("Diffs are always repository-wide");
    expect(help).toContain("Sibling package paths");
    expect(help).toContain("bounded relevance-ranked result may contain no");
    expect(help).toContain("Maximum relevance-ranked returned files");
    expect(help).toContain("Target examples: `npm:express`");
    expect(help).toContain("suppressed patch output exits 1");
  });

  it.each(["src/**/*.ts", "--"])(
    "accepts path glob %s when the raw argv suffix is -- <glob>",
    async (pathGlob) => {
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
        pathGlob,
      ]);

      const calls = codeDiff.mock.calls as unknown as Array<
        [{ options?: { pathGlob?: string } }]
      >;
      expect(calls[0]?.[0].options?.pathGlob).toBe(pathGlob);
      stdout.mockRestore();
    },
  );

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
