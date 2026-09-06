import { describe, expect, it, mock } from "bun:test";
import type {
  CodeDiffService,
  ResolveTargetService,
} from "@githits/core-internal";
import { z } from "zod";
import { createMockCodeNavigationService } from "../services/test-helpers.js";
import { QUICK_START_PREREQUISITE } from "../tools/quick-start.js";
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
  "quick_start",
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
  {
    prefix: RegExp;
    exactPrefix?: string;
    body: string[];
    absent?: string[];
  }
> = {
  quick_start: {
    prefix:
      /^Required first call: `quick_start` loads untrusted-content safety rules\./,
    exactPrefix:
      "Required first call: `quick_start` loads untrusted-content safety rules. This in",
    body: [
      "initializes a plain MCP session",
      "skips it lacks those rules",
      "Skip only when the `githits-mcp` skill is loaded",
    ],
  },
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
    prefix: /^List indexed files and paths in any public GitHub repo\/package;/,
    body: ["`code_read`", "`code_grep`"],
  },
  code_read: {
    prefix:
      /^Read an exact indexed file or focused window in any public GitHub repo\/package;/,
    body: [
      "`code_files`",
      "`code_grep`",
      "`search`",
      "150 lines by default",
      "up to 300 lines",
    ],
  },
  code_grep: {
    prefix:
      /^Enumerate text, regex, or identifier matches in any public GitHub repo\/package\./,
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
    body: [
      "`docs_list`",
      "`search`",
      "`code_read`",
      "150 lines by default",
      "up to 300 lines",
    ],
  },
  pkg_info: {
    prefix: /^Assess latest package health and adoption/,
    exactPrefix:
      "Assess latest package health and adoption: license, downloads, and activity. Pro",
    body: [
      "`pkg_vulns`",
      'Use `pkg_vulns` for version-specific vulnerability details, or pass `advisory_scope: "all"` for package-wide history;',
      "`pkg_deps`",
      "`pkg_changelog`",
      "`pkg_upgrade_review`",
    ],
  },
  pkg_vulns: {
    prefix: /^Check current package advisories\./,
    exactPrefix:
      "Check current package advisories. Do not trust your memory for vulnerabilities. ",
    body: [
      "a cutoff disclaimer is not current evidence",
      '`advisory_scope:"all"`',
      '`{"registry":"npm","package_name":"next","advisory_scope":"all"}`',
      "Pinned lookup",
      "identifiers and aliases, including CVEs when available",
      "identifier aliases (including CVEs)",
      "`pkg_info`",
      "`pkg_upgrade_review`",
    ],
  },
  pkg_deps: {
    prefix: /^Inspect what a package depends on, directly or transitively/,
    exactPrefix:
      "Inspect what a package depends on, directly or transitively. Lists direct runtim",
    body: [
      "`pkg_info`",
      "`pkg_vulns`",
      "`pkg_upgrade_review`",
      "`include_issues: true`",
    ],
  },
  pkg_changelog: {
    prefix: /^Find release notes and changelog history/,
    exactPrefix:
      "Find release notes and changelog history for a package or public GitHub repo. De",
    body: [
      "`(from_version, to_version]`",
      "one exact release",
      "`pkg_info`",
      "`pkg_upgrade_review`",
    ],
    absent: ["newest-first", "most recent"],
  },
  pkg_upgrade_review: {
    prefix: /^Review a package upgrade/,
    exactPrefix:
      "Review a package upgrade: vulnerabilities, releases, peers, dependency changes. ",
    body: ["`pkg_info`", "`pkg_changelog`", "`pkg_vulns`", "`pkg_deps`"],
  },
};

function renderDeferredCatalogSummary(description: string): string {
  const sentence = description.match(/^([^.]*\.)(?:\s|$)/)?.[1];
  if (sentence === undefined) {
    throw new Error(
      "tool description must start with one complete sentence; no period may appear inside it",
    );
  }

  return sentence.length > 79 ? `${sentence.slice(0, 79)}…` : sentence;
}

describe("MCP tool annotations", () => {
  it("explicitly classifies the potential impact of every public tool", () => {
    const descriptors = getMcpToolDescriptors();

    expect(descriptors).toHaveLength(16);

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
    const catalogPrefixes = descriptors.map(({ description }) =>
      description.slice(0, 80),
    );
    expect(new Set(catalogPrefixes).size).toBe(descriptors.length);
    const catalogSummaries = descriptors.map(({ description }) =>
      renderDeferredCatalogSummary(description),
    );
    expect(new Set(catalogSummaries).size).toBe(descriptors.length);
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
      const catalogSummary = renderDeferredCatalogSummary(
        descriptor.description,
      );
      expect(catalogPrefix, descriptor.name).toMatch(routing.prefix);
      expect(catalogSummary, descriptor.name).toMatch(routing.prefix);
      if (routing.exactPrefix !== undefined) {
        expect(catalogPrefix, descriptor.name).toBe(routing.exactPrefix);
      }
      if (descriptor.name === "quick_start") {
        expect(catalogSummary).toContain("quick_start");
        expect(catalogSummary).not.toContain("githits-mcp");
        expect(catalogSummary).not.toEndWith("…");
        expect(catalogPrefix).not.toContain("githits-mcp");
      }
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

      if (descriptor.name === "quick_start" || descriptor.name === "feedback") {
        expect(descriptor.description).not.toContain(QUICK_START_PREREQUISITE);
      } else {
        expect(descriptor.description).toEndWith(QUICK_START_PREREQUISITE);
      }
    }

    expect(
      descriptors.reduce(
        (total, descriptor) => total + descriptor.description.length,
        0,
      ),
    ).toBeLessThan(17_000);

    const searchSchema = z.toJSONSchema(
      z.object(descriptors.find(({ name }) => name === "search")?.schema ?? {}),
    );
    const querySchema = searchSchema.properties?.query;
    const queryDescription =
      (querySchema as { description?: string } | undefined)?.description ?? "";
    expect(queryDescription).toContain("Focused discovery terms");
    expect(queryDescription).not.toContain("use terms such as");
  });
});

describe("MCP output format", () => {
  it("advertises token-efficient text as the explicit default", () => {
    const descriptors = getMcpToolDescriptors();

    for (const descriptor of descriptors) {
      if (!FORMAT_SELECTABLE_TOOLS.has(descriptor.name)) continue;

      const inputSchema = z.toJSONSchema(z.object(descriptor.schema));
      const formatSchema = inputSchema.properties?.format;

      expect(formatSchema, descriptor.name).toMatchObject({
        default: "text",
        enum: ["text", "json"],
      });
      expect(JSON.stringify(formatSchema), descriptor.name).toContain(
        "token-efficient",
      );
      expect(JSON.stringify(formatSchema), descriptor.name).toContain(
        "programmatic follow-up",
      );
      expect(descriptor.schema.format?.parse(undefined)).toBe("text");
      expect(descriptor.schema.format?.safeParse("text-v1").success).toBe(
        false,
      );
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
