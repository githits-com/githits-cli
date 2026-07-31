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
    expect(tool.description).toContain("capped at 150 lines per call");
    expect(tool.schema.start_line?.description).toContain(
      "at most 150 lines per call",
    );
    expect(tool.schema.end_line?.description).toContain(
      "In text mode, omitting it returns at most 150 lines",
    );
    expect(tool.schema.end_line?.description).toContain(
      "in JSON mode, omitting it reads to the end",
    );
  });

  it("calls service.readPackageDoc with the page ID", async () => {
    const readPackageDoc = mock(() => Promise.resolve({ page: { id: "abc" } }));
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({ readPackageDoc }),
    );

    await tool.handler({ page_id: "abc" }, {});

    expect(readPackageDoc).toHaveBeenCalledWith({ pageId: "abc" });
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
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { page_id: "github:expressjs/express@abc123/README.md" },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(
      "docs_read | github:expressjs/express@abc123/README.md",
    );
    expect(text).toContain("lines 1-");
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

  it("classifies target-not-found errors as NOT_FOUND", async () => {
    const tool = createReadPackageDocTool(
      createMockPackageIntelligenceService({
        readPackageDoc: mock(() =>
          Promise.reject(
            new PackageIntelligenceTargetNotFoundError("Doc page not found"),
          ),
        ),
      }),
    );
    const result = await tool.handler({ page_id: "missing" }, {});
    const payload = parseText(result) as { code: string };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("NOT_FOUND");
  });
});
