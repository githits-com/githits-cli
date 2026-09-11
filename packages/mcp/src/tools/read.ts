import { z } from "zod";
import {
  DEFAULT_WAIT_TIMEOUT_MS,
  MAX_WAIT_TIMEOUT_MS,
  MCP_READ_DEFAULT_SPAN,
  MCP_READ_MAX_SPAN,
} from "../shared/code-navigation-defaults.js";
import { mapCodeNavigationError } from "../shared/code-navigation-error-map.js";
import { InvalidPackageSpecError } from "../shared/package-spec.js";
import {
  normalizeReadWaitTimeoutMs,
  resolveReadLocator,
  validateReadRange,
} from "../shared/read-request.js";
import { CODE_READ_GUARDRAIL } from "./guardrails.js";
import { readSourceFile } from "./read-file.js";
import { readDocumentationPage } from "./read-package-doc.js";
import { mcpMappedErrorResult } from "./shared.js";
import type { McpToolServices } from "./tool-services.js";
import {
  READ_ONLY_TOOL_ANNOTATIONS,
  type ToolDefinition,
  type ZodRawShape,
} from "./types.js";

export interface ReadArgs {
  target: string;
  path?: string;
  start_line?: number;
  end_line?: number;
  wait_timeout_ms?: number;
  format?: "text" | "json";
}

interface ReadSchema extends ZodRawShape {
  target: z.ZodString;
  path: z.ZodOptional<z.ZodString>;
  start_line: z.ZodOptional<z.ZodNumber>;
  end_line: z.ZodOptional<z.ZodNumber>;
  wait_timeout_ms: z.ZodOptional<z.ZodNumber>;
  format: z.ZodDefault<z.ZodEnum<{ text: "text"; json: "json" }>>;
}

export const readSchema: ReadSchema = {
  target: z
    .string()
    .describe(
      "With path: compact package or repo target, e.g. npm:react@18 or github:owner/repo#ref. Without path: emitted docsReadTarget or page ID; pass unchanged, including URL fragments.",
    ),
  path: z
    .string()
    .optional()
    .describe(
      "Exact package/repo-relative file path from search, code_files or code_grep. Omit for documentation pages; empty means omitted.",
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
  "Read an indexed source file or documentation page, including a docs section. " +
  "Pass target and path for a file; target alone for a docs page. " +
  "A docs URL fragment needs no bounds; either bound replaces it with a page-relative range. " +
  "Use emitted locators to preserve exact revisions. It does not list directories: use code_files. " +
  "Read focused windows from search/code_grep; follow returned continuation and error actions. " +
  "On INDEXING retry the same target/path with wait_timeout_ms; no content is available yet.";
export const DESCRIPTION: string = `${DESCRIPTION_BASE}\n\n${CODE_READ_GUARDRAIL}`;

/** One advertised reader; source-specific selection and error contracts stay intact. */
export function createReadTool(
  services: Pick<
    McpToolServices,
    "codeNavigationService" | "packageIntelligenceService"
  >,
): ToolDefinition<ReadArgs, typeof readSchema> {
  return {
    name: "read",
    description: DESCRIPTION,
    schema: readSchema,
    annotations: READ_ONLY_TOOL_ANNOTATIONS,
    handler: async (args, context) => {
      let locator: ReturnType<typeof resolveReadLocator>;
      let wait: number;
      try {
        locator = resolveReadLocator(args.target, args.path);
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
      if (locator.path !== undefined) {
        return readSourceFile(
          {
            ...args,
            target: locator.target,
            path: locator.path,
            wait_timeout_ms: wait,
          },
          services.codeNavigationService,
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
        services.packageIntelligenceService,
        context,
      );
    },
  };
}
