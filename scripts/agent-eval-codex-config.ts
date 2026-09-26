import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod";
import type { CodexReasoningEffort } from "./agent-eval.ts";

const modelProviderSchema = z.strictObject({
  name: z.string().min(1),
  base_url: z.url().refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }),
  env_key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  wire_api: z.literal("responses"),
});

const modelConfigSchema = z.object({
  model: z.string().min(1),
  model_provider: z.string().min(1),
  model_reasoning_effort: z
    .enum(["minimal", "low", "medium", "high", "xhigh", "max", "ultra"])
    .optional(),
  model_catalog_json: z.string().min(1).optional(),
  model_providers: z.record(z.string(), z.unknown()),
});

export interface CodexEvalConfigMetadata {
  path: string;
  sha256: string;
  catalogSha256: string | null;
  provider: string;
}

export interface CodexEvalConfig {
  model: string;
  reasoningEffort?: CodexReasoningEffort;
  envKey: string;
  configArgs: string[];
  metadata: CodexEvalConfigMetadata;
}

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

/**
 * Projects model settings from a caller-selected main config into CLI arguments.
 * Codex's ignore-user-config flag also suppresses native profile loading;
 * projecting only model settings keeps workload isolation intact.
 * Never include TOML parser errors: they can quote inline credentials.
 */
export function loadCodexEvalConfig(path: string): CodexEvalConfig {
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new Error("Could not read Codex eval config");
  }
  let decoded: unknown;
  try {
    decoded = parseToml(contents);
  } catch {
    throw new Error("Could not parse Codex eval config as TOML");
  }
  const parsed = modelConfigSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Codex eval config must select a model and provider");
  }
  const config = parsed.data;
  const selected = modelProviderSchema.safeParse(
    config.model_providers[config.model_provider],
  );
  if (!selected.success) {
    throw new Error(
      "Codex eval config must define its selected env-key Responses provider",
    );
  }
  const provider = selected.data;
  const configArgs = [
    "-c",
    `model_provider=${JSON.stringify(config.model_provider)}`,
    "-c",
    // Codex splits dotted override keys literally, including quote characters.
    // One table value preserves TOML key semantics without identifier escaping.
    `model_providers={${JSON.stringify(config.model_provider)}={${Object.entries(
      provider,
    )
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join(",")}}}`,
  ];
  let catalogSha256: string | null = null;
  if (config.model_catalog_json) {
    const catalogPath = resolve(dirname(path), config.model_catalog_json);
    try {
      catalogSha256 = sha256(readFileSync(catalogPath, "utf8"));
    } catch {
      throw new Error("Could not read Codex eval config model catalog");
    }
    configArgs.push("-c", `model_catalog_json=${JSON.stringify(catalogPath)}`);
  }
  return {
    model: config.model,
    reasoningEffort: config.model_reasoning_effort,
    envKey: provider.env_key,
    configArgs,
    metadata: {
      path: resolve(path),
      sha256: sha256(contents),
      catalogSha256,
      provider: config.model_provider,
    },
  };
}
