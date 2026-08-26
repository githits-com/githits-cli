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

const STABLE_MCP_TOOL_NAMES = [
  "get_example",
  "search_language",
  "feedback",
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
] as const;

const DESCRIPTION_ROUTING: Record<
  (typeof STABLE_MCP_TOOL_NAMES)[number],
  { prefix: RegExp; body: string[]; absent?: string[] }
> = {
  get_example: {
    prefix: /^Find canonical cross-project examples/,
    body: [
      "`search`",
      "`docs_read`",
      "`code_read`",
      "`code_grep`",
      "`search_language`",
    ],
  },
  search_language: {
    prefix: /^Resolve a supported language name or alias/,
    body: ["`get_example`", "Do not use this for source search"],
  },
  feedback: {
    prefix: /^Submit feedback when a GitHits result/,
    body: ["`solution_id`", "`tool_name`"],
  },
  search: {
    prefix: /^Discover relevant evidence in a known target before exact grep/,
    body: [
      "Start here for open-ended",
      "Omit `source` to let GitHits select the best sources",
      "`search_status`",
      "`code_grep`",
      "`docs_read`",
      "`code_read`",
    ],
  },
  search_status: {
    prefix: /^Continue an explicit `search` reference/,
    body: [
      "only after a prior `search` response explicitly supplies",
      "`searchRef`",
      "`search_status`",
    ],
  },
  code_files: {
    prefix: /^List indexed files and paths/,
    body: ["`code_read`", "`code_grep`"],
  },
  code_read: {
    prefix: /^Read an exact indexed file or focused line window/,
    body: ["`code_files`", "`code_grep`", "`search`", "150 lines per call"],
  },
  code_grep: {
    prefix:
      /^Enumerate matches for a known exact literal, regex, identifier, or call site/,
    body: [
      "deterministic and paginated",
      "`search`",
      "`code_read`",
      "`code_files`",
    ],
  },
  docs_list: {
    prefix: /^List package documentation pages/,
    body: ["`docs_read`", "`search`", "`code_read`"],
  },
  docs_read: {
    prefix: /^Read a package documentation page by ID/,
    body: ["`docs_list`", "`search`", "`code_read`", "150 lines per call"],
  },
  pkg_info: {
    prefix: /^Summarize latest package health and adoption signals/,
    body: [
      "`pkg_vulns`",
      "`pkg_deps`",
      "`pkg_changelog`",
      "`pkg_upgrade_review`",
    ],
  },
  pkg_vulns: {
    prefix: /^Find known package vulnerabilities, CVEs, advisories/,
    body: ["`pkg_info`", "`pkg_upgrade_review`"],
  },
  pkg_deps: {
    prefix: /^Map a package's dependency graph/,
    body: ["`pkg_info`", "`pkg_vulns`", "`pkg_upgrade_review`"],
  },
  pkg_changelog: {
    prefix: /^Find release and changelog evidence/,
    body: [
      "`(from_version, to_version]`",
      "one exact release",
      "`pkg_info`",
      "`pkg_upgrade_review`",
    ],
    absent: ["newest-first", "most recent"],
  },
  pkg_upgrade_review: {
    prefix:
      /^Compare current and target package versions and report upgrade evidence/,
    body: ["`pkg_info`", "`pkg_changelog`", "`pkg_vulns`", "`pkg_deps`"],
  },
};

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

describe("MCP tool description catalog", () => {
  it("puts each stable tool's benefit and routing role at the catalog boundary", () => {
    const descriptors = getMcpToolDescriptors();

    expect(descriptors.map(({ name }) => name)).toEqual([
      ...STABLE_MCP_TOOL_NAMES,
    ]);
    expect(Object.keys(DESCRIPTION_ROUTING).sort()).toEqual(
      [...STABLE_MCP_TOOL_NAMES].sort(),
    );

    for (const descriptor of descriptors) {
      const routing =
        DESCRIPTION_ROUTING[
          descriptor.name as keyof typeof DESCRIPTION_ROUTING
        ];
      expect(routing, descriptor.name).toBeDefined();

      const catalogPrefix = descriptor.description.slice(0, 80);
      expect(catalogPrefix, descriptor.name).toMatch(routing.prefix);
      expect(catalogPrefix, descriptor.name).not.toMatch(
        /^Use (when|after|before|for|only)\b/i,
      );
      expect(
        descriptor.description.length,
        `${descriptor.name}: description characters`,
      ).toBeLessThan(2000);
      for (const phrase of routing.body) {
        expect(
          descriptor.description,
          `${descriptor.name}: ${phrase}`,
        ).toContain(phrase);
      }
      for (const phrase of routing.absent ?? []) {
        expect(
          descriptor.description,
          `${descriptor.name}: ${phrase}`,
        ).not.toContain(phrase);
      }
    }

    expect(
      descriptors.reduce(
        (total, descriptor) => total + descriptor.description.length,
        0,
      ),
    ).toBeLessThan(15_000);

    const searchSchema = z.toJSONSchema(
      z.object(descriptors.find(({ name }) => name === "search")?.schema ?? {}),
    );
    const querySchema = searchSchema.properties?.query;
    const queryDescription =
      (querySchema as { description?: string } | undefined)?.description ?? "";
    expect(queryDescription).toMatch(
      /"how does".*"where is".*"grep the source"/,
    );
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
