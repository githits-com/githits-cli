import { describe, expect, it } from "bun:test";
import { createQuickStartTool } from "./quick-start.js";

describe("quickStartTool", () => {
  it("returns the injected guide without a service call", async () => {
    const tool = createQuickStartTool("session guide");

    expect(tool.name).toBe("quick_start");
    expect(tool.schema).toEqual({});
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(tool.description).toStartWith(
      "GitHits guide for public GitHub/package search, grep, code, docs, and examples.",
    );
    expect(tool.description).toContain("Call once per session");
    expect(tool.description).toContain("Tools execute without this guide");

    await expect(tool.handler({}, {})).resolves.toEqual({
      content: [{ type: "text", text: "session guide" }],
    });
  });
});
