import { describe, expect, it, mock } from "bun:test";
import {
  type PackageDocsList,
  PackageIntelligenceTargetNotFoundError,
} from "../services/index.js";
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
    expect(tool.annotations?.readOnlyHint).toBe(true);
    expect(Object.keys(tool.schema)).toEqual([
      "registry",
      "package_name",
      "version",
      "limit",
      "after",
    ]);
  });

  it("calls service.listPackageDocs with normalised params", async () => {
    const listPackageDocs = mock(() =>
      Promise.resolve({ pages: [], pageInfo: { hasNextPage: false } }),
    );
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService({ listPackageDocs }),
    );

    await tool.handler(
      { registry: "npm", package_name: "express", version: "5.2.1", limit: 3 },
      {},
    );

    expect(listPackageDocs).toHaveBeenCalledWith({
      registry: "NPM",
      packageName: "express",
      version: "5.2.1",
      limit: 3,
    });
  });

  it("returns JSON-stringified lean envelope on success", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "npm", package_name: "express" },
      {},
    );
    const payload = parseText(result) as Record<string, unknown>;
    expect(payload.name).toBe("express");
    expect(Array.isArray(payload.pages)).toBe(true);
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

    const result = await tool.handler(
      { registry: "npm", package_name: "ms" },
      {},
    );
    const payload = parseText(result) as {
      pages: Array<{ lastUpdatedAt?: string }>;
    };
    expect(payload.pages[0]?.lastUpdatedAt).toBeUndefined();
  });

  it("returns INVALID_ARGUMENT for unknown registry", async () => {
    const tool = createListPackageDocsTool(
      createMockPackageIntelligenceService(),
    );
    const result = await tool.handler(
      { registry: "cargo", package_name: "serde" },
      {},
    );
    const payload = parseText(result) as { code: string };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

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
    const result = await tool.handler(
      { registry: "npm", package_name: "ghost" },
      {},
    );
    const payload = parseText(result) as { code: string };
    expect(result.isError).toBe(true);
    expect(payload.code).toBe("NOT_FOUND");
  });
});
