import { describe, expect, it, mock } from "bun:test";
import {
  type PackageDocsList,
  PackageIntelligenceTargetNotFoundError,
} from "@githits/core-internal";
import { createMockPackageIntelligenceService } from "../services/test-helpers.js";
import { createListPackageDocsTool } from "./list-package-docs.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createListPackageDocsTool", () => {
  it("registers the correct tool metadata", () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService(),
    );
    expect(tool.name).toBe("docs_list");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
    expect(Object.keys(tool.schema)).toEqual([
      "target",
      "limit",
      "after",
      "format",
    ]);
    expect(tool.schema.target?.description).toContain("Go accepts versions");
    expect(tool.description).toContain("`docsReadTarget`");
    expect(tool.description).toContain("mutable current content");
    expect(tool.description).toContain("snapshot-addressed");
  });

  it("calls service.listPackageDocs with normalised params", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler({ target: "npm:express@5.2.1", limit: 3 }, {});

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "NPM",
      packageName: "express",
      version: "5.2.1",
      limit: 3,
    });
  });

  it("normalizes a trimmed uppercase npm scoped pin with pagination", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler(
      { target: " NPM:@types/node@22.0.0 ", limit: 3, after: " cursor " },
      {},
    );

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "NPM",
      packageName: "@types/node",
      version: "22.0.0",
      limit: 3,
      after: "cursor",
    });
  });

  it("normalizes an unpinned npm target without a version", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler({ target: "npm:express" }, {});

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "NPM",
      packageName: "express",
    });
  });

  it.each([
    "go:github.com/gin-gonic/gin@1.2.3",
    "go:github.com/gin-gonic/gin@v1.2.3",
  ])("normalizes Go target %s to a v-prefixed version", async (target) => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler({ target }, {});

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "GO",
      packageName: "github.com/gin-gonic/gin",
      version: "v1.2.3",
    });
  });

  it("normalizes a Swift GitHub target and package name", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler(
      { target: "swift:github.com/Apple/Swift-Argument-Parser@v1.5.0" },
      {},
    );

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "SWIFT",
      packageName: "github.com/apple/swift-argument-parser",
      version: "v1.5.0",
    });
  });

  it("normalizes a Maven coordinate", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler(
      { target: "maven:org.apache.commons:commons-lang3@3.17.0" },
      {},
    );

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "MAVEN",
      packageName: "org.apache.commons:commons-lang3",
      version: "3.17.0",
    });
  });

  it("returns JSON-stringified lean envelope when format=json", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { target: "npm:express", format: "json" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.name).toBe("express");
    expect(Array.isArray(payload.pages)).toBe(true);
  });

  it("renders active empty results as in progress and preserves JSON state", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({
        listPackageDocs: mock(() =>
          Promise.resolve({
            registry: "NPM",
            packageName: "express",
            version: "5.2.1",
            codeIndexState: "INDEXING",
            pages: [],
            pageInfo: { hasNextPage: false, totalCount: 0 },
          }),
        ),
      }),
    );

    const textResult = await tool.handler({ target: "npm:express" }, {});
    expect(textResult.content[0]?.text).toContain(
      "indexing is still in progress",
    );
    expect(textResult.content[0]?.text).not.toContain(
      "No documentation pages found.",
    );

    const jsonResult = await tool.handler(
      { target: "npm:express", format: "json" },
      {},
    );
    expect(parseText(jsonResult)).toMatchObject({
      codeIndexState: "INDEXING",
      pages: [],
    });
  });

  it("defaults to compact text output", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler({ target: "npm:express" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("docs_list | npm:express");
    expect(text).toContain("read target=");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("prefers docsReadTarget in text follow-ups and retains all JSON locators", async () => {
    const docsReadTarget =
      "https://docs.example.test/guide with spaces;$(echo nope)?q='quoted'&x=*";
    const listPackageDocs = mock(() =>
      Promise.resolve({
        registry: "npm",
        packageName: "example",
        pages: [
          {
            id: "legacy-crawled-id",
            docsReadTarget,
            title: "Publisher guide",
            sourceKind: "CRAWLED" as const,
            sourceUrl: "https://docs.example.test/guide with spaces",
          },
        ],
        pageInfo: { hasNextPage: false },
      }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    const textResult = await tool.handler({ target: "npm:example" }, {});
    expect(textResult.content[0]?.text).toContain(
      `read target=${JSON.stringify(docsReadTarget)}`,
    );
    expect(textResult.content[0]?.text).not.toContain(
      'read target="legacy-crawled-id"',
    );

    const jsonResult = await tool.handler(
      { target: "npm:example", format: "json" },
      {},
    );
    const payload = parseText(jsonResult) as {
      pages: Array<{
        docsReadTarget: string;
        pageId: string;
        sourceKind: string;
        sourceUrl: string;
        title: string;
      }>;
    };
    expect(payload.pages[0]).toEqual({
      docsReadTarget,
      pageId: "legacy-crawled-id",
      sourceKind: "crawled",
      sourceUrl: "https://docs.example.test/guide with spaces",
      title: "Publisher guide",
    });
  });

  it("uses served gitRef for repo-backed docs text follow-ups", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({
        listPackageDocs: mock(() =>
          Promise.resolve({
            registry: "npm",
            packageName: "ms",
            version: "2.1.3",
            pages: [
              {
                id: "github:vercel/ms@sha/readme.md",
                docsReadTarget: "github:vercel/ms@sha/readme.md",
                title: "readme.md",
                sourceKind: "REPOSITORY",
                sourceUrl: "https://github.com/vercel/ms/blob/sha/readme.md",
                repoUrl: "https://github.com/vercel/ms",
                gitRef: "served-sha",
                requestedRef: "main",
                filePath: "readme.md",
              },
            ],
            pageInfo: { hasNextPage: false },
          } satisfies PackageDocsList),
        ),
      }),
    );

    const result = await tool.handler({ target: "npm:ms" }, {});
    const text = result.content[0]?.text ?? "";
    expect(text).toContain('read target="github:vercel/ms@served-sha"');
    expect(text).not.toContain("#main");
  });

  it("omits nullish lastUpdatedAt values from the lean envelope", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({
        listPackageDocs: mock(() =>
          Promise.resolve({
            registry: "npm",
            packageName: "ms",
            version: "2.1.3",
            pages: [
              {
                id: "github:vercel/ms@sha/readme.md",
                docsReadTarget: "github:vercel/ms@sha/readme.md",
                title: "readme.md",
                sourceKind: "REPOSITORY",
                sourceUrl: "https://github.com/vercel/ms/blob/sha/readme.md",
                repoUrl: "https://github.com/vercel/ms",
                gitRef: "sha",
                filePath: "readme.md",
              },
            ],
            pageInfo: { hasNextPage: false },
          } satisfies PackageDocsList),
        ),
      }),
    );

    const result = await tool.handler({ target: "npm:ms", format: "json" }, {});
    const payload = parseText(result) as {
      pages: Array<{ lastUpdatedAt?: string }>;
    };
    expect(payload.pages[0]?.lastUpdatedAt).toBeUndefined();
  });

  it("returns INVALID_ARGUMENT for unknown registry", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );
    const result = await tool.handler({ target: "cargo:serde" }, {});
    const payload = parseText(result) as { code: string; retryable: boolean };
    expect(result.isError).toBe(true);
    expect(payload).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(listPackageDocs).not.toHaveBeenCalled();
  });

  it.each([
    "",
    "   ",
    "express",
    "npm:",
    "npm:express@",
    "madeup:express",
    "github:expressjs/express",
    "site:expressjs.com",
  ])(
    "rejects invalid compact target %j without calling service",
    async (target) => {
      const listPackageDocs = mock(() =>
        Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
      );
      const tool = createListPackageDocsTool(
        createMockPackageIntelligenceService({ listPackageDocs }),
      );

      const result = await tool.handler({ target }, {});

      expect(result.isError).toBe(true);
      expect(parseText(result)).toMatchObject({
        code: "INVALID_ARGUMENT",
        retryable: false,
      });
      expect(listPackageDocs).not.toHaveBeenCalled();
    },
  );

  it("classifies target-not-found errors as NOT_FOUND", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({
        listPackageDocs: mock(() =>
          Promise.reject(
            new PackageIntelligenceTargetNotFoundError("Package not found"),
          ),
        ),
      }),
    );
    const result = await tool.handler({ target: "npm:ghost" }, {});
    const payload = parseText(result) as { code: string };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("NOT_FOUND");
  });
});
