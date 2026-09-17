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
      "Call quick_start first to choose tools and load untrusted-content rules.",
    );
    expect(tool.description.slice(0, 80)).toBe(
      "Call quick_start first to choose tools and load untrusted-content rules. Call on",
    );
    expect(tool.description.split(".")[0]!.length + 1).toBeLessThanOrEqual(79);
    expect(tool.description.slice(0, 80)).not.toContain("githits-mcp");
    expect(tool.description).toContain(
      "Call once per session before discovering evidence tools",
    );
    expect(tool.description).toContain("untrusted-content rules");
    expect(tool.description).toContain(
      "unless the loaded githits-mcp skill already contains this guide",
    );

    await expect(tool.handler({}, {})).resolves.toEqual({
      content: [{ type: "text", text: "session guide" }],
    });
  });
});
