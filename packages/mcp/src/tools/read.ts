import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  MCP_READ_DEFAULT_SPAN,
  MCP_READ_MAX_SPAN,
} from "../shared/code-navigation-defaults.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { withIndexingRetryAction } from "../shared/mapped-error-text.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { InvalidPackageSpecError } from "../shared/package-spec.js";
import {
  isSiteReadTarget,
  normalizeReadWaitTimeoutMs,
  resolveReadLocator,
  validateReadRange,
} from "../shared/read-request.js";
import { formatReadResult } from "../shared/read-result-response.js";
import { createReadFileServiceAdapter } from "../shared/read-service-adapters.js";
import { serviceRequestArgs } from "../shared/service-request-args.js";
import { CODE_READ_GUARDRAIL } from "./guardrails.js";
import { readSourceFile } from "./read-file.js";
import { mcpMappedErrorResult, throwIfCallerCancellation } from "./shared.js";
import type { McpToolServices } from "./tool-services.js";
import {
  OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  textResult,
  type ZodRawShape,
} from "./types.js";

export interface ReadArgs {
  target: string;
  path?: string;
  selector?: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

interface ReadSchema extends ZodRawShape {
  target: z.ZodString;
  path: z.ZodOptional<z.ZodString>;
  selector: z.ZodOptional<z.ZodString>;
  start_line: z.ZodOptional<z.ZodNumber>;
  end_line: z.ZodOptional<z.ZodNumber>;
  wait_timeout_ms: z.ZodOptional<z.ZodNumber>;
  format: z.ZodDefault<z.ZodEnum<{ text: "text"; json: "json" }>>;
}

export const readSchema: ReadSchema = {
  target: z
    .string()
    .describe(
      'Docs: {"target":"https://docs.example/guide"} with no path or selector; copy returned URLs/docs IDs unchanged, never into path. site: targets need an exact page path (/ for root). Files: compact package/repo target plus relative path; target#symbol restricts to path when supplied.',
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Exact target-relative file or site-page path from supplied or returned locators; do not repeat site scope. Omit for docs URL/ID targets, and for symbols unless the declaration file is known, not its caller. Empty means omitted.",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "Code: a known declaration name. Docs: an exact heading ID returned for this page, never its title or a guessed slug; site headings need a page path. Otherwise omit; never empty. Do not guess qualifications or combine with a URL fragment or target#symbol. A docs fragment selects its full heading subtree; either bound replaces it with a page-relative range.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      "Positive 1-indexed start within reported length, only when known for this exact file/page version; never reuse another file's numbers. Bounds override a docs fragment and do not disambiguate symbols.",
    ),
  end_line: z
    .number()
    .optional()
    .describe(
      `Inclusive end, at least start_line. Text: ${MCP_READ_DEFAULT_SPAN} lines without an end, up to ${MCP_READ_MAX_SPAN} with one. Code JSON is also bounded; docs JSON keeps the backend selection.`,
    ),
  wait_timeout_ms: z
    .number()
    .optional()
    .describe(
      `Indexing wait in ms (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS}); the backend applies it when relevant.`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit for text. Use json only when code consumes raw fields or text lacks a required field.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Read an indexed source file, code symbol, or documentation section. Pass target without path for a returned docs URL; preserve returned line bounds. Files and site pages take target plus path; selector reads a known declaration or returned heading ID. Read known declarations before searching. On resolution failure, use a returned declaration range or literal grep; bounds do not disambiguate. If a heading is missing, do not retry it: read its page without selector/fragment; if the page is unavailable, find an indexed page with search and its source argument set to docs. Hosted docs are mutable; repository docs address snapshots. Use list for directories. On INDEXING follow recovery for the same target/path.";
export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${CODE_READ_GUARDRAIL}`;

/** One advertised reader; source-specific selection and error contracts stay intact. */
export function createReadTool(
  services: Pick<McpToolServices, "readService">,
): ToolDefinition<ReadArgs, typeof readSchema> {
  return {
    name: "read",
    description: DESCRIPTION,
    schema: readSchema,
    annotations: OPEN_WORLD_READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      let locator: ReturnType<typeof resolveReadLocator>;
      let wait: number;
      try {
        locator = resolveReadLocator(args.target, args.path);
        if (
          args.selector !== undefined &&
          (typeof args.selector !== "string" || !args.selector.trim())
        ) {
          throw new InvalidPackageSpecError(
            "selector must be a nonblank string.",
          );
        }
        validateReadRange(args.start_line, args.end_line);
        wait = normalizeReadWaitTimeoutMs(args.wait_timeout_ms);
        if (
          args.format !== undefined &&
          args.format !== "text" &&
          args.format !== "json"
        ) {
          throw new InvalidPackageSpecError("format must be text or json.");
        }
      } catch (error) {
        return mcpMappedErrorResult(
          mapCodeNavigationError(error),
          context,
          args.format,
        );
      }
      if (
        args.selector !== undefined ||
        locator.path === undefined ||
        locator.target.includes("#") ||
        isSiteReadTarget(locator.target)
      ) {
        try {
          const response = await services.readService.read(
            {
              target: locator.target,
              ...(locator.path ? { path: locator.path } : {}),
              ...(args.selector !== undefined
                ? { selector: args.selector }
                : {}),
              ...(args.start_line !== undefined
                ? { startLine: args.start_line }
                : {}),
              ...(args.end_line !== undefined
                ? { endLine: args.end_line }
                : {}),
              waitTimeoutMs: wait,
            },
            ...serviceRequestArgs(context?.signal),
          );
          return textResult(
            formatReadResult(
              response,
              {
                target: locator.target,
                selector: args.selector,
                path: locator.path,
                endLine: args.end_line,
              },
              args.format === "json" ? "mcp-json" : "mcp-text",
            ),
          );
        } catch (error) {
          throwIfCallerCancellation(error, context?.signal);
          const docsError = mapPackageIntelligenceError(error);
          return mcpMappedErrorResult(
            withIndexingRetryAction(
              docsError.code !== "UNKNOWN"
                ? docsError
                : mapCodeNavigationError(error),
              "read",
              "mcp",
              { maxWaitMs: MAX_WAIT_TIMEOUT_MS },
            ),
            context,
            args.format,
            {
              recovery: { syntax: "mcp", tool: "read", args },
              indexingTarget: args.target,
              indexingOutcome: "This content is not available yet.",
            },
          );
        }
      }
      return readSourceFile(
        {
          ...args,
          target: locator.target,
          path: locator.path,
          wait_timeout_ms: wait,
        },
        createReadFileServiceAdapter(
          services.readService,
          locator.target,
          context?.signal,
        ),
        context,
      );
    },
  };
}
