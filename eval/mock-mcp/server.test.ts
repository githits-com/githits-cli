import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { writeState } from "./state.js";

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: string[];
}

function schemaFor(
  tools: readonly { name: string; inputSchema: object }[],
  name: string,
): JsonSchema {
  const tool = tools.find((candidate) => candidate.name === name);
  expect(tool).toBeDefined();
  return tool?.inputSchema as JsonSchema;
}

describe("security-eval mock MCP coordinate schemas", () => {
  it("matches canonical targets and validates compact calls over stdio", async () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), "mock-mcp-contract-"));
    const stateFile = join(fixtureDir, "state.json");
    const state = {
      attackId: "schema-contract",
      variantId: "plain",
      expectedTool: "pkg_info" as const,
      content: "fixture package info",
    };
    writeState(stateFile, state);

    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [resolve(import.meta.dir, "server.ts")],
      env: { EVAL_MCP_STATE_FILE: stateFile },
    });
    const client = new Client({ name: "mock-mcp-contract", version: "1.0.0" });

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      for (const name of ["pkg_info", "pkg_vulns"] as const) {
        const schema = schemaFor(listed.tools, name);
        expect(schema.properties?.target).toEqual({ type: "string" });
        expect(schema.required).toContain("target");
        expect(schema.properties ?? {}).not.toHaveProperty("registry");
        expect(schema.properties ?? {}).not.toHaveProperty("package_name");
        expect(schema.properties ?? {}).not.toHaveProperty("version");
      }

      const info = await client.callTool({
        name: "pkg_info",
        arguments: { target: "npm:zod" },
      });
      expect(info.isError).not.toBe(true);
      expect(JSON.stringify(info.content)).toContain("fixture package info");

      writeState(stateFile, {
        ...state,
        expectedTool: "pkg_vulns",
        content: "fixture package vulnerabilities",
      });
      const vulns = await client.callTool({
        name: "pkg_vulns",
        arguments: { target: "npm:zod" },
      });
      expect(vulns.isError).not.toBe(true);
      expect(JSON.stringify(vulns.content)).toContain(
        "fixture package vulnerabilities",
      );

      const oldOnlyInfo = await client.callTool({
        name: "pkg_info",
        arguments: { registry: "npm", package_name: "zod" },
      });
      expect(oldOnlyInfo.isError).toBe(true);
      expect(JSON.stringify(oldOnlyInfo.content)).toContain(
        "Invalid arguments",
      );
      expect(JSON.stringify(oldOnlyInfo.content)).not.toContain(
        "fixture package info",
      );

      const objectTargetInfo = await client.callTool({
        name: "pkg_info",
        arguments: { target: { registry: "npm", package_name: "zod" } },
      });
      expect(objectTargetInfo.isError).toBe(true);
      expect(JSON.stringify(objectTargetInfo.content)).toContain(
        "Invalid arguments",
      );
      expect(JSON.stringify(objectTargetInfo.content)).not.toContain(
        "fixture package info",
      );

      const oldOnlyVulns = await client.callTool({
        name: "pkg_vulns",
        arguments: {
          registry: "npm",
          package_name: "zod",
          version: "1.0.0",
        },
      });
      expect(oldOnlyVulns.isError).toBe(true);
      expect(JSON.stringify(oldOnlyVulns.content)).toContain(
        "Invalid arguments",
      );
      expect(JSON.stringify(oldOnlyVulns.content)).not.toContain(
        "fixture package vulnerabilities",
      );

      const objectTargetVulns = await client.callTool({
        name: "pkg_vulns",
        arguments: { target: { registry: "npm", package_name: "zod" } },
      });
      expect(objectTargetVulns.isError).toBe(true);
      expect(JSON.stringify(objectTargetVulns.content)).toContain(
        "Invalid arguments",
      );
      expect(JSON.stringify(objectTargetVulns.content)).not.toContain(
        "fixture package vulnerabilities",
      );
    } finally {
      await client.close();
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});
