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
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
} from "../tools/types.js";
import {
  createDescriptorServices,
  createMcpServerWithFactories,
  getMcpToolDescriptors,
  type McpToolFactory,
} from "./server.js";

const FORMAT_SELECTABLE_TOOLS = new Set([
  "get_example",
  "search",
  "search_status",
  "code_files",
  "read",
  "code_grep",
  "docs_list",
  "pkg_info",
  "pkg_vulns",
  "pkg_deps",
  "pkg_changelog",
  "pkg_upgrade_review",
]);

const STABLE_MCP_TOOL_NAMES = [
  "quick_start",
  "get_example",
  "search",
  "search_status",
  "code_files",
  "read",
  "code_grep",
  "docs_list",
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
      /^Call quick_start first to choose tools and load untrusted-content rules\./,
    exactPrefix:
      "Call quick_start first to choose tools and load untrusted-content rules. Call on",
    body: [
      "Call once per session before discovering evidence tools",
      "untrusted-content rules",
      "unless the loaded githits-mcp skill already contains this guide",
    ],
  },
  get_example: {
    prefix: /^Find canonical cross-project examples/,
    body: [
      "target-scoped search came up short",
      "source repository provenance",
    ],
  },
  search: {
    prefix:
      /^Discover relevant docs, code, and symbols in a known public target\./,
    body: [
      "Start here for open-ended",
      "`query` plus either `target` or `targets`",
      "`search_status`",
      "`read`",
    ],
  },
  search_status: {
    prefix: /^Continue an explicit search reference for progress and results\./,
    body: [
      "only after a prior `search` response explicitly supplies",
      "`searchRef`",
      "`search_status`",
    ],
  },
  code_files: {
    prefix: /^List indexed files and paths in a public repo or package\./,
    body: ["`read`", "`code_grep`"],
  },
  read: {
    prefix:
      /^Read an indexed source file, code symbol, or documentation section\./,
    exactPrefix:
      "Read an indexed source file, code symbol, or documentation section. Pass target ",
    body: [
      "use code_files",
      "search/code_grep",
      "target and path for a file; use compact target#symbol or selector for a code symbol",
      "Hosted/crawled HTTP(S) docs targets read mutable current content",
      "repository-doc targets address snapshots",
      "A docs URL fragment needs no bounds",
      "full subtree through the next equal-or-higher heading",
      "either bound replaces it with a page-relative range",
      "exact revisions",
      "does not list directories",
      "returned continuation and error actions",
      "INDEXING retry",
    ],
  },
  code_grep: {
    prefix:
      /^Find text, regex, or identifier matches in a public repo or package\./,
    body: ["deterministic and paginated", "`read.path`", "`match.line`"],
  },
  docs_list: {
    prefix: /^List package documentation targets for follow-up reads\./,
    body: [
      "`read.target`",
      "`docsReadTarget`",
      "not standalone `site:` targets",
    ],
  },
  pkg_info: {
    prefix: /^Assess latest package health and adoption/,
    exactPrefix:
      "Assess latest package health and adoption: license, downloads, and activity. Pro",
    body: [
      "unpinned package target",
      "always returns latest",
      "Historical counts are not current-version risk",
    ],
  },
  pkg_vulns: {
    prefix: /^Check current package advisories\./,
    exactPrefix:
      "Check current package advisories. Do not trust your memory for vulnerabilities. ",
    body: [
      "a cutoff disclaimer is not current evidence",
      '`advisory_scope:"all"`',
      '`{"target":"npm:next","advisory_scope":"all"}`',
      "unpinned target",
      "identifiers and aliases, including CVEs when available",
      "identifier aliases (including CVEs)",
      "Transitive evidence is opt-in",
    ],
  },
  pkg_deps: {
    prefix: /^Inspect what a package depends on, directly or transitively/,
    exactPrefix:
      "Inspect what a package depends on, directly or transitively. Lists direct runtim",
    body: [
      "non-runtime groups are omitted by default",
      "not local application lockfile",
    ],
  },
  pkg_changelog: {
    prefix: /^Find release notes and changelog history/,
    exactPrefix:
      "Find release notes and changelog history for a package. Default latest mode retu",
    body: [
      "`registry:name@version`",
      "one selected release",
      "Empty latest or range selections succeed",
    ],
    absent: ["newest-first", "most recent", "repo_url", "from_version"],
  },
  pkg_upgrade_review: {
    prefix: /^Review a package upgrade/,
    exactPrefix:
      "Review a package upgrade: vulnerabilities, releases, peers, dependency changes. ",
    body: ["facts only", "does not assign risk", "at most 30 upgrades"],
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

    expect(descriptors.map(({ name }) => name)).not.toContain("feedback");
    expect(descriptors).toHaveLength(13);
    expect(descriptors.map(({ name }) => name)).toContain("read");
    expect(descriptors.map(({ name }) => name)).not.toContain("code_read");
    expect(descriptors.map(({ name }) => name)).not.toContain("docs_read");

    for (const descriptor of descriptors) {
      expect(descriptor.annotations, descriptor.name).toEqual({
        readOnlyHint: true,
        openWorldHint: descriptor.name !== "quick_start",
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
    expect(descriptors.map(({ name }) => name)).not.toContain("code_read");
    expect(descriptors.map(({ name }) => name)).not.toContain("docs_read");
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
      expect(
        descriptor.description.split(".")[0]!.length + 1,
        descriptor.name,
      ).toBeLessThanOrEqual(79);
      expect(catalogSummary, descriptor.name).not.toEndWith("…");
      if (descriptor.name === "quick_start") {
        expect(catalogSummary).toContain("Call quick_start first");
        expect(catalogSummary).toContain("untrusted-content rules");
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

      if (descriptor.name === "quick_start") {
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

    const readDescription = descriptors.find(
      ({ name }) => name === "read",
    )?.description;
    expect(readDescription).toBeDefined();
    expect(readDescription?.slice(0, 79)).toBe(
      "Read an indexed source file, code symbol, or documentation section. Pass target",
    );
    expect(readDescription?.slice(0, 80)).toBe(
      "Read an indexed source file, code symbol, or documentation section. Pass target ",
    );

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
  it("keeps model-read results in text by default", () => {
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
        "Omit `format` to use token-efficient text when the model reads the result",
      );
      expect(JSON.stringify(formatSchema), descriptor.name).toContain(
        "code consumes the raw response instead of the model",
      );
      expect(descriptor.schema.format?.parse(undefined)).toBe("text");
      expect(descriptor.schema.format?.safeParse("text-v1").success).toBe(
        false,
      );
    }
  });
});

describe("MCP code_grep schema", () => {
  it("accepts nonnegative safe context integers and advertises the effective cap", () => {
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
        maximum: Number.MAX_SAFE_INTEGER,
        description: expect.stringContaining("capped at 10"),
      });
    }
  });
});

describe("MCP compact target schemas", () => {
  it.each([
    ["docs_list", ["after", "format", "limit", "target"]],
    ["pkg_info", ["format", "target", "verbose"]],
    [
      "pkg_vulns",
      [
        "advisory_scope",
        "format",
        "include_transitive",
        "include_withdrawn",
        "min_severity",
        "target",
        "verbose",
      ],
    ],
    [
      "pkg_deps",
      [
        "format",
        "include_importers",
        "include_issues",
        "lifecycle",
        "max_depth",
        "target",
      ],
    ],
    [
      "pkg_changelog",
      ["body_lines", "format", "limit", "omit_bodies", "target", "verbose"],
    ],
  ] as const)("%s exposes the compact target schema", (name, properties) => {
    const descriptor = getMcpToolDescriptors().find(
      (candidate) => candidate.name === name,
    );
    expect(descriptor).toBeDefined();

    const schema = z.toJSONSchema(z.object(descriptor?.schema ?? {}), {
      io: "input",
    });
    expect(Object.keys(schema.properties ?? {}).sort(), name).toEqual([
      ...properties,
    ]);
    expect(schema.required, name).toEqual(["target"]);
    expect(schema.properties?.target, name).toMatchObject({
      type: "string",
    });
    for (const coordinate of [
      "registry",
      "package_name",
      "version",
      "repo_url",
      "git_ref",
      "from_version",
      "to_version",
    ]) {
      expect(
        schema.properties?.[coordinate],
        `${name}: ${coordinate}`,
      ).toBeUndefined();
    }
  });

  it("uses strings for code and discovery targets without nested coordinates", () => {
    const descriptors = getMcpToolDescriptors();
    for (const name of ["code_files", "code_grep"] as const) {
      const descriptor = descriptors.find(
        (candidate) => candidate.name === name,
      );
      expect(descriptor).toBeDefined();
      const schema = z.toJSONSchema(z.object(descriptor?.schema ?? {}));
      const targetSchema = schema.properties?.target as
        | { properties?: unknown; type?: string }
        | undefined;
      expect(targetSchema, name).toMatchObject({ type: "string" });
      expect(targetSchema?.properties, name).toBeUndefined();
    }

    const search = descriptors.find((candidate) => candidate.name === "search");
    expect(search).toBeDefined();
    const searchSchema = z.toJSONSchema(z.object(search?.schema ?? {}));
    const targetSchema = searchSchema.properties?.target as
      | { properties?: unknown; type?: string }
      | undefined;
    const targetsSchema = searchSchema.properties?.targets as
      | { items?: { properties?: unknown; type?: string }; type?: string }
      | undefined;
    expect(targetSchema).toMatchObject({ type: "string" });
    expect(targetSchema?.properties).toBeUndefined();
    expect(targetsSchema).toMatchObject({
      type: "array",
      items: { type: "string" },
    });
    expect(targetsSchema?.items?.properties).toBeUndefined();
  });
});

describe("MCP search schema", () => {
  it("keeps query and public_only without duplicate structured qualifiers", () => {
    const search = getMcpToolDescriptors().find(
      (candidate) => candidate.name === "search",
    );
    expect(search).toBeDefined();

    const schema = z.toJSONSchema(z.object(search?.schema ?? {}));
    for (const field of [
      "category",
      "kind",
      "path_prefix",
      "file_intent",
      "name",
      "language",
    ]) {
      expect(schema.properties?.[field], field).toBeUndefined();
    }
    expect(schema.properties?.query).toBeDefined();
    expect(schema.properties?.public_only).toBeDefined();
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
        annotations: READ_ONLY_TOOL_ANNOTATIONS,
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
