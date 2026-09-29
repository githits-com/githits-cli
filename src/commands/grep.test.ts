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
      });
      expect(log.mock.calls[0]?.[0]).toBe(JSON.stringify(defaultGrepResult));
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
            ["grep", "router", "npm:x", flag, "11", flag, "0", "--json"],
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
        { context: ["11"], beforeContext: ["0"], afterContext: ["0"] },
        { beforeContext: ["-1"] },
        { afterContext: ["1.2"] },
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
      expect(write.mock.calls[0]?.[0]).toContain("Restart explicitly");
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
                      reason: "indexing",
                      retryable: true,
                      progress_ref: "index:1",
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
          .progress_ref,
      ).toBe("index:1");
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
      expect(ambiguous.details.hint).toContain("site_ambiguous");
      expect(ambiguous.details.hint).not.toContain("--wait");
      expect(stop).toHaveBeenCalledTimes(2);
      expect(log).not.toHaveBeenCalled();
    } finally {
      log.mockRestore();
      error.mockRestore();
      exit.mockRestore();
    }
  });
});
