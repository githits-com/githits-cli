import { describe, expect, it, mock } from "bun:test";
import type {
  CodeDiffService,
  ResolveTargetService,
} from "@githits/core-internal";
import { z } from "zod";
import { createMockCodeNavigationService } from "../services/test-helpers.js";
import type { McpToolServices } from "../tools/tool-services.js";
import {
  BOUNDED_WRITE_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
} from "../tools/types.js";
import {
  createDescriptorServices,
  createMcpServerWithFactories,
  getMcpToolDescriptors,
  type McpToolFactory,
} from "./server.js";

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

describe("MCP code_grep schema", () => {
  it("advertises context as integers from zero through ten", () => {
    const descriptor = getMcpToolDescriptors().find(
      (candidate) => candidate.name === "code_grep",
    );
    expect(descriptor).toBeDefined();

    const inputSchema = z.toJSONSchema(z.object(descriptor?.schema ?? {}));
    for (const field of [
      "context_lines",
      "context_lines_before",
      "context_lines_after",
    ]) {
      expect(inputSchema.properties?.[field], field).toMatchObject({
        type: "integer",
        minimum: 0,
        maximum: 10,
        description: expect.stringContaining("integer 0-10"),
      });
    }
  });
});

describe("MCP factory seam", () => {
  interface ExperimentalServices extends McpToolServices {
    codeNavigationService: ReturnType<typeof createMockCodeNavigationService> &
      CodeDiffService;
    resolveTargetService: ResolveTargetService;
  }

  it("passes extension services to descriptor construction without runtime providers", () => {
    const stable = createDescriptorServices();
    const descriptorServices: ExperimentalServices = {
      ...stable,
      codeNavigationService: {
        ...stable.codeNavigationService,
        ...createMockCodeNavigationService(),
      },
      resolveTargetService: {
        resolveTarget: mock(() => Promise.reject(new Error("unused"))),
      },
    };
    const experimentalFactory: McpToolFactory<ExperimentalServices> = (
      services,
    ): ToolDefinition<unknown> => {
      expect(services.resolveTargetService).toBeDefined();
      expect(services.codeNavigationService.codeDiff).toBeDefined();
      return {
        name: "experimental_probe",
        description: "test-only experimental factory",
        schema: {},
        annotations: BOUNDED_WRITE_TOOL_ANNOTATIONS,
        handler: async () => textResult("ok"),
      };
    };

    const server = createMcpServerWithFactories({
      metadata: { name: "factory-test", version: "0.0.0" },
      services: () => {
        throw new Error("runtime provider must not run during registration");
      },
      toolFactories: [experimentalFactory],
      descriptorServices,
    });

    expect(
      Object.keys(
        (
          server as unknown as {
            _registeredTools: Record<string, unknown>;
          }
        )._registeredTools,
      ),
    ).toEqual(["experimental_probe"]);
  });
});
