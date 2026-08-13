import { describe, expect, it, mock } from "bun:test";
import {
  CodeNavigationFileNotFoundError,
  CodeNavigationIndexingError,
  CodeNavigationTargetNotFoundError,
} from "@githits/core-internal";
import {
  createMockCodeNavigationService,
  defaultGrepRepoResult,
} from "../services/test-helpers.js";
import { createGrepRepoTool } from "./grep-repo.js";

function parseText(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]?.text ?? "");
}

describe("createGrepRepoTool — metadata", () => {
  it("registers the correct tool name and schema keys", () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    expect(tool.name).toBe("code_grep");
    expect(tool.description).toContain("Deterministic text or regex grep");
    expect(Object.keys(tool.schema).sort()).toEqual([
      "case_sensitive",
      "context_lines",
      "context_lines_after",
      "context_lines_before",
      "cursor",
      "exclude_doc_files",
      "exclude_test_files",
      "extensions",
      "format",
      "globs",
      "max_matches",
      "max_matches_per_file",
      "path",
      "path_prefix",
      "pattern",
      "pattern_type",
      "symbol_fields",
      "target",
      "wait_timeout_ms",
    ]);
    expect(tool.schema.symbol_fields?.description).toContain("parent_path");
    expect(tool.annotations).toEqual({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    });
  });
});

describe("createGrepRepoTool — happy path", () => {
  it("calls grepRepo with resolved target and grep params", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const service = createMockCodeNavigationService({ grepRepo });
    const tool = createGrepRepoTool(service);

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path_prefix: "src/",
        globs: ["src/**/*.js"],
        extensions: ["js"],
        pattern_type: "regex",
        case_sensitive: true,
        context_lines_before: 2,
        context_lines_after: 1,
      },
      {},
    );

    const calls = grepRepo.mock.calls as unknown as Array<
      [
        {
          target: { registry?: string };
          pattern: string;
          patternType?: string;
          pathSelectors?: Array<{ kind: string; value: string }>;
          extensions?: string[];
          caseSensitive?: boolean;
          contextLinesBefore?: number;
          contextLinesAfter?: number;
          symbolFields?: string[];
        },
      ]
    >;
    expect(calls[0]?.[0]?.target.registry).toBe("NPM");
    expect(calls[0]?.[0]?.pattern).toBe("middleware");
    expect(calls[0]?.[0]?.patternType).toBe("REGEX");
    expect(calls[0]?.[0]?.caseSensitive).toBe(true);
    expect(calls[0]?.[0]?.extensions).toEqual(["js"]);
    expect(calls[0]?.[0]?.pathSelectors).toEqual([
      { kind: "PREFIX", value: "src/" },
      { kind: "GLOB", value: "src/**/*.js" },
    ]);
  });

  it("accepts compact package string targets", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const service = createMockCodeNavigationService({ grepRepo });
    const tool = createGrepRepoTool(service);

    await tool.handler(
      {
        target: "npm:express",
        pattern: "middleware",
      },
      {},
    );

    const calls = grepRepo.mock.calls as unknown as Array<
      [{ target: { registry?: string; packageName?: string } }]
    >;
    expect(calls[0]?.[0]?.target).toMatchObject({
      registry: "NPM",
      packageName: "express",
    });
  });

  it("returns invalid argument for whitespace-only repo_url with git_ref", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const service = createMockCodeNavigationService({ grepRepo });
    const tool = createGrepRepoTool(service);

    const result = await tool.handler(
      {
        target: { repo_url: " ", git_ref: "HEAD" },
        pattern: "middleware",
      },
      {},
    );

    expect(result.isError).toBe(true);
    expect(grepRepo).not.toHaveBeenCalled();
    expect(parseText(result)).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("passes symbol field hydration through to grepRepo", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const tool = createGrepRepoTool(
      createMockCodeNavigationService({ grepRepo }),
    );

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        symbol_fields: ["name", "qualified_path", "kind"],
      },
      {},
    );

    expect(grepRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        symbolFields: ["name", "qualified_path", "kind"],
      }),
    );
  });

  it("treats empty optional selectors as omitted", async () => {
    const grepRepo = mock(() => Promise.resolve(defaultGrepRepoResult));
    const tool = createGrepRepoTool(
      createMockCodeNavigationService({ grepRepo }),
    );

    await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "",
        path_prefix: "",
        cursor: "",
      },
      {},
    );

    const calls = grepRepo.mock.calls as unknown as Array<
      [{ pathSelectors?: unknown; cursor?: string }]
    >;
    expect(calls[0]?.[0]?.pathSelectors).toBeUndefined();
    expect(calls[0]?.[0]?.cursor).toBeUndefined();
  });

  it("emits the JSON envelope shape when format=json", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        format: "json",
      },
      {},
    );
    const payload = parseText(result) as {
      pattern: string;
      patternType?: string;
      caseSensitive?: boolean;
      totalMatches: number;
      matches: Array<{ filePath: string; line: number }>;
    };
    expect(payload.pattern).toBe("middleware");
    // patternType / caseSensitive omitted when default
    expect(payload.patternType).toBeUndefined();
    expect(payload.caseSensitive).toBeUndefined();
    expect(payload.totalMatches).toBe(1);
    expect(payload.matches[0]).toMatchObject({
      filePath: "src/index.js",
      line: 4,
    });
  });

  it("renders targetResolution retry candidates in text output", async () => {
    const tool = createGrepRepoTool(
      createMockCodeNavigationService({
        grepRepo: mock(() =>
          Promise.resolve({
            ...defaultGrepRepoResult,
            targetResolution: {
              requested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "HEAD",
              },
              resolvedRequested: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
              },
              served: {
                repoUrl: "https://github.com/expressjs/express",
                gitRef: "main",
                commitSha: "abc123789def",
              },
              freshness: "fallback_recent",
              freshnessReason: "ref_resolution_deferred",
              availableVersions: [],
              availableRefs: [{ ref: "main" }],
            },
          }),
        ),
      }),
    );
    const result = await tool.handler(
      {
        target: "https://github.com/expressjs/express#HEAD",
        pattern: "middleware",
      },
      {},
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Using recent indexed snapshot");
    expect(text).toContain("queryable now: refs=main");
  });
});

describe("createGrepRepoTool — text format", () => {
  it("defaults to text output when format is omitted", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_grep | 1 match in 1 file");
    expect(text).toContain('pattern="middleware"');
    expect(text).toContain("src/index.js (1)");
    expect(() => JSON.parse(text)).toThrow();
  });

  it("renders text output when format=text-v1", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        format: "text-v1",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_grep | ");
  });

  it("accepts format=text as an alias for text-v1", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        format: "text",
      },
      {},
    );
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("code_grep | ");
  });
});

describe("createGrepRepoTool — validation errors", () => {
  it("returns INVALID_ARGUMENT for empty pattern", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("returns INVALID_ARGUMENT envelope when pattern is omitted", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        path_prefix: "lib/",
      },
      {},
    );
    expect(result.isError).toBe(true);
    const payload = parseText(result) as { code: string; error: string };
    expect(payload.code).toBe("INVALID_ARGUMENT");
    expect(payload.error).toContain("`pattern` is required");
    expect(payload.error).toContain("use `code_files` instead");
  });

  it("returns INVALID_ARGUMENT for out-of-range numeric arguments", async () => {
    const tool = createGrepRepoTool(createMockCodeNavigationService());
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        max_matches: 1001,
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe(
      "INVALID_ARGUMENT",
    );
  });
});

describe("createGrepRepoTool — service errors", () => {
  it("adds code_files recovery details for an exact missing path", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationFileNotFoundError(
            "Path not found in the index: docs/missing.md.",
            "docs/missing.md",
          ),
        ),
      ),
    });
    const tool = createGrepRepoTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "pagination",
        path: "docs/missing.md",
      },
      {},
    );

    expect(result.isError).toBe(true);
    const payload = parseText(result) as {
      code: string;
      details?: { action?: string; filePath?: string };
    };
    expect(payload.code).toBe("FILE_NOT_FOUND");
    expect(payload.details?.filePath).toBe("docs/missing.md");
    expect(payload.details?.action).toContain("`code_files`");
    expect(payload.details?.action).toContain('path_prefix: "docs/"');
    expect(payload.details?.action).toContain("`code_grep`");
    expect(payload.details?.action).not.toContain("githits code");
  });

  it("uses the containing directory for an extensionless exact path", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationFileNotFoundError(
            "Path not found in the index: benchmarks/run.",
            "benchmarks/run",
          ),
        ),
      ),
    });
    const result = await createGrepRepoTool(service).handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "benchmark",
        path: "benchmarks/run",
      },
      {},
    );

    const payload = parseText(result) as {
      details?: { action?: string };
    };
    expect(payload.details?.action).toContain('path_prefix: "benchmarks/"');
    expect(payload.details?.action).not.toContain("benchmarks/run/");
  });

  it("uses an empty prefix for a root-level extensionless exact path", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationFileNotFoundError(
            "Path not found in the index: LICENSE.",
            "LICENSE",
          ),
        ),
      ),
    });
    const result = await createGrepRepoTool(service).handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "copyright",
        path: "LICENSE",
      },
      {},
    );

    const payload = parseText(result) as {
      details?: { action?: string };
    };
    expect(payload.details?.action).toContain("without `path_prefix`");
    expect(payload.details?.action).not.toContain("LICENSE/");
  });

  it("does not add file recovery to generic NOT_FOUND errors", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const result = await createGrepRepoTool(service).handler(
      {
        target: { registry: "npm", package_name: "ghost" },
        pattern: "middleware",
      },
      {},
    );

    const payload = parseText(result) as {
      details?: { action?: string };
    };
    expect(payload.details?.action).toBeUndefined();
  });

  it("does not infer recovery when FILE_NOT_FOUND omits filePath", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationFileNotFoundError(
            "Path not found in the index.",
            undefined,
          ),
        ),
      ),
    });
    const result = await createGrepRepoTool(service).handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
        path: "docs/missing.md",
      },
      {},
    );

    const payload = parseText(result) as {
      details?: { action?: string };
    };
    expect(payload.details?.action).toBeUndefined();
  });

  it("classifies CodeNavigationIndexingError as INDEXING", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationIndexingError("Indexing...", "ref_abc"),
        ),
      ),
    });
    const tool = createGrepRepoTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "express" },
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("INDEXING");
  });

  it("classifies CodeNavigationTargetNotFoundError as NOT_FOUND", async () => {
    const service = createMockCodeNavigationService({
      grepRepo: mock(() =>
        Promise.reject(
          new CodeNavigationTargetNotFoundError("Package not found"),
        ),
      ),
    });
    const tool = createGrepRepoTool(service);
    const result = await tool.handler(
      {
        target: { registry: "npm", package_name: "ghost" },
        pattern: "middleware",
      },
      {},
    );
    expect(result.isError).toBe(true);
    expect((parseText(result) as { code: string }).code).toBe("NOT_FOUND");
  });
});
