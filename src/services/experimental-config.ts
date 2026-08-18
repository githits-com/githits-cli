import { z } from "zod";
import { AppConfigError, readAppConfig } from "./app-config.js";
import type { FileSystemService } from "./filesystem-service.js";

export const EXPERIMENTAL_REPORT_TOOL_ISSUES_MODES = [
  "experimental",
  "all",
] as const;
export type ExperimentalReportToolIssuesMode =
  (typeof EXPERIMENTAL_REPORT_TOOL_ISSUES_MODES)[number];

export interface ExperimentalSettings {
  tools: boolean;
  reportToolIssues: ExperimentalReportToolIssuesMode | undefined;
  configPath: string;
}

export class ExperimentalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExperimentalConfigError";
  }
}

const EXPERIMENTAL_SCHEMA = z
  .object({
    tools: z.boolean().optional(),
    report_tool_issues: z
      .enum(EXPERIMENTAL_REPORT_TOOL_ISSUES_MODES)
      .optional(),
  })
  .passthrough();

const CONFIG_SCHEMA = z
  .object({
    experimental: EXPERIMENTAL_SCHEMA.optional(),
  })
  .passthrough();

/**
 * Load the typed experimental settings from the shared GitHits config.
 *
 * The reporting mode is retained even when tools are disabled so later
 * consumers can decide how its dormant policy should be composed.
 */
export async function loadExperimentalSettings(
  fs: FileSystemService,
): Promise<ExperimentalSettings> {
  let document: Awaited<ReturnType<typeof readAppConfig>>;
  try {
    document = await readAppConfig(fs);
  } catch (error) {
    if (error instanceof AppConfigError) {
      throw new ExperimentalConfigError(error.message);
    }
    throw error;
  }
  const parsed = CONFIG_SCHEMA.safeParse(document.data);
  if (!parsed.success) {
    throw new ExperimentalConfigError(
      `Invalid GitHits config at ${document.configPath}: ${z.prettifyError(parsed.error)}`,
    );
  }

  return {
    tools: parsed.data.experimental?.tools ?? false,
    reportToolIssues: parsed.data.experimental?.report_tool_issues,
    configPath: document.configPath,
  };
}
