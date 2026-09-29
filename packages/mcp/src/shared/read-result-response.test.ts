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
        readTarget: {
          target: "github:owner/repo@served-sha",
          path: "root/eval/run.ts",
          selector: "main",
          startLine: 57,
          endLine: 241,
        },
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
    expect(mcp.hint).toContain(
      'path="root/eval/run.ts" start_line=207 end_line=241',
    );
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
      'target="github:owner/repo@served-sha" path="root/eval/run.ts"',
    );
    expect(fragmentContinuation.hint).not.toContain("#main");
    expect(fragmentContinuation.hint).not.toContain("selector");
    expect(mcp).not.toHaveProperty("readTarget");
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

describe("served read action cap matrix", () => {
  const content = Array.from(
    { length: 401 },
    (_, index) => `line ${700 + index}`,
  ).join("\n");

  it.each([undefined, 1200])(
    "caps code with end request %s and keeps served identity/absolute EOF bounds",
    (endLine) => {
      const response: ReadResult = {
        source: "code",
        result: {
          readTarget: {
            target: "github:owner/repo@served-sha",
            path: "exact.ts",
            selector: "logical symbol",
            startLine: 700,
            endLine: 1100,
          },
          filePath: "display.ts",
          startLine: 700,
          endLine: 1100,
          totalLines: 2000,
          content,
        },
      };
      const request = {
        target: "github:wrong/repo@main",
        selector: "requested",
        endLine,
      };
      const limit = endLine === undefined ? 150 : 300;
      const payload = JSON.parse(
        formatReadResult(response, request, "mcp-json"),
      );
      expect(payload.content.split("\n")).toHaveLength(limit);
      expect(payload.endLine).toBe(699 + limit);
      expect(payload.hint).toBe(
        `Continue with read target="github:owner/repo@served-sha" path="exact.ts" start_line=${700 + limit} end_line=1100.`,
      );
      expect(payload.hint).not.toContain("selector");
      for (const format of ["cli-json", "cli-text"] as const)
        expect(formatReadResult(response, request, format)).toContain(
          "line 1100",
        );
      expect(payload).not.toHaveProperty("readTarget");
    },
  );

  it.each([undefined, 1200])(
    "caps only docs text with end request %s and preserves full JSON",
    (endLine) => {
      const response: ReadResult = {
        source: "docs",
        result: {
          readTarget: {
            target: "https://docs.test/served?x=%25",
            path: "/exact/page",
            selector: "logical heading",
            startLine: 700,
            endLine: 1100,
          },
          contentRange: {
            startLine: 700,
            endLine: 1100,
            totalLines: 2000,
            anchor: "logical heading",
          },
          page: { id: "wrong-page", docsReadTarget: "wrong-target", content },
        },
      };
      const request = {
        target: "requested-page",
        selector: "requested",
        endLine,
      };
      const limit = endLine === undefined ? 150 : 300;
      const text = formatReadResult(response, request, "mcp-text");
      expect(text).toContain(
        `Continue with read target="https://docs.test/served?x=%25" path="/exact/page" start_line=${700 + limit} end_line=1100.`,
      );
      expect(text).not.toContain(`line ${700 + limit}`);
      for (const format of ["mcp-json", "cli-json"] as const) {
        const json = JSON.parse(formatReadResult(response, request, format));
        expect(json.content).toBe(content);
        expect(json.endLine).toBe(1100);
        expect(json).not.toHaveProperty("readTarget");
        expect(json).not.toHaveProperty("hint");
      }
    },
  );

  it("uses returned content coordinates when a custom provider omits endLine", () => {
    const response: ReadResult = {
      source: "code",
      result: {
        readTarget: {
          target: "github:owner/repo@served-sha",
          path: "exact.ts",
          selector: "x",
        },
        filePath: "display.ts",
        startLine: 700,
        totalLines: 2000,
        content: `${content}\n`,
      },
    };
    const payload = JSON.parse(
      formatReadResult(
        response,
        { target: "github:wrong/repo@main", selector: "x" },
        "mcp-json",
      ),
    );
    expect(payload.hint).toBe(
      'Continue with read target="github:owner/repo@served-sha" path="exact.ts" start_line=850 end_line=1100.',
    );
    expect(payload.content.split("\n")).toHaveLength(150);
  });

  it.each([undefined, null])(
    "does not reconstruct old/null provider code metadata: %s",
    (readTarget) => {
      const response: ReadResult = {
        source: "code",
        result: {
          readTarget,
          filePath: "file.ts",
          startLine: 700,
          endLine: 1100,
          totalLines: 2000,
          content,
        },
      };
      const payload = JSON.parse(
        formatReadResult(
          response,
          { target: "github:owner/repo@main", selector: "x" },
          "mcp-json",
        ),
      );
      expect(payload.hint).toBe(
        "Continuation unavailable: missing read target.",
      );
    },
  );

  it("keeps an old docs provider body and explains unavailable continuation", () => {
    const response: ReadResult = {
      source: "docs",
      result: {
        contentRange: { startLine: 700, endLine: 1100, totalLines: 2000 },
        page: { id: "page", docsReadTarget: "target", content },
      },
    };
    expect(
      formatReadResult(response, { target: "request" }, "mcp-text"),
    ).toContain("Continuation unavailable: missing read target.");
    expect(
      JSON.parse(formatReadResult(response, { target: "request" }, "mcp-json"))
        .content,
    ).toBe(content);
  });

  it("does not fabricate empty or binary continuations", () => {
    for (const result of [
      {
        isBinary: true,
        content,
        startLine: 700,
        endLine: 1100,
        totalLines: 2000,
      },
      { content: "", startLine: 1, endLine: 0, totalLines: 0 },
    ]) {
      const response: ReadResult = {
        source: "code",
        result: { ...result, filePath: "file.ts", readTarget: null },
      };
      expect(
        JSON.parse(
          formatReadResult(response, { target: "request" }, "mcp-json"),
        ),
      ).not.toHaveProperty("hint");
    }
  });
});
