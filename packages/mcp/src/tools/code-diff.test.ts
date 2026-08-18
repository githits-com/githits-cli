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
    });
    expect(schema.properties?.max_patch_bytes).toMatchObject({
      type: "integer",
      minimum: 1024,
      maximum: 2_097_152,
    });
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
        "CodeDiff target must be a compact string or include package `registry` + `package_name` or repository `repo_url`.",
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
      error: "`maximum files` must be an integer from 1 through 300.",
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

  it("renders exact resolutions, scope warnings, primary evidence, and MCP-native follow-up", () => {
    const text = formatCodeDiffMcpText(payload());
    expect(text).toContain("Code diff: npm:express");
    expect(text).toContain("Requested endpoints: 4.18.1 -> 4.18.2");
    expect(text).toContain("Resolved endpoints: v4.18.1");
    expect(text).toContain("from-sha");
    expect(text).toContain("Scope: package");
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
      .find((line) => line.includes("patch preview:"))
      ?.split("patch preview: ")[1];
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
    expect(text).toContain("    patch preview: @@ -1 +1 @@");
    expect(text).toContain("      +new");
    expect(text).toContain("      -old");
    expect(text).toContain("      ");
    expect(text).not.toContain("\u001b");
    expect(text).not.toContain("\n+new");
    const preview = text
      .split("\n")
      .filter(
        (line) =>
          line.startsWith("    patch preview:") || line.startsWith("      "),
      )
      .map((line) =>
        line.startsWith("    patch preview:")
          ? line.slice("    patch preview: ".length)
          : line.slice("      ".length),
      )
      .join("\n");
    expect(new TextEncoder().encode(preview).byteLength).toBeLessThanOrEqual(
      320,
    );
  });
});
