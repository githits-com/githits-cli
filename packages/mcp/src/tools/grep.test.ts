import { describe, expect, it, mock } from "bun:test";
import type {
  GrepParams,
  GrepResult,
  GrepService,
} from "@githits/core-internal";
import { GrepGraphQLError, parseGrepResult } from "@githits/core-internal";
import { z } from "zod";
import mixedPage from "../shared/fixtures/grep-text/mixed-100.json";
import { createGrepTool, type GrepArgs } from "./grep.js";
import { CODE_GREP_GUARDRAIL } from "./guardrails.js";

const emptyPage: GrepResult = {
  hits: [],
  targets: [],
  unavailableTargets: [],
  traversal: "COMPLETE",
  nextCursor: null,
  totalMatches: 0,
};

function service(
  grep: (params: GrepParams) => Promise<GrepResult> = async () => emptyPage,
): GrepService {
  return { grep: mock(grep) };
}

function payload(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe("unified MCP grep", () => {
  it("advertises a standalone selection sentence, migration route, guardrail, and independent controls", () => {
    const tool = createGrepTool(service());
    const firstSentence = tool.description.split(".")[0] + ".";
    const first80 = tool.description.slice(0, 80);
    const inputSchema = z.toJSONSchema(z.object(tool.schema), { io: "input" });

    expect(tool.name).toBe("grep");
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      openWorldHint: true,
      destructiveHint: false,
    });
    expect(firstSentence).toBe(
      "Find regex or literal matches across source and documentation.",
    );
    expect(firstSentence.length).toBeLessThanOrEqual(79);
    expect(first80).not.toContain("code_grep");
    expect(tool.description).toContain("Replaces code_grep.");
    expect(tool.description).toContain(CODE_GREP_GUARDRAIL);
    expect(Object.keys(tool.schema)).toEqual([
      "targets",
      "pattern",
      "pattern_type",
      "ignore_case",
      "context_lines_before",
      "context_lines_after",
      "max_matches",
      "cursor",
      "wait_timeout_ms",
      "format",
    ]);
    expect(inputSchema.required).toEqual(["targets", "pattern"]);
    expect(inputSchema.properties?.targets).toMatchObject({
      minItems: 1,
      maxItems: 20,
    });
    expect(tool.description).toContain("packages include selected hosted docs");
    expect(tool.schema.targets?.description).toContain("ordered");
    expect(tool.schema.pattern?.description).toContain("RE2 regex");
    expect(tool.schema.ignore_case?.description).toContain("case-sensitive");
    expect(tool.schema.cursor?.description).toContain("same ordered targets");
    expect(tool.schema.format?.description).toContain("grouped matches");
    expect(tool.schema.pattern?.description).toContain(
      "No lookaround or backreferences",
    );
    expect(tool.description).not.toContain("githits code grep");
    expect(inputSchema.properties?.format).toMatchObject({ default: "text" });
  });

  it("normalizes omitted defaults, explicit false, and empty site selectors before one service call", async () => {
    const grep = mock(async (_params: GrepParams) => emptyPage);
    const tool = createGrepTool(service(grep));
    const result = await tool.handler({
      targets: [
        { target: "npm:express", path_selectors: [] },
        { target: "site:expressjs.com/en/5x", path_selectors: [] },
      ],
      pattern: "router",
      ignore_case: false,
      context_lines_before: 0,
      wait_timeout_ms: 0,
    });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe("No matches.");
    expect(grep).toHaveBeenCalledTimes(1);
    expect(grep).toHaveBeenCalledWith({
      targets: [
        { target: "npm:express", corpus: "ALL", allowUnscoped: true },
        { target: "site:expressjs.com/en/5x" },
      ],
      pattern: "router",
      patternType: "REGEX",
      caseSensitive: true,
      contextLinesBefore: 0,
      contextLinesAfter: 0,
      waitTimeoutMs: 0,
      includeDetailedFields: false,
    });
  });

  it("forwards explicit controls and returns the complete projected JSON page", async () => {
    const page = parseGrepResult(mixedPage);
    const grep = mock(async (_params: GrepParams) => page);
    const tool = createGrepTool(service(grep));
    const args: GrepArgs = {
      targets: [
        {
          target: "github:expressjs/express@main",
          corpus: "source",
          path_selectors: [{ kind: "exact", value: "lib/express.js" }],
        },
        { target: "site:expressjs.com" },
      ],
      pattern: "router",
      pattern_type: "literal",
      ignore_case: true,
      context_lines_before: 1,
      context_lines_after: 2,
      max_matches: 100,
      cursor: "opaque-page-two",
      format: "json",
    };
    const result = await tool.handler(args);

    expect(result.isError).toBeUndefined();
    expect(payload(result.content[0]!.text)).toEqual(
      JSON.parse(JSON.stringify(page)),
    );
    expect(grep).toHaveBeenCalledWith({
      targets: [
        {
          target: "github:expressjs/express@main",
          corpus: "SOURCE",
          allowUnscoped: true,
          pathSelectors: [{ kind: "EXACT", value: "lib/express.js" }],
        },
        { target: "site:expressjs.com" },
      ],
      pattern: "router",
      patternType: "LITERAL",
      caseSensitive: false,
      contextLinesBefore: 1,
      contextLinesAfter: 2,
      maxMatches: 100,
      cursor: "opaque-page-two",
      includeDetailedFields: true,
    });
    expect((payload(result.content[0]!.text).hits as unknown[]).length).toBe(
      page.hits.length,
    );
  });

  it("uses the shared grouped text with exact read guidance and continuation", async () => {
    const page = parseGrepResult(mixedPage);
    const tool = createGrepTool(service(async () => page));
    const result = await tool.handler({
      targets: [{ target: "npm:express" }],
      pattern: "router",
    });
    const text = result.content[0]?.text ?? "";

    expect(text).toContain("# Read files: read target=$target path=$path");
    expect(text).toContain("# Read pages: read target=$url");
    expect(text).toContain("Sources:");
    expect(text).toContain('cursor="');
    expect(text).not.toContain("githits read");
  });

  it("maps an invalid site corpus before calling the service", async () => {
    const grep = mock(async (_params: GrepParams) => emptyPage);
    const tool = createGrepTool(service(grep));
    const result = await tool.handler({
      targets: [{ target: "site:expressjs.com", corpus: "source" }],
      pattern: "router",
    });

    expect(result.isError).toBe(true);
    expect(payload(result.content[0]!.text)).toMatchObject({
      code: "INVALID_ARGUMENT",
      retryable: false,
    });
    expect(grep).not.toHaveBeenCalled();
  });

  it("gives a preparation-wait action for a retryable indexing error", async () => {
    const tool = createGrepTool(
      service(async () => {
        throw new GrepGraphQLError("not ready", {
          code: "GREP_TARGET_PREPARATION_REQUIRED",
          retryable: true,
          target_issues: [{ input_index: 0, reason: "indexing" }],
        });
      }),
    );
    const result = await tool.handler({
      targets: [{ target: "npm:express" }],
      pattern: "router",
    });

    expect(result.isError).toBe(true);
    expect(payload(result.content[0]!.text)).toMatchObject({
      code: "INDEXING",
      retryable: true,
      details: {
        targetIssues: [{ input_index: 0, reason: "indexing" }],
        action: expect.stringContaining("wait_timeout_ms"),
      },
    });
  });

  it("propagates caller cancellation instead of returning a service error", async () => {
    const controller = new AbortController();
    const cancellation = new DOMException("aborted", "AbortError");
    const tool = createGrepTool(
      service(async () => {
        controller.abort();
        throw cancellation;
      }),
    );

    await expect(
      tool.handler(
        { targets: [{ target: "npm:express" }], pattern: "router" },
        { signal: controller.signal },
      ),
    ).rejects.toBe(cancellation);
  });
});
