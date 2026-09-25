import { describe, expect, it } from "bun:test";
import type { ReadResult } from "@githits/core-internal";
import { formatReadResult } from "./read-result-response.js";

describe("unified read presentation", () => {
  it("renders an actionable unsupported snapshot without source content", () => {
    const response: ReadResult = {
      source: "symbol_resolution",
      result: {
        status: "SNAPSHOT_UNSUPPORTED",
        candidates: [],
        suggestions: [],
        hasMore: false,
        repoUrl: "https://github.com/owner/repo",
        gitRef: "abc",
        message: "Legacy snapshot lacks a content hash.",
        codeIndexState: "CURRENT",
      },
    };
    const request = { target: "github:owner/repo@abc", selector: "main" };
    const text = formatReadResult(response, request, "mcp-text");
    expect(text).toContain('"source":"symbol"');
    expect(text).toContain("start_line and end_line");
    expect(
      JSON.parse(formatReadResult(response, request, "mcp-json")),
    ).toMatchObject({
      status: "SNAPSHOT_UNSUPPORTED",
      action: expect.stringContaining('"source":"symbol"'),
    });
    expect(formatReadResult(response, request, "cli-text")).toContain(
      "--start N --end M",
    );
    expect(formatReadResult(response, request, "cli-text")).toContain(
      "--source symbol",
    );
    expect(formatReadResult(response, request, "mcp-json")).not.toContain(
      "__typename",
    );
    expect(formatReadResult(response, request, "mcp-json")).not.toContain(
      '"message":null',
    );
  });

  it("uses the base target in fragment miss recovery actions", () => {
    const response: ReadResult = {
      source: "symbol_resolution",
      result: {
        status: "NOT_FOUND",
        candidates: [],
        suggestions: [],
        hasMore: false,
        repoUrl: "https://github.com/owner/repo",
        gitRef: "abc",
        message: null,
        codeIndexState: "CURRENT",
      },
    };
    const request = {
      target: "npm:express@5.2.1#missing",
    };
    const mcp = JSON.parse(formatReadResult(response, request, "mcp-json"));
    expect(mcp.target).toBe(request.target);
    expect(mcp.action).toContain('"target":"npm:express@5.2.1"');
    expect(mcp.action).not.toContain("#missing");
    expect(formatReadResult(response, request, "cli-text")).toContain(
      '--in "npm:express@5.2.1"',
    );
  });

  it("caps MCP symbol content with a precise continuation while CLI retains it", () => {
    const content = Array.from(
      { length: 185 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    const response: ReadResult = {
      source: "code",
      result: {
        filePath: "eval/run.ts",
        startLine: 57,
        endLine: 241,
        totalLines: 300,
        content,
        language: undefined,
        isBinary: false,
        targetResolution: {
          requested: {
            repoUrl: "https://github.com/owner/repo",
            gitRef: "abc",
          },
          availableVersions: [],
          availableRefs: [],
        },
      },
    };
    const request = { target: "github:owner/repo@abc", selector: "main" };
    const mcp = JSON.parse(formatReadResult(response, request, "mcp-json"));
    expect(mcp.endLine).toBe(206);
    expect(mcp.content).not.toContain("line 151");
    expect(mcp.hint).toContain('path="eval/run.ts" start_line=207');
    const fragmentContinuation = JSON.parse(
      formatReadResult(
        response,
        {
          target: "github:owner/repo@abc#main",
        },
        "mcp-json",
      ),
    );
    expect(fragmentContinuation.hint).toContain(
      'target="github:owner/repo@abc" path="eval/run.ts"',
    );
    expect(fragmentContinuation.hint).not.toContain("#main");
    expect(formatReadResult(response, request, "cli-text")).toContain(
      "line 185",
    );
    const cliJson = JSON.parse(formatReadResult(response, request, "cli-json"));
    expect(cliJson.content).toContain("line 185");
    expect(cliJson.endLine).toBe(241);
    expect(
      formatReadResult(response, { ...request, verbose: true }, "cli-text"),
    ).toContain("57  line 1");
    expect(
      JSON.parse(formatReadResult(response, request, "mcp-json")),
    ).toMatchObject({
      repoUrl: "https://github.com/owner/repo",
      gitRef: "abc",
    });
    expect(
      formatReadResult(
        response,
        {
          target: "https://github.com/owner/repo#abc",
          selector: "main",
        },
        "cli-text",
      ),
    ).toContain("line 185");
  });
});
