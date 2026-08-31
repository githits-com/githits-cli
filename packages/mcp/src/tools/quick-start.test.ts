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
      "Start GitHits sessions here unless the `githits-mcp` skill is loaded.",
    );
    expect(tool.description.slice(0, 80)).toBe(
      "Start GitHits sessions here unless the `githits-mcp` skill is loaded. Load once ",
    );
    expect(tool.description).toContain("Load once before other GitHits tools");
    expect(tool.description).toContain("does not query GitHits evidence");

    await expect(tool.handler({}, {})).resolves.toEqual({
      content: [{ type: "text", text: "session guide" }],
    });
  });
});
