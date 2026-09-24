import { compactCodeSymbolFragment } from "@githits/core-internal";
import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  MCP_READ_DEFAULT_SPAN,
  MCP_READ_MAX_SPAN,
} from "../shared/code-navigation-defaults.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { mapPackageIntelligenceError } from "../shared/package-intelligence-error-map.js";
import { InvalidPackageSpecError } from "../shared/package-spec.js";
import {
  normalizeReadWaitTimeoutMs,
  resolveReadLocator,
  validateReadRange,
} from "../shared/read-request.js";
import { formatSelectorRead } from "../shared/read-selector-response.js";
import {
  createReadFileServiceAdapter,
  createReadPackageDocServiceAdapter,
} from "../shared/read-service-adapters.js";
import { CODE_READ_GUARDRAIL } from "./guardrails.js";
import { readSourceFile } from "./read-file.js";
import { readDocumentationPage } from "./read-package-doc.js";
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
      "With path: compact package or repo target, e.g. npm:react@18 or github:owner/repo@ref. Without path: docs target/page ID, compact code target#symbol, or compact code target with selector. Preserve HTTP(S) docs URLs and fragments unchanged.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Exact package/repo-relative file path from search, code_files or code_grep. Omit for documentation pages; empty means omitted.",
    ),
  selector: z
    .string()
    .optional()
    .describe(
      "Logical docs heading ID or indexed code symbol. With path, search exactly that file; omit path to search the code target. Do not combine with a docs URL fragment.",
    ),
  start_line: z
    .number()
    .optional()
    .describe(
      "Positive 1-indexed start. Either bound overrides a docs URL fragment with a page-relative range.",
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
      `Code indexing wait in ms (0-${MAX_WAIT_TIMEOUT_MS}, default ${DEFAULT_WAIT_TIMEOUT_MS}); validated but unused for docs.`,
    ),
  format: z
    .enum(["text", "json"])
    .default("text")
    .describe(
      "Omit `format` to use token-efficient text when the model reads the result. Use json when code consumes the raw response instead of the model or required metadata is absent from text.",
    ),
};

export const DESCRIPTION_BASE: string =
  "Read an indexed source file, code symbol, or documentation section. " +
  "Pass target and path for a file; use compact target#symbol or selector for a code symbol, and selector for a docs heading. " +
  "Replaces code_read and docs_read. " +
  "Hosted/crawled HTTP(S) docs targets read mutable current content; repository-doc targets address snapshots. " +
  "A docs URL fragment needs no bounds and returns its heading with the full subtree through the next equal-or-higher heading; either bound replaces it with a page-relative range. " +
  "Use emitted locators to preserve exact revisions. It does not list directories: use code_files. " +
  "Read focused windows from search/code_grep; follow returned continuation and error actions. " +
  "On INDEXING retry the same target/path with wait_timeout_ms; no content is available yet.";
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
        return mcpMappedErrorResult(mapCodeNavigationError(error), context);
      }
      const fragment = compactCodeSymbolFragment(locator.target, locator.path);
      if (args.selector !== undefined || fragment !== undefined) {
        try {
          const response = await services.readService.read({
            target: locator.target,
            ...(locator.path ? { path: locator.path } : {}),
            ...(args.selector !== undefined ? { selector: args.selector } : {}),
            ...(args.start_line !== undefined
              ? { startLine: args.start_line }
              : {}),
            ...(args.end_line !== undefined ? { endLine: args.end_line } : {}),
            waitTimeoutMs: wait,
          });
          return textResult(
            formatSelectorRead(
              response,
              {
                target: locator.target,
                selector: args.selector ?? fragment ?? "",
                codeFragment: fragment,
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
            docsError.code !== "UNKNOWN"
              ? docsError
              : mapCodeNavigationError(error),
            context,
          );
        }
      }
      if (locator.path !== undefined) {
        return readSourceFile(
          {
            ...args,
            target: locator.target,
            path: locator.path,
            wait_timeout_ms: wait,
          },
          createReadFileServiceAdapter(services.readService, locator.target),
          context,
        );
      }
      return readDocumentationPage(
        {
          page_id: locator.target,
          start_line: args.start_line,
          end_line: args.end_line,
          format: args.format,
        },
        createReadPackageDocServiceAdapter(services.readService),
        context,
      );
    },
  };
}
