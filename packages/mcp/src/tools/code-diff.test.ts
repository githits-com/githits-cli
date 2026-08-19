import { describe, expect, it, mock } from "bun:test";
import {
  CodeDiffError,
  type CodeDiffResult,
  type CodeDiffService,
} from "@githits/core-internal";
import { z } from "zod";
import {
  createMockCodeNavigationService,
  defaultCodeDiffResult,
} from "../services/test-helpers.js";
import { formatCodeDiffMcpText } from "../shared/code-diff-mcp-text.js";
import { buildCodeDiffSuccessPayload } from "../shared/code-diff-response.js";
import {
  type CodeDiffMcpArgs,
  createCodeDiffTool,
  DESCRIPTION,
} from "./code-diff.js";

function invoke(
  tool: ReturnType<typeof createCodeDiffTool>,
  args: CodeDiffMcpArgs,
) {
  return tool.handler(args, undefined);
}

function payload(result: CodeDiffResult = defaultCodeDiffResult) {
  return buildCodeDiffSuccessPayload(result, {
    target: { registry: "NPM", packageName: "express" },
    view: "name-status",
  });
}

function parseError(result: Awaited<ReturnType<typeof invoke>>): {
  code: string;
  error: string;
  retryable: boolean;
} {
  return JSON.parse(result.content[0]?.text ?? "{}");
}

describe("code_diff MCP adapter", () => {
  it("describes the union target, views, privacy, and safety contract", () => {
    const tool = createCodeDiffTool(createMockCodeNavigationService());
    const schema = z.toJSONSchema(z.object(tool.schema));

    expect(tool.name).toBe("code_diff");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    });
    expect(Object.keys(tool.schema)).toEqual([
      "target",
      "from",
      "to",
      "view",
      "path_glob",
      "max_files",
      "max_patch_bytes",
      "format",
    ]);
    expect(schema.properties?.format).toMatchObject({
      default: "text-v1",
      enum: ["text-v1", "text", "json"],
    });
    expect(schema.properties?.view).toMatchObject({
      default: "name-status",
      enum: ["name-status", "name-only", "stat", "patch"],
    });
    expect(schema.properties?.max_files).toMatchObject({
      type: "integer",
      minimum: 1,
      maximum: 300,
      description: expect.stringContaining("relevance-ranked"),
    });
    expect(schema.properties?.max_patch_bytes).toMatchObject({
      type: "integer",
      minimum: 1024,
      maximum: 2_097_152,
    });
    const pathGlobSchema = schema.properties?.path_glob as {
      description?: string;
    };
    expect(pathGlobSchema.description).toContain(
      "no braces, character classes, `!`, or Git pathspec magic",
    );
    expect(pathGlobSchema.description).toContain("non-empty");
    const targetSchema = schema.properties?.target as {
      anyOf?: Array<Record<string, unknown>>;
    };
    expect(targetSchema.anyOf).toEqual([
      { type: "string" },
      {
        type: "object",
        properties: {
          registry: { type: "string" },
          package_name: { type: "string" },
        },
        required: ["registry", "package_name"],
        additionalProperties: false,
      },
      {
        type: "object",
        properties: {
          repo_url: { type: "string" },
        },
        required: ["repo_url"],
        additionalProperties: false,
      },
    ]);
    for (const phrase of [
      "exact source changes",
      "repository-wide diffs",
      "does not prove the package unchanged",
      "package_name",
      "repo_url",
      "from",
      "to",
      "name-status",
      "compatibility",
      "upgrade safety",
      "credentials",
      "private code",
      "proprietary content",
      "320 UTF-8 bytes",
      "full returned patch",
    ]) {
      expect(DESCRIPTION).toContain(phrase);
    }
  });

  it("selects each requested service mode and preserves separate endpoints", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const tool = createCodeDiffTool({ codeDiff });
    const base = {
      target: "npm:express" as const,
      from: "4.18.1",
      to: "4.18.2",
    };

    for (const [view, mode] of [
      ["name-only", "inventory"],
      ["name-status", "inventory"],
      ["stat", "stats"],
      ["patch", "patches"],
    ] as const) {
      await invoke(tool, { ...base, view });
      expect(codeDiff).toHaveBeenLastCalledWith({
        target: { registry: "NPM", packageName: "express" },
        from: "4.18.1",
        to: "4.18.2",
        mode,
      });
    }
  });

  it("defaults to bounded name-status inventory and omits backend defaults", async () => {
    const codeDiff = mock(() => Promise.resolve(defaultCodeDiffResult));
    const tool = createCodeDiffTool({ codeDiff });

    await invoke(tool, {
      target: { registry: "npm", package_name: "express" },
      from: "v1",
      to: "v2",
    });

    expect(codeDiff).toHaveBeenCalledWith({
      target: { registry: "NPM", packageName: "express" },
      from: "v1",
      to: "v2",
      mode: "inventory",
    });
  });

  it("returns the exact shared JSON projection", async () => {
    const service: CodeDiffService = {
      codeDiff: mock(() => Promise.resolve(defaultCodeDiffResult)),
    };
    const tool = createCodeDiffTool(service);
    const result = await invoke(tool, {
      target: { repo_url: "https://github.com/expressjs/express" },
      from: "main",
      to: "release",
      view: "name-status",
      format: "json",
    });

    expect(result.content[0]?.text).toBe(
      JSON.stringify(
        buildCodeDiffSuccessPayload(defaultCodeDiffResult, {
          target: { repoUrl: "https://github.com/expressjs/express" },
          view: "name-status",
        }),
      ),
    );
  });

  it("maps builder and representative CodeDiff service failures", async () => {
    const tool = createCodeDiffTool(createMockCodeNavigationService());
    const invalid = await invoke(tool, {
      target: {} as unknown as CodeDiffMcpArgs["target"],
      from: "1",
      to: "2",
    });
    expect(invalid.isError).toBe(true);
    expect(parseError(invalid)).toEqual({
      code: "INVALID_ARGUMENT",
      error:
        "Diff target must be a compact string or include package `registry` + `package_name` or repository `repo_url`.",
      retryable: false,
    });

    const invalidMaxFiles = await invoke(tool, {
      target: "npm:express",
      from: "1",
      to: "2",
      max_files: 0,
    });
    expect(invalidMaxFiles.isError).toBe(true);
    expect(parseError(invalidMaxFiles)).toEqual({
      code: "INVALID_ARGUMENT",
      error: "Maximum files must be an integer from 1 through 300.",
      retryable: false,
    });

    const invalidRepositoryTarget = await invoke(tool, {
      target: { repo_url: "npm:express" },
      from: "1",
      to: "2",
    });
    expect(invalidRepositoryTarget.isError).toBe(true);
    expect(parseError(invalidRepositoryTarget)).toEqual({
      code: "INVALID_ARGUMENT",
      error: "Repository target must identify a repository, not a package.",
      retryable: false,
    });

    const service = createCodeDiffTool({
      codeDiff: mock(() =>
        Promise.reject(
          new CodeDiffError("Too many requests", {
            code: "RATE_LIMITED",
            retryable: true,
          }),
        ),
      ),
    });
    const mapped = await invoke(service, {
      target: "npm:express",
      from: "1",
      to: "2",
    });
    expect(mapped.isError).toBe(true);
    expect(parseError(mapped).code).toBe("RATE_LIMITED");
  });

  it("keeps empty and identical diffs successful", () => {
    const empty = structuredClone(defaultCodeDiffResult);
    empty.fromResolution.requested = "same";
    empty.toResolution.requested = "same";
    empty.raw.summary.filesChanged = 0;
    empty.raw.summary.added = 0;
    empty.raw.summary.deleted = 0;
    empty.raw.summary.modified = 0;
    empty.raw.files = [];
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(empty, {
        target: { registry: "NPM", packageName: "express" },
        view: "name-status",
      }),
    );
    expect(text).toContain("No changes between the requested endpoints.");
    expect(text).not.toContain("isError");
  });

  it("renders exact resolutions, scope facts, primary evidence, and MCP-native follow-up", () => {
    const text = formatCodeDiffMcpText(payload());
    expect(text).toContain("Code diff: npm:express");
    expect(text).toContain("Requested endpoints: 4.18.1 -> 4.18.2");
    expect(text).toContain("Resolved endpoints: v4.18.1");
    expect(text).toContain("from-sha");
    expect(text).toContain("Scope: repository");
    expect(text).not.toContain("roots");
    expect(text).toContain("lib/express.js [status=modified]");
    expect(text).toContain('view "stat"');
    expect(text).not.toContain("--stat");
    expect(text).not.toContain("githits ");

    const patchResult = structuredClone(defaultCodeDiffResult);
    const patchText = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(patchResult, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(patchText).toContain("patch preview: @@ -1 +1 @@");
    expect(patchText).toContain("Content: complete");
    expect(patchText).not.toContain("patch preview (truncated)");
    expect(patchText).not.toContain(
      'use format "json" for the full returned patch content',
    );
  });

  it("marks bounded previews while JSON preserves the full returned patch", async () => {
    const longPatch = `@@ -1 +1 @@\n+${"x".repeat(500)}`;
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: longPatch,
    };

    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(text).toContain("patch preview (truncated):");
    expect(text).toContain(
      'use format "json" for the full returned patch content (1 preview truncated)',
    );
    expect(
      text.match(/use format "json" for the full returned patch content/g),
    ).toHaveLength(1);
    expect(text).toContain("JSON cannot recover backend-omitted content");

    const tool = createCodeDiffTool({
      codeDiff: mock(() => Promise.resolve(result)),
    });
    const json = await invoke(tool, {
      target: "npm:express",
      from: "4.18.1",
      to: "4.18.2",
      view: "patch",
      format: "json",
    });
    const payload = JSON.parse(json.content[0]?.text ?? "{}");
    expect(payload.files[0].patch).toBe(longPatch);
  });

  it("aggregates recovery for multiple truncated patch previews", () => {
    const longPatch = `@@ -1 +1 @@\n+${"x".repeat(500)}`;
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.summary.filesChanged = 2;
    result.raw.summary.modified = 2;
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: longPatch,
    };
    result.raw.files.push({
      ...result.raw.files[0]!,
      path: "lib/router.js",
      patch: longPatch,
    });

    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );

    expect(text.match(/patch preview \(truncated\):/g)).toHaveLength(2);
    expect(text).toContain(
      'use format "json" for the full returned patch content (2 previews truncated)',
    );
    expect(
      text.match(/use format "json" for the full returned patch content/g),
    ).toHaveLength(1);
  });

  it("distinguishes text bounds from backend-incomplete patch coverage", () => {
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.contentCoverage = "PARTIAL";
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: `@@ -1 +1 @@\n+${"x".repeat(500)}`,
    };
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );

    expect(text).toContain("Content: partial");
    expect(text).toContain("Warning: requested content is partial.");
    expect(text).toContain(
      'use format "json" for the full returned patch content (1 preview truncated)',
    );
  });

  it("renders an unknown side of a mixed scope as a question mark", () => {
    const fromOnly = structuredClone(defaultCodeDiffResult);
    fromOnly.raw.scope.fromSubpath = "packages/old";
    fromOnly.raw.scope.toSubpath = "";
    const fromOnlyText = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(fromOnly, {
        target: { registry: "NPM", packageName: "express" },
        view: "name-status",
      }),
    );
    expect(fromOnlyText).toContain(
      "Scope: repository, roots packages/old -> ?",
    );

    const toOnly = structuredClone(defaultCodeDiffResult);
    toOnly.raw.scope.fromSubpath = "";
    toOnly.raw.scope.toSubpath = "packages/new";
    const toOnlyText = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(toOnly, {
        target: { registry: "NPM", packageName: "express" },
        view: "name-status",
      }),
    );
    expect(toOnlyText).toContain("Scope: repository, roots ? -> packages/new");
  });

  it("frames legacy unknown scope as repository-wide", () => {
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.scope.status = "UNKNOWN";
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "name-status",
      }),
    );

    expect(text).toContain("legacy unknown scope metadata");
    expect(text).toContain("treat this diff as repository-wide");
    expect(text).toContain("unrelated paths may be included");
    expect(text).not.toContain("package scope was not identified");
  });

  it("omits empty patch previews and trailing blank lines", () => {
    const emptyPatch = structuredClone(defaultCodeDiffResult);
    emptyPatch.raw.files[0] = {
      ...emptyPatch.raw.files[0]!,
      patch: "",
    };
    const emptyText = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(emptyPatch, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(emptyText).not.toContain("patch preview:");

    const trailingBlankLines = structuredClone(defaultCodeDiffResult);
    trailingBlankLines.raw.files[0] = {
      ...trailingBlankLines.raw.files[0]!,
      patch: "@@ -1 +1 @@\n-old\n+new\n\n",
    };
    const trailingText = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(trailingBlankLines, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(trailingText).toContain("      +new");
    expect(trailingText).not.toContain("      \n");
  });

  it("marks incomplete, unsafe, filtered, omitted, and byte-escaped patch evidence", () => {
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.summary.inventoryComplete = false;
    result.raw.summary.unprojectableFiles = 1;
    result.raw.hasMoreFiles = true;
    result.raw.contentCoverage = "PARTIAL";
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      path: "bad\u001b[31m.ts",
      pathEncoding: "BYTE_ESCAPED",
      contentStatus: "OMITTED",
      patch: undefined,
      contentOmissionReason: "content_budget",
      contentSafety: { filtered: true, modifications: ["IMAGES_REPLACED"] },
    };
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(text).toContain("inventory is incomplete");
    expect(text).toContain("more matching files");
    expect(text).toContain("display-only byte escapes");
    expect(text).toContain("modified for content safety");
    expect(text).toContain("not presented as authoritative");
    expect(text).toContain("patch omitted: content_budget");
    expect(text).toContain("path_glob");
    expect(text).toContain("max_files");
    expect(text).toContain('format "json"');
    expect(text).not.toContain("\u001b");
  });

  it("keeps patch previews within a UTF-8 byte bound", () => {
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: "€".repeat(200),
    };
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    const preview = text
      .split("\n")
      .find((line) => line.includes("patch preview"))
      ?.match(/patch preview(?: \(truncated\))?: (.*)$/)?.[1];
    expect(preview).toBeDefined();
    expect(
      new TextEncoder().encode(preview ?? "").byteLength,
    ).toBeLessThanOrEqual(320);
  });

  it("preserves sanitized multiline patch preview lines with indentation", () => {
    const result = structuredClone(defaultCodeDiffResult);
    result.raw.files[0] = {
      ...result.raw.files[0]!,
      patch: `@@ -1 +1 @@\n+new\u001b[31m\n-old\r\n ${"€".repeat(200)}`,
    };
    const text = formatCodeDiffMcpText(
      buildCodeDiffSuccessPayload(result, {
        target: { registry: "NPM", packageName: "express" },
        view: "patch",
      }),
    );
    expect(text).toContain("    patch preview (truncated): @@ -1 +1 @@");
    expect(text).toContain("      +new");
    expect(text).toContain("      -old");
    expect(text).toContain("      ");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\n+new");
    const preview = text
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("    patch preview") || line.startsWith("      "),
      )
      .map((line) =>
        line.startsWith("    patch preview")
          ? line.replace(/^ {4}patch preview(?: \(truncated\))?: /, "")
          : line.slice("      ".length),
      )
      .join("\n");
    expect(new TextEncoder().encode(preview).byteLength).toBeLessThanOrEqual(
      320,
    );
  });
});
