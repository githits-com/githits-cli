import { describe, expect, it } from "bun:test";
import { z } from "zod";
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

const FORMAT_SELECTABLE_TOOLS = new Set([
  "get_example",
  "search_language",
  "search",
  "search_status",
  "code_files",
  "code_read",
  "code_grep",
  "docs_list",
  "docs_read",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
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

describe("MCP output format", () => {
  it("advertises token-efficient text-v1 as the explicit default", () => {
    const descriptors = getMcpToolDescriptors();

    for (const descriptor of descriptors) {
      if (!FORMAT_SELECTABLE_TOOLS.has(descriptor.name)) continue;

      const inputSchema = z.toJSONSchema(z.object(descriptor.schema));
      const formatSchema = inputSchema.properties?.format;

      expect(formatSchema, descriptor.name).toMatchObject({
        default: "text-v1",
        enum: ["text-v1", "text", "json"],
      });
    }
  });
});
