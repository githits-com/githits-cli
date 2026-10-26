import { describe, expect, it, mock, spyOn } from "bun:test";
import type { GrepParams, GrepResult } from "@githits/core-internal";
import { Command } from "commander";
import { registerGrepCommand } from "../commands/grep.js";
import {
  createMockGrepService,
  defaultGrepResult,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

describe("unified grep CLI/MCP parity", () => {
  it("shares qualified empty copy and selective recovery while preserving JSON", async () => {
    const result: GrepResult = {
      ...defaultGrepResult,
      traversal: "NON_RESUMABLE_PARTIAL",
      unavailableTargets: [
        {
          inputIndex: 0,
          target: "npm:pending",
          reason: "repository_indexing",
          retryable: true,
          progressRef: null,
          suggestedSiteTargets: null,
        },
        {
          inputIndex: 1,
          target: "npm:terminal",
          reason: "no_grep_scopes",
          retryable: false,
          progressRef: null,
          suggestedSiteTargets: null,
        },
      ],
    };
    const before = structuredClone(result);
    const grepService = createMockGrepService({
      grep: mock(() => Promise.resolve(result)),
    });
    const write = spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const program = new Command("githits");
      registerGrepCommand(program, async () => ({
        grepService,
        hasValidToken: true,
        mcpUrl: "https://example.test",
        createSpinner: () => ({ stop: () => {} }),
      }));
      await program.parseAsync(
        ["grep", "router", "npm:pending", "npm:terminal"],
        { from: "user" },
      );
      const cli = write.mock.calls.map(([chunk]) => String(chunk)).join("");
      const tool = createParityMcpTool("grep", { grepService });
      const args = {
        targets: [{ target: "npm:pending" }, { target: "npm:terminal" }],
        pattern: "router",
      };
      const mcp = await tool.handler(args);
      expect(mcp.isError).toBeUndefined();
      const mcpText = String(mcp.content[0]?.text);
      expect(cli).toContain("None of the requested content could be searched.");
      expect(cli).toContain(
        "Repeat the same pattern and options for:\n    npm:pending",
      );
      expect(cli).toContain(
        "Omit --cursor; set --wait 30000 to wait up to 30s for preparation.",
      );
      expect(mcpText).toContain(
        "Omit cursor; set wait_timeout_ms=30000 to wait up to 30s for preparation.",
      );
      expect(
        cli
          .replace("--wait 30000", "wait_timeout_ms=30000")
          .replace("Omit --cursor", "Omit cursor")
          .trim(),
      ).toBe(mcpText);
      const json = await tool.handler({ ...args, format: "json" });
      expect(JSON.parse(String(json.content[0]?.text))).toEqual(before);
      expect(result).toEqual(before);
    } finally {
      write.mockRestore();
    }
  });

  it("sends equivalent mixed targets and controls and returns the same JSON", async () => {
    const grep = mock((_params: GrepParams) =>
      Promise.resolve(defaultGrepResult),
    );
    const grepService = createMockGrepService({ grep });
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      const program = new Command("githits");
      registerGrepCommand(program, async () => ({
        grepService,
        hasValidToken: true,
        mcpUrl: "https://example.test",
        createSpinner: () => ({ stop: () => {} }),
      }));
      await program.parseAsync(
        [
          "grep",
          "-F",
          "-i",
          "-C",
          "2",
          "-A",
          "1",
          "-B",
          "0",
          "router",
          "npm:express",
          "site:expressjs.com",
          "--corpus",
          "documentation",
          "--path",
          "History.md",
          "--glob",
          "docs/**",
          "--limit",
          "7",
          "--cursor",
          "page-two",
          "--wait",
          "20",
          "--json",
        ],
        { from: "user" },
      );
      const cliParams = grep.mock.calls[0]?.[0];
      const cliJson = String(log.mock.calls[0]?.[0]);

      const mcp = await createParityMcpTool("grep", { grepService }).handler({
        targets: [
          {
            target: "npm:express",
            corpus: "documentation",
            path_selectors: [
              { kind: "exact", value: "History.md" },
              { kind: "glob", value: "docs/**" },
            ],
          },
          { target: "site:expressjs.com" },
        ],
        pattern: "router",
        pattern_type: "literal",
        ignore_case: true,
        context_lines_before: 0,
        context_lines_after: 1,
        max_matches: 7,
        cursor: "page-two",
        wait_timeout_ms: 20,
        format: "json",
      });

      expect(mcp.isError).toBeUndefined();
      expect(grep).toHaveBeenCalledTimes(2);
      expect(grep.mock.calls[1]?.[0]).toEqual(cliParams);
      expect(mcp.content[0]?.text).toBe(cliJson);
    } finally {
      log.mockRestore();
    }
  });
});

describe("package-path advisory CLI/MCP parity", () => {
  for (const shape of ["zero-hit", "mixed-pending", "pending-only"] as const) {
    it(`preserves ${shape} short-wait pages in text and JSON without rewriting requests`, async () => {
      const path = "packages/x/src 'quoted';$HOME";
      const warning = {
        requestedInputIndices: [0, 2],
        target: "npm:x",
        path,
        repositorySubpath: "packages/x",
        message:
          'Package paths are relative to the package root. Did you mean target "npm:x" with path "src"?',
        suggestions: [
          { target: "npm:x", path: "src 'quoted';$HOME" },
          { target: `github:o/r@${"c".repeat(40)}`, path },
        ],
      };
      const result: GrepResult = {
        ...defaultGrepResult,
        pathWarnings:
          shape === "pending-only"
            ? []
            : [
                warning,
                {
                  ...warning,
                  requestedInputIndices: [1],
                  path: "packages/x/test",
                },
              ],
        traversal: shape === "zero-hit" ? "COMPLETE" : "NON_RESUMABLE_PARTIAL",
        unavailableTargets:
          shape === "zero-hit"
            ? []
            : [
                {
                  inputIndex: 1,
                  target: "npm:pending",
                  reason: "repository_indexing",
                  retryable: true,
                  progressRef: "opaque-progress",
                  suggestedSiteTargets: null,
                },
              ],
      };
      if (shape !== "pending-only") {
        result.targets = [
          {
            targetIndex: 0,
            requestedInputIndices: [0, 2],
            kind: "REPOSITORY",
            target: "npm:x",
            traversal: "COMPLETE",
            readiness: "CURRENT",
            errorCode: null,
            retryable: false,
            publicMessage: null,
            requestedRef: "v1",
            commitSha: "c".repeat(40),
            corpus: "ALL",
            filesScanned: 0,
            filesInScope: 0,
            binaryFilesSkipped: 0,
            filesTooLargeSkipped: 0,
            fileIssues: [],
            fileIssuesOmitted: 0,
            repoUrl: "https://github.com/o/r",
            canonicalSite: null,
          },
        ];
      }
      if (shape === "mixed-pending") {
        result.totalMatches = 1;
        result.hits = [
          {
            __typename: "GrepRepositoryHit",
            targetIndex: 0,
            filePath: "src/a.ts",
            line: 1,
            lineSlice: {
              content: "router",
              startByte: 0,
              endByte: 6,
              originalLineBytes: 6,
            },
            contextBeforeSlices: [],
            contextAfterSlices: [],
            matchStartByte: 0,
            matchEndByte: 6,
            contentSafety: { filtered: false },
            read: {
              target: `github:o/r@${"c".repeat(40)}`,
              path: "packages/x/src/a.ts",
              startLine: 1,
              endLine: 1,
            },
          },
        ];
      }
      const before = structuredClone(result);
      const grep = mock((_params: GrepParams) => Promise.resolve(result));
      const grepService = createMockGrepService({ grep });
      const write = spyOn(process.stdout, "write").mockImplementation(
        () => true,
      );
      const log = spyOn(console, "log").mockImplementation(() => {});
      try {
        const runCli = async (json: boolean): Promise<void> => {
          const program = new Command("githits");
          registerGrepCommand(program, async () => ({
            grepService,
            hasValidToken: true,
            mcpUrl: "https://example.test",
            createSpinner: () => ({ stop: () => {} }),
          }));
          await program.parseAsync(
            [
              "grep",
              "router",
              "npm:x",
              "npm:pending",
              "npm:x",
              "--path-prefix",
              path,
              "--wait",
              "0",
              ...(json ? ["--json"] : []),
            ],
            { from: "user" },
          );
        };
        const tool = createParityMcpTool("grep", { grepService });
        const args = {
          targets: ["npm:x", "npm:pending", "npm:x"].map((target) => ({
            target,
            path_selectors: [{ kind: "prefix", value: path }],
          })),
          pattern: "router",
          wait_timeout_ms: 0,
        };
        await runCli(false);
        const cli = write.mock.calls.map(([chunk]) => String(chunk)).join("");
        const mcp = await tool.handler(args);
        expect(mcp.isError).toBeUndefined();
        const text = String(mcp.content[0]?.text);
        if (shape === "pending-only") {
          expect(cli).toContain("No matches available yet");
          expect(text).toContain("No matches available yet");
          expect(text).not.toContain("Path advisories:");
          expect(cli).not.toContain("Path advisories:");
        } else {
          for (const output of [cli, text]) {
            expect(
              output.split("\n").filter((line) => line.startsWith("Warning:")),
            ).toEqual([
              'Warning: Path is prefixed with package path "packages/x". Did you mean "src \'quoted\';$HOME"?',
            ]);
            expect(output).not.toContain(warning.message);
            expect(output).not.toContain("Unverified alternatives");
            if (shape === "mixed-pending") {
              expect(output).toContain("1: router");
              expect(output).toContain("Preparing:");
              expect(output).toContain("npm:pending");
            } else expect(output).toStartWith("No matches found.");
          }
          expect(text).not.toContain(JSON.stringify(warning.suggestions[1]));
          expect(cli).not.toContain(
            `target='${warning.suggestions[1]!.target}' path=`,
          );
        }
        expect(grep.mock.calls[0]?.[0]).toEqual(grep.mock.calls[1]?.[0]);
        await runCli(true);
        const json = await tool.handler({ ...args, format: "json" });
        expect(json.isError).toBeUndefined();
        const expected = {
          ...before,
          pathWarnings: [
            ...new Set(
              before.pathWarnings.map(
                () =>
                  'Path is prefixed with package path "packages/x". Did you mean "src \'quoted\';$HOME"?',
              ),
            ),
          ],
        };
        expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toEqual(expected);
        expect(JSON.parse(String(json.content[0]?.text))).toEqual(expected);
        expect(grep).toHaveBeenCalledTimes(4);
        expect(grep.mock.calls[2]?.[0]).toEqual(grep.mock.calls[3]?.[0]);
        expect(grep.mock.calls[3]?.[0]).toMatchObject({
          waitTimeoutMs: 0,
          targets: args.targets.map(({ target }) => ({
            target,
            corpus: "ALL",
            pathSelectors: [{ kind: "PREFIX", value: path }],
            allowUnscoped: true,
          })),
        });
        expect(result).toEqual(before);
      } finally {
        write.mockRestore();
        log.mockRestore();
      }
    });
  }
});

it.each(["ready", "pending"] as const)(
  "preserves canonical %s input provenance in CLI/MCP grep",
  async (mode) => {
    const target = "maven:example:library@1.2.3";
    const identity = {
      registry: "MAVEN",
      packageName: "example:library",
      version: "1.2.3",
      repoUrl: "https://github.com/example/library",
      gitRef: "v1.2.3",
      commitSha: "a".repeat(40),
      releaseCorrespondence: "unverified",
    };
    const resolution = {
      requested: {
        registry: "MAVEN",
        packageName: "example:library",
        version: "1.2.3",
        releaseCorrespondence: null,
      },
      resolvedRequested: identity,
      ...(mode === "ready" ? { served: identity } : {}),
      freshness: mode === "ready" ? "current" : "indexing",
      availableVersions: [],
      availableRefs: [],
      suggestedRefs: [],
    };
    const result: GrepResult = {
      ...defaultGrepResult,
      targetResolutions: [
        { inputIndex: 0, target, targetResolution: resolution },
      ],
      ...(mode === "pending"
        ? {
            traversal: "NON_RESUMABLE_PARTIAL",
            unavailableTargets: [
              {
                inputIndex: 0,
                target,
                reason: "repository_indexing",
                retryable: true,
                progressRef: null,
                suggestedSiteTargets: null,
              },
            ],
          }
        : {
            targets: [
              {
                targetIndex: 7,
                requestedInputIndices: [0],
                kind: "REPOSITORY",
                target,
                traversal: "COMPLETE",
                readiness: "CURRENT",
                errorCode: null,
                retryable: false,
                publicMessage: null,
                requestedRef: "v1.2.3",
                commitSha: identity.commitSha,
                corpus: "SOURCE",
                filesScanned: 1,
                filesInScope: 1,
                binaryFilesSkipped: 0,
                filesTooLargeSkipped: 0,
                fileIssues: [],
                fileIssuesOmitted: 0,
                repoUrl: identity.repoUrl,
                canonicalSite: null,
              },
            ],
          }),
    };
    const grep = mock(async () => result);
    const grepService = createMockGrepService({ grep });
    const program = new Command("githits");
    registerGrepCommand(program, async () => ({
      grepService,
      hasValidToken: true,
      mcpUrl: "https://example.test",
      createSpinner: () => ({ stop: () => {} }),
    }));
    const tool = createParityMcpTool("grep", { grepService });
    const out = spyOn(process.stdout, "write").mockImplementation(() => true);
    const log = spyOn(console, "log").mockImplementation(() => {});
    try {
      await program.parseAsync(["grep", "router", target, "--wait", "0"], {
        from: "user",
      });
      const cliText = out.mock.calls.map(([v]) => String(v)).join("");
      const args = {
        targets: [{ target }],
        pattern: "router",
        wait_timeout_ms: 0,
      };
      const mcpText = (await tool.handler(args, {})).content[0]?.text ?? "";
      for (const text of [cliText, mcpText]) {
        const flat = text.replace(/\s+/g, " ");
        expect(flat).toContain(`match to library@1.2.3 unconfirmed`);
        expect(flat).toContain(
          `${mode === "ready" ? "Source" : "Selected source"}: github:example/library@v1.2.3`,
        );
      }
      await program.parseAsync(
        ["grep", "router", target, "--wait", "0", "--json"],
        { from: "user" },
      );
      const cliJson = JSON.parse(String(log.mock.calls[0]?.[0]));
      const mcpJson = JSON.parse(
        (await tool.handler({ ...args, format: "json" }, {})).content[0]
          ?.text ?? "{}",
      );
      expect(cliJson).toEqual(mcpJson);
      expect(cliJson.targetResolutions).toEqual(
        JSON.parse(JSON.stringify(result.targetResolutions)),
      );
      expect(cliJson.unavailableTargets).toEqual(result.unavailableTargets);
      expect(grep).toHaveBeenCalledTimes(4);
    } finally {
      out.mockRestore();
      log.mockRestore();
    }
  },
);
