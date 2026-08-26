import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  defaultListFilesResult,
} from "../services/test-helpers.js";
import { createListFilesTool } from "./list-files.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createListFilesTool — metadata", () => {
  it("registers the correct tool name, description, and schema keys", () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    expect(tool.name).toBe("code_files");
    expect(tool.description).toContain(
      "List indexed files and paths for enumeration",
    );
    expect(tool.description).toContain("`code_read` or `code_grep`");
    expect(tool.description).toContain(
      "First choice for file/path enumeration",
    );
    expect(tool.description).toContain("`path_prefix` for directory prefixes");
    expect(tool.description).toContain("`FILE_PATH_EXCLUDED`");
    expect(tool.description).toContain("`SOURCE_FILE_INVENTORY_UNKNOWN`");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "exclude_doc_files",
      "exclude_file_intents",
      "exclude_test_files",
      "extensions",
      "file_intent",
      "file_intents",
      "file_types",
      "format",
      "globs",
      "include_hidden",
      "languages",
      "limit",
      "path",
      "path_prefix",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
  });
});

describe("createListFilesTool — happy path", () => {
  it("calls listFiles with the resolved package target", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const tool = createListFilesTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
      },
      {},
    );

    const calls = listFiles.mock.calls as unknown as Array<
      [{ target: { registry?: string; packageName?: string } }]
    >;
    expect(calls[0]?.[0]?.target?.registry).toBe("NPM");
    expect(calls[0]?.[0]?.target?.packageName).toBe("express");
  });

  it("ignores blank repo fields on package targets", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const tool = createListFilesTool(service);

    await tool.handler(
      {
        target: {
          registry: "npm",
          package_name: "express",
          repo_url: " ",
          git_ref: "\t",
        },
      },
      {},
    );

    const calls = listFiles.mock.calls as unknown as Array<
      [
        {
          target: { registry?: string; packageName?: string; repoUrl?: string };
        },
      ]
    >;
    expect(calls[0]?.[0]?.target).toMatchObject({
      registry: "NPM",
      packageName: "express",
    });
    expect(calls[0]?.[0]?.target?.repoUrl).toBeUndefined();
  });

  it("accepts compact repo string targets", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const tool = createListFilesTool(service);

    await tool.handler(
      {
        target: "https://github.com/expressjs/express#HEAD",
      },
      {},
    );

    const calls = listFiles.mock.calls as unknown as Array<
      [{ target: { repoUrl?: string; gitRef?: string } }]
    >;
    expect(calls[0]?.[0]?.target).toMatchObject({
      repoUrl: "https://github.com/expressjs/express",
      gitRef: "HEAD",
    });
  });

  it("forwards advanced list-files filters to the service", async () => {
    const listFiles = mock(() => Promise.resolve(defaultListFilesResult));
    const service = createMockCodeNavigationService({ listFiles });
    const tool = createListFilesTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "README.md",
        path_prefix: "src/",
        globs: ["test/**/*.js"],
        extensions: ["js"],
        file_types: ["source"],
        languages: ["JavaScript"],
        file_intents: ["production", "test"],
        exclude_file_intents: ["generated"],
        exclude_doc_files: true,
        exclude_test_files: false,
        include_hidden: true,
      },
      {},
    );

    const calls = listFiles.mock.calls as unknown as Array<
      [
        {
          pathSelectors?: Array<{ kind: string; value: string }>;
          pathPrefix?: string;
          fileIntents?: string[];
          excludeFileIntents?: string[];
          includeHidden?: boolean;
        },
      ]
    >;
    expect(calls[0]?.[0]).toMatchObject({
      pathSelectors: [
        { kind: "EXACT", value: "README.md" },
        { kind: "GLOB", value: "test/**/*.js" },
      ],
      pathPrefix: "src/",
      fileIntents: ["PRODUCTION", "TEST"],
      excludeFileIntents: ["GENERATED"],
      includeHidden: true,
    });
  });

  it("emits the envelope with files, total, hasMore, resolution, indexedVersion", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" }, format: "json" },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as {
      registry: string;
      name: string;
      total: number;
      hasMore: boolean;
      files: Array<{ path: string }>;
      indexedVersion?: string;
      resolution?: { resolvedRef?: string };
    };
    expect(payload.registry).toBe("npm");
    expect(payload.name).toBe("express");
    expect(payload.total).toBe(2);
    expect(payload.hasMore).toBe(false);
    expect(payload.files[0]?.path).toBe("src/index.js");
    expect(payload.indexedVersion).toBe("v5.2.1");
    expect(payload.resolution?.resolvedRef).toBe("v5.2.1");
  });

  it("emits repo-URL addressing envelope", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: {
          repo_url: "https://github.com/expressjs/express",
          git_ref: "main",
        },
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      registry?: string;
      name?: string;
      repoUrl?: string;
      gitRef?: string;
    };
    expect(payload.registry).toBeUndefined();
    expect(payload.name).toBeUndefined();
    expect(payload.repoUrl).toBe("https://github.com/expressjs/express");
    expect(payload.gitRef).toBe("main");
  });

  it("emits filter.pathPrefix when caller set one", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path_prefix: "src/",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: { pathPrefix?: string };
    };
    expect(payload.filter?.pathPrefix).toBe("src/");
  });

  it("echoes advanced filters when caller set them", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "README.md",
        globs: ["test/**/*.js"],
        extensions: ["js"],
        file_types: ["source"],
        languages: ["JavaScript"],
        file_intent: "production",
        exclude_file_intents: ["generated"],
        exclude_doc_files: true,
        include_hidden: true,
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      filter?: {
        path?: string;
        globs?: string[];
        extensions?: string[];
        fileTypes?: string[];
        languages?: string[];
        fileIntent?: string;
        excludeFileIntents?: string[];
        excludeDocFiles?: boolean;
        includeHidden?: boolean;
      };
    };
    expect(payload.filter).toEqual({
      path: "README.md",
      globs: ["test/**/*.js"],
      extensions: ["js"],
      fileTypes: ["source"],
      languages: ["JavaScript"],
      fileIntent: "production",
      excludeFileIntents: ["generated"],
      excludeDocFiles: true,
      includeHidden: true,
    });
  });

  it("omits filter when caller only used defaults", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" }, format: "json" },
      {},
    );
    const payload = parseText(result) as { filter?: unknown };
    expect(payload.filter).toBeUndefined();
  });
});

describe("createListFilesTool — validation errors", () => {
  it("returns INVALID_ARGUMENT for both target forms (not both)", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: {
          registry: "npm",
          package_name: "express",
          repo_url: "https://github.com/x",
          git_ref: "main",
        },
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("not both");
  });

  it("returns INVALID_ARGUMENT for out-of-range limit via envelope (not raw Zod)", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" }, limit: 1001 },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("returns INVALID_ARGUMENT for missing repo_url pair (only git_ref)", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler({ target: { git_ref: "main" } }, {});
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
  });

  it("allows repo targets without git refs for default-branch intent", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: "https://github.com/expressjs/express" },
      {},
    );
    expect(result.isError).toBeUndefined();
  });

  it("treats empty optional selectors as omitted", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path: "",
        path_prefix: "",
        file_intent: "",
        format: "json",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const payload = parseText(result) as { filter?: unknown };
    expect(payload.filter).toBeUndefined();
  });
});

describe("createListFilesTool — service errors", () => {
  it("classifies CodeNavigationIndexingError as INDEXING with retryable + details", async () => {
    const service = createMockCodeNavigationService({
      listFiles: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError(
            "Target is indexing.",
            "ref_abc",
            [{ version: "4.21.0", ref: "v4.21.0" }],
            [{ ref: "main" }],
          ),
        ),
      ),
    });
    const tool = createListFilesTool(service);
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" } },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      retryable: boolean;
      details?: {
        indexingRef?: string;
        availableVersions?: unknown;
        availableRefs?: unknown;
      };
    };
    expect(payload.code).toBe("INDEXING");
    expect(payload.retryable).toBe(true);
    expect(payload.details?.indexingRef).toBe("ref_abc");
    expect(payload.details?.availableVersions).toBeTruthy();
    expect(payload.details?.availableRefs).toBeTruthy();
  });

  it("classifies CodeNavigationTargetNotFoundError as NOT_FOUND", async () => {
    const service = createMockCodeNavigationService({
      listFiles: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createListFilesTool(service);
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "ghost" } },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string };
    expect(payload.code).toBe("NOT_FOUND");
  });
});

describe("createListFilesTool — text format", () => {
  it("defaults to text output when format is omitted", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      { target: { registry: "npm", package_name: "express" } },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_files | 2 paths");
    // Confirm text payload is not valid JSON (proves text default).
    expect(() => JSON.parse(text)).toThrow();
  });

  it("returns line-oriented text when format=text-v1", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        format: "text-v1",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_files | 2 paths | npm:express@v5.2.1");
    expect(text).toContain("src/index.js");
    // Confirm the text payload is not valid JSON.
    expect(() => JSON.parse(text)).toThrow();
  });

  it("accepts format=text as an alias for text-v1", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        format: "text",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_files | 2 paths");
  });

  it("keeps JSON envelope when format=json (explicit)", async () => {
    const tool = createListFilesTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as { registry: string; total: number };
    expect(payload.registry).toBe("npm");
    expect(payload.total).toBe(2);
  });
});
