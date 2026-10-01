import { z } from "zod";
import { AppConfigError, readAppConfig } from "./app-config.js";
import type { FileSystemService } from "./filesystem-service.js";

/** Local skill maintenance settings loaded from the shared GitHits config. */
export interface SkillUpdateSettings {
  /** Whether local MCP skill maintenance is enabled. */
  autoUpdate: boolean;
  /** Canonical or legacy config path selected by the shared config reader. */
  configPath: string;
}

/** Raised when the shared config cannot be read or has invalid skill settings. */
export class SkillConfigError extends Error {
  /** Create a sanitized skill config error. */
  constructor(message: string) {
    super(message);
    this.name = "SkillConfigError";
  }
}

const SKILLS_SCHEMA = z
  .object({
    auto_update: z.boolean().optional(),
  })
  .passthrough();

const CONFIG_SCHEMA = z
  .object({
    skills: SKILLS_SCHEMA.optional(),
  })
  .passthrough();

/**
 * Load typed local skill update settings from the shared GitHits config.
 * Missing config or `skills.auto_update` defaults to enabled.
 *
 * @throws {SkillConfigError} when config parsing or setting validation fails.
 */
export async function loadSkillUpdateSettings(
  fs: FileSystemService,
): Promise<SkillUpdateSettings> {
  let document: Awaited<ReturnType<typeof readAppConfig>>;
  try {
    document = await readAppConfig(fs);
  } catch (error) {
    if (error instanceof AppConfigError) {
      throw new SkillConfigError("Cannot read or parse GitHits config.");
    }
    throw error;
  }

  const parsed = CONFIG_SCHEMA.safeParse(document.data);
  if (!parsed.success) {
    throw new SkillConfigError(
      `Invalid skills.auto_update in GitHits config at ${document.configPath}.`,
    );
  }

  return {
    autoUpdate: parsed.data.skills?.auto_update ?? true,
    configPath: document.configPath,
  };
}
