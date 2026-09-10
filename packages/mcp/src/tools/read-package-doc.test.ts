import { describe, expect, it, mock } from "bun:test";
import {
  type PackageDocResult,
  PackageIntelligenceDocumentationSectionUnresolvedError,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createReadPackageDocTool } from "./read-package-doc.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

function numberedLines(start: number, end: number): string {
  return Array.from(
    { length: end - start + 1 },
    (_, index) => `line ${start + index}`,
  ).join("\n");
}

function docResult(options: {
  docsReadTarget?: string;
  pageId?: string;
  content: string;
  startLine?: number;
  endLine?: number;
  totalLines: number;
  anchor?: string;
  sourceUrl?: string;
}): PackageDocResult {
  const docsReadTarget = options.docsReadTarget ?? "doc-target";
  return {
    contentRange: {
      startLine: options.startLine,
      endLine: options.endLine,
      totalLines: options.totalLines,
      anchor: options.anchor,
    },
    page: {
      id: options.pageId ?? "stable-page-id",
      docsReadTarget,
      content: options.content,
      source: options.sourceUrl ? { url: options.sourceUrl } : undefined,
    },
  };
}

describe("createReadPackageDocTool", () => {
  it("registers the fragment and range contract", () => {
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
    expect(tool.description).toContain("fragment needs no bounds");
    expect(tool.description).toContain(
      "either bound replaces it with a page-relative range",
    );
    expect(tool.description).toContain("up to 300");
    expect(tool.description).toContain("stable `pageId`");
    expect(tool.schema.page_id?.description).toContain("Pass unchanged");
    expect(tool.schema.start_line?.description).toContain(
      "Either bound overrides a URL fragment",
    );
    expect(tool.schema.end_line?.description).toContain(
      "JSON has no local cap",
    );
  });

  it("resolves a fragment without forwarding the default text window", async () => {
    const target =
      "https://flask.palletsprojects.com/en/stable/design/#the-routing-system";
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          docsReadTarget: target,
          pageId: "flask-design",
          content: numberedLines(81, 93),
          startLine: 81,
          endLine: 93,
          totalLines: 219,
          anchor: "the-routing-system",
          sourceUrl: target,
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler({ page_id: target }, {});
    const output = result.content[0]?.text ?? "";

    expect(readPackageDoc).toHaveBeenCalledWith({ pageId: target });
    expect(output).toContain("lines 81-93/219");
    expect(output).toContain("line 81");
    expect(output).not.toContain("hint:");
  });

  it("forwards an explicit fragment override and does not slice it twice", async () => {
    const target = "https://docs.example.test/page#section";
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          docsReadTarget: target,
          content: "line 100\nline 101",
          startLine: 100,
          endLine: 101,
          totalLines: 250,
          sourceUrl: target,
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: target, start_line: 100, end_line: 101, format: "json" },
      {},
    );

    expect(readPackageDoc).toHaveBeenCalledWith({
      pageId: target,
      startLine: 100,
      endLine: 101,
    });
    expect(parseText(result)).toMatchObject({
      pageId: "stable-page-id",
      docsReadTarget: target,
      startLine: 100,
      endLine: 101,
      totalLines: 250,
      content: "line 100\nline 101",
    });
  });

  it.each([
    [{ start_line: 10 }, { pageId: "doc-target", startLine: 10 }],
    [{ end_line: 40 }, { pageId: "doc-target", endLine: 40 }],
  ])("forwards one-sided bounds %#", async (args, expected) => {
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          content: "line 10",
          startLine: 10,
          endLine: 10,
          totalLines: 40,
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    await tool.handler({ page_id: "doc-target", ...args, format: "json" }, {});

    expect(readPackageDoc).toHaveBeenCalledWith(expected);
  });

  it("reports backend end clamping without changing the requested wire bound", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          content: numberedLines(10, 20),
          startLine: 10,
          endLine: 20,
          totalLines: 20,
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "doc-target", start_line: 10, end_line: 40, format: "json" },
      {},
    );

    expect(readPackageDoc).toHaveBeenCalledWith({
      pageId: "doc-target",
      startLine: 10,
      endLine: 40,
    });
    expect(parseText(result)).toMatchObject({
      startLine: 10,
      endLine: 20,
      totalLines: 20,
    });
  });

  it("locally caps explicit text output and points to the remaining backend range", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          content: numberedLines(1, 400),
          startLine: 1,
          endLine: 400,
          totalLines: 400,
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "doc-target", start_line: 1, end_line: 600 },
      {},
    );
    const output = result.content[0]?.text ?? "";

    expect(readPackageDoc).toHaveBeenCalledWith({
      pageId: "doc-target",
      startLine: 1,
      endLine: 600,
    });
    expect(output).toContain("lines 1-300/400");
    expect(output).toContain(
      'Continue with docs_read page_id="stable-page-id" start_line=301 end_line=400.',
    );
    expect(output).toContain("line 300");
    expect(output).not.toContain("line 301\n");
  });

  it("locally caps a long fragment from its absolute backend origin", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          content: numberedLines(81, 280),
          startLine: 81,
          endLine: 280,
          totalLines: 400,
          anchor: "long-section",
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler({ page_id: "doc-target" }, {});
    const output = result.content[0]?.text ?? "";

    expect(readPackageDoc).toHaveBeenCalledWith({ pageId: "doc-target" });
    expect(output).toContain("lines 81-230/400");
    expect(output).toContain(
      'Continue with docs_read page_id="stable-page-id" start_line=231 end_line=280.',
    );
  });

  it("keeps JSON unbounded and exposes the resolved anchor", async () => {
    const readPackageDoc = mock(() =>
      Promise.resolve(
        docResult({
          content: numberedLines(81, 280),
          startLine: 81,
          endLine: 280,
          totalLines: 400,
          anchor: "long-section",
        }),
      ),
    );
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    const result = await tool.handler(
      { page_id: "doc-target", format: "json" },
      {},
    );

    expect(parseText(result)).toMatchObject({
      startLine: 81,
      endLine: 280,
      totalLines: 400,
      anchor: "long-section",
      content: numberedLines(81, 280),
    });
  });

  it("uses backend trailing-newline and empty-page totals", async () => {
    const trailingTool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.resolve(
            docResult({
              content: "one\n",
              startLine: 1,
              endLine: 2,
              totalLines: 2,
            }),
          ),
        ),
      }),
    );
    const trailing = await trailingTool.handler(
      { page_id: "doc-target", format: "json" },
      {},
    );
    expect(parseText(trailing)).toMatchObject({
      content: "one\n",
      startLine: 1,
      endLine: 2,
      totalLines: 2,
    });

    const emptyTool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.resolve(docResult({ content: "", totalLines: 0 })),
        ),
      }),
    );
    const empty = await emptyTool.handler(
      { page_id: "doc-target", format: "json" },
      {},
    );
    expect(parseText(empty)).toEqual({
      pageId: "stable-page-id",
      docsReadTarget: "doc-target",
      totalLines: 0,
      content: "",
    });
  });

  it("returns INVALID_ARGUMENT for invalid identity and bounds", async () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService(),
    );
    for (const args of [
      { page_id: "   " },
      { page_id: "page", start_line: 0 },
      { page_id: "page", start_line: 4, end_line: 3 },
    ]) {
      const result = await tool.handler(args, {});
      const payload = parseText(result) as { code: string };
      expect(result.isError).toBe(true);
      expect(payload.code).toBe("INVALID_ARGUMENT");
    }
  });

  it("keeps unresolved sections distinct from missing pages", async () => {
    const unresolvedTool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.reject(
            new PackageIntelligenceDocumentationSectionUnresolvedError(
              "Documentation section was not found",
              "not_found",
            ),
          ),
        ),
      }),
    );
    const unresolved = await unresolvedTool.handler(
      { page_id: "https://docs.example.test/page#missing" },
      {},
    );
    expect(parseText(unresolved)).toEqual({
      error: "Documentation section was not found",
      code: "DOCUMENTATION_SECTION_UNRESOLVED",
      retryable: false,
      details: { reason: "not_found" },
    });

    const missingTool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.reject(
            new PackageIntelligenceTargetNotFoundError("Doc page not found"),
          ),
        ),
      }),
    );
    const missing = await missingTool.handler(
      { page_id: "https://docs.example.test/unknown" },
      {},
    );
    expect(parseText(missing)).toEqual({
      error: "Doc page not found",
      code: "NOT_FOUND",
      retryable: false,
    });
  });
});
