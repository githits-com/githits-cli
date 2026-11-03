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
      "For docs, put the returned HTTP(S) page URL or docs ID in target and omit path. Never put a page URL in path or reconstruct its address. A site: target instead requires its exact page path (/ for root). Files use compact package/repo target plus relative path; target#symbol restricts to path when supplied.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Exact target-relative file or site-page path; do not repeat site scope. For symbols, include only a known declaration file, not a caller/import file. Reuse supplied or returned paths. Omit for other docs targets; empty means omitted.",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "Known code declaration name or returned heading ID for this same docs page. Omit if unknown; never pass an empty string or derive a heading ID from its title. For code symbols, include only a known declaration path; otherwise omit path. Site headings require a page path. Do not guess class qualifications or combine with a docs URL fragment or compact target#symbol. A docs URL fragment needs no bounds and selects the full subtree through the next equal-or-higher heading; either bound overrides it with a page-relative range.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      "Positive 1-indexed start. Include deciding conditions. Either bound overrides a docs fragment; bounds do not disambiguate symbols.",
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
      "Default text is for reading. Use json only when code consumes raw fields or text lacks required fields.",
    ),
};

export const DESCRIPTION_BASE: string = `Read an indexed source file, code symbol, or documentation section. Pass target and path for files/site pages; selector reads code symbols/docs headings. Read known code declarations with selector before searching/grepping; include only a known declaration path, never inferred caller qualifications. Follow helpers when their behavior matters; reuse definitions. On resolution failure, use a returned declaration range or literal grep; bounds do not disambiguate. Preserve emitted docs actions. If a heading is missing, do not retry it: read the same page without selector/fragment or use page-relative lines. If the page is unavailable, discover an indexed page with search and its source argument set to docs. Hosted docs are mutable; repository docs address snapshots. Read needed sections; continue only for missing content. Use list for directories. On INDEXING follow recovery for the same target/path.`;
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
