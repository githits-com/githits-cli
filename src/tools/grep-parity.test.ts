import { describe, expect, it, mock, spyOn } from "bun:test";
import type { GrepParams } from "@githits/core-internal";
import { Command } from "commander";
import { registerGrepCommand } from "../commands/grep.js";
import {
  createMockGrepService,
  defaultGrepResult,
} from "../services/test-helpers.js";
import { createParityMcpTool } from "./parity-test-helpers.js";

describe("unified grep CLI/MCP parity", () => {
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
