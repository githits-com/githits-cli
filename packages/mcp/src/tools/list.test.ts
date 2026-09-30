import { describe, expect, it, mock } from "bun:test";
import type {
  ListParams,
  ListResult,
  ListService,
} from "@githits/core-internal";
import { ListGraphQLError } from "@githits/core-internal";
import { z } from "zod";
import { projectListResult } from "../shared/list-response.js";
import { formatListText } from "../shared/list-text.js";
import { createListTool } from "./list.js";

const FIRST_SENTENCE =
  "List files and documentation paths in a known package, repository, or site.";

function listResult(overrides: Partial<ListResult> = {}): ListResult {
  return {
    inventoryKind: "SOURCE",
    requestedTarget: "npm:express@5.2.1",
    canonicalTarget: "npm:express@5.2.1",
    entries: [],
    hasMore: false,
    nextCursor: null,
    indexedVersion: null,
    codeIndexState: null,
    indexingStatus: null,
    indexingRef: null,
    inventoryState: null,
    crawlStatus: null,
    coverageState: null,
    coverageReason: null,
    preparation: null,
    ...overrides,
  };
}

function createService(
  list: (params: ListParams) => Promise<ListResult>,
): ListService {
  return { list: mock(list) };
}

function errorPayload(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("createListTool", () => {
  it("advertises listing intent and the later legacy-name compatibility sentence", () => {
    const tool = createListTool(createService(async () => listResult()));
    const firstSentence = tool.description.slice(
      0,
      tool.description.indexOf(".") + 1,
    );
    const first80 = tool.description.slice(0, 80);

    expect(tool.name).toBe("list");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
    expect(firstSentence).toBe(FIRST_SENTENCE);
    expect(firstSentence.length).toBeLessThanOrEqual(79);
    expect(first80).toStartWith(`${FIRST_SENTENCE} Use`);
    expect(first80).not.toContain("code_files");
    expect(first80).not.toContain("docs_list");
    expect(tool.description).toContain("Replaces code_files and docs_list.");
    expect(tool.description).toContain("find an exact path before `read`");
    expect(tool.description).toContain("use `search` for topics");
    expect(tool.description).toContain("one package-owned tree");
    expect(tool.description).toContain("whole snapshot");
    expect(tool.description).toContain("Both include source and documentation");
    expect(tool.description).toContain("explicit `site:` target");
    expect(tool.description).toContain(
      "supplied by the user or a docs search result",
    );
    expect(tool.description).toContain("target-relative literals or globs");
    expect(tool.description).toContain(
      "Directories show immediate children unless `recursive`",
    );
    expect(tool.description).toContain(
      "glob depth is independent of recursion",
    );
    expect(tool.description).toContain("read and continuation guidance");
    expect(tool.description).toContain(
      "a path without trailing `/` is a page even when its source URL ended in `/`",
    );
    expect(tool.description).toContain(
      "use JSON for exact entry kinds or actions",
    );
    expect(tool.schema.format!.description).toContain(
      "parsing or filtering it programmatically",
    );
  });

  it("defines exactly ten fields with defaults, bounds, and empty values allowed", () => {
    const tool = createListTool(createService(async () => listResult()));
    const schema = z.object(tool.schema);
    const parsed = schema.parse({
      target: "npm:express@5.2.1",
      paths: [],
      recursive: false,
      file_types: [],
      languages: [],
      intents: [],
      after: "",
    });

    expect(Object.keys(tool.schema)).toEqual([
      "target",
      "paths",
      "recursive",
      "file_types",
      "languages",
      "intents",
      "limit",
      "after",
      "wait_timeout_ms",
      "format",
    ]);
    expect(tool.schema.target!.description).toContain("site:expressjs.com");
    expect(tool.schema.paths!.description).toContain(
      "Target-relative literal paths and globs",
    );
    expect(tool.schema.paths!.description).toContain(
      "Site paths with one leading `/` stay within the supplied target",
    );
    expect(tool.schema.recursive!.description).toContain(
      "independent of recursion",
    );
    expect(tool.schema.file_types!.description).toContain(
      "Source inventories only",
    );
    expect(tool.schema.languages!.description).toContain(
      "Source inventories only",
    );
    expect(tool.schema.intents!.description).toContain(
      "Source inventories only",
    );
    expect(tool.schema.after!.description).toContain("same target, paths");
    expect(tool.schema.format!.description).toContain("token-efficient text");
    expect(parsed.format).toBe("text");
    expect(parsed.paths).toEqual([]);
    expect(parsed.recursive).toBe(false);
    expect(parsed.after).toBe("");
    expect(
      schema.safeParse({ target: "site:docs.example", file_types: ["doc"] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        target: "npm:x",
        paths: Array.from({ length: 1000 }, () => "a"),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        target: "npm:x",
        paths: Array.from({ length: 1001 }, () => "a"),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        target: "npm:x",
        file_types: Array.from({ length: 65 }, () => "source"),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        target: "npm:x",
        languages: Array.from({ length: 65 }, () => "TypeScript"),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: "npm:x", intents: ["PRODUCTION", "VENDOR"] })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        target: "npm:x",
        intents: Array.from({ length: 64 }, () => "TEST"),
      }).success,
    ).toBe(true);
    expect(
      schema.safeParse({
        target: "npm:x",
        intents: Array.from({ length: 65 }, () => "TEST"),
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: "npm:x", intents: ["integration-test"] })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: "npm:x", limit: 1, wait_timeout_ms: 0 })
        .success,
    ).toBe(true);
    expect(
      schema.safeParse({
        target: "npm:x",
        limit: 500,
        wait_timeout_ms: 300_000,
      }).success,
    ).toBe(true);
    expect(schema.safeParse({ target: "npm:x", limit: 0 }).success).toBe(false);
    expect(schema.safeParse({ target: "npm:x", limit: 501 }).success).toBe(
      false,
    );
    expect(
      schema.safeParse({ target: "npm:x", wait_timeout_ms: -1 }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ target: "npm:x", wait_timeout_ms: 300_001 }).success,
    ).toBe(false);
  });

  it("normalizes empty arrays and cursor while preserving explicit recursive false", async () => {
    const response = listResult();
    const list = mock(async (_params: ListParams) => response);
    const tool = createListTool({ list });

    await tool.handler(
      {
        target: "npm:express@5.2.1",
        paths: [],
        recursive: false,
        file_types: [],
        languages: [],
        intents: [],
        after: "",
      },
      {},
    );

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      target: "npm:express@5.2.1",
      recursive: false,
      includeDetailedFields: false,
      includeReadActions: false,
    });
  });

  it("accepts a leading slash in a site selector", async () => {
    const list = mock(async (_params: ListParams) => listResult());
    const tool = createListTool({ list });

    await tool.handler(
      { target: "site:expressjs.com", paths: ["/en/resources/"] },
      {},
    );

    expect(list).toHaveBeenCalledWith({
      target: "site:expressjs.com",
      paths: ["en/resources/"],
      includeDetailedFields: false,
      includeReadActions: true,
    });
  });

  it("normalizes display-cased language and classification filters", async () => {
    const list = mock(async (_params: ListParams) => listResult());
    const tool = createListTool({ list });

    await tool.handler(
      {
        target: "npm:express",
        paths: ["lib/**/*.js"],
        languages: ["JavaScript"],
        file_types: ["SOURCE"],
      },
      {},
    );

    expect(list).toHaveBeenCalledWith({
      target: "npm:express",
      paths: ["lib/**/*.js"],
      languages: ["javascript"],
      fileTypes: ["source"],
      includeDetailedFields: false,
      includeReadActions: false,
    });
  });

  it("uses compact source projection and the shared path-only formatter by default", async () => {
    const response = listResult({
      entries: [
        { kind: "DIRECTORY", path: "src" },
        { kind: "FILE", path: "README.md" },
      ],
    });
    const list = mock(async (_params: ListParams) => response);
    const tool = createListTool({ list });

    const result = await tool.handler({ target: "npm:express@5.2.1" }, {});

    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({
      target: "npm:express@5.2.1",
      includeDetailedFields: false,
      includeReadActions: false,
    });
    expect(result.content[0]?.text).toBe(
      formatListText(projectListResult(response), {
        useColors: false,
        syntax: "mcp",
      }),
    );
    expect(result.content[0]?.text).toBe(
      '# source npm:express@5.2.1 | follow up with "read npm:express@5.2.1 $path"\nsrc/\nREADME.md',
    );
  });

  it("requests site read actions and renders the shared relative site paths", async () => {
    const response = listResult({
      inventoryKind: "SITE",
      requestedTarget: "site:expressjs.com",
      canonicalTarget: "site:expressjs.com",
      entries: [
        {
          kind: "PAGE",
          path: "expressjs.com/en/resources/",
          read: { target: "site:expressjs.com", path: "en/resources/" },
        },
        { kind: "DIRECTORY", path: "en/resources/guide/" },
      ],
    });
    const list = mock(async (_params: ListParams) => response);
    const tool = createListTool({ list });

    const result = await tool.handler({ target: "site:expressjs.com" }, {});

    expect(list).toHaveBeenCalledWith({
      target: "site:expressjs.com",
      includeDetailedFields: false,
      includeReadActions: true,
    });
    expect(result.content[0]?.text).toBe(
      formatListText(projectListResult(response), {
        useColors: false,
        syntax: "mcp",
      }),
    );
    expect(result.content[0]?.text).toBe(
      '# source site:expressjs.com | follow up with "read site:expressjs.com $path"\nen/resources/\nen/resources/guide/',
    );
  });

  it("returns detailed JSON with exact actions and the continuation cursor", async () => {
    const response = listResult({
      hasMore: true,
      nextCursor: "opaque-cursor",
      entries: [
        {
          kind: "FILE",
          path: "src/index.ts",
          read: {
            target: "github:expressjs/express@abc123",
            path: "src/index.ts",
          },
        },
        {
          kind: "DIRECTORY",
          path: "src/",
          browse: {
            target: "github:expressjs/express@abc123",
            paths: ["src/"],
          },
        },
      ],
    });
    const list = mock(async (_params: ListParams) => response);
    const tool = createListTool({ list });

    const result = await tool.handler(
      { target: "github:expressjs/express", format: "json" },
      {},
    );

    expect(list).toHaveBeenCalledWith({
      target: "github:expressjs/express",
      includeDetailedFields: true,
      includeReadActions: true,
    });
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual(
      projectListResult(response),
    );
    expect(JSON.parse(result.content[0]?.text ?? "{}")).toMatchObject({
      hasMore: true,
      nextCursor: "opaque-cursor",
      entries: [
        {
          read: {
            target: "github:expressjs/express@abc123",
            path: "src/index.ts",
          },
        },
        {
          browse: {
            target: "github:expressjs/express@abc123",
            paths: ["src/"],
          },
        },
      ],
    });
  });

  it("maps invalid input, adds cursor reset guidance, and propagates caller cancellation", async () => {
    const unusedList = mock(async (_params: ListParams) => listResult());
    const invalidTool = createListTool({ list: unusedList });
    const invalid = await invalidTool.handler(
      { target: "npm:express", paths: ["  "], after: "opaque-cursor" },
      {},
    );

    expect(invalid.isError).toBe(true);
    expect(errorPayload(invalid)).toMatchObject({ code: "INVALID_ARGUMENT" });
    expect(errorPayload(invalid).error).not.toContain(
      "Retry once without `after`",
    );
    expect(unusedList).not.toHaveBeenCalled();

    const cursorError = createListTool({
      list: mock(async () => {
        throw new ListGraphQLError("Cursor expired.", "VALIDATION_ERROR");
      }),
    });
    const cursorResult = await cursorError.handler(
      { target: "npm:express", after: "opaque-cursor" },
      {},
    );
    expect(errorPayload(cursorResult)).toMatchObject({
      code: "INVALID_ARGUMENT",
      error: expect.stringContaining("Retry once without `after`"),
    });

    const cancellation = new Error("caller cancelled");
    cancellation.name = "AbortError";
    const controller = new AbortController();
    controller.abort(cancellation);
    const cancelledTool = createListTool({
      list: mock(async () => {
        throw cancellation;
      }),
    });
    await expect(
      cancelledTool.handler(
        { target: "npm:express" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(cancellation);
  });
});
