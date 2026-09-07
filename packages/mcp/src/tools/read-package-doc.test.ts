import { describe, expect, it, mock } from "bun:test";
import { PackageIntelligenceTargetNotFoundError } from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createReadPackageDocTool } from "./read-package-doc.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createReadPackageDocTool", () => {
  it("registers the correct tool metadata", () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("docs_read");
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(tool.schema)).toEqual([
      "page_id",
      "start_line",
      "end_line",
      "format",
    ]);
    expect(tool.description).toContain("150 lines by default");
    expect(tool.description).toContain("up to 300 lines");
    expect(tool.description).toContain("`docsReadTarget`");
    expect(tool.schema.page_id?.description).toContain("`docsReadTarget`");
    expect(tool.schema.start_line?.description).toContain("at most 150 lines");
    expect(tool.schema.end_line?.description).toContain("up to 300 lines");
    expect(tool.schema.end_line?.description).toContain(
      "In JSON mode, omitting it reads to the end",
    );
  });

  it("honors an explicit text range up to 300 lines", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve({
        page: {
          id: "abc",
          docsReadTarget: "abc",
          content: "line\n".repeat(400),
        },
      }),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "abc", start_line: 1, end_line: 248 },
      {},
    );
    expect(result.content[0]?.text).toContain("lines 1-248/400");
  });

  it("reports when the explicit text range ceiling truncates available content", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve({
        page: {
          id: "abc",
          docsReadTarget: "abc",
          content: "line\n".repeat(400),
        },
      }),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "abc", start_line: 1, end_line: 600 },
      {},
    );
    expect(result.content[0]?.text).toContain("lines 1-300/400");
    expect(result.content[0]?.text).toContain(
      "MCP explicit-range ceiling: 300 lines",
    );
  });

  it("does not report truncation when a clamped range reaches end of page", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve({
        page: {
          id: "abc",
          docsReadTarget: "abc",
          content: "line\n".repeat(248),
        },
      }),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "abc", start_line: 1, end_line: 600 },
      {},
    );
    expect(result.content[0]?.text).toContain("lines 1-248/248");
    expect(result.content[0]?.text).not.toContain("MCP explicit-range ceiling");
  });

  it("passes an emitted URL target through and preserves read locators and range", async () => {
    const docsReadTarget =
      "https://expressjs.com/en/guide/routing.html?publisher=express";
    const readPackageDoc = mock(() =>
      Promise.resolve({
        page: {
          id: "legacy-routing-id",
          docsReadTarget,
          content: "one\ntwo\nthree",
          source: { url: docsReadTarget },
        },
      }),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      {
        page_id: docsReadTarget,
        start_line: 2,
        end_line: 2,
        format: "json",
      },
      {},
    );

    expect(readPackageDoc).toHaveBeenCalledWith({ pageId: docsReadTarget });
    expect(parseText(result)).toMatchObject({
      docsReadTarget,
      pageId: "legacy-routing-id",
      sourceUrl: docsReadTarget,
      startLine: 2,
      endLine: 2,
      content: "two",
    });

    const textResult = await tool.handler(
      { page_id: docsReadTarget, start_line: 2, end_line: 2 },
      {},
    );
    const text = textResult.content[0]?.text ?? "";
    expect(text.match(/expressjs\.com/g)).toHaveLength(1);
    expect(text).not.toContain(`source: ${docsReadTarget}`);
  });

  it("returns JSON-stringified lean envelope when format=json", async () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { page_id: "github:expressjs/express@abc123/README.md", format: "json" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.pageId).toBe("github:expressjs/express@abc123/README.md");
  });

  it("defaults to bounded text output", async () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.resolve({
            page: {
              id: "github:expressjs/express@abc123/README.md",
              docsReadTarget: "github:expressjs/express@abc123/README.md",
              content: "line\n".repeat(400),
            },
          }),
        ),
      }),
    );
    const result = await tool.handler(
      { page_id: "github:expressjs/express@abc123/README.md" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "docs_read | github:expressjs/express@abc123/README.md",
    );
    expect(text).toContain("lines 1-150/400");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("returns INVALID_ARGUMENT for empty page ID", async () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ page_id: "   " }, {});
    const payload = parseText(result) as { code: string };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("classifies unknown URL targets as non-retryable NOT_FOUND", async () => {
    const unknownUrl = "https://docs.example.test/unknown";
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.reject(
            new PackageIntelligenceTargetNotFoundError("Doc page not found"),
          ),
        ),
      }),
    );
    const result = await tool.handler({ page_id: unknownUrl }, {});
    const payload = parseText(result) as { code: string; retryable: boolean };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("NOT_FOUND");
    expect(payload.retryable).toBe(false);
  });
});
