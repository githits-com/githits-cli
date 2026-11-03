import { describe, expect, it, mock, spyOn } from "bun:test";
import { GrepGraphQLError, type GrepParams } from "@githits/core-internal";
import { Command } from "commander";
import {
  createMockGrepService,
  defaultGrepResult,
} from "../services/test-helpers.js";
import {
  type GrepCommandDependencies,
  type GrepCommandOptions,
  grepAction,
  registerGrepCommand,
} from "./grep.js";

function deps(
  overrides: Partial<GrepCommandDependencies> = {},
): GrepCommandDependencies {
  return {
    grepService: createMockGrepService(),
    hasValidToken: true,
    mcpUrl: "https://example.test",
    createSpinner: () => ({ stop: () => {} }),
    ...overrides,
  };
}

describe("unified grep CLI", () => {
  it("registers grep/rg flags and explains remote differences", () => {
    const help = registerGrepCommand(new Command()).helpInformation();
    expect(help).toContain("<pattern> <targets...>");
    for (const flag of [
      "-F, --fixed-strings",
      "-i, --ignore-case",
      "-s, --case-sensitive",
      "-A, --after-context",
      "-B, --before-context",
      "-C, --context",
      "--path-prefix",
      "--corpus",
      "--cursor",
      "--limit",
      "--wait",
      "--json",
    ])
      expect(help).toContain(flag);
    expect(help).toContain("RE2");
    expect(help).toContain("global page cap");
    expect(help).toContain("independently");
    expect(help).not.toContain("--literal");
    expect(help).not.toContain("--regex");
    expect(help).toContain("capped at 10");
    expect(help).toContain("--path lib/express.js");
    expect(help).toContain("--path-prefix lib/");
    expect(help).toContain("Targets, not file paths");
    const prose = help.replace(/\s+/g, " ");
    expect(prose).toContain("Defaults: RE2 regex");
    expect(prose).toContain(
      "foo|bar alternates; foo\\|bar matches a literal pipe.",
    );
    expect(prose).toContain("Content-index regex needs literal text");
    expect(prose).toContain(
      "a single exact-file route accepts anchorless regex",
    );
    expect(prose.split("foo\\|bar")).toHaveLength(2);
    expect(prose).not.toContain("unsupported or anchorless expressions fail");
  });
  it("parses ordered mixed operands and interleaved selectors with explicit defaults", async () => {
    const grep = mock((_params: GrepParams) =>
      Promise.resolve(defaultGrepResult),
    );
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = new Command("githits");
      registerGrepCommand(program, async () =>
        deps({ grepService: createMockGrepService({ grep }) }),
      );
      await program.parseAsync(
        [
          "grep",
          "router",
          "npm:x",
          "--glob",
          "**/*.ts",
          "site:docs.test",
          "--path",
          "a.ts",
          "--path-prefix",
          "lib/",
          "--glob",
          "**/*.js",
          "npm:x",
          "--json",
        ],
        { from: "user" },
      );
      expect(grep.mock.calls[0]?.[0]).toEqual({
        targets: [
          {
            target: "npm:x",
            corpus: "ALL",
            allowUnscoped: true,
            pathSelectors: [
              { kind: "GLOB", value: "**/*.ts" },
              { kind: "EXACT", value: "a.ts" },
              { kind: "PREFIX", value: "lib/" },
              { kind: "GLOB", value: "**/*.js" },
            ],
          },
          { target: "site:docs.test" },
          {
            target: "npm:x",
            corpus: "ALL",
            allowUnscoped: true,
            pathSelectors: [
              { kind: "GLOB", value: "**/*.ts" },
              { kind: "EXACT", value: "a.ts" },
              { kind: "PREFIX", value: "lib/" },
              { kind: "GLOB", value: "**/*.js" },
            ],
          },
        ],
        pattern: "router",
        patternType: "REGEX",
        caseSensitive: true,
        contextLinesBefore: 0,
        contextLinesAfter: 0,
        includeDetailedFields: true,
        waitTimeoutMs: 30000,
      });
      expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(
        defaultGrepResult,
      );
    } finally {
      log.mockRestore();
    }
  });
  it("makes the last case flag win including short clusters and repeats", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const [flags, expected] of [
        [[], true],
        [["-i"], false],
        [["-is"], true],
        [["-si"], false],
        [["-i", "-s", "-i"], false],
        [["--ignore-case", "--case-sensitive"], true],
      ] as const) {
        const grep = mock((_params: GrepParams) =>
          Promise.resolve(defaultGrepResult),
        );
        const program = new Command();
        registerGrepCommand(program, async () =>
          deps({ grepService: createMockGrepService({ grep }) }),
        );
        await program.parseAsync(
          ["grep", ...flags, "router", "npm:x", "--json"],
          { from: "user" },
        );
        expect(grep.mock.calls[0]?.[0].caseSensitive).toBe(expected);
      }
    } finally {
      log.mockRestore();
    }
  });
  it("uses literal mode, side-over-symmetric context and leading-dash patterns", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      for (const flags of [
        ["-A", "1", "-C", "2", "-B", "0"],
        ["-C", "2", "-A", "1", "-B", "0"],
      ]) {
        const grep = mock((_params: GrepParams) =>
          Promise.resolve(defaultGrepResult),
        );
        const program = new Command();
        registerGrepCommand(program, async () =>
          deps({ grepService: createMockGrepService({ grep }) }),
        );
        await program.parseAsync(
          ["grep", "-F", ...flags, "--json", "--", "--foo", "github:o/r"],
          { from: "user" },
        );
        expect(grep.mock.calls[0]?.[0]).toMatchObject({
          pattern: "--foo",
          patternType: "LITERAL",
          contextLinesBefore: 0,
          contextLinesAfter: 1,
        });
      }
    } finally {
      log.mockRestore();
    }
  });
  it("validates every repeated context flag before choosing the final value", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      for (const flag of ["-A", "-B", "-C"]) {
        const d = deps();
        const program = new Command();
        registerGrepCommand(program, async () => d);
        await expect(
          program.parseAsync(
            ["grep", "router", "npm:x", flag, "invalid", flag, "0", "--json"],
            { from: "user" },
          ),
        ).rejects.toThrow("exit");
        expect(d.grepService.grep).not.toHaveBeenCalled();
        expect(JSON.parse(String(error.mock.calls.at(-1)?.[0])).code).toBe(
          "INVALID_ARGUMENT",
        );
      }
      const grep = mock((_params: GrepParams) =>
        Promise.resolve(defaultGrepResult),
      );
      const program = new Command();
      registerGrepCommand(program, async () =>
        deps({ grepService: createMockGrepService({ grep }) }),
      );
      await program.parseAsync(
        [
          "grep",
          "router",
          "npm:x",
          "-A",
          "1",
          "-A",
          "3",
          "-B",
          "0",
          "-B",
          "4",
          "-C",
          "1",
          "-C",
          "2",
          "--json",
        ],
        { from: "user" },
      );
      expect(grep.mock.calls[0]?.[0]).toMatchObject({
        contextLinesBefore: 4,
        contextLinesAfter: 3,
      });
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });
  it("rejects all invalid context controls and source flags on site-only operands", async () => {
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      for (const options of [
        { beforeContext: ["-1"] },
        { afterContext: ["1.2"] },
        { context: ["9007199254740992"] },
        { context: [""] },
        { corpus: "all" },
        { pathSelectors: [{ kind: "exact", value: "a" }] },
        { pathSelectors: [{ kind: "glob", value: "*" }] },
      ] satisfies GrepCommandOptions[]) {
        const d = deps();
        await expect(
          grepAction(
            "router",
            ["site:docs.test"],
            { ...options, json: true },
            d,
          ),
        ).rejects.toThrow("exit");
        expect(d.grepService.grep).not.toHaveBeenCalled();
        expect(JSON.parse(String(error.mock.calls.at(-1)?.[0])).code).toBe(
          "INVALID_ARGUMENT",
        );
      }
    } finally {
      exit.mockRestore();
      error.mockRestore();
    }
  });
  it.each([0, 10, 11, 20])(
    "normalizes context %s with structured JSON facts only when capped",
    async (requested) => {
      const d = deps();
      const log = spyOn(console, "log").mockImplementation(() => {});
      const error = spyOn(console, "error").mockImplementation(() => {});
      try {
        await grepAction(
          "router",
          ["npm:x"],
          { context: [String(requested)], json: true },
          d,
        );
        expect(d.grepService.grep).toHaveBeenCalledTimes(1);
        expect(d.grepService.grep).toHaveBeenCalledWith(
          expect.objectContaining({
            contextLinesBefore: Math.min(requested, 10),
            contextLinesAfter: Math.min(requested, 10),
          }),
        );
        expect(log).toHaveBeenCalledTimes(1);
        expect(error).not.toHaveBeenCalled();
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual({
          ...defaultGrepResult,
          ...(requested > 10
            ? {
                contextClamping: {
                  requestedBefore: requested,
                  requestedAfter: requested,
                  effectiveBefore: 10,
                  effectiveAfter: 10,
                },
              }
            : {}),
        });
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    },
  );

  it("reports asymmetric clamping once on text stderr with the larger-read action", async () => {
    const d = deps();
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    const error = spyOn(console, "error").mockImplementation(() => {});
    try {
      await grepAction(
        "router",
        ["npm:x"],
        { context: ["20"], afterContext: ["3"] },
        d,
      );
      expect(d.grepService.grep).toHaveBeenCalledWith(
        expect.objectContaining({
          contextLinesBefore: 10,
          contextLinesAfter: 3,
        }),
      );
      expect(error).toHaveBeenCalledTimes(1);
      expect(error.mock.calls[0]?.[0]).toBe(
        "Context capped (before/after): 20/3 -> 10/3. More: githits read.",
      );
      expect(write).toHaveBeenCalledTimes(1);
      expect(String(write.mock.calls[0]?.[0])).not.toContain("Context capped");
    } finally {
      write.mockRestore();
      error.mockRestore();
    }
  });

  it.each([
    { context: ["20"], beforeContext: ["0"], afterContext: ["0"] },
    { context: ["20", "3"] },
  ] satisfies GrepCommandOptions[])(
    "does not report overridden excessive context: %j",
    async (options) => {
      const log = spyOn(console, "log").mockImplementation(() => {});
      const error = spyOn(console, "error").mockImplementation(() => {});
      const d = deps();
      try {
        await grepAction("router", ["npm:x"], { ...options, json: true }, d);
        const expected = options.beforeContext ? 0 : 3;
        expect(d.grepService.grep).toHaveBeenCalledWith(
          expect.objectContaining({
            contextLinesBefore: expected,
            contextLinesAfter: expected,
          }),
        );
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(
          defaultGrepResult,
        );
        expect(error).not.toHaveBeenCalled();
      } finally {
        log.mockRestore();
        error.mockRestore();
      }
    },
  );

  it("keeps a clamped service failure as one JSON stderr error without stdout", async () => {
    const grep = mock(() =>
      Promise.reject(
        new GrepGraphQLError("server timeout", { code: "TIMEOUT" }),
      ),
    );
    const stop = mock(() => {});
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(
        grepAction(
          "router",
          ["npm:x"],
          { context: ["20"], json: true },
          deps({
            grepService: createMockGrepService({ grep }),
            createSpinner: () => ({ stop }),
          }),
        ),
      ).rejects.toThrow("exit");
      expect(grep).toHaveBeenCalledTimes(1);
      expect(grep).toHaveBeenCalledWith(
        expect.objectContaining({
          contextLinesBefore: 10,
          contextLinesAfter: 10,
        }),
      );
      expect(stop).toHaveBeenCalledTimes(1);
      expect(log).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(error.mock.calls[0]?.[0])).code).toBe("TIMEOUT");
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it("does not print a clamping notice before another argument fails validation", async () => {
    const d = deps();
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(
        grepAction("router", ["npm:x"], { context: ["20"], limit: "0" }, d),
      ).rejects.toThrow("exit");
      expect(d.grepService.grep).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledTimes(1);
      expect(String(error.mock.calls[0]?.[0])).not.toContain("Context capped");
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it.each(["-1", "1.2", "abc", "9007199254740992"])(
    "reports invalid CLI context %s with native flag and raw value",
    async (value) => {
      const d = deps();
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      try {
        await expect(
          grepAction(
            "router",
            ["npm:x"],
            { beforeContext: [value], json: true },
            d,
          ),
        ).rejects.toThrow("exit");
        const payload = JSON.parse(String(error.mock.calls[0]?.[0]));
        expect(payload.code).toBe("INVALID_ARGUMENT");
        expect(payload.error).toContain("--before-context");
        expect(payload.error).toContain("nonnegative safe integer");
        expect(payload.error).toContain(`Got ${JSON.stringify(value)}.`);
        expect(d.grepService.grep).not.toHaveBeenCalled();
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("keeps partial and cursor-expired pages successful and always stops the spinner", async () => {
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    const stop = mock(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("unexpected exit");
    });
    try {
      await grepAction(
        "router",
        ["npm:x"],
        {},
        deps({
          createSpinner: () => ({ stop }),
          grepService: createMockGrepService({
            grep: async () => ({
              ...defaultGrepResult,
              traversal: "CURSOR_EXPIRED",
            }),
          }),
        }),
      );
      expect(exit).not.toHaveBeenCalled();
      expect(stop).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[0]).toContain("To restart the full search");
    } finally {
      write.mockRestore();
      exit.mockRestore();
    }
  });
  it("emits clean structured auth and preparation errors without writing stdout", async () => {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    const stop = mock(() => {});
    try {
      await expect(
        grepAction(
          "router",
          ["npm:x"],
          { json: true },
          deps({ hasValidToken: false }),
        ),
      ).rejects.toThrow("exit");
      expect(JSON.parse(String(error.mock.calls[0]?.[0])).code).toBe(
        "AUTH_REQUIRED",
      );
      await expect(
        grepAction(
          "router",
          ["npm:x"],
          { json: true },
          deps({
            createSpinner: () => ({ stop }),
            grepService: createMockGrepService({
              grep: async () => {
                throw new GrepGraphQLError("not ready", {
                  code: "GREP_TARGET_PREPARATION_REQUIRED",
                  retryable: true,
                  target_issues: [
                    {
                      input_index: 0,
                      reason: "repository_indexing",
                      retryable: true,
                    },
                  ],
                });
              },
            }),
          }),
        ),
      ).rejects.toThrow("exit");
      expect(
        JSON.parse(String(error.mock.calls.at(-1)?.[0])).details.targetIssues[0]
          .reason,
      ).toBe("repository_indexing");
      expect(
        JSON.parse(String(error.mock.calls.at(-1)?.[0])).details.hint,
      ).toContain("--wait <ms>");
      await expect(
        grepAction(
          "router",
          ["site:docs.test"],
          { json: true },
          deps({
            createSpinner: () => ({ stop }),
            grepService: createMockGrepService({
              grep: async () => {
                throw new GrepGraphQLError("ambiguous", {
                  code: "GREP_TARGET_PREPARATION_REQUIRED",
                  retryable: false,
                  target_issues: [
                    {
                      input_index: 0,
                      reason: "site_ambiguous",
                      retryable: false,
                    },
                  ],
                });
              },
            }),
          }),
        ),
      ).rejects.toThrow("exit");
      const ambiguous = JSON.parse(String(error.mock.calls.at(-1)?.[0]));
      expect(ambiguous.retryable).toBe(false);
      expect(ambiguous.code).toBe("INVALID_ARGUMENT");
      expect(ambiguous.details.hint).toBeUndefined();
      expect(ambiguous.details.hint ?? "").not.toContain("--wait");
      expect(stop).toHaveBeenCalledTimes(2);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });
  it.each([
    ["repository_indexing", "INDEXING", true, "job"],
    ["documentation_publishing", "INDEXING", true, "job"],
    ["documentation_discovery", "INDEXING", true, undefined],
    ["site_v6_required", "INDEXING", true, undefined],
    ["starting_url_pending", "INDEXING", true, undefined],
    ["repository_not_found", "NOT_FOUND", false, undefined],
    ["repository_ref_not_found", "REF_NOT_FOUND", false, undefined],
    ["package_version_not_found", "VERSION_NOT_FOUND", false, undefined],
    ["repository_ref_ambiguous", "INVALID_ARGUMENT", false, undefined],
    ["repository_legally_blocked", "UNRESOLVABLE", false, undefined],
    ["repository_unavailable", "BACKEND_ERROR", true, "job"],
    ["future_reason", "UNRESOLVABLE", true, undefined],
    ["future_reason", "INDEXING", true, "job"],
  ] as const)(
    "emits %s as %s in CLI JSON",
    async (reason, code, retryable, progress_ref) => {
      const issues = [
        {
          input_index: 0,
          target: "npm:x",
          reason,
          retryable,
          ...(progress_ref ? { progress_ref } : {}),
        },
      ];
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      try {
        await expect(
          grepAction(
            "router",
            ["npm:x"],
            { json: true },
            deps({
              grepService: createMockGrepService({
                grep: async () => {
                  throw new GrepGraphQLError("Backend diagnostic.", {
                    code: "GREP_TARGET_PREPARATION_REQUIRED",
                    retryable,
                    target_issues: issues,
                  });
                },
              }),
            }),
          ),
        ).rejects.toThrow("exit");
        const result = JSON.parse(String(error.mock.calls[0]?.[0]));
        expect(result).toMatchObject({
          error: "Backend diagnostic.",
          code,
          retryable,
          details: {
            graphqlCode: "GREP_TARGET_PREPARATION_REQUIRED",
            targetIssues: issues,
          },
        });
        expect((result.details.hint ?? "").includes("--wait")).toBe(
          code === "INDEXING" && retryable,
        );
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );

  it("emits the terminal blocker for mixed progress and missing targets in CLI JSON", async () => {
    const issues = [
      { input_index: 0, reason: "repository_indexing", retryable: true },
      { input_index: 1, reason: "repository_not_found", retryable: false },
    ];
    const error = spyOn(console, "error").mockImplementation(() => {});
    const exit = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("exit");
    });
    try {
      await expect(
        grepAction(
          "router",
          ["npm:a", "npm:b"],
          { json: true },
          deps({
            grepService: createMockGrepService({
              grep: async () => {
                throw new GrepGraphQLError("Mixed blockers", {
                  code: "GREP_TARGET_PREPARATION_REQUIRED",
                  retryable: false,
                  target_issues: issues,
                });
              },
            }),
          }),
        ),
      ).rejects.toThrow("exit");
      const result = JSON.parse(String(error.mock.calls[0]?.[0]));
      expect(result).toMatchObject({
        code: "NOT_FOUND",
        retryable: false,
        details: { targetIssues: issues },
      });
      expect(result.details.hint).toContain("repository was not found");
      expect(result.details.hint).not.toMatch(/repository_not_found|--wait/);
    } finally {
      error.mockRestore();
      exit.mockRestore();
    }
  });

  it.each(["package_version_not_found", "repository_ref_not_found"] as const)(
    "retains additional blockers and path facts for %s in text",
    async (reason) => {
      const issues = [
        {
          input_index: 0,
          target: "npm:a",
          reason,
          retryable: false,
          file_path: "lib/a.js",
        },
        {
          input_index: 1,
          target: "npm:b",
          reason: "repository_not_found",
          retryable: false,
        },
      ];
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      try {
        await expect(
          grepAction(
            "router",
            ["npm:a", "npm:b"],
            {},
            deps({
              grepService: createMockGrepService({
                grep: async () => {
                  throw new GrepGraphQLError("First target diagnostic.", {
                    code: "GREP_TARGET_PREPARATION_REQUIRED",
                    retryable: false,
                    target_issues: issues,
                  });
                },
              }),
            }),
          ),
        ).rejects.toThrow("exit");
        const text = String(error.mock.calls[0]?.[0]).replace(/\s+/g, " ");
        expect(text).toContain("First target diagnostic.");
        expect(text).toContain("npm:a: path lib/a.js");
        expect(text).toContain("npm:b: repository was not found");
        expect(text).not.toMatch(/repository_not_found|--wait/);
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );
  it.each([
    ["repository_indexing", "repository is being indexed"],
    ["documentation_publishing", "documentation is being prepared"],
    ["documentation_discovery", "documentation sources are being discovered"],
    [
      "site_v6_required",
      "documentation site requires a publication format update",
    ],
    ["starting_url_pending", "requested documentation URL is being prepared"],
  ] as const)(
    "retains the pending target and %s reason in text",
    async (reason, copy) => {
      const issues = [
        {
          input_index: 0,
          target: "npm:x",
          reason,
          retryable: true,
          message: "Preparation is pending.",
        },
      ];
      const error = spyOn(console, "error").mockImplementation(() => {});
      const exit = spyOn(process, "exit").mockImplementation(() => {
        throw new Error("exit");
      });
      try {
        await expect(
          grepAction(
            "router",
            ["npm:x"],
            {},
            deps({
              grepService: createMockGrepService({
                grep: async () => {
                  throw new GrepGraphQLError("Preparation is pending.", {
                    code: "GREP_TARGET_PREPARATION_REQUIRED",
                    retryable: true,
                    target_issues: issues,
                  });
                },
              }),
            }),
          ),
        ).rejects.toThrow("exit");
        const text = String(error.mock.calls[0]?.[0]).replace(/\s+/g, " ");
        expect(text).toContain(`npm:x: ${copy}`);
        expect(text).toContain("--wait");
        expect(text).not.toContain(reason);
      } finally {
        error.mockRestore();
        exit.mockRestore();
      }
    },
  );
});
