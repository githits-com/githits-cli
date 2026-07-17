import { describe, expect, it } from "bun:test";
import { getMcpToolDescriptors } from "./server.js";

const BOUNDED_NON_DESTRUCTIVE_WRITES = new Set([
  "get_example",
  "feedback",
  "search",
  "code_files",
  "code_read",
  "code_grep",
  "docs_list",
]);

describe("MCP tool annotations", () => {
  it("explicitly classifies the potential impact of every public tool", () => {
    const descriptors = getMcpToolDescriptors();

    expect(descriptors).toHaveLength(15);

    for (const descriptor of descriptors) {
      expect(descriptor.annotations, descriptor.name).toEqual({
        readOnlyHint: !BOUNDED_NON_DESTRUCTIVE_WRITES.has(descriptor.name),
        openWorldHint: false,
        destructiveHint: false,
      });
    }
  });
});
