import { z } from "zod";
import { AppConfigError, readAppConfig } from "./app-config.js";
import type { FileSystemService } from "./filesystem-service.js";

export interface ExperimentalSettings {
  tools: boolean;
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
  })
  .passthrough();

const CONFIG_SCHEMA = z
  .object({
    experimental: EXPERIMENTAL_SCHEMA.optional(),
  })
  .passthrough();

/**
 * Load the typed experimental settings from the shared GitHits config.
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
    configPath: document.configPath,
  };
}
