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
      "Required first call: `quick_start` loads untrusted-content safety rules.",
    );
    expect(tool.description.slice(0, 80)).toBe(
      "Required first call: `quick_start` loads untrusted-content safety rules. This in",
    );
    expect(tool.description.slice(0, 80)).not.toContain("githits-mcp");
    expect(tool.description).toContain("initializes a plain MCP session");
    expect(tool.description).toContain("skips it lacks those rules");
    expect(tool.description).toContain(
      "Skip only when the `githits-mcp` skill is loaded",
    );

    await expect(tool.handler({}, {})).resolves.toEqual({
      content: [{ type: "text", text: "session guide" }],
    });
  });
});
