import { describe, expect, it } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import { getMcpToolDescriptors } from "../../../packages/mcp/src/mcp/server.js";
import { createContextFixtureServer } from "./fixture-server.js";

describe("context fixture MCP contract", () => {
  it("exposes production descriptions and schemas while bounding fixture evidence", async () => {
    const server = createContextFixtureServer();
    const client = new Client({ name: "context-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = await client.listTools();
      const expected = getMcpToolDescriptors();
      expect(listed.tools.map((t) => t.name)).toEqual(
        expected.map((t) => t.name),
      );
      for (const descriptor of expected) {
        const tool = listed.tools.find((t) => t.name === descriptor.name);
        expect(tool?.description).toBe(descriptor.description);
        const schema = z.toJSONSchema(z.object(descriptor.schema), {
          target: "draft-7",
          io: "input",
        });
        // SDK includes its JSON-schema dialect marker; compare the wire arguments.
        const properties: unknown = tool?.inputSchema.properties;
        expect(properties).toEqual(schema.properties);
        expect(tool?.inputSchema.required).toEqual(schema.required);
      }
      const result = await client.callTool({
        name: "code_grep",
        arguments: { target: "github:openai/codex", pattern: "tool_search" },
      });
      expect(result.isError).not.toBe(true);
      expect(JSON.stringify(result.content)).toContain(
        "fixed context-loading fixture",
      );
      const unsupported = await client.callTool({
        name: "code_grep",
        arguments: { target: "github:openai/codex", pattern: "different" },
      });
      expect(unsupported.isError).toBe(true);
    } finally {
      await client.close();
      await server.close();
    }
  });
});
